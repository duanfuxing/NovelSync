import os
import sys
import unittest
from unittest.mock import Mock, patch


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


class DashboardStatsTest(unittest.TestCase):
    def test_material_dashboard_stats_are_normalized_from_cloud_stats(self):
        from storage.crud import normalize_material_dashboard_stats

        stats = normalize_material_dashboard_stats({
            "taskCount": "12",
            "successImageCount": "6",
            "failedImageCount": "1",
            "runningTaskCount": "1",
            "todayImageCount": "4",
            "latestTask": {
                "title": "今日任务",
                "status": 2,
                "statusText": "running",
                "requestedCount": "10",
                "successCount": "4",
                "failedCount": "1",
                "createdAt": "2026-06-26 10:00:00",
            },
        })

        self.assertEqual(stats["taskCount"], 12)
        self.assertEqual(stats["successImageCount"], 6)
        self.assertEqual(stats["failedImageCount"], 1)
        self.assertEqual(stats["runningTaskCount"], 1)
        self.assertEqual(stats["todayImageCount"], 4)
        self.assertEqual(stats["latestTask"]["title"], "今日任务")
        self.assertEqual(stats["latestTask"]["status"], "running")

    def test_material_dashboard_stats_calls_cloud_stats_api(self):
        import core.miaobi_client as miaobi_client
        import storage.crud as crud

        client = Mock()
        client.get_material_stats.return_value = {
            "code": 10000,
            "data": {
                "taskCount": 1,
                "successImageCount": 2,
                "failedImageCount": 0,
                "runningTaskCount": 0,
                "todayImageCount": 2,
                "latestTask": None,
            },
        }

        with patch.object(miaobi_client, "MiaobiClient", return_value=client):
            stats = crud.get_material_dashboard_stats()

        self.assertEqual(stats["taskCount"], 1)
        client.get_material_stats.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
