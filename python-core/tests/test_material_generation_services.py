import base64
import os
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


class MaterialGenerationServicesTest(unittest.TestCase):
    def test_backend_material_defaults_ignore_client_supplied_models(self):
        from material_generation.settings import resolve_model_config

        with patch.dict(os.environ, {
            "MATERIAL_TEXT_PROVIDER": "server-text",
            "MATERIAL_TEXT_MODEL": "server-text-model",
            "MATERIAL_IMAGE_PROVIDER": "server-image",
            "MATERIAL_IMAGE_MODEL": "server-image-model",
        }):
            config = resolve_model_config()

        self.assertEqual(config.llm_provider, "server-text")
        self.assertEqual(config.text_model, "server-text-model")
        self.assertEqual(config.image_provider, "server-image")
        self.assertEqual(config.image_model, "server-image-model")

    def test_prompt_service_parses_json_array_from_configured_api(self):
        from material_generation.prompt_service import generate_prompts

        response = Mock()
        response.json.return_value = {
            "choices": [
                {
                    "message": {
                        "content": '["提示词 A", "提示词 B"]',
                    },
                },
            ],
        }
        response.raise_for_status.return_value = None

        with patch.dict(os.environ, {
            "MATERIAL_TEXT_API_URL": "https://example.test/chat/completions",
            "MATERIAL_TEXT_API_KEY": "token",
            "MATERIAL_TEXT_MODEL": "text-model",
        }), patch("material_generation.prompt_service.requests.post", return_value=response) as post:
            prompts = generate_prompts(2, "古风女主")

        self.assertEqual(prompts, ["提示词 A", "提示词 B"])
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["model"], "text-model")
        self.assertIn("古风女主", payload["messages"][-1]["content"])

    def test_image_service_writes_openai_style_base64_image(self):
        from material_generation.image_service import generate_image

        png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
        )
        response = Mock()
        response.json.return_value = {"data": [{"b64_json": base64.b64encode(png).decode("ascii")}]}
        response.raise_for_status.return_value = None

        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = os.path.join(tmpdir, "image.png")
            with patch.dict(os.environ, {
                "MATERIAL_IMAGE_API_URL": "https://example.test/images/generations",
                "MATERIAL_IMAGE_API_KEY": "token",
                "MATERIAL_IMAGE_MODEL": "image-model",
            }), patch("material_generation.image_service.requests.post", return_value=response) as post:
                result = generate_image("测试提示词", output_path)

            self.assertTrue(os.path.exists(output_path))
            self.assertEqual(result["local_path"], output_path)
            self.assertEqual(result["width"], 1)
            self.assertEqual(result["height"], 1)
            payload = post.call_args.kwargs["json"]
            self.assertEqual(payload["model"], "image-model")
            self.assertEqual(payload["prompt"], "测试提示词")

    def test_image_service_uses_qwen_payload_from_reference_project(self):
        from material_generation.image_service import generate_image

        png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
        )
        response = Mock()
        response.json.return_value = {
            "output": {
                "choices": [
                    {"message": {"content": [{"image": "https://example.test/image.png"}]}}
                ]
            }
        }
        response.raise_for_status.return_value = None

        download = Mock()
        download.headers = {"Content-Type": "image/png"}
        download.iter_content.return_value = [png]
        download.raise_for_status.return_value = None

        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = os.path.join(tmpdir, "image.png")
            with patch.dict(os.environ, {
                "MATERIAL_IMAGE_API_URL": "",
                "MATERIAL_IMAGE_PROVIDER": "qwen",
                "IMAGE_API_URL": "https://dashscope.test/images",
                "IMAGE_API_KEY": "token",
                "IMAGE_MODEL": "qwen-image-2.0-pro",
                "NEGATIVE_PROMPT": "低画质",
                "IMAGE_SIZE": "2048*2048",
            }), patch("material_generation.image_service.requests.post", return_value=response) as post, \
                 patch("material_generation.image_service.requests.get", return_value=download):
                result = generate_image("测试提示词", output_path)

            self.assertEqual(result["local_path"], output_path)
            payload = post.call_args.kwargs["json"]
            self.assertEqual(payload["model"], "qwen-image-2.0-pro")
            self.assertEqual(payload["input"]["messages"][0]["content"][0]["text"], "测试提示词")
            self.assertFalse(payload["parameters"]["prompt_extend"])
            self.assertFalse(payload["parameters"]["watermark"])
            self.assertEqual(payload["parameters"]["negative_prompt"], "低画质")

    def test_image_service_rejects_non_http_image_url(self):
        from material_generation.image_service import generate_image

        response = Mock()
        response.json.return_value = {"data": [{"url": "file:///tmp/not-allowed.png"}]}
        response.raise_for_status.return_value = None

        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = os.path.join(tmpdir, "image.png")
            with patch.dict(os.environ, {
                "MATERIAL_IMAGE_API_URL": "https://example.test/images/generations",
                "MATERIAL_IMAGE_API_KEY": "token",
            }), patch("material_generation.image_service.requests.post", return_value=response):
                with self.assertRaises(ValueError):
                    generate_image("测试提示词", output_path)

    def test_image_service_extracts_yike_output_urls(self):
        from material_generation.image_service import _extract_yike_output_urls

        urls = _extract_yike_output_urls({
            "ImageResult": [
                {"OutputUrl": "https://example.test/a.png"},
                {"OutputUrl": "https://example.test/b.png"},
            ]
        })

        self.assertEqual(urls, ["https://example.test/a.png", "https://example.test/b.png"])

    def test_image_service_rejects_non_image_download(self):
        from material_generation.image_service import generate_image

        response = Mock()
        response.json.return_value = {"data": [{"url": "https://example.test/not-image.txt"}]}
        response.raise_for_status.return_value = None

        download = Mock()
        download.headers = {"Content-Type": "text/plain"}
        download.iter_content.return_value = [b"not image"]
        download.raise_for_status.return_value = None

        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = os.path.join(tmpdir, "image.png")
            with patch.dict(os.environ, {
                "MATERIAL_IMAGE_API_URL": "https://example.test/images/generations",
                "MATERIAL_IMAGE_API_KEY": "token",
            }), patch("material_generation.image_service.requests.post", return_value=response), \
                 patch("material_generation.image_service.requests.get", return_value=download):
                with self.assertRaises(ValueError):
                    generate_image("测试提示词", output_path)


if __name__ == "__main__":
    unittest.main()
