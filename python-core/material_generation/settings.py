import os
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class MaterialModelConfig:
    llm_provider: str
    text_model: str
    image_provider: str
    image_model: str


def resolve_model_config() -> MaterialModelConfig:
    """Resolve server-controlled material generation defaults.

    The variable names mirror baidu-novel-prompts, while MATERIAL_* aliases are
    kept for compatibility with earlier local configuration.
    """
    llm_provider = os.environ.get("MATERIAL_TEXT_PROVIDER") or os.environ.get("LLM_PROVIDER", "doubao")
    image_provider = os.environ.get("MATERIAL_IMAGE_PROVIDER") or os.environ.get("IMAGE_PROVIDER", "qwen")
    return MaterialModelConfig(
        llm_provider=llm_provider,
        text_model=os.environ.get("MATERIAL_TEXT_MODEL") or get_text_model(llm_provider),
        image_provider=image_provider,
        image_model=os.environ.get("MATERIAL_IMAGE_MODEL") or get_image_model(image_provider),
    )


def get_text_model(provider: str | None = None) -> str:
    provider = provider or os.environ.get("LLM_PROVIDER", "doubao")
    if provider == "doubao":
        return os.environ.get("DOUBAO_MODEL", "")
    if provider == "qwen":
        return os.environ.get("QWEN_MODEL", "qwen3.5-plus")
    if provider == "gemini":
        return os.environ.get("GEMINI_MODEL", "gemini-3-flash-preview")
    if provider == "chatgpt":
        return os.environ.get("OPENAI_MODEL", "gpt-4.1")
    return os.environ.get("MATERIAL_TEXT_MODEL", "system-default")


def get_image_model(provider: str | None = None) -> str:
    provider = provider or os.environ.get("IMAGE_PROVIDER", "qwen")
    if provider == "qwen":
        return os.environ.get("IMAGE_MODEL", "qwen-image-2.0-pro")
    if provider == "chatgpt":
        return os.environ.get("GPT_IMAGE_MODEL", "gpt-image-2-all")
    if provider == "yike":
        return os.environ.get("YIKE_STYLE_ID", "RealisticPhotographyPro")
    return os.environ.get("MATERIAL_IMAGE_MODEL", "system-default")


def is_text_service_configured() -> bool:
    if os.environ.get("MATERIAL_TEXT_API_URL", "").strip():
        return True
    provider = os.environ.get("MATERIAL_TEXT_PROVIDER") or os.environ.get("LLM_PROVIDER", "doubao")
    if provider == "doubao":
        return bool(os.environ.get("DOUBAO_API_KEY", "").strip() and os.environ.get("DOUBAO_MODEL", "").strip())
    if provider == "qwen":
        return bool(os.environ.get("QWEN_API_KEY", "").strip())
    if provider == "gemini":
        return bool(os.environ.get("GEMINI_API_KEY", "").strip())
    if provider == "chatgpt":
        return bool(os.environ.get("OPENAI_API_KEY", "").strip())
    return False


def is_image_service_configured() -> bool:
    if os.environ.get("MATERIAL_IMAGE_API_URL", "").strip():
        return True
    provider = os.environ.get("MATERIAL_IMAGE_PROVIDER") or os.environ.get("IMAGE_PROVIDER", "qwen")
    if provider == "qwen":
        return bool(os.environ.get("IMAGE_API_KEY", "").strip() and os.environ.get("IMAGE_API_URL", "").strip())
    if provider == "chatgpt":
        return bool(os.environ.get("OPENAI_API_KEY", "").strip())
    if provider == "yike":
        return bool(
            os.environ.get("ALIBABA_CLOUD_ACCESS_KEY_ID", "").strip()
            and os.environ.get("ALIBABA_CLOUD_ACCESS_KEY_SECRET", "").strip()
        )
    return False


def ensure_output_dir(output_dir: str | None) -> tuple[bool, str]:
    if not output_dir:
        return False, "请先设置素材输出目录"
    if not os.path.isdir(output_dir):
        return False, f"素材输出目录不存在或不可访问: {output_dir}"
    if not os.access(output_dir, os.W_OK):
        return False, f"素材输出目录不可写: {output_dir}"
    return True, ""


def create_task_dir(output_dir: str, task_id: str) -> str:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    task_dir = os.path.join(output_dir, f"material_task_{stamp}_{task_id[:8]}")
    os.makedirs(os.path.join(task_dir, "images"), exist_ok=True)
    return task_dir


def ensure_path_under(base_dir: str, target_path: str) -> bool:
    base = os.path.realpath(base_dir)
    target = os.path.realpath(target_path)
    try:
      return os.path.commonpath([base, target]) == base
    except ValueError:
      return False
