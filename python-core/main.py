"""
NovelSync 启动入口
用法: APP_ENV=dev uvicorn python-core.api.main:app --host 127.0.0.1 --port 18321 --reload
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config  # noqa: E402
from utils.log_setup import init_logging  # noqa: E402
init_logging()

if __name__ == "__main__":
    import uvicorn
    from urllib.parse import urlparse

    # 从 env 读取端口，与前端 VITE_LOCAL_API_BASE_URL 保持一致
    _api_url = os.environ.get("VITE_LOCAL_API_BASE_URL", "http://127.0.0.1:18321")
    _port = urlparse(_api_url).port or 18321

    print(f"[Main] 启动 API 服务 (http://127.0.0.1:{_port})")

    if getattr(sys, 'frozen', False):
        # PyInstaller 打包后：直接导入 app 对象，避免字符串导入找不到模块
        from api.main import app
        uvicorn.run(app, host="127.0.0.1", port=_port)
    else:
        # 开发环境：字符串导入，支持 --reload 热更新
        uvicorn.run("api.main:app", host="127.0.0.1", port=_port)
