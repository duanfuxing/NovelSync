import os
import sys
import unittest


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


class MaterialTaskRunnerTest(unittest.TestCase):
    def test_cloud_only_runner_is_noop_compatibility_shim(self):
        import material_generation.task_runner as task_runner_module

        runner = task_runner_module.MaterialTaskRunner()

        self.assertIsNone(runner.submit("mg_1"))
        self.assertIsNone(runner.cancel("mg_1"))


if __name__ == "__main__":
    unittest.main()
