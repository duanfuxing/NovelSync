import sys
import os
import io
import threading
from collections import deque
from datetime import datetime

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # 将启动第一时间挂载 dotenv 控制器并执行环境判断
from fastapi import FastAPI, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

from storage.database import init_db
from storage.crud import upsert_client_config, get_client_config, clear_client_config, upsert_bjh_cookies, get_all_bjh_cookies, get_watch_path, set_watch_path, get_all_worker_status, get_novel_list, get_dashboard_stats, upsert_user_profile, get_active_user_phone
from core.miaobi_client import MiaobiClient


# ========== 日志捕获 ==========

class LogCapture(io.TextIOBase):
    """捕获 stdout 输出到环形缓冲区，同时保留原始输出"""
    def __init__(self, original_stdout, max_lines=500):
        self.original = original_stdout
        self.buffer = deque(maxlen=max_lines)
        self.lock = threading.Lock()

    def write(self, text):
        self.original.write(text)
        if text and text.strip():
            with self.lock:
                self.buffer.append({
                    "time": datetime.now().strftime("%H:%M:%S"),
                    "message": text.strip()
                })
        return len(text)

    def flush(self):
        self.original.flush()

    def get_logs(self):
        with self.lock:
            return list(self.buffer)

    def clear(self):
        with self.lock:
            self.buffer.clear()

log_capture = LogCapture(sys.stdout)
sys.stdout = log_capture


# ========== Request Models ==========

class SendCodeItem(BaseModel):
    """发送验证码请求体"""
    account: str        # 手机号
    channel: str = "sms"
    action: str = "login"


class LoginItem(BaseModel):
    """短信验证码登录请求体"""
    account: str        # 手机号
    verifyCode: str     # 验证码
    channel: str = "sms"
    client_id: str      # 本机设备标识（仅用于本地落盘，不转发给妙笔）


class SetWatchPathItem(BaseModel):
    """设置监控目录请求体"""
    client_id: str
    watch_path: str


# ========== FastAPI App ==========

app = FastAPI(title="NovelSync Core API Base")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    from storage.database import init_db
    from storage.crud import reset_all_worker_status
    from workers.scheduler import scheduler
    from workers.account_sync import AccountSyncWorker
    from workers.article_sync import ArticleSyncWorker
    from workers.order_sync import OrderSyncWorker
    from workers.file_watcher import FileWatcherWorker

    # 1. 初始化数据库
    init_db()

    # 2. 重置旧的 Worker 状态
    reset_all_worker_status()

    # 3. 注册并启动所有 Worker 线程
    scheduler.register(AccountSyncWorker())
    scheduler.register(ArticleSyncWorker())
    scheduler.register(OrderSyncWorker())
    scheduler.register(FileWatcherWorker())
    scheduler.start_all()

    print("[API] NovelSync API Engine Started")


@app.get("/health")
def health_check():
    return {"status": "running"}


# ========== 认证代理路由 ==========

@app.post("/auth/send-code")
def proxy_send_code(item: SendCodeItem):
    """代理转发：发送短信验证码"""
    try:
        client = MiaobiClient()
        res_data = client.send_verify_message(
            account=item.account,
            channel=item.channel,
            action=item.action
        )

        if res_data.get("code") != 10000:
            return {"code": res_data.get("code", 500), "message": res_data.get("message", "发送验证码失败")}

        return {
            "code": 10000,
            "message": res_data.get("message", "发送成功"),
            "data": res_data.get("data", {}),
        }
    except Exception as e:
        print(f"[Auth Proxy] 发送验证码失败: {e}")
        return {"code": 500, "message": f"代理层异常: {e}"}


@app.post("/auth/login")
def proxy_login(item: LoginItem, background_tasks: BackgroundTasks):
    """
    代理转发：短信验证码登录
    登录成功后自动拉取用户详情，一并落盘到本地 SQLite。
    """
    try:
        # Step 1: 调用妙笔登录接口
        client = MiaobiClient()
        res_data = client.login(
            account=item.account,
            verify_code=item.verifyCode,
            channel=item.channel
        )

        if res_data.get("code") != 10000:
            return {"code": res_data.get("code", 500), "message": res_data.get("message", "登录失败")}

        login_data = res_data.get("data", {})
        token = login_data.get("token", "")

        # Step 2: 用拿到的 Token 拉取完整用户信息（失败时用空 dict 兜底，走 login_data fallback）
        user_info = _fetch_user_info(token) or {}

        # Step 3: 合并数据，落盘到 SQLite
        uid = login_data.get("code", "")  # 妙笔用 code 作为用户唯一标识
        nick_name = user_info.get("nickName") or login_data.get("nickName", "")
        avatar = user_info.get("avatar") or login_data.get("avatar", "")
        phone = user_info.get("phone") or login_data.get("phone", "")
        vip_level = user_info.get("vipLevel") if user_info.get("vipLevel") is not None else login_data.get("vipLevel", 0)

        upsert_client_config(
            client_id=item.client_id,
            token=token,
            uid=uid,
            nick_name=nick_name,
            avatar=avatar,
            phone=phone,
            vip_level=vip_level,
        )

        # 写入用户信息到 UserProfile 表
        upsert_user_profile(
            phone=phone,
            uid=uid,
            nick_name=nick_name,
            avatar=avatar,
            vip_level=vip_level,
        )

        # 触发后台任务：抓取并分页合并用户下的百家号 Cookies 并入库
        background_tasks.add_task(_sync_user_cookies_task, token, phone)

        return {
            "code": 10000,
            "message": "登录成功",
            "data": {
                "uid": uid,
                "token": token,
                "nickName": nick_name,
                "avatar": avatar,
                "phone": phone,
                "vipLevel": vip_level,
                "inkNumber": login_data.get("ink_number", 0),
            },
        }
    except Exception as e:
        print(f"[Auth Proxy] 登录代理异常: {e}")
        return {"code": 500, "message": f"代理层异常: {e}"}


@app.get("/auth/user-info")
def get_user_info(client_id: str):
    """
    读取本地 SQLite 中已落盘的用户信息（与 login 写入对称）。
    前端不需要再透传 Token，直接传 client_id 即可获取本地缓存的用户 Profile。
    """
    try:
        config_data = get_client_config(client_id)
        if config_data:
            return {"code": 10000, "message": "success", "data": config_data}
        return {"code": 401, "message": "本地无用户信息，请先登录"}
    except Exception as e:
        print(f"[Auth Proxy] 获取用户信息失败: {e}")
        return {"code": 500, "message": f"获取用户信息异常: {e}"}


@app.get("/auth/session")
def restore_session(client_id: str, background_tasks: BackgroundTasks):
    """
    从本地 SQLite 读取已有登录态，用于应用启动时自动恢复会话。
    前端启动时调用此接口，如果有有效 Token 则无需重新登录。
    """
    try:
        config_data = get_client_config(client_id)
        if config_data:
            # 验证 Token 是否仍然有效：调一次用户信息接口
            user_info = _fetch_user_info(config_data["token"])
            if user_info:
                phone = user_info.get("phone") or config_data.get("phone", "")
                # 更新 UserProfile
                if phone:
                    upsert_user_profile(
                        phone=phone,
                        uid=config_data.get("uid", ""),
                        nick_name=user_info.get("nickName"),
                        avatar=user_info.get("avatar"),
                        vip_level=user_info.get("vipLevel", 0),
                    )
                # 恢复登录态时，静默触发一次同步
                if phone:
                    background_tasks.add_task(_sync_user_cookies_task, config_data["token"], phone)

                return {
                    "code": 10000,
                    "message": "会话恢复成功",
                    "data": {
                        "uid": config_data["uid"],
                        "token": config_data["token"],
                        "nickName": user_info.get("nickName", config_data.get("nickName")),
                        "avatar": user_info.get("avatar", config_data.get("avatar")),
                        "phone": user_info.get("phone", config_data.get("phone")),
                        "vipLevel": user_info.get("vipLevel", config_data.get("vipLevel", 0)),
                    },
                }
            else:
                # Token 已失效，清除本地登录态
                clear_client_config(client_id)
                return {"code": 401, "message": "本地会话已过期，请重新登录"}

        return {"code": 401, "message": "无本地登录态"}
    except Exception as e:
        print(f"[Auth Proxy] 恢复会话失败: {e}")
        return {"code": 500, "message": f"恢复会话异常: {e}"}


@app.post("/auth/logout")
def logout(client_id: str):
    """清除本地登录态"""
    try:
        clear_client_config(client_id)
        return {"code": 10000, "message": "已退出登录"}
    except Exception as e:
        return {"code": 500, "message": f"退出登录失败: {e}"}


# ========== 设置类路由 ==========

@app.get("/settings/watch-path")
def api_get_watch_path(client_id: str):
    """读取本地已保存的监控目录路径"""
    try:
        path = get_watch_path(client_id)
        return {"code": 10000, "message": "success", "data": {"watchPath": path}}
    except Exception as e:
        return {"code": 500, "message": f"读取监控目录失败: {e}"}


@app.post("/settings/watch-path")
def api_set_watch_path(item: SetWatchPathItem):
    """保存监控目录路径到本地 SQLite"""
    import os
    try:
        if not os.path.isdir(item.watch_path):
            return {"code": 400, "message": f"路径不存在或不是目录: {item.watch_path}"}
        set_watch_path(item.client_id, item.watch_path)
        return {"code": 10000, "message": "保存成功", "data": {"watchPath": item.watch_path}}
    except ValueError as e:
        return {"code": 401, "message": str(e)}
    except Exception as e:
        return {"code": 500, "message": f"保存监控目录失败: {e}"}


@app.get("/settings/pick-directory")
def api_pick_directory():
    """弹出系统原生文件夹选取器，返回用户选中的路径"""
    import subprocess
    import platform
    try:
        system = platform.system()
        if system == "Darwin":
            # macOS: 用 osascript 弹原生 Finder 对话框
            script = 'tell application "Finder" to set thePath to POSIX path of (choose folder with prompt "选择小说原稿监控目录")'
            result = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True, text=True, timeout=120
            )
            if result.returncode != 0:
                return {"code": 400, "message": "用户取消了选择"}
            path = result.stdout.strip()
        elif system == "Windows":
            # Windows: 用 PowerShell
            ps_cmd = "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description='选择小说原稿监控目录'; if($f.ShowDialog() -eq 'OK'){$f.SelectedPath}"
            result = subprocess.run(
                ["powershell", "-Command", ps_cmd],
                capture_output=True, text=True, timeout=120
            )
            path = result.stdout.strip()
            if not path:
                return {"code": 400, "message": "用户取消了选择"}
        else:
            # Linux: 用 zenity
            result = subprocess.run(
                ["zenity", "--file-selection", "--directory", "--title=选择小说原稿监控目录"],
                capture_output=True, text=True, timeout=120
            )
            if result.returncode != 0:
                return {"code": 400, "message": "用户取消了选择"}
            path = result.stdout.strip()

        if path:
            return {"code": 10000, "message": "success", "data": {"path": path}}
        return {"code": 400, "message": "用户取消了选择"}
    except subprocess.TimeoutExpired:
        return {"code": 400, "message": "选择超时，请重试"}
    except Exception as e:
        return {"code": 500, "message": f"打开目录选择器失败: {e}"}


# ========== 业务代理路由 ==========

@app.get("/sync/bjh/cookies")
def get_and_sync_cookies():
    """
    读取当前登录用户的百家号 Cookie 列表（仅读本地 SQLite，不触发云端同步）。
    云端同步由 AccountSyncWorker 定时处理，前端轮询此接口获取最新本地数据。
    """
    
    try:
        # 读取当前用户的百家号授权
        user_phone = get_active_user_phone() or ""
        cookies = get_all_bjh_cookies(user_phone=user_phone)
        return {
            "code": 10000,
            "message": "success",
            "data": cookies
        }
    except Exception as e:
        return {"code": 500, "message": f"获取 Cookies 失败: {e}"}


# ========== 首页统计 ==========

@app.get("/dashboard/stats")
def dashboard_stats():
    """首页数据统计：百家号总数、文章总数、订单总额"""
    try:
        user_phone = get_active_user_phone() or ""
        stats = get_dashboard_stats(user_phone=user_phone)
        return {"code": 10000, "message": "success", "data": stats}
    except Exception as e:
        return {"code": 500, "message": f"获取统计数据失败: {e}"}


# ========== 小说列表 ==========

@app.get("/novels/list")
def get_novels(
    page: int = 1,
    page_size: int = 10,
    keyword: str = "",
    app_id: str = "",
    start_date: str = "",
    end_date: str = "",
    sort_field: str = "publish_time",
    sort_order: str = "desc",
):
    """小说列表分页查询（关联 articles + orders）"""
    try:
        result = get_novel_list(
            page=page,
            page_size=page_size,
            keyword=keyword,
            app_id=app_id,
            start_date=start_date,
            end_date=end_date,
            sort_field=sort_field,
            sort_order=sort_order,
            user_phone=get_active_user_phone() or "",
        )
        return {"code": 10000, "message": "success", "data": result}
    except Exception as e:
        print(f"[API] 查询小说列表失败: {e}")
        return {"code": 500, "message": f"查询失败: {e}"}


# ========== Worker 状态查询 ==========

@app.get("/workers/status")
def get_workers_status():
    """查询所有 Worker 的运行状态（前端轮询展示用）"""
    interval_map = {
        "AccountSyncWorker": config.WORKER_INTERVAL_ACCOUNT_SYNC,
        "ArticleSyncWorker": config.WORKER_INTERVAL_ARTICLE_SYNC,
        "OrderSyncWorker": config.WORKER_INTERVAL_ORDER_SYNC,
        "FileWatcherWorker": config.WORKER_INTERVAL_FILE_WATCHER,
    }
    try:
        statuses = get_all_worker_status()
        for s in statuses:
            s["intervalSeconds"] = interval_map.get(s["workerName"], 0)
        return {"code": 10000, "message": "success", "data": statuses}
    except Exception as e:
        return {"code": 500, "message": f"查询 Worker 状态失败: {e}"}


@app.post("/workers/trigger")
def trigger_worker(worker_name: str):
    """手动触发指定 Worker 立即执行一次（唤醒已有线程）"""
    from workers.scheduler import scheduler
    if scheduler.trigger(worker_name):
        return {"code": 10000, "message": f"{worker_name} 已触发执行"}
    return {"code": 400, "message": f"未知的 Worker: {worker_name}"}


# ========== 调试接口 ==========

@app.get("/debug/logs")
async def get_debug_logs():
    """获取最近的运行日志"""
    return {"code": 10000, "data": log_capture.get_logs()}

@app.post("/debug/logs/clear")
async def clear_debug_logs():
    """清空日志缓冲区"""
    log_capture.clear()
    return {"code": 10000, "message": "日志已清空"}

# ========== 内部工具函数 ==========

def _fetch_user_info(token: str) -> dict | None:
    """调用妙笔 /user/info 接口获取用户信息"""
    try:
        client = MiaobiClient(token)
        res_data = client.get_user_info()
        if res_data.get("code") == 10000:
            return res_data.get("data", {})
        return None
    except Exception as e:
        print(f"[Auth Proxy] _fetch_user_info 异常: {e}")
        return None

def _sync_user_cookies_task(token: str, user_phone: str = ""):
    """后台任务：分页拉取所有用户的 Cookie 记录并写入缓存"""
    page = 1
    total_cookies = []
    
    try:
        client = MiaobiClient(token)
        while True:
            res_data = client.get_user_cookies(page=page)
            if res_data.get("code") != 10000:
                print(f"[Cookie Sync] 获取 cookie 列表失败(page={page}), msg: {res_data.get('message', '未知错误')}")
                break
                
            data_dict = res_data.get("data", {})
            pagination = data_dict.get("pagination", {})
            current_list = data_dict.get("data", [])

            if not current_list:
                break

            total_cookies.extend(current_list)
            
            current_page = page  # API 的 currentPage 不可靠（始终返回 1），用本地 page 判断
            last_page = pagination.get("lastPage", page)
            
            if current_page >= last_page:
                break
                
            page += 1
            
        # 写入本地存储
        if total_cookies:
            upsert_bjh_cookies(total_cookies, user_phone=user_phone)
            print(f"[Cookie Sync] 异步同步结束，总共写入/更新 {len(total_cookies)} 条记录")
        else:
            print(f"[Cookie Sync] 账号下无可用缓存的 Cookie。")
        
    except Exception as e:
        print(f"[Cookie Sync] 发生异常: {e}")
