import json
import os
import platform
import re
import subprocess
import threading
from pathlib import Path
from urllib import request
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Body, Query, Request
from pydantic import BaseModel

from core.miaobi_client import MiaobiClient
from material_generation.miaobi_adapter import (
    build_cloud_create_payload,
    flatten_cloud_images,
    is_cloud_image_id,
    is_cloud_item_id,
    normalize_cloud_task,
)
from material_generation.schemas import CreateMaterialTaskRequest
from storage.crud import (
    get_active_material_output_dir,
    get_active_token,
    get_active_user_phone,
)

router = APIRouter(prefix="/material", tags=["material"])

download_jobs: dict[str, dict] = {}
download_jobs_lock = threading.Lock()


def response_ok(data=None, message: str = "success"):
    return {"code": 10000, "message": message, "data": data}


def response_from_cloud(res: dict):
    if res.get("code") != 10000:
        return {
            "code": res.get("code", 500),
            "message": res.get("message", "妙笔素材接口请求失败"),
            "data": res.get("data", []),
        }
    return None


def debug_cloud_response(label: str, res: dict):
    try:
        text = json.dumps(res, ensure_ascii=False, default=str)
    except TypeError:
        text = str(res)
    max_len = 12000
    if len(text) > max_len:
        text = f"{text[:max_len]}... [truncated {len(text) - max_len} chars]"
    print(f"[MaterialGeneration][MiaobiCloud] {label}: {text}")


def current_user_phone() -> str | None:
    return get_active_user_phone()


class RetryImageRequest(BaseModel):
    taskId: str | None = None
    promptId: str | None = None


class DownloadImagesRequest(BaseModel):
    imageIds: list[str] = []


def require_cloud_user() -> tuple[str | None, dict | None]:
    user_phone = current_user_phone()
    if not user_phone:
        return None, {"code": 401, "message": "请先登录"}
    return user_phone, None


def extract_cloud_task_rows(data):
    if isinstance(data, dict):
        if isinstance(data.get("data"), list):
            return data.get("data", []), data.get("pagination", {})
        if isinstance(data.get("list"), list):
            return data.get("list", []), data.get("pagination", {})
    if isinstance(data, list):
        return data, {}
    return [], {}


def flatten_cloud_prompts(rows: list[dict]) -> list[dict]:
    prompts = []
    for index, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            continue
        prompt_id = row.get("itemNo") or row.get("promptId")
        if not prompt_id:
            continue
        prompts.append({
            "promptId": prompt_id,
            "cloudItemNo": prompt_id,
            "taskId": row.get("taskNo") or row.get("taskId") or "",
            "promptIndex": index,
            "prompt": row.get("prompt") or "",
            "negativePrompt": "",
            "metadataJson": row.get("promptJson") or {},
            "promptStatus": row.get("promptStatus"),
            "status": row.get("status") or row.get("promptStatus"),
            "errorMsg": row.get("errorMsg") or "",
            "createdAt": row.get("createdAt"),
            "finishedAt": row.get("finishedAt"),
        })
    return prompts


def normalize_task_no_query(task_nos: list[str]) -> list[str]:
    normalized: list[str] = []
    for value in task_nos or []:
        for item in str(value or "").split(","):
            task_no = item.strip()
            if task_no and task_no not in normalized:
                normalized.append(task_no)
    return normalized


def safe_dir_name(name: str | None) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|\r\n\t]+', "_", str(name or "").strip())
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ._")
    return cleaned[:120] or "素材制作任务"


def image_file_extension(row: dict) -> str:
    for value in (row.get("remotePath"), row.get("remoteUrl")):
        suffix = Path(str(value or "")).suffix.lower()
        if suffix in (".jpg", ".jpeg", ".png", ".webp"):
            return suffix
    return ".jpeg"


def save_remote_image(row: dict, target_dir: str) -> dict:
    url = row.get("remoteUrl")
    if not url:
        raise ValueError("图片缺少远程地址")

    image_id = row.get("imageId") or row.get("cloudImageNo") or "image"
    image_index = int(row.get("imageIndex") or 1)
    filename = f"{image_index:03d}_{safe_dir_name(image_id)}{image_file_extension(row)}"
    path = os.path.join(target_dir, filename)
    with request.urlopen(url, timeout=60) as response:
        content = response.read()
    with open(path, "wb") as file:
        file.write(content)
    return {
        "imageId": image_id,
        "path": path,
        "fileSize": len(content),
    }


def create_download_job(task_id: str, image_ids: list[str], output_dir: str) -> dict:
    job_id = f"mdj_{uuid4().hex}"
    job = {
        "downloadJobId": job_id,
        "taskId": task_id,
        "imageIds": list(image_ids),
        "status": "pending",
        "total": len(image_ids),
        "savedCount": 0,
        "failedCount": 0,
        "outputDir": "",
        "baseOutputDir": output_dir,
        "message": "下载任务已提交",
        "files": [],
        "errors": [],
    }
    with download_jobs_lock:
        download_jobs[job_id] = job
    return job.copy()


def update_download_job(job_id: str, **updates):
    with download_jobs_lock:
        job = download_jobs.get(job_id)
        if not job:
            return None
        job.update(updates)
        return job.copy()


def run_download_job(job_id: str):
    with download_jobs_lock:
        job = download_jobs.get(job_id)
        if not job:
            return
        task_id = job["taskId"]
        selected_ids = set(job["imageIds"])
        base_output_dir = job["baseOutputDir"]

    update_download_job(job_id, status="running", message="正在下载图片")

    try:
        client = MiaobiClient()
        task_res = client.get_material_task(task_id)
        task_error = response_from_cloud(task_res)
        if task_error:
            raise ValueError(task_error["message"])
        task = normalize_cloud_task(task_res.get("data", {}))
        target_dir = os.path.join(base_output_dir, safe_dir_name(task.get("title") or task_id))
        os.makedirs(target_dir, exist_ok=True)

        image_res = client.get_material_task_images(task_id)
        image_error = response_from_cloud(image_res)
        if image_error:
            raise ValueError(image_error["message"])
        rows = [
            row
            for row in flatten_cloud_images(image_res.get("data", []))
            if row.get("imageId") in selected_ids and row.get("remoteUrl")
        ]
        if not rows:
            raise ValueError("没有可保存的选中图片")

        update_download_job(job_id, total=len(rows), outputDir=target_dir)
        files = []
        errors = []
        for row in rows:
            try:
                files.append(save_remote_image(row, target_dir))
            except Exception as e:
                errors.append({
                    "imageId": row.get("imageId") or row.get("cloudImageNo") or "",
                    "message": str(e),
                })
            update_download_job(
                job_id,
                savedCount=len(files),
                failedCount=len(errors),
                files=files,
                errors=errors,
            )

        if errors and files:
            update_download_job(
                job_id,
                status="partial_failed",
                message=f"部分图片保存失败，成功 {len(files)} 张，失败 {len(errors)} 张",
            )
        elif errors:
            update_download_job(job_id, status="failed", message=f"保存图片失败: {errors[0]['message']}")
        else:
            update_download_job(job_id, status="success", message=f"图片已保存到输出目录中，共 {len(files)} 张")
    except Exception as e:
        update_download_job(job_id, status="failed", message=str(e))


@router.get("/config-status")
def get_config_status():
    user_phone = current_user_phone()
    cloud_configured = False
    cloud_config = {}
    if user_phone and get_active_token():
        try:
            res = MiaobiClient().get_material_config()
            cloud_configured = res.get("code") == 10000
            cloud_config = res.get("data", {}) if cloud_configured else {}
        except Exception as e:
            print(f"[MaterialGeneration] 获取妙笔素材配置失败: {e}")
    return response_ok({
        "loggedIn": bool(user_phone),
        "outputDir": get_active_material_output_dir(),
        "outputDirReady": True,
        "outputDirError": "",
        "textServiceConfigured": False,
        "imageServiceConfigured": False,
        "cloudConfigured": cloud_configured,
        "cloudConfig": cloud_config,
        "ready": bool(user_phone and cloud_configured),
        "modelConfig": {},
    })


@router.get("/output-dir/reveal")
def reveal_output_dir():
    output_dir = get_active_material_output_dir()
    if not output_dir:
        return {"code": 400, "message": "素材输出目录未设置"}
    if not os.path.isdir(output_dir):
        return {"code": 400, "message": f"素材输出目录不存在: {output_dir}"}

    try:
        system = platform.system()
        if system == "Darwin":
            subprocess.Popen(["open", output_dir])
        elif system == "Windows":
            subprocess.Popen(["explorer", output_dir])
        else:
            subprocess.Popen(["xdg-open", output_dir])
        return response_ok(message="success")
    except Exception as e:
        return {"code": 500, "message": f"打开素材输出目录失败: {e}"}


@router.post("/tasks")
def create_task(item: CreateMaterialTaskRequest):
    user_phone, auth_error = require_cloud_user()
    if auth_error:
        return auth_error

    try:
        payload = build_cloud_create_payload(item.model_dump())
        res = MiaobiClient().create_material_task(payload)
        error = response_from_cloud(res)
        if error:
            return error
        task = normalize_cloud_task(res.get("data", {}), user_phone=user_phone or "")
        return response_ok(task, res.get("message", "任务已提交"))
    except ValueError as e:
        return {"code": 400, "message": str(e)}
    except Exception as e:
        print(f"[MaterialGeneration] 妙笔素材任务创建失败: {e}")
        return {"code": 500, "message": f"妙笔素材任务创建失败: {e}"}


@router.get("/tasks")
def get_tasks(
    page: int = 1,
    page_size: int = 50,
    title: str | None = None,
    startDate: str | None = None,
    endDate: str | None = None,
):
    user_phone, auth_error = require_cloud_user()
    if auth_error:
        return auth_error
    try:
        res = MiaobiClient().list_material_tasks(
            page=page,
            page_size=page_size,
            title=title.strip() if title else None,
            start_date=startDate,
            end_date=endDate,
        )
        error = response_from_cloud(res)
        if error:
            return error
        rows, pagination = extract_cloud_task_rows(res.get("data", {}))
        tasks = [normalize_cloud_task(row, user_phone=user_phone or "") for row in rows]
        return response_ok({"list": tasks, "pagination": pagination})
    except Exception as e:
        return {"code": 500, "message": f"妙笔素材任务列表读取失败: {e}"}


@router.get("/tasks/progress")
def get_tasks_progress(request: Request = None, taskNos: list[str] = Query(default=[])):
    _, auth_error = require_cloud_user()
    if auth_error:
        return auth_error
    bracket_task_nos = request.query_params.getlist("taskNos[]") if request else []
    task_nos = normalize_task_no_query([*taskNos, *bracket_task_nos])
    if not task_nos:
        return {"code": 400, "message": "请选择要查询的任务"}
    if len(task_nos) > 100:
        return {"code": 400, "message": "单次最多查询 100 个任务"}

    try:
        res = MiaobiClient().get_material_tasks_progress(task_nos)
        cloud_error = response_from_cloud(res)
        if cloud_error:
            return cloud_error
        data = res.get("data", {})
        rows = data.get("rows", []) if isinstance(data, dict) else []
        return response_ok({"rows": rows})
    except Exception as e:
        return {"code": 500, "message": f"妙笔素材任务进度读取失败: {e}"}


@router.get("/tasks/{task_id}")
def get_task(task_id: str):
    user_phone, auth_error = require_cloud_user()
    if auth_error:
        return auth_error
    try:
        res = MiaobiClient().get_material_task(task_id)
        cloud_error = response_from_cloud(res)
        if cloud_error:
            return cloud_error
        normalized = normalize_cloud_task(res.get("data", {}), user_phone=user_phone or "")
        return response_ok(normalized)
    except Exception as e:
        return {"code": 500, "message": f"妙笔素材任务详情读取失败: {e}"}


@router.get("/tasks/{task_id}/prompts")
def get_task_prompts(task_id: str):
    _, auth_error = require_cloud_user()
    if auth_error:
        return auth_error
    try:
        res = MiaobiClient().get_material_task_images(task_id)
        cloud_error = response_from_cloud(res)
        if cloud_error:
            return cloud_error
        return response_ok({"list": flatten_cloud_prompts(res.get("data", []))})
    except Exception as e:
        return {"code": 500, "message": f"妙笔素材提示词读取失败: {e}"}


@router.get("/tasks/{task_id}/images")
def get_task_images(task_id: str):
    _, auth_error = require_cloud_user()
    if auth_error:
        return auth_error
    try:
        res = MiaobiClient().get_material_task_images(task_id)
        debug_cloud_response(f"GET /material/tasks/{task_id}/images", res)
        cloud_error = response_from_cloud(res)
        if cloud_error:
            return cloud_error
        rows = flatten_cloud_images(res.get("data", []))
        return response_ok({"list": rows})
    except Exception as e:
        return {"code": 500, "message": f"妙笔素材图片列表读取失败: {e}"}


@router.post("/tasks/{task_id}/images/download")
def download_task_images(task_id: str, item: DownloadImagesRequest, background_tasks: BackgroundTasks):
    _, auth_error = require_cloud_user()
    if auth_error:
        return auth_error
    if not item.imageIds:
        return {"code": 400, "message": "请选择要下载的图片"}

    output_dir = get_active_material_output_dir()
    if not output_dir:
        return {"code": 400, "message": "素材输出目录未设置"}
    if not os.path.isdir(output_dir):
        return {"code": 400, "message": f"素材输出目录不存在: {output_dir}"}

    job = create_download_job(task_id, item.imageIds, output_dir)
    background_tasks.add_task(run_download_job, job["downloadJobId"])
    return response_ok(job, "下载任务已提交")


@router.get("/download-jobs/{job_id}")
def get_download_job(job_id: str):
    with download_jobs_lock:
        job = download_jobs.get(job_id)
        if not job:
            return {"code": 404, "message": "下载任务不存在或已过期"}
        return response_ok(job.copy())


@router.get("/tasks/{task_id}/reveal")
def reveal_task_output_dir(task_id: str):
    return {"code": 400, "message": "素材任务使用云端数据，不再保存本地输出目录"}


@router.delete("/tasks/{task_id}")
def delete_task(task_id: str):
    return {"code": 400, "message": "妙笔云端素材任务暂不支持本地删除"}


@router.post("/tasks/{task_id}/cancel")
def cancel_task(task_id: str):
    user_phone, auth_error = require_cloud_user()
    if auth_error:
        return auth_error
    res = MiaobiClient().cancel_material_task(task_id)
    cloud_error = response_from_cloud(res)
    if cloud_error:
        return cloud_error
    normalized = normalize_cloud_task(res.get("data", {}), user_phone=user_phone or "")
    return response_ok(normalized, "取消请求已提交")


@router.post("/tasks/{task_id}/retry-failed")
def retry_failed(task_id: str):
    _, auth_error = require_cloud_user()
    if auth_error:
        return auth_error
    res = MiaobiClient().retry_material_failed(task_id)
    debug_cloud_response(f"POST /material/tasks/{task_id}/retry-failed", res)
    cloud_error = response_from_cloud(res)
    if cloud_error:
        return cloud_error
    return response_ok(res.get("data", {}), "失败项已提交重试")


@router.post("/images/{image_id}/retry")
def retry_image(image_id: str, item: RetryImageRequest | None = Body(default=None)):
    _, auth_error = require_cloud_user()
    if auth_error:
        return auth_error

    if not isinstance(item, RetryImageRequest):
        item = None
    prompt_id = item.promptId if item else None
    task_id = item.taskId if item else None
    if not prompt_id or not task_id:
        return {"code": 400, "message": "云端图片重试缺少任务或子任务编号"}
    if is_cloud_image_id(image_id):
        res = MiaobiClient().retry_material_image(prompt_id, image_id)
        debug_cloud_response(f"POST /material/items/{prompt_id}/images/{image_id}/retry", res)
    elif is_cloud_item_id(image_id):
        res = MiaobiClient().retry_material_failed(task_id)
        debug_cloud_response(f"POST /material/tasks/{task_id}/retry-failed", res)
    else:
        return {"code": 400, "message": "无效的云端图片编号"}

    cloud_error = response_from_cloud(res)
    if cloud_error:
        return cloud_error
    return response_ok(res.get("data", {}), "图片已提交重试")


@router.get("/images")
def get_images(page: int = 1, page_size: int = 100):
    return response_ok({"list": [], "pagination": {"currentPage": page, "pageSize": page_size, "total": 0}})


@router.get("/images/{image_id}")
def get_image(image_id: str):
    return {"code": 404, "message": "素材图片详情请从云端任务图片列表读取"}


@router.get("/images/{image_id}/reveal")
def reveal_image(image_id: str):
    return {"code": 400, "message": "云端图片没有本地文件路径"}


def reset_interrupted_tasks_on_startup():
    return None
