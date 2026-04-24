# 百家号同步工具 (NovelSync) 详细设计文档 v1.0

## 1. 项目目录结构
采用模块化设计，确保 UI 与后台逻辑分离。

```plaintext
NovelSync/ 
├── src-tauri/       # Tauri 桌面端主程序目录 (Rust 构建的跨平台壳环境)
├── src/             # Vite + React + TS 前端视图层 (Ant Design)
│   ├── assets/      # 静态资源（图标、图片）
│   ├── components/  # 独立分离的 UI 组件库
│   ├── pages/       # 前端各个路由功能页面
│   └── store/       # Zustand 状态管理
├── python-core/     # 本地 Python 后端与核心单机微服务逻辑
│   ├── api/         # FastAPI 启动入口与基础无状态路由接口 (削弱其负担，剥离调度)
│   ├── manager/     # 统一调度中心 (SyncManager: 掌管任务队列与 Worker 生命防崩恢复) 🔥
│   ├── event_bus/   # 事件系统 (EventBus: 替代 SQLite 来维持内部消息高频流转) 🔥
│   ├── monitor/     # 系统探针监控 (System Monitor: CPU/内存等软硬状态上报) 🔥
│   ├── workers/     # 执行层沙盒进程池 (标准派发与执行)
│   │   ├── base_worker.py  # 进程基类 (内部提供 EventBus 对接和 run 容错保障循环) 
│   │   ├── article_sync.py # 文章同步与数据抓取独立进程 
│   │   ├── order_sync.py   # 订单与收益抓取独立进程 
│   │   └── file_watcher.py # 本地文件监控上报进程
│   ├── storage/     # 数据库底层持久化配置 (含 SQLModel 封装)
│   ├── core/        # 核心公共库
│   │   ├── auth.py         # 登录校验逻辑
│   │   ├── websocket.py    # 外部 WebSocket 云端连通性封装
│   │   └── http_client.py  # 外部网络请求访问池
│   ├── utils/       # 工具类 
│   └── config.py    # 运行时全局配置引擎
├── data/            # 本地 SQLite 3 数据库文件实例存储位
├── 需求文档/        # 规范及设计文档
├── requirements.txt # Python 后端核心依赖 (FastAPI, SQLModel, watchdog, uvicorn 等)
├── package.json     # Node.js 前台资源列表 (Vite, React, Ant Design, axios 等) 
├── .env             # 环境变量与机密配置 (被 git 忽略)
├── .gitignore       # Git 版本控制过滤规则库
└── README.md        # 项目介绍与部署启动说明文档
```

## 2. 本地数据库设计
采用 SQLite 3 为低延迟储存内核结合 **SQLModel** 作为对象关系映射持久层。环境要求开启 `PRAGMA journal_mode=WAL;` 从而支撑高速并发操作及跨进程通信。
表结构及 DDL 创建语句详见：**[客户端数据库表结构.md](./客户端数据库表结构.md)**

## 3. 架构设计

采用前后端侧别分离方案：**Tauri (原生壳) + React (Web前端视图) + FastAPI (核心运行实例)**，并辅以本地轻量计算群（Worker 进程组）进行多管线同步作业。

### 3.1 核心微服务群栈及边界职责 (V3 新生架构)
* **Tauri (桌面壳与基础运行保安 Sidecar)**:
  * 脱离单纯包裹网页的任务范畴。负责**侧边栏托管式拉起 Python 服务**，检测其端口可用性、并在 Python 层非正常覆灭时予以硬重启。
  * 将具备专门的日志中心系统，实时截获并提供 `app.log` / `worker.log` 在 UI 显示排错。
  * 配合 React 与 Ant Design 生态来呈现毫无迟滞的绝佳体验。
* **FastAPI (薄薄一层的 API 桥梁)**:
  * 将旧有臃肿的子进程管理能力退位。专注负责暴露内部 RESTful 路由给前端 axios 请求查询业务数据，和维持至核心主网 WebSocket。
* **Sync Manager (集中式调度核心体系) 🔥**:
  * 整个中台的真正“大脑”。全数下沉掌控所有 Worker 进程的生成与死亡。如果某个进程崩溃死亡将被察觉并自动拉起（不死之身）。
  * 支撑复杂的多账号挂载优先级打分：自动避让冷却中的账号，择优高成功率账号派包抓取。
* **Event Bus (高速内存事件总线) 🔥**:
  * 取代往昔强迫 Worker 将执行中日志写入 SQLite 从而引发卡死、抢锁的技术痛点。
  * 所有进度流转采取标准的无锁推拉模式：**Worker(生产者) -> Queue/EventBus -> Manager(消费汇聚) -> WebSockets -> UI/React(渲染展示)**。
* **Worker (高规范化执行进程池)**:
  * 后台隔绝的运行沙盒组，必须统一继任于 `BaseWorker` 超类结构体系。各节点发生任意崩溃绝不允许污染宿主系统，而是标准化包成错误包塞进 EventBus 发给上游救火。

### 3.2 进阶的数据处理与系统监控
* **SQLite 持久层规范归位**: 禁止将其用于一切“进度推拉”行为，缩减数据库负担。它应当专注于纯粹的历史断线恢复保留与永久业务储存本身 (`journal_mode=WAL` 等机制仍做多重防护)。
* **通信网络**: `HTTP` 处理非敏感常规上传拉取；高频进度推送与云端制裁下发全权依托 `WebSocket` 即时性完成。
* **Monitor (系统心电图组)**: 新增底层硬件状态报告（包含系统虚拟缓存、总体算力余量、及当前排爆在系统中的任务积压池水位程度），一并实时投屏。

## 4. 核心功能与交互流程

### 4.1 登录鉴权
* **流程**:
  1. 客户端通过探测 `hash(CPU特征 + 主板编码 + 磁盘ID + MAC)` 生成全栈防盗用的唯一机器特征作为 `client_id`。
  2. 用户在 UI 输入手机号和密码，调用 `POST /auth/login` 进行登录。
  3. 登录成功后，服务器返回 Token。客户端将 Token 和登录状态保存在本地 `client_config`。

### 4.2 本地监控目录设置
* **流程**:
  1. 用户在设置界面选择一个本地文件夹，作为小说原稿的存放目录。
  2. 选中的路径保存在 `client_config` 表的 `watch_path` 字段。
  3. 客户端启动时必须检查 `watch_path`。如果目录不存在或未设置，不启动后台进程，并在界面上提示用户先进行设置。

### 4.3 百家号多账号挂载与列表展示
* **流程**:
  1. 登录成功后，客户端调用 `GET /baijiahao-sync/v1/cookie/userCookies` 获取分配的百家号列表，存入本地表 `client_bjh_cookies`。
  2. **UI 列表展示**: 客户端会在界面专门的“百家号列表”功能页渲染这些账号数据，包含 `ID`、`头像`、`名称`，让用户明确当前挂载的号源。
  3. **任务分配**: 后台 Worker 根据 `last_used` 字段轮换使用这些账号的 Cookie 进行数据抓取操作。
  4. 如果 Cookie 失效或服务器通过 WebSocket 下发 `UPDATE_BJH_COOKIE` 更新指令，客户端自动覆盖更新本地表记录，并控制目标 Worker 重新加载。

### 4.4 小说文件监控与上传
* **流程**:
  1. 用户将 `.doc` 或 `.docx` 文件存放到设置好的监控目录。
  2. `file_watcher` 进程检测到文件变动。
  3. 客户端提取文件内的纯文本，进行字数统计，并生成 MD5 记录到 `client_books_sync_tasks` 表。
  4. 调用 `POST /sync/novel/content` 发送给服务端。

### 4.5 文章流量指标上报
* **流程**:
  1. `article_sync` 进程定时（如每 60 分钟）运行一次。
  2. 使用百家号 Cookie 抓取最近文章的 `阅读量`、`点赞量`、`评论数` 和 `收益`。
  3. 将指标在 SQLite 保存记录。
  4. 批量调用 `POST /sync/novel/articles` 推送给服务端保存。

### 4.6 订单与收益上报
* **流程**:
  1. `order_sync` 进程定时或按需运行。
  2. 抓取小说专栏的总发文数、流水的订单量及推荐量等宏观数据。
  3. 调用 `POST /sync/novel/orders` 上报给服务端。

### 4.7 在线状态上报与断网重试
* **流程**:
  1. 每 30 秒通过 WebSocket 发送 `HEARTBEAT` 心跳，并定时上报 CPU 占用和任务数 (`REPORT_ONLINE_STATUS`)。
  2. 所有 HTTP 上传请求失败时，本地 `sync_status` 记为 0。当网络恢复后，底层程序会自动查找状态为 0 的记录并重新发送。

### 4.8 账号封禁强制下线
* **流程**:
  1. 服务端通过 WebSocket 下发账号禁用指令 (`ACCOUNT_DISABLE`)。
  2. FastAPI 中心控制器接收阻断指令，立即停止所有的后台 Worker 子进程（如文章采集、订单同步等）。
  3. 清除本地 SQLite 中的 Token 和授权信息，彻底终止上传操作。
  4. 界面弹窗提示“服务连接已被切断”，锁定其他页面操作，强制用户退出应用。

## 5. 接口说明
详细的 HTTP 和 WebSocket 接口定义请参考同级目录的：**[接口规范文档 (api_spec.md)](./api_spec.md)**。

## 6. 异常与安全处理
* **断线重连**: WebSocket 断开后会自动按照增量时间（1秒, 2秒, 4秒... 最大 60秒）不断尝试重连。
* **本地加密体系**: 存储的极度敏感凭证数据（Cookies 及 JWT 等），均强制不留明文，必须使用衍生自多复合硬件识别联合加密指纹（派生密钥）进行 AES 本地全本加密封存于库底。杜绝盗库换绑环境后被异地复用。