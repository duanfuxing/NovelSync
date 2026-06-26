import os
import sys
import tempfile
import time
import unittest
from unittest.mock import patch


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


class NovelSyncGateTest(unittest.TestCase):
    def test_novel_worker_does_not_tick_when_novel_sync_disabled(self):
        import workers.base_worker as base_worker

        statuses: list[tuple[str, str]] = []

        class GatedWorker(base_worker.BaseWorker):
            interval = 0.05
            requires_novel_sync = True

            def __init__(self):
                super().__init__()
                self.calls = 0

            def process(self):
                self.calls += 1

        worker = GatedWorker()
        with patch.object(base_worker, "update_worker_status", side_effect=lambda name, status, message="": statuses.append((name, status))), \
             patch.object(base_worker, "get_active_novel_sync_state", return_value={
                 "enabled": False,
                 "ready": False,
                 "reason": "小说自动同步未启用",
                 "watchPath": None,
             }, create=True):
            worker.start()
            time.sleep(0.16)
            worker.stop()
            worker._thread.join(timeout=1)

        self.assertEqual(worker.calls, 0)
        self.assertNotIn(("GatedWorker", "running"), statuses)

    def test_match_files_rejects_when_novel_sync_disabled(self):
        import api.main as api_main

        with tempfile.TemporaryDirectory() as tmpdir:
            with open(os.path.join(tmpdir, "测试小说.txt"), "w", encoding="utf-8") as f:
                f.write("content")

            with patch.object(api_main, "get_active_novel_sync_state", return_value={
                "enabled": False,
                "ready": False,
                "reason": "小说自动同步未启用",
                "watchPath": tmpdir,
            }), patch.object(api_main, "get_active_watch_path", return_value=tmpdir):
                result = api_main.match_local_files("测试小说")

        self.assertEqual(result["code"], 400)
        self.assertIn("小说同步未运行", result["message"])


if __name__ == "__main__":
    unittest.main()
