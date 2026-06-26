import json
import os
import re

import requests

from .settings import get_text_model


def _template_prompts(count: int, theme: str = "") -> list[str]:
    theme_text = theme.strip() if theme else "古风人物，清晰构图，自然光线"
    return [
        f"{theme_text}，第 {index} 张，人物主体明确，画面干净，细节丰富，高清写实风格。"
        for index in range(1, count + 1)
    ]


def _parse_prompt_content(content: str, count: int) -> list[str]:
    text = content.strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\[[\s\S]*\]", text)
        parsed = json.loads(match.group(0)) if match else None

    if isinstance(parsed, dict):
        parsed = parsed.get("prompts") or parsed.get("data") or parsed.get("items")

    if not isinstance(parsed, list):
        raise ValueError("提示词接口未返回数组")

    prompts = [str(item).strip() for item in parsed if str(item).strip()]
    if len(prompts) < count:
        raise ValueError(f"提示词数量不足，需要 {count} 条，实际 {len(prompts)} 条")
    return prompts[:count]


def _build_messages(count: int, theme: str = "") -> list[dict]:
    theme_text = theme.strip() or "古风人物，清晰构图，自然光线"
    return [
        {
            "role": "system",
            "content": "你是专业图片素材提示词生成器。只返回 JSON 字符串数组，不要返回额外说明。",
        },
        {
            "role": "user",
            "content": (
                f"基于关键词“{theme_text}”生成 {count} 条中文生图提示词。"
                "每条提示词要适合直接传给图片生成模型，强调主体、场景、构图、光线、质感。"
            ),
        },
    ]


def _post_json(api_url: str, api_key: str, payload: dict, timeout: int) -> dict:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    response = requests.post(api_url, json=payload, headers=headers, timeout=timeout)
    response.raise_for_status()
    return response.json()


def _extract_chat_content(data: dict) -> str:
    return (
        data.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    ) if isinstance(data, dict) else ""


def _extract_openai_response_text(data: dict) -> str:
    if not isinstance(data, dict):
        return ""
    if isinstance(data.get("output_text"), str):
        return data["output_text"]
    parts: list[str] = []
    for item in data.get("output", []) or []:
        for content in item.get("content", []) or []:
            text = content.get("text") if isinstance(content, dict) else ""
            if text:
                parts.append(text)
    return "".join(parts)


def _openai_compatible_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


def _generate_prompts_via_openai_compat(
    count: int,
    provider: str,
    api_url: str,
    api_key: str,
    model: str,
    timeout: int,
    messages: list[dict],
) -> list[str]:
    payload = {
        "model": model,
        "extra_body": {"enable_thinking": True},
        "messages": messages,
        "max_tokens": int(os.environ.get("MAX_OUTPUT_TOKENS", "65536")),
        "temperature": 0.8,
    }
    if provider == "qwen":
        payload.pop("extra_body", None)
    data = _post_json(api_url, api_key, payload, timeout)

    if isinstance(data, dict) and isinstance(data.get("prompts"), list):
        return [str(item).strip() for item in data["prompts"] if str(item).strip()][:count]

    content = _extract_chat_content(data)
    if not content:
        raise ValueError("提示词接口响应中缺少 choices[0].message.content")
    return _parse_prompt_content(content, count)


def _generate_prompts_via_gemini(count: int, api_key: str, model: str, timeout: int, messages: list[dict]) -> list[str]:
    base_url = os.environ.get("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com").rstrip("/")
    system_text = "\n\n".join(msg["content"] for msg in messages if msg["role"] == "system")
    user_text = "\n\n".join(msg["content"] for msg in messages if msg["role"] == "user")
    payload = {
        "system_instruction": {"parts": [{"text": system_text}]},
        "contents": [{"role": "user", "parts": [{"text": user_text}]}],
        "generationConfig": {"maxOutputTokens": int(os.environ.get("MAX_OUTPUT_TOKENS", "65536"))},
    }
    url = f"{base_url}/v1beta/models/{model}:generateContent"
    response = requests.post(
        url,
        json=payload,
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        timeout=timeout,
    )
    response.raise_for_status()
    data = response.json()
    content = (
        data.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [{}])[0]
        .get("text", "")
    )
    if not content:
        raise ValueError("Gemini 提示词接口响应中缺少 candidates[0].content.parts[0].text")
    return _parse_prompt_content(content, count)


def _generate_prompts_via_openai_responses(
    count: int,
    api_key: str,
    model: str,
    timeout: int,
    messages: list[dict],
) -> list[str]:
    base_url = os.environ.get("OPENAI_BASE_URL", "https://api.apiyi.com/v1").rstrip("/")
    url = base_url if base_url.endswith("/responses") else f"{base_url}/responses"
    instructions = "\n\n".join(msg["content"] for msg in messages if msg["role"] == "system")
    user_input = "\n\n".join(msg["content"] for msg in messages if msg["role"] == "user")
    data = _post_json(
        url,
        api_key,
        {"model": model, "instructions": instructions, "input": user_input},
        timeout,
    )
    content = _extract_openai_response_text(data)
    if not content:
        raise ValueError("OpenAI Responses 提示词接口响应中缺少 output_text")
    return _parse_prompt_content(content, count)


def _generate_prompts_via_api(count: int, theme: str = "") -> list[str]:
    api_url = os.environ.get("MATERIAL_TEXT_API_URL", "").strip()
    api_key = os.environ.get("MATERIAL_TEXT_API_KEY", "").strip()
    timeout = int(os.environ.get("MATERIAL_TEXT_TIMEOUT", "60"))
    provider = os.environ.get("MATERIAL_TEXT_PROVIDER") or os.environ.get("LLM_PROVIDER", "doubao")
    model = os.environ.get("MATERIAL_TEXT_MODEL") or get_text_model(provider)
    messages = _build_messages(count, theme)

    if api_url:
        return _generate_prompts_via_openai_compat(count, provider, api_url, api_key, model, timeout, messages)

    if provider == "doubao":
        api_key = os.environ.get("DOUBAO_API_KEY", "").strip()
        api_url = _openai_compatible_url(os.environ.get("DOUBAO_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3"))
        if not api_key or not model:
            return _template_prompts(count, theme)
        return _generate_prompts_via_openai_compat(count, provider, api_url, api_key, model, timeout, messages)
    if provider == "qwen":
        api_key = os.environ.get("QWEN_API_KEY", "").strip()
        api_url = _openai_compatible_url(os.environ.get("QWEN_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"))
        if not api_key:
            return _template_prompts(count, theme)
        return _generate_prompts_via_openai_compat(count, provider, api_url, api_key, model, timeout, messages)
    if provider == "gemini":
        api_key = os.environ.get("GEMINI_API_KEY", "").strip()
        if not api_key:
            return _template_prompts(count, theme)
        return _generate_prompts_via_gemini(count, api_key, model, timeout, messages)
    if provider == "chatgpt":
        api_key = os.environ.get("OPENAI_API_KEY", "").strip()
        if not api_key:
            return _template_prompts(count, theme)
        return _generate_prompts_via_openai_responses(count, api_key, model, timeout, messages)

    return _template_prompts(count, theme)


def generate_prompts(count: int, theme: str = "") -> list[str]:
    return _generate_prompts_via_api(count, theme)
