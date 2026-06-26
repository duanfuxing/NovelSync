import os
import sys
import unittest
from datetime import datetime


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


class MiaobiMaterialAdapterTest(unittest.TestCase):
    def test_task_status_mapping(self):
        from material_generation.miaobi_adapter import cloud_task_status_to_local

        self.assertEqual(cloud_task_status_to_local(1), "pending")
        self.assertEqual(cloud_task_status_to_local(2), "running")
        self.assertEqual(cloud_task_status_to_local(3), "success")
        self.assertEqual(cloud_task_status_to_local(4), "failed")
        self.assertEqual(cloud_task_status_to_local(5), "partial_failed")
        self.assertEqual(cloud_task_status_to_local(6), "cancel_requested")
        self.assertEqual(cloud_task_status_to_local(7), "canceled")
        self.assertEqual(cloud_task_status_to_local(8), "deleted")
        self.assertEqual(cloud_task_status_to_local(999), "failed")

    def test_sanitize_create_payload_blocks_sensitive_keys(self):
        from material_generation.miaobi_adapter import build_cloud_create_payload

        payload = build_cloud_create_payload({
            "title": "古风",
            "promptTheme": "灯笼",
            "count": 2,
            "imageSize": "1140x640",
            "negativePrompt": "水印",
            "promptExtend": True,
            "api_key": "leak",
            "provider_key": "leak",
        })

        self.assertEqual(payload, {
            "title": "古风",
            "prompt_theme": "灯笼",
            "count": 2,
            "image_size": "1140x640",
            "negative_prompt": "水印",
            "prompt_extend": True,
        })

    def test_create_payload_allows_missing_optional_title_theme_and_negative_prompt(self):
        from unittest.mock import patch

        from material_generation.miaobi_adapter import build_cloud_create_payload

        with patch(
            "material_generation.miaobi_adapter.default_material_task_title",
            return_value="20260626153045_abcdef",
        ):
            payload = build_cloud_create_payload({
                "count": 100,
                "imageSize": "1140x640",
            })

        self.assertEqual(payload, {
            "title": "20260626153045_abcdef",
            "count": 100,
            "image_size": "1140x640",
            "prompt_extend": False,
        })

    def test_default_material_task_title_uses_timestamp_and_uuid6(self):
        from material_generation.miaobi_adapter import default_material_task_title

        title = default_material_task_title(
            now=datetime(2026, 6, 26, 15, 30, 45),
            token="abcdef123456",
        )

        self.assertEqual(title, "20260626153045_abcdef")

    def test_normalize_cloud_task_does_not_synthesize_progress_percent(self):
        from material_generation.miaobi_adapter import normalize_cloud_task

        task = normalize_cloud_task({
            "taskNo": "mg_1",
            "status": 2,
            "requestedCount": 10,
            "successCount": 4,
            "failedCount": 1,
        })

        self.assertIsNone(task["progressPercent"])

    def test_flatten_cloud_images_maps_item_and_image_ids(self):
        from material_generation.miaobi_adapter import flatten_cloud_images

        rows = flatten_cloud_images([
            {
                "itemNo": "mgi_1",
                "taskNo": "mg_1",
                "prompt": "提示词",
                "promptJson": {"age": 23},
                "promptStatus": 3,
                "imageStatus": 3,
                "images": [
                    {
                        "imageNo": "mgimg_1",
                        "imageIndex": 1,
                        "status": 3,
                        "url": "https://example.test/a.jpeg",
                        "path": "remote/a.jpeg",
                        "width": 1140,
                        "height": 640,
                        "fileSize": 10,
                        "provider": "qwen",
                        "model": "wan_2_7_pro",
                        "createdAt": "2026-06-25 12:03:00",
                    }
                ],
            }
        ])

        self.assertEqual(rows[0]["imageId"], "mgimg_1")
        self.assertEqual(rows[0]["promptId"], "mgi_1")
        self.assertEqual(rows[0]["taskId"], "mg_1")
        self.assertEqual(rows[0]["remoteUrl"], "https://example.test/a.jpeg")
        self.assertEqual(rows[0]["remotePath"], "remote/a.jpeg")
        self.assertEqual(rows[0]["status"], "success")
        self.assertEqual(rows[0]["prompt"], "提示词")
        self.assertEqual(rows[0]["metadataJson"], {"age": 23})


if __name__ == "__main__":
    unittest.main()
