"""
日志初始化：把 stdout/stderr 同时输出到控制台和日志文件。
所有 print() 自动进日志文件，无需改动现有代码。

日志文件位置：
  - 打包后: ~/Library/Application Support/NovelSync/logs/
  - 开发环境: python-core/data/logs/

特性：
  - 每天一个日志文件 (novelsync_YYYY-MM-DD.log)
  - 跨天自动切换到新文件
  - 自动清理 7 天前的旧日志
  - 与 api/main.py 的 LogCapture（调试控制台）兼容，链式输出互不干扰
"""
import os
import sys
from datetime import datetime


class _StreamTee:
    """同时写入原始流（控制台）和日志文件，支持跨天自动切换文件"""

    def __init__(self, original_stream, log_dir: str):
        self._original = original_stream
        self._log_dir = log_dir
        self._current_date = datetime.now().strftime("%Y-%m-%d")
        self._log_file = self._open_log_file(self._current_date)

    def _open_log_file(self, date_str: str):
        path = os.path.join(self._log_dir, f"novelsync_{date_str}.log")
        return open(path, "a", encoding="utf-8", buffering=1)

    def _check_date_rollover(self):
        """检查是否跨天，自动切换到新的日志文件"""
        today = datetime.now().strftime("%Y-%m-%d")
        if today != self._current_date:
            try:
                self._log_file.close()
            except Exception:
                pass
            self._current_date = today
            self._log_file = self._open_log_file(today)

    def write(self, data):
        if data:
            self._original.write(data)
            try:
                self._check_date_rollover()
                self._log_file.write(data)
                self._log_file.flush()
            except Exception:
                pass

    def flush(self):
        self._original.flush()
        try:
            self._log_file.flush()
        except Exception:
            pass

    # 保留原始流的属性（uvicorn 等库可能会用到）
    def fileno(self):
        return self._original.fileno()

    def isatty(self):
        return self._original.isatty()


def _get_log_dir() -> str:
    """日志目录跟 DB 同级"""
    if getattr(sys, 'frozen', False):
        if sys.platform == 'darwin':
            base = os.path.expanduser("~/Library/Application Support/NovelSync")
        elif sys.platform == 'win32':
            base = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "NovelSync")
        else:
            base = os.path.join(os.path.expanduser("~"), ".novelsync")
    else:
        base = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")

    log_dir = os.path.join(base, "logs")
    os.makedirs(log_dir, exist_ok=True)
    return log_dir


def _cleanup_old_logs(log_dir: str, keep_days: int = 7):
    """自动清理超过 keep_days 天的旧日志"""
    try:
        now = datetime.now().timestamp()
        for f in os.listdir(log_dir):
            if not f.endswith(".log"):
                continue
            path = os.path.join(log_dir, f)
            if now - os.path.getmtime(path) > keep_days * 86400:
                os.remove(path)
    except Exception:
        pass


def init_logging():
    """
    初始化日志系统，把 stdout/stderr tee 到日志文件。
    每天一个日志文件: novelsync_2026-04-09.log
    自动清理 7 天前的旧日志。
    """
    log_dir = _get_log_dir()
    _cleanup_old_logs(log_dir)

    sys.stdout = _StreamTee(sys.__stdout__, log_dir)
    sys.stderr = _StreamTee(sys.__stderr__, log_dir)

    log_path = os.path.join(log_dir, f"novelsync_{datetime.now().strftime('%Y-%m-%d')}.log")
    print(f"[Log] 日志文件: {log_path}")
