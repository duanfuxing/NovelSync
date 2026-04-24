import multiprocessing
import threading
import time
from typing import Dict, Type
from workers.base_worker import BaseWorker


class SyncManager:
    """Worker 进程生命周期管理器"""

    def __init__(self):
        self.workers: Dict[str, multiprocessing.Process] = {}
        self.worker_classes: Dict[str, Type[BaseWorker]] = {}
        self._health_thread: threading.Thread | None = None
        self._running = False

    def register_worker(self, name: str, worker_cls: Type[BaseWorker]):
        self.worker_classes[name] = worker_cls

    def _start_worker(self, name: str):
        """启动单个 Worker 子进程"""
        if name not in self.worker_classes:
            return
        worker = self.worker_classes[name]()
        p = multiprocessing.Process(target=worker.run, name=name, daemon=True)
        p.start()
        self.workers[name] = p
        print(f"[SyncManager] Worker '{name}' 启动成功 (PID={p.pid})")

    def start_all(self):
        """启动所有 Worker + 健康检查线程"""
        self._running = True
        for name in self.worker_classes:
            self._start_worker(name)
        self._health_thread = threading.Thread(target=self._health_loop, daemon=True)
        self._health_thread.start()

    def stop_all(self):
        """终止所有 Worker 子进程"""
        self._running = False
        for name, p in self.workers.items():
            if p.is_alive():
                p.terminate()
                p.join(timeout=5)
                print(f"[SyncManager] Worker '{name}' 已停止")
        self.workers.clear()

    def _health_loop(self):
        """后台健康检查：发现死掉的 Worker 自动拉起"""
        while self._running:
            time.sleep(10)
            for name in list(self.worker_classes.keys()):
                p = self.workers.get(name)
                if p and not p.is_alive():
                    print(f"[SyncManager] Worker '{name}' 异常退出，正在重启...")
                    self._start_worker(name)
