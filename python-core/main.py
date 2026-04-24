"""
NovelSync 启动入口
用法: APP_ENV=dev uvicorn python-core.api.main:app --host 127.0.0.1 --port 18321 --reload
"""
import sys
import os
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config  # noqa: E402
from utils.log_setup import init_logging  # noqa: E402
init_logging()


def _watch_parent_process():
    """
    守护线程：监听父进程（Tauri）是否存活。
    父进程死亡后 Python sidecar 自行退出，防止进程残留。
    兼容 macOS / Windows / Linux。
    """
    ppid = os.getppid()
    print(f"[Main] 父进程监控已启动 (parent PID={ppid})")

    while True:
        time.sleep(2)
        try:
            if sys.platform == "win32":
                # Windows: 用 ctypes 调 OpenProcess 检测进程是否存在
                import ctypes
                kernel32 = ctypes.windll.kernel32
                SYNCHRONIZE = 0x00100000
                handle = kernel32.OpenProcess(SYNCHRONIZE, False, ppid)
                if handle == 0:
                    # 进程不存在
                    break
                kernel32.CloseHandle(handle)
            else:
                # macOS / Linux: 发 signal 0 检测进程是否存在
                os.kill(ppid, 0)
        except (OSError, ProcessLookupError):
            break

    print(f"[Main] 父进程 (PID={ppid}) 已退出，sidecar 自行终止")
    os._exit(0)


if __name__ == "__main__":
    import uvicorn
    from urllib.parse import urlparse

    # 从 env 读取端口，与前端 VITE_LOCAL_API_BASE_URL 保持一致
    _api_url = os.environ.get("VITE_LOCAL_API_BASE_URL", "http://127.0.0.1:18321")
    _port = urlparse(_api_url).port or 18321

    print(f"[Main] 启动 API 服务 (http://127.0.0.1:{_port})")

    # 启动父进程存活监控（仅打包环境启用，开发环境不需要）
    if getattr(sys, 'frozen', False):
        watcher = threading.Thread(target=_watch_parent_process, daemon=True)
        watcher.start()

    if getattr(sys, 'frozen', False):
        # PyInstaller 打包后：直接导入 app 对象，避免字符串导入找不到模块
        from api.main import app
        uvicorn.run(app, host="127.0.0.1", port=_port)
    else:
        # 开发环境：字符串导入，支持 --reload 热更新
        uvicorn.run("api.main:app", host="127.0.0.1", port=_port)
