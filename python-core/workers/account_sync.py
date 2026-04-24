import config
from workers.base_worker import BaseWorker
from core.miaobi_client import MiaobiClient
from storage.crud import upsert_bjh_cookies, get_active_user_phone


class AccountSyncWorker(BaseWorker):
    """
    账号同步 Worker：
    1. 定时从妙笔云端拉取最新的百家号 Cookie 列表，写入本地 SQLite
    """
    interval = config.WORKER_INTERVAL_ACCOUNT_SYNC

    def process(self):
        print("[AccountSync] ========== 开始同步百家号 Cookie ==========")

        user_phone = get_active_user_phone()
        if not user_phone:
            print("[AccountSync] 未获取到当前用户 phone，跳过同步。")
            return

        client = MiaobiClient()
        print(f"[AccountSync] base_url={client.base_url}, token={'有' if client.token else '无'}, timeout={client.timeout}s")
        if not client.token:
            print("[AccountSync] Token 不存在，跳过本轮同步。")
            return

        page = 1
        total_cookies = []

        while True:
            print(f"[AccountSync] 请求第 {page} 页...")
            try:
                res_data = client.get_user_cookies(page=page)
                print(f"[AccountSync] 第 {page} 页响应 code={res_data.get('code')}, message={res_data.get('message', '')}")

            except Exception as e:
                print(f"[AccountSync] 请求第 {page} 页异常: {type(e).__name__}: {e}")
                break

            if res_data.get("code") != 10000:
                print(f"[AccountSync] 获取 Cookie 列表失败 (page={page}): {res_data.get('message', '未知错误')}")
                break

            data_dict = res_data.get("data", {})
            pagination = data_dict.get("pagination", {})
            current_list = data_dict.get("data", [])

            if not current_list:
                print(f"[AccountSync] 第 {page} 页返回空数据，提前退出分页循环")
                break

            total_cookies.extend(current_list)

            current_page = page  # API 的 currentPage 不可靠（始终返回 1），用本地 page 判断
            last_page = pagination.get("lastPage", page)

            print(f"[AccountSync] 第 {page} 页: 本页 {len(current_list)} 条, 累计 {len(total_cookies)} 条, page={page}, lastPage={last_page}")

            if current_page >= last_page:
                print(f"[AccountSync] 已到达最后一页，退出分页循环")
                break
            page += 1

        if total_cookies:
            upsert_bjh_cookies(total_cookies, user_phone=user_phone, cleanup_orphans=True)
            print(f"[AccountSync] 同步完成，写入/更新 {len(total_cookies)} 条 Cookie 记录。")
        else:
            print("[AccountSync] 本轮未获取到 Cookie 数据。")
