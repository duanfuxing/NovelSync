import os
import sys
import tempfile
import unittest
from fastapi import BackgroundTasks
from unittest.mock import Mock, patch


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


class MaterialGenerationApiTest(unittest.TestCase):
    def test_config_status_uses_cloud_config_as_readiness(self):
        import api.material_generation as material_api

        client = Mock()
        client.get_material_config.return_value = {"code": 10000, "data": {"imageSizes": ["1140x640"]}}
        with patch.object(material_api, "current_user_phone", return_value="13800000000"), \
             patch.object(material_api, "get_active_token", return_value="token-1"), \
             patch.object(material_api, "get_active_material_output_dir", return_value="/tmp/output"), \
             patch.object(material_api, "MiaobiClient", return_value=client):
            result = material_api.get_config_status()

        self.assertEqual(result["code"], 10000)
        data = result["data"]
        self.assertTrue(data["ready"])
        self.assertTrue(data["cloudConfigured"])
        self.assertFalse(data["textServiceConfigured"])
        self.assertFalse(data["imageServiceConfigured"])
        self.assertEqual(data["outputDir"], "/tmp/output")

    def test_reveal_task_output_dir_is_not_supported_for_cloud_data(self):
        import api.material_generation as material_api

        result = material_api.reveal_task_output_dir("mg_1")

        self.assertEqual(result["code"], 400)
        self.assertIn("云端数据", result["message"])

    def test_delete_task_is_not_supported_for_cloud_data(self):
        import api.material_generation as material_api

        result = material_api.delete_task("mg_1")

        self.assertEqual(result["code"], 400)
        self.assertIn("云端素材任务", result["message"])

    def test_get_tasks_passes_title_and_date_filters_to_cloud(self):
        import api.material_generation as material_api

        client = Mock()
        client.list_material_tasks.return_value = {
            "code": 10000,
            "data": {"data": [], "pagination": {"total": 0}},
        }
        with patch.object(material_api, "current_user_phone", return_value="13800000000"), \
             patch.object(material_api, "MiaobiClient", return_value=client):
            result = material_api.get_tasks(
                page=1,
                page_size=50,
                title=" 古风 ",
                startDate="2026-06-01",
                endDate="2026-06-26",
            )

        self.assertEqual(result["code"], 10000)
        client.list_material_tasks.assert_called_once_with(
            page=1,
            page_size=50,
            title="古风",
            start_date="2026-06-01",
            end_date="2026-06-26",
        )

    def test_retry_image_requires_cloud_task_and_prompt_ids(self):
        import api.material_generation as material_api

        with patch.object(material_api, "current_user_phone", return_value="13800000000"):
            result = material_api.retry_image("mgimg_1")

        self.assertEqual(result["code"], 400)
        self.assertIn("缺少任务或子任务编号", result["message"])

    def test_download_task_images_starts_async_job(self):
        import api.material_generation as material_api

        with tempfile.TemporaryDirectory() as tmpdir, \
             patch.object(material_api, "current_user_phone", return_value="13800000000"), \
             patch.object(material_api, "get_active_material_output_dir", return_value=tmpdir):
            result = material_api.download_task_images(
                "mg_1",
                material_api.DownloadImagesRequest(imageIds=["mgimg_1"]),
                BackgroundTasks(),
            )

        self.assertEqual(result["code"], 10000)
        self.assertEqual(result["data"]["status"], "pending")
        self.assertEqual(result["data"]["total"], 1)
        self.assertTrue(result["data"]["downloadJobId"])

    def test_run_download_job_saves_selected_images_under_task_title_dir(self):
        import api.material_generation as material_api

        client = Mock()
        client.get_material_task.return_value = {
            "code": 10000,
            "data": {"taskNo": "mg_1", "title": "测试/任务", "status": 3},
        }
        client.get_material_task_images.return_value = {
            "code": 10000,
            "data": [{
                "itemNo": "mgi_1",
                "taskNo": "mg_1",
                "promptStatus": 3,
                "imageStatus": 3,
                "images": [{
                    "imageNo": "mgimg_1",
                    "imageIndex": 1,
                    "status": 3,
                    "url": "https://example.test/image.jpeg",
                    "path": "remote/image.jpeg",
                }],
            }],
        }

        response = Mock()
        response.read.return_value = b"image-bytes"
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=None)

        with tempfile.TemporaryDirectory() as tmpdir, \
             patch.object(material_api, "MiaobiClient", return_value=client), \
             patch.object(material_api.request, "urlopen", return_value=response):
            job = material_api.create_download_job("mg_1", ["mgimg_1"], tmpdir)
            material_api.run_download_job(job["downloadJobId"])

            result = material_api.get_download_job(job["downloadJobId"])
            saved_path = result["data"]["files"][0]["path"]
            self.assertTrue(os.path.exists(saved_path))
            with open(saved_path, "rb") as file:
                self.assertEqual(file.read(), b"image-bytes")
            self.assertTrue(saved_path.startswith(os.path.join(tmpdir, "测试_任务")))

        self.assertEqual(result["code"], 10000)
        self.assertEqual(result["data"]["status"], "success")
        self.assertEqual(result["data"]["savedCount"], 1)


if __name__ == "__main__":
    unittest.main()
