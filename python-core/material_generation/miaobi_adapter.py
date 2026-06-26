import json
from datetime import datetime
from typing import Any
from uuid import uuid4


TASK_STATUS_MAP = {
    1: "pending",
    2: "running",
    3: "success",
    4: "failed",
    5: "partial_failed",
    6: "cancel_requested",
    7: "canceled",
    8: "deleted",
}

ITEM_STATUS_MAP = {
    1: "pending",
    2: "running",
    3: "success",
    4: "failed",
    5: "canceled",
}

def _to_int(value: int | str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def cloud_task_status_to_local(status: int | str) -> str:
    return TASK_STATUS_MAP.get(_to_int(status), "failed")


def cloud_item_status_to_local(status: int | str) -> str:
    return ITEM_STATUS_MAP.get(_to_int(status), "failed")


def is_cloud_task_id(task_id: str | None) -> bool:
    return bool(task_id and str(task_id).startswith("mg_"))


def is_cloud_item_id(item_id: str | None) -> bool:
    return bool(item_id and str(item_id).startswith("mgi_"))


def is_cloud_image_id(image_id: str | None) -> bool:
    return bool(image_id and str(image_id).startswith("mgimg_"))


def default_material_task_title(now: datetime | None = None, token: str | None = None) -> str:
    timestamp = (now or datetime.now()).strftime("%Y%m%d%H%M%S")
    suffix = (token or uuid4().hex).replace("-", "")[:6]
    return f"{timestamp}_{suffix}"


def build_cloud_create_payload(raw: dict) -> dict:
    raw_title = str(raw.get("title") or "").strip()
    title = raw_title[:128] or default_material_task_title()
    count = int(raw.get("count") or 1)
    if count > 100:
        raise ValueError("妙笔单次最多制作 100 张图片")
    raw_theme = raw.get("promptTheme") or raw.get("prompt_theme") or raw.get("theme")
    theme = str(raw_theme).strip() if raw_theme is not None else ""

    payload = {
        "title": title,
        "count": count,
        "prompt_extend": bool(raw.get("promptExtend") if "promptExtend" in raw else raw.get("prompt_extend", False)),
    }
    if theme:
        payload["prompt_theme"] = theme[:1000]

    image_size = raw.get("imageSize") or raw.get("image_size")
    if image_size:
        payload["image_size"] = str(image_size)

    negative_prompt = raw.get("negativePrompt") or raw.get("negative_prompt")
    if negative_prompt:
        payload["negative_prompt"] = str(negative_prompt).strip()[:1000]

    return payload


def normalize_cloud_task(raw: dict, user_phone: str = "") -> dict:
    task_no = str(raw.get("taskNo") or raw.get("task_id") or raw.get("taskId") or "")
    requested_count = int(raw.get("requestedCount") or raw.get("requested_count") or raw.get("count") or 0)
    success_count = int(raw.get("successCount") or raw.get("success_count") or 0)
    failed_count = int(raw.get("failedCount") or raw.get("failed_count") or 0)
    progress = raw.get("progressPercent")
    if progress is None:
        progress = raw.get("progress_percent")

    status = raw.get("statusText") if isinstance(raw.get("statusText"), str) else None
    if not status:
        status = cloud_task_status_to_local(raw.get("status"))

    return {
        "taskId": task_no,
        "cloudTaskNo": task_no,
        "userPhone": user_phone,
        "title": raw.get("title") or "素材制作任务",
        "theme": raw.get("theme") or raw.get("promptTheme") or raw.get("prompt_theme") or "",
        "negativePrompt": raw.get("negativePrompt") or raw.get("negative_prompt") or "",
        "promptExtend": int(raw.get("promptExtend") or raw.get("prompt_extend") or 0),
        "imageSize": raw.get("imageSize") or raw.get("image_size") or "",
        "status": status,
        "requestedCount": requested_count,
        "successCount": success_count,
        "failedCount": failed_count,
        "progressPercent": int(progress) if progress not in (None, "") else None,
        "errorMsg": raw.get("errorMsg") or raw.get("error_msg") or "",
        "nextPollAfterSeconds": int(raw.get("nextPollAfterSeconds") or raw.get("next_poll_after_seconds") or 3),
        "createdAt": raw.get("createdAt") or raw.get("created_at") or "",
        "startedAt": raw.get("startedAt") or raw.get("started_at") or "",
        "finishedAt": raw.get("finishedAt") or raw.get("finished_at") or "",
    }


def flatten_cloud_images(items: list[dict]) -> list[dict]:
    rows: list[dict] = []
    for item in items or []:
        item_no = str(item.get("itemNo") or item.get("promptId") or "")
        task_no = str(item.get("taskNo") or item.get("taskId") or "")
        prompt_status = cloud_item_status_to_local(item.get("promptStatus") or item.get("imageStatus") or 1)
        images = item.get("images") or []
        if not images:
            rows.append(_cloud_image_row(item, {}, item_no, task_no, prompt_status))
            continue
        for image in images:
            rows.append(_cloud_image_row(item, image, item_no, task_no, prompt_status))
    return rows


def _cloud_image_row(item: dict, image: dict, item_no: str, task_no: str, prompt_status: str) -> dict:
    image_no = str(image.get("imageNo") or item_no)
    status = image.get("statusText") if isinstance(image.get("statusText"), str) else None
    if not status:
        status = cloud_item_status_to_local(image.get("status") or item.get("imageStatus") or item.get("promptStatus") or 1)
    return {
        "imageId": image_no,
        "cloudImageNo": image_no,
        "taskId": task_no,
        "promptId": item_no,
        "cloudItemNo": item_no,
        "imageIndex": int(image.get("imageIndex") or 1),
        "localPath": "",
        "remoteUrl": image.get("url") or "",
        "remotePath": image.get("path") or "",
        "status": status,
        "promptStatus": prompt_status,
        "prompt": item.get("prompt") or "",
        "metadataJson": item.get("promptJson") or {},
        "width": image.get("width"),
        "height": image.get("height"),
        "fileSize": image.get("fileSize"),
        "errorMsg": image.get("errorMsg") or item.get("errorMsg") or "",
        "provider": image.get("provider") or "",
        "providerTaskId": image.get("providerTaskId") or "",
        "model": image.get("model") or "",
        "createdAt": image.get("createdAt") or item.get("createdAt") or "",
        "finishedAt": item.get("finishedAt") or "",
    }


def parse_cloud_datetime(value: Any):
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(text[:19], fmt)
        except ValueError:
            continue
    return None


def metadata_to_json(value: Any) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(value or {}, ensure_ascii=False)
