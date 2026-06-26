import os
import sys
import unittest
from unittest.mock import Mock, patch


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


class MiaobiMaterialApiTest(unittest.TestCase):
    def test_miaobi_client_material_methods_use_expected_paths(self):
        from core.miaobi_client import MiaobiClient

        calls = []
        client = MiaobiClient(token="token-1")
        client._get = lambda path, params=None: calls.append(("GET", path, params)) or {"code": 10000}
        client._post = lambda path, payload=None: calls.append(("POST", path, payload)) or {"code": 10000}

        client.get_material_config()
        client.get_material_stats()
        client.create_material_task({"title": "t", "prompt_theme": "p", "count": 1})
        client.list_material_tasks(page=2, page_size=20, status=2, title="古风", start_date="2026-06-01", end_date="2026-06-26")
        client.get_material_tasks_progress(["mg_1", "mg_2"])
        client.get_material_task("mg_1")
        client.get_material_task_images("mg_1")
        client.cancel_material_task("mg_1")
        client.retry_material_failed("mg_1")
        client.retry_material_image("mgi_1", "mgimg_1")

        self.assertEqual(calls, [
            ("GET", "baijiahao-sync/v1/material/config", None),
            ("GET", "baijiahao-sync/v1/material/stats", None),
            ("POST", "baijiahao-sync/v1/material/tasks", {"title": "t", "prompt_theme": "p", "count": 1}),
            ("GET", "baijiahao-sync/v1/material/tasks", {
                "currentPage": 2,
                "_limit": 20,
                "status": 2,
                "title": "古风",
                "startDate": "2026-06-01",
                "endDate": "2026-06-26",
            }),
            ("GET", "baijiahao-sync/v1/material/tasks/progress", {"taskNos": "mg_1,mg_2"}),
            ("GET", "baijiahao-sync/v1/material/tasks/mg_1", None),
            ("GET", "baijiahao-sync/v1/material/tasks/mg_1/images", None),
            ("POST", "baijiahao-sync/v1/material/tasks/mg_1/cancel", None),
            ("POST", "baijiahao-sync/v1/material/tasks/mg_1/retry-failed", None),
            ("POST", "baijiahao-sync/v1/material/items/mgi_1/images/mgimg_1/retry", None),
        ])

    def test_create_task_proxies_to_miaobi_without_local_storage(self):
        import api.material_generation as material_api
        from material_generation.schemas import CreateMaterialTaskRequest

        client = Mock()
        client.create_material_task.return_value = {
            "code": 10000,
            "message": "任务已提交",
            "data": {
                "taskNo": "mg_1",
                "title": "古风",
                "status": 1,
                "requestedCount": 1,
                "successCount": 0,
                "failedCount": 0,
                "progressPercent": 0,
                "nextPollAfterSeconds": 3,
                "createdAt": "2026-06-25 12:00:00",
            },
        }

        with patch.object(material_api, "current_user_phone", return_value="13800000000"), \
             patch.object(material_api, "MiaobiClient", return_value=client):
            result = material_api.create_task(CreateMaterialTaskRequest(
                title="古风",
                count=1,
                promptTheme="灯笼",
                imageSize="1140x640",
                negativePrompt="水印",
                promptExtend=False,
            ))

        self.assertEqual(result["code"], 10000)
        self.assertEqual(result["data"]["taskId"], "mg_1")
        self.assertEqual(result["data"]["status"], "pending")
        client.create_material_task.assert_called_once_with({
            "title": "古风",
            "prompt_theme": "灯笼",
            "count": 1,
            "image_size": "1140x640",
            "negative_prompt": "水印",
            "prompt_extend": False,
        })

    def test_create_task_without_prompt_theme_does_not_send_theme(self):
        import api.material_generation as material_api
        from material_generation.schemas import CreateMaterialTaskRequest

        client = Mock()
        client.create_material_task.return_value = {
            "code": 10000,
            "message": "任务已提交",
            "data": {
                "taskNo": "mg_1",
                "title": "古风",
                "status": 1,
                "requestedCount": 1,
                "successCount": 0,
                "failedCount": 0,
                "progressPercent": 0,
                "nextPollAfterSeconds": 3,
                "createdAt": "2026-06-25 12:00:00",
            },
        }

        with patch.object(material_api, "current_user_phone", return_value="13800000000"), \
             patch.object(material_api, "MiaobiClient", return_value=client):
            result = material_api.create_task(CreateMaterialTaskRequest(
                title="古风",
                count=1,
                imageSize="1140x640",
                promptExtend=False,
            ))

        self.assertEqual(result["code"], 10000)
        client.create_material_task.assert_called_once_with({
            "title": "古风",
            "count": 1,
            "image_size": "1140x640",
            "prompt_extend": False,
        })

    def test_create_task_count_above_miaobi_limit_returns_business_error(self):
        import api.material_generation as material_api
        from material_generation.schemas import CreateMaterialTaskRequest

        client = Mock()

        with patch.object(material_api, "current_user_phone", return_value="13800000000"), \
             patch.object(material_api, "MiaobiClient", return_value=client):
            result = material_api.create_task(CreateMaterialTaskRequest(
                title="古风",
                count=101,
                promptTheme="灯笼",
                imageSize="1140x640",
            ))

        self.assertEqual(result["code"], 400)
        self.assertIn("100", result["message"])
        client.create_material_task.assert_not_called()

    def test_get_tasks_progress_proxies_batch_task_numbers(self):
        import api.material_generation as material_api

        client = Mock()
        client.get_material_tasks_progress.return_value = {
            "code": 10000,
            "data": {
                "rows": [
                    {
                        "taskNo": "mg_1",
                        "status": 2,
                        "statusText": "running",
                        "requestedCount": 4,
                        "successCount": 1,
                        "failedCount": 0,
                        "progressPercent": 25,
                        "nextPollAfterSeconds": 3,
                    }
                ]
            },
        }

        request = Mock()
        request.query_params.getlist.return_value = ["mg_3"]

        with patch.object(material_api, "current_user_phone", return_value="13800000000"), \
             patch.object(material_api, "MiaobiClient", return_value=client):
            result = material_api.get_tasks_progress(request=request, taskNos=["mg_1,mg_2", "mg_1"])

        self.assertEqual(result["code"], 10000)
        self.assertEqual(result["data"]["rows"][0]["taskNo"], "mg_1")
        request.query_params.getlist.assert_called_once_with("taskNos[]")
        client.get_material_tasks_progress.assert_called_once_with(["mg_1", "mg_2", "mg_3"])

    def test_get_task_images_proxies_to_cloud_and_flattens_images(self):
        import api.material_generation as material_api

        client = Mock()
        client.get_material_task_images.return_value = {
            "code": 10000,
            "data": [
                {
                    "itemNo": "mgi_1",
                    "taskNo": "mg_1",
                    "prompt": "提示词",
                    "promptStatus": 3,
                    "imageStatus": 3,
                    "images": [
                        {
                            "imageNo": "mgimg_1",
                            "imageIndex": 1,
                            "status": 3,
                            "url": "https://example.test/a.jpeg",
                            "path": "remote/a.jpeg",
                            "createdAt": "2026-06-25 12:03:00",
                        }
                    ],
                }
            ],
        }

        with patch.object(material_api, "current_user_phone", return_value="13800000000"), \
             patch.object(material_api, "MiaobiClient", return_value=client):
            result = material_api.get_task_images("mg_1")

        self.assertEqual(result["code"], 10000)
        self.assertEqual(result["data"]["list"][0]["imageId"], "mgimg_1")
        self.assertEqual(result["data"]["list"][0]["remoteUrl"], "https://example.test/a.jpeg")
        client.get_material_task_images.assert_called_once_with("mg_1")

    def test_retry_image_uses_item_and_image_numbers(self):
        import api.material_generation as material_api

        client = Mock()
        client.retry_material_image.return_value = {"code": 10000, "data": {"row": True}}
        with patch.object(material_api, "current_user_phone", return_value="13800000000"), \
             patch.object(material_api, "MiaobiClient", return_value=client):
            result = material_api.retry_image("mgimg_1", material_api.RetryImageRequest(taskId="mg_1", promptId="mgi_1"))

        self.assertEqual(result["code"], 10000)
        client.retry_material_image.assert_called_once_with("mgi_1", "mgimg_1")

    def test_retry_failed_item_without_cloud_image_uses_task_retry_failed(self):
        import api.material_generation as material_api

        client = Mock()
        client.retry_material_failed.return_value = {"code": 10000, "data": {"row": True, "retryCount": 1}}
        with patch.object(material_api, "current_user_phone", return_value="13800000000"), \
             patch.object(material_api, "MiaobiClient", return_value=client):
            result = material_api.retry_image("mgi_1", material_api.RetryImageRequest(taskId="mg_1", promptId="mgi_1"))

        self.assertEqual(result["code"], 10000)
        client.retry_material_failed.assert_called_once_with("mg_1")
        client.retry_material_image.assert_not_called()


if __name__ == "__main__":
    unittest.main()
