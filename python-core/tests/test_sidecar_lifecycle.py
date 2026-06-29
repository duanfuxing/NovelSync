import os
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


class SidecarLifecycleTest(unittest.TestCase):
    def test_parent_pid_prefers_explicit_env_value(self):
        import main as sidecar_main

        with patch.dict(os.environ, {"NOVELSYNC_PARENT_PID": "4321"}):
            self.assertEqual(sidecar_main._get_parent_pid(), 4321)

    def test_parent_pid_falls_back_to_os_parent_for_invalid_env(self):
        import main as sidecar_main

        with patch.dict(os.environ, {"NOVELSYNC_PARENT_PID": "bad-value"}), \
             patch.object(sidecar_main.os, "getppid", return_value=1234):
            self.assertEqual(sidecar_main._get_parent_pid(), 1234)

    def test_sidecar_pid_file_is_written_and_removed_for_current_process(self):
        import main as sidecar_main

        with tempfile.TemporaryDirectory() as tmpdir:
            pid_file = os.path.join(tmpdir, "novelsync-server.pid")

            sidecar_main._write_sidecar_pid_file(pid_file)
            with open(pid_file, "r", encoding="utf-8") as f:
                self.assertEqual(f.read().strip(), str(os.getpid()))

            sidecar_main._remove_sidecar_pid_file(pid_file)
            self.assertFalse(os.path.exists(pid_file))

    def test_sidecar_pid_file_remove_preserves_other_process_pid(self):
        import main as sidecar_main

        with tempfile.TemporaryDirectory() as tmpdir:
            pid_file = os.path.join(tmpdir, "novelsync-server.pid")
            with open(pid_file, "w", encoding="utf-8") as f:
                f.write(str(os.getpid() + 1000))

            sidecar_main._remove_sidecar_pid_file(pid_file)
            self.assertTrue(os.path.exists(pid_file))


if __name__ == "__main__":
    unittest.main()
