import threading
import abc
from storage.crud import get_active_novel_sync_state, update_worker_status


class BaseWorker(abc.ABC):
    """
    Worker 基类（线程模式）。
    每个 Worker 在独立 daemon 线程中循环运行，
    使用 threading.Event 控制休眠，支持外部唤醒。
    """

    # 子类覆盖此属性设置轮询间隔（秒）
    interval: int = 60
    requires_novel_sync: bool = False

    def __init__(self):
        self._wake_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._running = False
        self._trigger_kwargs: dict = {}

    @abc.abstractmethod
    def process(self):
        """子类实现具体业务逻辑"""
        pass

    def start(self):
        """启动 Worker 线程"""
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()

    def stop(self):
        """停止 Worker"""
        self._running = False
        self._wake_event.set()  # 唤醒使其退出循环

    def trigger(self, **kwargs):
        """外部手动触发：立即唤醒线程执行一次，可传参供 process() 读取"""
        self._trigger_kwargs = kwargs
        self._wake_event.set()

    def wake(self):
        """唤醒线程重新检查运行条件"""
        self._wake_event.set()

    def _wait_until_allowed(self, worker_name: str) -> bool:
        """小说同步关闭或未就绪时不进入定时倒计时。"""
        if not self.requires_novel_sync:
            return True

        while self._running:
            sync_state = get_active_novel_sync_state()
            if sync_state["ready"]:
                return True

            update_worker_status(worker_name, "idle", sync_state["reason"])
            self._wake_event.wait()
            self._wake_event.clear()

        return False

    def _run_loop(self):
        worker_name = self.__class__.__name__

        # 启动后先进入等待，不立即执行（手动触发或到达 interval 后才首次运行）
        # 使用 init_sleeping 避免覆盖 SQLite 中已有的 last_success_at
        if not self._wait_until_allowed(worker_name):
            return
        update_worker_status(worker_name, "init_sleeping")
        self._wake_event.wait(timeout=self.interval)
        self._wake_event.clear()

        while self._running:
            if not self._wait_until_allowed(worker_name):
                break
            try:
                update_worker_status(worker_name, "running")
                self.process()
                update_worker_status(worker_name, "sleeping")
                self._trigger_kwargs = {}  # 执行完毕清空触发参数
            except Exception as e:
                update_worker_status(worker_name, "error", str(e)[:200])
                print(f"[{worker_name}] 异常: {e}")
                self._wake_event.wait(timeout=5)
                self._wake_event.clear()
                continue

            # 休眠等待下一轮（可被 trigger() 唤醒）
            self._wake_event.wait(timeout=self.interval)
            self._wake_event.clear()
