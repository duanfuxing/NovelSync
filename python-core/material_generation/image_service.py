import base64
import json
import os
import re
import struct
import tempfile
import time
from urllib.parse import urlparse

import requests

from .settings import get_image_model


_PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)


def _image_size(image_bytes: bytes) -> tuple[int | None, int | None]:
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n") and len(image_bytes) >= 24:
        width, height = struct.unpack(">II", image_bytes[16:24])
        return width, height
    if image_bytes.startswith(b"\xff\xd8"):
        index = 2
        while index + 9 < len(image_bytes):
            if image_bytes[index] != 0xFF:
                index += 1
                continue
            marker = image_bytes[index + 1]
            block_len = int.from_bytes(image_bytes[index + 2:index + 4], "big")
            if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
                height = int.from_bytes(image_bytes[index + 5:index + 7], "big")
                width = int.from_bytes(image_bytes[index + 7:index + 9], "big")
                return width, height
            index += 2 + block_len
    return None, None


def _write_image(output_path: str, image_bytes: bytes) -> dict:
    if not _looks_like_image(image_bytes):
        raise ValueError("返回内容不是有效图片")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".image-", suffix=".tmp", dir=os.path.dirname(output_path))
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(image_bytes)
        os.replace(tmp_path, output_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
    width, height = _image_size(image_bytes)
    return {
        "local_path": output_path,
        "width": width,
        "height": height,
        "file_size": os.path.getsize(output_path),
    }


def _looks_like_image(image_bytes: bytes) -> bool:
    return (
        image_bytes.startswith(b"\x89PNG\r\n\x1a\n")
        or image_bytes.startswith(b"\xff\xd8")
        or image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP"
    )


def _extract_image_payload(data: dict) -> tuple[bytes | None, str | None]:
    item = data
    if isinstance(data.get("data"), list) and data["data"]:
        item = data["data"][0]

    b64_value = item.get("b64_json") or item.get("base64") or item.get("image")
    if isinstance(b64_value, str) and b64_value:
        if b64_value.startswith("data:"):
            b64_value = b64_value.split(",", 1)[1]
        return base64.b64decode(b64_value), None

    url = item.get("url") or item.get("image_url") or item.get("remote_url")
    if isinstance(url, str) and url:
        return None, url

    return None, None


def _extract_qwen_image_url(data: dict) -> str:
    try:
        image_url = data["output"]["choices"][0]["message"]["content"][0]["image"]
    except (KeyError, IndexError, TypeError):
        return ""
    return image_url if isinstance(image_url, str) else ""


def _extract_url_from_text(content: str) -> tuple[bytes | None, str | None]:
    url_match = re.search(r"https?://[^\s)]+\.(?:png|jpg|jpeg|webp)(?:\?[^\s)]*)?", content)
    if url_match:
        return None, url_match.group(0)

    data_match = re.search(r"data:image/[^\s)]+", content)
    if not data_match:
        return None, None
    data_url = data_match.group(0)
    try:
        _, b64_data = data_url.split(",", 1)
        return base64.b64decode(b64_data), None
    except ValueError:
        return None, None


def _post_json(api_url: str, api_key: str, payload: dict, timeout: int) -> dict:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    response = requests.post(api_url, json=payload, headers=headers, timeout=timeout)
    response.raise_for_status()
    return response.json()


def _generate_image_via_legacy_api(prompt: str, output_path: str, api_url: str, api_key: str, model: str, timeout: int) -> dict:
    payload = {
        "model": model,
        "prompt": prompt,
        "n": 1,
        "size": os.environ.get("MATERIAL_IMAGE_SIZE", "1024x1024"),
        "response_format": os.environ.get("MATERIAL_IMAGE_RESPONSE_FORMAT", "b64_json"),
    }
    image_bytes, image_url = _extract_image_payload(_post_json(api_url, api_key, payload, timeout))
    if image_url:
        image_bytes = _download_image(image_url, timeout=timeout)
    if not image_bytes:
        raise ValueError("生图接口响应中未找到图片数据")
    return _write_image(output_path, image_bytes)


def _generate_image_via_qwen(prompt: str, output_path: str, timeout: int) -> dict:
    api_url = os.environ.get("IMAGE_API_URL", "").strip()
    api_key = os.environ.get("IMAGE_API_KEY", "").strip()
    model = os.environ.get("MATERIAL_IMAGE_MODEL") or get_image_model("qwen")
    if not api_url or not api_key:
        return _write_image(output_path, _PNG_1X1)

    payload = {
        "model": model,
        "input": {
            "messages": [
                {"role": "user", "content": [{"text": prompt}]}
            ]
        },
        "parameters": {
            "negative_prompt": os.environ.get("NEGATIVE_PROMPT", ""),
            "prompt_extend": False,
            "watermark": False,
            "size": os.environ.get("IMAGE_SIZE", "2048*2048"),
        },
    }
    data = _post_json(api_url, api_key, payload, timeout)
    image_url = _extract_qwen_image_url(data)
    if not image_url:
        raise ValueError("通义万相响应中未找到 output.choices[0].message.content[0].image")
    return _write_image(output_path, _download_image(image_url, timeout=timeout))


def _generate_image_via_gpt(prompt: str, output_path: str, timeout: int) -> dict:
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        return _write_image(output_path, _PNG_1X1)

    base_url = os.environ.get("OPENAI_BASE_URL", "https://api.apiyi.com/v1").rstrip("/")
    api_url = base_url if base_url.endswith("/chat/completions") else f"{base_url}/chat/completions"
    model = os.environ.get("MATERIAL_IMAGE_MODEL") or get_image_model("chatgpt")
    ratio = os.environ.get("GPT_IMAGE_RATIO", "横版 16:9").strip()
    final_prompt = f"{ratio}，{prompt}" if ratio else prompt
    data = _post_json(
        api_url,
        api_key,
        {"model": model, "messages": [{"role": "user", "content": final_prompt}], "stream": False},
        timeout,
    )
    content = (
        data.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    ) if isinstance(data, dict) else ""
    if not content:
        raise ValueError("GPT Image 响应中缺少 choices[0].message.content")
    image_bytes, image_url = _extract_url_from_text(content)
    if image_url:
        image_bytes = _download_image(image_url, timeout=timeout)
    if not image_bytes:
        raise ValueError("GPT Image 响应中未找到图片链接")
    return _write_image(output_path, image_bytes)


def _extract_yike_output_urls(result: object) -> list[str]:
    if result is not None and hasattr(result, "to_map"):
        result = result.to_map()
    elif isinstance(result, str):
        try:
            result = json.loads(result)
        except json.JSONDecodeError:
            return []

    if not isinstance(result, dict):
        return []

    urls: list[str] = []
    for item in result.get("ImageResult", []) or []:
        if hasattr(item, "to_map"):
            item = item.to_map()
        if not isinstance(item, dict):
            continue
        image_url = item.get("OutputUrl", "")
        if isinstance(image_url, str) and image_url:
            urls.append(image_url)
    return urls


def _generate_image_via_yike(prompt: str, output_path: str, timeout: int) -> dict:
    try:
        from alibabacloud_yike20260319.client import Client as YikeClient
        from alibabacloud_credentials.client import Client as CredentialClient
        from alibabacloud_tea_openapi import models as open_api_models
        from alibabacloud_yike20260319 import models as yike_models
    except ImportError as exc:
        raise RuntimeError(
            "缺少一刻 SDK 依赖，请安装 alibabacloud_yike20260319、alibabacloud_credentials、alibabacloud_tea_openapi"
        ) from exc

    ak = os.environ.get("ALIBABA_CLOUD_ACCESS_KEY_ID", "").strip()
    sk = os.environ.get("ALIBABA_CLOUD_ACCESS_KEY_SECRET", "").strip()
    if ak:
        os.environ["ALIBABA_CLOUD_ACCESS_KEY_ID"] = ak
    if sk:
        os.environ["ALIBABA_CLOUD_ACCESS_KEY_SECRET"] = sk

    credential = CredentialClient()
    cfg = open_api_models.Config(credential=credential)
    cfg.endpoint = os.environ.get("YIKE_ENDPOINT", "yike.cn-shanghai.aliyuncs.com")
    client = YikeClient(cfg)

    app_params = json.dumps({
        "Extra.4.Prompt": prompt,
        "Extra.4.StyleId": os.environ.get("YIKE_STYLE_ID", "RealisticPhotographyPro"),
        "Extra.4.AspectRatio": os.environ.get("YIKE_ASPECT_RATIO", "16:9"),
        "Extra.4.Resolution": os.environ.get("YIKE_RESOLUTION", "2K"),
        "Extra.4.N": int(os.environ.get("YIKE_IMAGE_COUNT", "1")),
    }, ensure_ascii=False)
    submit_req = yike_models.SubmitYikeAIAppJobRequest(
        app_id=os.environ.get("YIKE_APP_ID", "app_stylized_generate_image"),
        app_params=app_params,
    )
    submit_resp = client.submit_yike_aiapp_job(submit_req)
    job_id = submit_resp.body.job_id

    max_polls = int(os.environ.get("YIKE_MAX_POLLS", "60"))
    poll_interval = int(os.environ.get("YIKE_POLL_INTERVAL", "3"))
    deadline = time.monotonic() + timeout
    for _ in range(max_polls):
        if time.monotonic() >= deadline:
            break
        time.sleep(min(poll_interval, max(0.1, deadline - time.monotonic())))
        get_req = yike_models.GetYikeAIAppJobRequest(job_id=job_id)
        get_resp = client.get_yike_aiapp_job(get_req)
        status = get_resp.body.status
        if status == "Finished":
            urls = _extract_yike_output_urls(get_resp.body.result)
            if not urls:
                raise ValueError("一刻任务完成但未返回图片 URL")
            return _write_image(output_path, _download_image(urls[0], timeout=timeout))
        if status == "Failed":
            error_code = getattr(get_resp.body, "error_code", "未知")
            raise RuntimeError(f"一刻生图任务失败: {error_code}")
    raise TimeoutError("一刻生图任务轮询超时")


def _generate_image_via_api(prompt: str, output_path: str) -> dict:
    timeout = int(os.environ.get("MATERIAL_IMAGE_TIMEOUT", "180"))
    legacy_api_url = os.environ.get("MATERIAL_IMAGE_API_URL", "").strip()
    if legacy_api_url:
        return _generate_image_via_legacy_api(
            prompt,
            output_path,
            legacy_api_url,
            os.environ.get("MATERIAL_IMAGE_API_KEY", "").strip(),
            os.environ.get("MATERIAL_IMAGE_MODEL", "system-default"),
            timeout,
        )

    provider = os.environ.get("MATERIAL_IMAGE_PROVIDER") or os.environ.get("IMAGE_PROVIDER", "qwen")
    if provider == "qwen":
        return _generate_image_via_qwen(prompt, output_path, timeout)
    if provider == "chatgpt":
        return _generate_image_via_gpt(prompt, output_path, timeout)
    if provider == "yike":
        return _generate_image_via_yike(prompt, output_path, timeout)
    return _write_image(output_path, _PNG_1X1)


def _download_image(image_url: str, timeout: int) -> bytes:
    parsed = urlparse(image_url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("图片下载地址协议不受支持")

    max_bytes = int(os.environ.get("MATERIAL_IMAGE_MAX_BYTES", str(20 * 1024 * 1024)))
    response = requests.get(image_url, timeout=timeout, stream=True)
    response.raise_for_status()
    content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
    if content_type and not content_type.startswith("image/"):
        raise ValueError(f"图片下载返回了非图片内容: {content_type}")

    chunks: list[bytes] = []
    total = 0
    for chunk in response.iter_content(chunk_size=64 * 1024):
        if not chunk:
            continue
        total += len(chunk)
        if total > max_bytes:
            raise ValueError("图片文件超过大小限制")
        chunks.append(chunk)
    data = b"".join(chunks)
    if not _looks_like_image(data):
        raise ValueError("下载内容不是有效图片")
    return data


def generate_image(prompt: str, output_path: str) -> dict:
    return _generate_image_via_api(prompt, output_path)
