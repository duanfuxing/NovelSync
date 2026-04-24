import os
import sys
from dotenv import load_dotenv

def bind_environment():
    # 1.定位基础目录
    #   PyInstaller 打包后文件在 sys._MEIPASS 临时目录中
    #   常规运行时在项目根目录（python-core 的上级）
    if getattr(sys, 'frozen', False):
        base_dir = sys._MEIPASS
    else:
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # 2.确定运行环境
    #   打包后: 从构建时生成的 .env.runtime 文件读取（因为 OS 环境变量 APP_ENV 不可用）
    #   开发时: 从 OS 环境变量读取
    app_env = os.environ.get("APP_ENV", "dev").lower()
    runtime_flag = os.path.join(base_dir, ".env.runtime")
    if getattr(sys, 'frozen', False) and os.path.exists(runtime_flag):
        with open(runtime_flag, "r", encoding="utf-8-sig") as f:
            app_env = f.read().strip().lower() or app_env
    
    if app_env in ["prod", "production"]:
        env_path = os.path.join(base_dir, ".env.production")
        mode = "PROD"
    else:
        env_path = os.path.join(base_dir, ".env.development")
        mode = "DEV"
        
    # 3.挂载到 Python 的 os.environ 系统字典里去
    if os.path.exists(env_path):
        load_dotenv(dotenv_path=env_path, override=True)
        print(f"[Config Engine] Env variables LOADED. Mode: {mode} ({env_path})")
    else:
        print(f"[Config Engine] Warning! Failed to locate target file: {env_path}")

# 初始化时即加载
bind_environment()

# 此处即可提取供后端调用的真实服务器接口。不论前挂什么模式它都是自适应的！
CLOUD_API_BASE_URL = os.environ.get("VITE_CLOUD_API_BASE_URL", "")

# Worker 轮询间隔 (秒)
WORKER_INTERVAL_ACCOUNT_SYNC = int(os.environ.get("WORKER_INTERVAL_ACCOUNT_SYNC", 60))
WORKER_INTERVAL_ARTICLE_SYNC = int(os.environ.get("WORKER_INTERVAL_ARTICLE_SYNC", 7200))
WORKER_INTERVAL_ORDER_SYNC   = int(os.environ.get("WORKER_INTERVAL_ORDER_SYNC", 7200))
WORKER_INTERVAL_FILE_WATCHER = int(os.environ.get("WORKER_INTERVAL_FILE_WATCHER", 300))
