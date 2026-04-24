from workers.base_worker import BaseWorker


class WorkerScheduler:
    """
    Worker 调度器（单进程线程模式）。
    在 API 进程内管理所有 Worker 线程的生命周期。
    """

    def __init__(self):
        self._workers: dict[str, BaseWorker] = {}

    def register(self, worker: BaseWorker):
        """注册一个 Worker 实例"""
        name = worker.__class__.__name__
        self._workers[name] = worker

    def start_all(self):
        """启动所有已注册的 Worker 线程"""
        for name, worker in self._workers.items():
            worker.start()
            print(f"[Scheduler] {name} 已启动 (间隔 {worker.interval}s)")

    def stop_all(self):
        """停止所有 Worker"""
        for name, worker in self._workers.items():
            worker.stop()
            print(f"[Scheduler] {name} 已停止")

    def trigger(self, worker_name: str) -> bool:
        """手动触发指定 Worker 立即执行"""
        worker = self._workers.get(worker_name)
        if worker:
            worker.trigger()
            return True
        return False

    def get_worker_names(self) -> list[str]:
        return list(self._workers.keys())


# 全局单例
scheduler = WorkerScheduler()
