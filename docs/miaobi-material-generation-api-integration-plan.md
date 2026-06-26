# Miaobi Material Generation API Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 2026-06-25 妙笔系统素材制作 API 接入 NovelSync 现有“素材生成”模块，让桌面端通过本地 FastAPI 代理创建、查询、取消和重试云端素材任务。

**Architecture:** 保持前端继续调用本地 `/material/*` 接口；后端新增妙笔素材 API 客户端与云端响应适配层，把妙笔的数字状态、`taskNo`、`itemNo`、`imageNo` 映射为现有前端可消费的字符串状态和字段。SQLite 保留为本地任务镜像与离线展示缓存，不再由本地线程生成提示词或图片。

**Tech Stack:** React 18、Ant Design 5、Zustand、Axios、FastAPI、SQLModel/SQLite、requests、Python unittest。

---

## 背景与输入

接口文档来源：

```text
/Users/dl/work/code/em-dnmp/www/Taido/miaobi-api/resources/change-log/2026-06-25-material-generation/api-doc.md
```

妙笔云端基础路径：

```text
/baijiahao-sync/v1/material
```

鉴权方式与本项目已有登录、小说同步接口一致：后端 `MiaobiClient` 携带本地保存的妙笔 token，请求头包含 `Authorization: Bearer <token>` 和 `token: <token>`。

现有 NovelSync 已有素材模块：

- 后端路由：[python-core/api/material_generation.py](/Users/dl/work/code/Python/NovelSync/python-core/api/material_generation.py)
- 妙笔客户端：[python-core/core/miaobi_client.py](/Users/dl/work/code/Python/NovelSync/python-core/core/miaobi_client.py)
- 本地模型：[python-core/storage/models.py](/Users/dl/work/code/Python/NovelSync/python-core/storage/models.py)
- 本地 CRUD：[python-core/storage/crud.py](/Users/dl/work/code/Python/NovelSync/python-core/storage/crud.py)
- 前端 API：[src/api/material.ts](/Users/dl/work/code/Python/NovelSync/src/api/material.ts)
- 前端页面：[src/pages/MaterialGeneration.tsx](/Users/dl/work/code/Python/NovelSync/src/pages/MaterialGeneration.tsx)
- 前端类型：[src/types/material.ts](/Users/dl/work/code/Python/NovelSync/src/types/material.ts)

## 推荐方案

采用“本地代理 + 云端任务镜像”的方案。

本地 API 契约尽量不变，前端仍访问：

```text
GET  /material/config-status
POST /material/tasks
GET  /material/tasks
GET  /material/tasks/{task_id}
GET  /material/tasks/{task_id}/images
POST /material/tasks/{task_id}/cancel
POST /material/tasks/{task_id}/retry-failed
POST /material/images/{image_id}/retry
```

后端把这些请求代理到妙笔云端：

```text
GET  /baijiahao-sync/v1/material/config
POST /baijiahao-sync/v1/material/tasks
GET  /baijiahao-sync/v1/material/tasks
GET  /baijiahao-sync/v1/material/tasks/{taskNo}
GET  /baijiahao-sync/v1/material/tasks/{taskNo}/images
POST /baijiahao-sync/v1/material/tasks/{taskNo}/cancel
POST /baijiahao-sync/v1/material/tasks/{taskNo}/retry-failed
POST /baijiahao-sync/v1/material/items/{itemNo}/images/{imageNo}/retry
```

原因：

- 前端已有素材页可复用，不需要新增页面。
- 登录态、妙笔网关域名、requests session 已经集中在 `MiaobiClient`。
- 云端接口已经负责提示词、图片生成、限额、异步任务和重试，本地 `prompt_service.py`、`image_service.py`、`task_runner.py` 在云端模式下应退出主路径。
- 本地 SQLite 继续保存任务镜像，支持页面快速回显、历史记录和后续本地下载能力。

## 非目标

- 不在客户端暴露模型 API key、模型名、provider key。
- 不让前端直连 `api.miaobi-ai.tech` 或 `api.miaobi-ai.com`。
- 不保留本地模型生成作为主流程。
- 不改变现有登录、会话恢复、小说同步开关逻辑。
- 不实现云端文档未提供的“删除云端任务”接口；本地删除只能删除本地镜像，除非妙笔后续补接口。

## 接口字段适配

### 状态映射

云端任务状态：

```text
1=pending
2=running
3=success
4=failed
5=partial_failed
6=cancel_requested
7=canceled
8=deleted
```

本地/前端任务状态：

```text
pending
running
success
failed
partial_failed
cancel_requested
canceled
deleted
interrupted
```

云端子任务、图片状态：

```text
1=pending
2=running
3=success
4=failed
5=canceled
```

本地/前端图片状态：

```text
pending
running
success
failed
canceled
```

转换必须在后端集中完成，放在新文件 `python-core/material_generation/miaobi_adapter.py`，前端不得解析数字状态。

### 创建任务请求映射

前端输入扩展为：

```ts
{
  title?: string;
  count: number;
  promptTheme?: string;
  imageSize?: "1140x640" | "370x245";
  negativePrompt?: string;
  promptExtend?: boolean;
}
```

后端转发到妙笔：

```json
{
  "title": "古风女主素材",
  "prompt_theme": "古风女主，夜色，灯笼，写实",
  "count": 2,
  "image_size": "1140x640",
  "negative_prompt": "低清晰度，畸形手指，文字水印",
  "prompt_extend": false
}
```

校验规则：

- `title` 必填或由本地补为 `素材制作任务`，最长 128 字。
- `promptTheme` 必填，转为 `prompt_theme`，最长 1000 字。
- `count` 范围从本地当前 1-100 改为 1-20。
- `imageSize` 只允许来自云端 `/config` 返回的 `imageSizes.value`，默认使用 `defaultImageSize`。
- `negativePrompt` 最长 1000 字。
- `promptExtend` 默认 `false`。
- 禁止把 `api_key`、`apiKey`、`model_api_key`、`provider_key` 从客户端透传给云端。

### 图片列表映射

妙笔 `GET /tasks/{taskNo}/images` 返回的是 item 数组，每个 item 内含 `images` 数组。前端当前需要扁平图片列表，因此后端应扁平化：

```text
item.itemNo + image.imageNo -> imageId
item.taskNo -> taskId
item.itemNo -> promptId
image.imageIndex -> imageIndex
image.url -> remoteUrl
image.path -> remotePath 或 localPath 为空
item.prompt -> prompt
item.promptJson -> metadataJson
image.width/height/fileSize -> width/height/fileSize
image.errorMsg 或 item.errorMsg -> errorMsg
```

本地不强制下载远端图片。第一阶段直接用 `remoteUrl` 预览，`localPath` 允许为空。

## 文件结构

### 创建

- `python-core/material_generation/miaobi_adapter.py`
  - 负责状态转换、任务字段转换、图片扁平化、请求体白名单过滤。
- `python-core/tests/test_miaobi_material_adapter.py`
  - 覆盖数字状态映射、任务详情转换、图片列表扁平化、敏感字段过滤。
- `python-core/tests/test_miaobi_material_api.py`
  - 覆盖本地 `/material/*` 路由代理云端客户端的行为。

### 修改

- `python-core/core/miaobi_client.py`
  - 新增素材配置、任务创建、列表、详情、图片、取消、任务失败重试、单图重试方法。
- `python-core/material_generation/schemas.py`
  - 把创建请求扩展为妙笔接口字段，并把 `count` 上限改为 20。
- `python-core/api/material_generation.py`
  - 从本地生成流程切换为妙笔代理流程。
  - `config-status` 改为报告登录态、云端配置、输出目录可用性；不再要求本地文本/生图模型配置。
  - 删除或旁路 `generate_prompts()`、`task_runner.submit()` 主路径。
- `python-core/storage/models.py`
  - 为云端任务编号和图片编号补字段，建议在现有表追加字段而不是重建表。
- `python-core/storage/crud.py`
  - 增加 upsert 云端任务镜像、upsert 云端 item/prompt、upsert 云端图片镜像方法。
- `src/types/material.ts`
  - 增加 `cancel_requested`、`deleted`、`canceled` 图片状态、`imageSize`、`negativePrompt`、`promptExtend`。
- `src/api/material.ts`
  - 兼容 `taskNo`、`itemNo`、`imageNo`、`progressPercent`、`nextPollAfterSeconds`、云端分页字段。
- `src/pages/MaterialGeneration.tsx`
  - 创建表单增加图片尺寸、负向提示词、提示词扩展开关。
  - 数量上限改为 20。
  - 轮询间隔优先使用任务返回的 `nextPollAfterSeconds`。
  - 远端图片不支持本地打开目录时禁用“打开所在目录”按钮。

### 保留但退出主路径

- `python-core/material_generation/prompt_service.py`
- `python-core/material_generation/image_service.py`
- `python-core/material_generation/task_runner.py`

这些文件可作为本地 fallback 保留，但默认不再由 `/material/tasks` 调用。是否保留 fallback 由环境变量控制：

```text
MATERIAL_GENERATION_MODE=miaobi
```

取值：

```text
miaobi
local
```

默认值必须为 `miaobi`。

## 数据模型变更

在 `MaterialTask` 追加：

```python
cloud_task_no: Optional[str] = Field(default=None, index=True)
theme: str = Field(default="")
negative_prompt: str = Field(default="")
prompt_extend: int = Field(default=0)
image_size: str = Field(default="1140x640")
progress_percent: int = Field(default=0)
next_poll_after_seconds: int = Field(default=3)
```

在 `MaterialPrompt` 追加：

```python
cloud_item_no: Optional[str] = Field(default=None, index=True)
prompt_status: str = Field(default="pending")
finished_at: Optional[datetime] = None
```

在 `MaterialImage` 追加：

```python
cloud_image_no: Optional[str] = Field(default=None, index=True)
remote_path: Optional[str] = None
provider: Optional[str] = None
provider_task_id: Optional[str] = None
model: Optional[str] = None
```

SQLite 自动迁移会对已有表追加字段；不得修改已有主键，避免触发 `storage/database.py` 的重建表逻辑。

## 开发任务

### Task 1: 妙笔客户端方法

**Files:**

- Modify: `python-core/core/miaobi_client.py`
- Test: `python-core/tests/test_miaobi_material_api.py`

- [ ] **Step 1: 写客户端调用测试**

测试用例：

```python
def test_miaobi_client_material_methods_use_expected_paths():
    from core.miaobi_client import MiaobiClient

    calls = []
    client = MiaobiClient(token="token-1")
    client._get = lambda path, params=None: calls.append(("GET", path, params)) or {"code": 10000}
    client._post = lambda path, payload=None: calls.append(("POST", path, payload)) or {"code": 10000}

    client.get_material_config()
    client.create_material_task({"title": "t", "prompt_theme": "p", "count": 1})
    client.list_material_tasks(page=2, page_size=20, status=2, title="古风")
    client.get_material_task("mg_1")
    client.get_material_task_images("mg_1")
    client.cancel_material_task("mg_1")
    client.retry_material_failed("mg_1")
    client.retry_material_image("mgi_1", "mgimg_1")

    assert calls == [
        ("GET", "baijiahao-sync/v1/material/config", None),
        ("POST", "baijiahao-sync/v1/material/tasks", {"title": "t", "prompt_theme": "p", "count": 1}),
        ("GET", "baijiahao-sync/v1/material/tasks", {"currentPage": 2, "_limit": 20, "status": 2, "title": "古风"}),
        ("GET", "baijiahao-sync/v1/material/tasks/mg_1", None),
        ("GET", "baijiahao-sync/v1/material/tasks/mg_1/images", None),
        ("POST", "baijiahao-sync/v1/material/tasks/mg_1/cancel", None),
        ("POST", "baijiahao-sync/v1/material/tasks/mg_1/retry-failed", None),
        ("POST", "baijiahao-sync/v1/material/items/mgi_1/images/mgimg_1/retry", None),
    ]
```

- [ ] **Step 2: 跑测试确认失败**

Run:

```bash
python -m unittest python-core/tests/test_miaobi_material_api.py -v
```

Expected: FAIL，提示 `MiaobiClient` 缺少素材方法。

- [ ] **Step 3: 实现客户端方法**

在 `MiaobiClient` 末尾增加素材方法，路径与测试完全一致。`list_material_tasks()` 参数名固定为 `currentPage`、`_limit`、`status`、`title`。

- [ ] **Step 4: 跑测试确认通过**

Run:

```bash
python -m unittest python-core/tests/test_miaobi_material_api.py -v
```

Expected: PASS。

### Task 2: 云端响应适配层

**Files:**

- Create: `python-core/material_generation/miaobi_adapter.py`
- Test: `python-core/tests/test_miaobi_material_adapter.py`

- [ ] **Step 1: 写状态和字段转换测试**

覆盖以下输入输出：

```python
def test_task_status_mapping():
    from material_generation.miaobi_adapter import cloud_task_status_to_local

    assert cloud_task_status_to_local(1) == "pending"
    assert cloud_task_status_to_local(2) == "running"
    assert cloud_task_status_to_local(3) == "success"
    assert cloud_task_status_to_local(4) == "failed"
    assert cloud_task_status_to_local(5) == "partial_failed"
    assert cloud_task_status_to_local(6) == "cancel_requested"
    assert cloud_task_status_to_local(7) == "canceled"
    assert cloud_task_status_to_local(8) == "deleted"
    assert cloud_task_status_to_local(999) == "failed"
```

```python
def test_sanitize_create_payload_blocks_sensitive_keys():
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

    assert payload == {
        "title": "古风",
        "prompt_theme": "灯笼",
        "count": 2,
        "image_size": "1140x640",
        "negative_prompt": "水印",
        "prompt_extend": True,
    }
```

```python
def test_flatten_cloud_images_maps_item_and_image_ids():
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

    assert rows[0]["imageId"] == "mgimg_1"
    assert rows[0]["promptId"] == "mgi_1"
    assert rows[0]["taskId"] == "mg_1"
    assert rows[0]["remoteUrl"] == "https://example.test/a.jpeg"
    assert rows[0]["status"] == "success"
    assert rows[0]["prompt"] == "提示词"
```

- [ ] **Step 2: 跑测试确认失败**

Run:

```bash
python -m unittest python-core/tests/test_miaobi_material_adapter.py -v
```

Expected: FAIL，提示模块不存在。

- [ ] **Step 3: 实现适配层**

实现函数：

```python
cloud_task_status_to_local(status: int | str) -> str
cloud_item_status_to_local(status: int | str) -> str
build_cloud_create_payload(raw: dict) -> dict
normalize_cloud_task(raw: dict, user_phone: str = "") -> dict
flatten_cloud_images(items: list[dict]) -> list[dict]
```

要求：

- 日期字段原样保留为字符串。
- `progressPercent` 缺失时用 `(successCount + failedCount) / requestedCount` 计算。
- `build_cloud_create_payload()` 只输出白名单字段。
- 空 `promptTheme` 抛出 `ValueError("素材需求不能为空")`。

- [ ] **Step 4: 跑测试确认通过**

Run:

```bash
python -m unittest python-core/tests/test_miaobi_material_adapter.py -v
```

Expected: PASS。

### Task 3: 本地存储镜像

**Files:**

- Modify: `python-core/storage/models.py`
- Modify: `python-core/storage/crud.py`
- Test: `python-core/tests/test_miaobi_material_api.py`

- [ ] **Step 1: 写 upsert 测试**

测试目标：

- 同一个 `cloud_task_no` 重复同步时更新同一条 `MaterialTask`。
- 同一个 `cloud_image_no` 重复同步时更新同一条 `MaterialImage`。
- 不修改已有主键定义。

- [ ] **Step 2: 增加字段**

按“数据模型变更”章节追加字段。字段全部 nullable 或带默认值，保证 SQLite `ALTER TABLE ADD COLUMN` 可执行。

- [ ] **Step 3: 增加 CRUD**

新增方法：

```python
upsert_material_task_from_cloud(task: dict, user_phone: str) -> dict
upsert_material_images_from_cloud(task_no: str, rows: list[dict], user_phone: str) -> list[dict]
get_material_task_by_cloud_no(task_no: str) -> dict | None
get_material_image_by_cloud_no(image_no: str) -> dict | None
```

实现规则：

- `cloud_task_no` 存在时优先作为幂等键。
- 本地 `task_id` 对云端任务使用 `taskNo`，避免前后端 ID 再转换。
- 本地 `prompt_id` 对云端 item 使用 `itemNo`。
- 本地 `image_id` 对云端图片使用 `imageNo`。

- [ ] **Step 4: 跑存储相关测试**

Run:

```bash
python -m unittest python-core/tests/test_miaobi_material_api.py -v
```

Expected: PASS。

### Task 4: 后端 `/material/*` 改为妙笔代理

**Files:**

- Modify: `python-core/api/material_generation.py`
- Modify: `python-core/material_generation/schemas.py`
- Test: `python-core/tests/test_miaobi_material_api.py`
- Update if necessary: `python-core/tests/test_material_generation_api.py`

- [ ] **Step 1: 写路由代理测试**

覆盖：

- 未登录时 `POST /material/tasks` 返回 `401`。
- `POST /material/tasks` 调用 `MiaobiClient.create_material_task()`，返回本地规范化 task。
- `GET /material/tasks` 调用云端列表并返回 `list`。
- `GET /material/tasks/{task_id}/images` 调用云端图片接口并返回扁平列表。
- `POST /material/images/{image_id}/retry` 能通过本地镜像找到 `itemNo` 和 `imageNo`，调用云端单图重试。

- [ ] **Step 2: 修改 schema**

`CreateMaterialTaskRequest` 改为：

```python
class CreateMaterialTaskRequest(BaseModel):
    title: str | None = Field(default=None, max_length=128)
    count: int = Field(ge=1, le=20)
    promptTheme: str = Field(min_length=1, max_length=1000)
    imageSize: str | None = None
    negativePrompt: str | None = Field(default=None, max_length=1000)
    promptExtend: bool = False
```

- [ ] **Step 3: 改造 config-status**

`GET /material/config-status` 返回：

```json
{
  "loggedIn": true,
  "outputDir": "/local/output",
  "outputDirReady": true,
  "outputDirError": "",
  "cloudConfigured": true,
  "ready": true,
  "cloudConfig": {
    "defaultImageSize": "1140x640",
    "imageSizes": []
  }
}
```

兼容旧前端字段：

```json
{
  "textServiceConfigured": true,
  "imageServiceConfigured": true
}
```

- [ ] **Step 4: 改造任务接口**

`create_task()` 流程：

1. 检查 `current_user_phone()`。
2. 校验本地素材输出目录，保留现有提示。
3. 用 `build_cloud_create_payload()` 构造云端请求。
4. 调用 `MiaobiClient().create_material_task(payload)`。
5. 检查云端 `code == 10000`。
6. 用 `normalize_cloud_task()` 标准化。
7. 写入本地镜像。
8. 返回 `response_ok(task, "任务已提交")`。

列表、详情、图片、取消、失败重试都先请求云端；云端成功后刷新本地镜像。

- [ ] **Step 5: 处理本地功能差异**

`reveal_task_output_dir()` 和 `reveal_image()`：

- 如果本地 `outputDir` 或 `localPath` 存在，保留原行为。
- 如果只有 `remoteUrl`，返回 `400` 和消息 `云端图片未下载到本地，无法打开所在目录`。

`delete_task()`：

- 只删除本地镜像。
- 如果云端状态不是 `deleted`，返回消息 `已删除本地记录，云端任务未删除`。

- [ ] **Step 6: 跑后端测试**

Run:

```bash
python -m unittest python-core/tests/test_miaobi_material_adapter.py python-core/tests/test_miaobi_material_api.py python-core/tests/test_material_generation_api.py -v
```

Expected: PASS。

### Task 5: 前端 API 与类型适配

**Files:**

- Modify: `src/types/material.ts`
- Modify: `src/api/material.ts`

- [ ] **Step 1: 扩展类型**

增加：

```ts
export type MaterialTaskStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'partial_failed'
  | 'failed'
  | 'cancel_requested'
  | 'canceled'
  | 'deleted'
  | 'interrupted';
```

创建输入增加：

```ts
imageSize?: string;
negativePrompt?: string;
promptExtend?: boolean;
```

`MaterialConfigStatus` 增加：

```ts
cloudConfigured: boolean;
cloudConfig?: {
  defaultImageSize?: string;
  imageSizes?: Array<{ value: string; label: string; width: number; height: number }>;
};
```

- [ ] **Step 2: 扩展 normalizeTask**

兼容字段：

```text
taskNo -> taskId
progressPercent -> progressPercent
nextPollAfterSeconds -> nextPollAfterSeconds
theme -> promptTheme
negativePrompt -> negativePrompt
imageSize -> imageSize
```

- [ ] **Step 3: 扩展 normalizeImage**

兼容字段：

```text
imageNo -> imageId
itemNo -> promptId
url -> remoteUrl
path -> remotePath
statusText/status -> status
```

- [ ] **Step 4: 修改 createTask**

提交字段：

```ts
{
  title: input.title,
  count: input.count,
  promptTheme: input.promptTheme,
  imageSize: input.imageSize,
  negativePrompt: input.negativePrompt,
  promptExtend: input.promptExtend ?? false,
}
```

- [ ] **Step 5: 跑前端类型检查**

Run:

```bash
npm run build
```

Expected: PASS。

### Task 6: 前端页面交互

**Files:**

- Modify: `src/pages/MaterialGeneration.tsx`

- [ ] **Step 1: 创建表单增加云端字段**

新增控件：

- 图片尺寸：`Select`，选项来自 `configStatus.cloudConfig.imageSizes`。
- 负向提示词：`TextArea`，最大 1000 字。
- 提示词扩展：`Switch`，默认关闭。

- [ ] **Step 2: 修改制作数量**

`InputNumber` 改为：

```tsx
<InputNumber min={1} max={20} precision={0} style={{ width: '100%' }} />
```

- [ ] **Step 3: promptTheme 改为必填**

表单规则：

```tsx
rules={[{ required: true, message: '请输入素材需求' }]}
```

- [ ] **Step 4: 远端图片禁用本地打开目录**

按钮禁用条件：

```tsx
disabled={!image.localPath}
```

远端图片仍允许：

```tsx
window.open(image.remoteUrl, '_blank')
```

- [ ] **Step 5: 增加 cancel_requested/deleted 展示**

`statusMeta` 增加：

```tsx
cancel_requested: { label: '取消中', color: 'warning', icon: <SyncOutlined spin /> },
deleted: { label: '已删除', color: 'default' },
```

- [ ] **Step 6: 使用云端建议轮询间隔**

计算当前任务轮询间隔：

```tsx
const pollMs = Math.max(2, selectedTask?.nextPollAfterSeconds ?? 3) * 1000;
```

没有 `nextPollAfterSeconds` 时保持 3 秒。

- [ ] **Step 7: 跑前端构建**

Run:

```bash
npm run build
```

Expected: PASS。

### Task 7: 回归验证

**Files:**

- No planned source changes.

- [ ] **Step 1: 后端单测**

Run:

```bash
python -m unittest python-core/tests/test_miaobi_material_adapter.py python-core/tests/test_miaobi_material_api.py python-core/tests/test_material_generation_api.py python-core/tests/test_material_task_runner.py python-core/tests/test_novel_sync_gate.py -v
```

Expected: PASS。

- [ ] **Step 2: Python 编译检查**

Run:

```bash
python -m compileall python-core/core python-core/api python-core/material_generation python-core/storage
```

Expected: PASS，无 SyntaxError。

- [ ] **Step 3: 前端构建**

Run:

```bash
npm run build
```

Expected: PASS。

- [ ] **Step 4: 手动联调**

使用开发环境：

```bash
APP_ENV=dev python -m uvicorn python-core.api.main:app --host 127.0.0.1 --port 8000 --reload
npm run dev
```

验证路径：

1. 登录成功后进入“素材生成”。
2. 页面能读取云端 `/material/config` 并显示图片尺寸。
3. 创建 `count=1` 的任务。
4. 任务进入 pending/running。
5. 轮询后看到 success/failed/partial_failed。
6. 成功图片可以用远端 URL 预览。
7. 失败任务可以调用“重试失败项”。
8. 失败单图可以调用“重试图片”。
9. 取消 running 任务后显示 `取消中` 或 `已取消`。

## 风险与处理

### 风险 1: 云端接口没有删除任务

处理：前端“删除任务”改为“删除本地记录”，确认弹窗文案必须写明不删除云端任务。

### 风险 2: 云端图片只有远端 URL

处理：第一阶段不自动下载，预览使用 `remoteUrl`；“打开所在目录”只在 `localPath` 存在时可用。

### 风险 3: 本地旧任务使用 UUID，云端任务使用 taskNo

处理：新云端任务直接以 `taskNo` 作为本地 `task_id`，旧 UUID 任务仍可展示。CRUD 查询同时兼容 `task_id` 和 `cloud_task_no`。

### 风险 4: 数字状态进入前端

处理：状态转换集中在 `miaobi_adapter.py`；前端 normalize 只作为兜底，不承担主要转换责任。

### 风险 5: 本地旧测试依赖本地生成流程

处理：保留 `MATERIAL_GENERATION_MODE=local` fallback。旧 `task_runner` 测试继续测试 local 模式，不影响默认 miaobi 模式。

## 完成标准

- 本地 `/material/*` 接口全部可以通过模拟 `MiaobiClient` 返回完成单元测试。
- 前端素材页可以提交妙笔云端任务，并展示任务与图片结果。
- 创建请求不会透传任何客户端敏感 key。
- `count` 上限已调整为妙笔接口限制的 20。
- 云端任务状态和图片状态不会以数字形式暴露给页面业务逻辑。
- 登录、小说同步开关、百家号 Cookie 同步逻辑保持不变。
