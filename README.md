# NovelSync (小说同步桌面微服务)

这是一套分离式本地服务平台，由 Tauri 托管 React (客户端面板) + FastAPI (核心任务微服务) 相互配合运行。具备防崩溃进程池及 SQLite WAL 高并发支持机制。

## 🎯 亮点架构
1. **统一神经中枢**: `Manager` 和 `EventBus` 摒弃数据库抢锁的通讯通病，彻底实现高速消息内存流转与崩溃进程自愈。
2. **账号监控守卫**: 可轮询检查所有的身份凭证，并在探测到平台拦截时发起全局熔断。
3. **极简极客 UI**: 使用 Zustand 搭配 Ant Design Dark Theme 的仪表交互看板。

## 🚀 快速开始

项目提供了一键构建脚本 `build.sh`，自动处理 Python 虚拟环境、PyInstaller 打包、Tauri 初始化等全部流程。

### 环境要求

| 依赖 | 版本 | 说明 | Windows 安装 |
|------|------|------|-------------|
| Node.js | 18+ | 前端构建 | https://nodejs.org/ |
| Python | 3.10+ | 后端运行时 | https://python.org/ (**勾选 Add to PATH**) |
| Rust | latest | Tauri 编译 | https://rustup.rs/ |
| VS Build Tools | — | Rust 编译依赖 (仅 Win) | 安装 Rust 时自动提示安装 |
| WebView2 | — | Tauri 渲染引擎 (仅 Win) | Win10/11 自带，老版本去 Edge 官网下载 |

### 开发模式

```bash
# macOS / Linux
./build.sh dev

# Windows (PowerShell)
.\build.ps1 dev
```

脚本会自动完成：
1. 创建 `.venv` 并安装 Python 依赖 + PyInstaller
2. 用 PyInstaller 打包 `python-core` 为 sidecar 二进制
3. 安装前端 npm 依赖和 Tauri CLI
4. 初始化 Tauri 骨架（首次执行时）
5. 启动 `tauri dev` 热重载调试（Python sidecar 随 Tauri 自动拉起）

启动后：
- 前端 Vite 开发服务: `http://localhost:1420`
- Python API 服务: `http://127.0.0.1:8000`

### 生产构建

```bash
# macOS / Linux
./build.sh prod

# Windows (PowerShell)
.\build.ps1 prod
```

产物输出到 `src-tauri/target/release/bundle/`，包含对应平台的安装包（macOS → `.dmg`，Windows → `.msi`）。

> ⚠️ **Tauri 和 PyInstaller 都不支持交叉编译**：Mac 版必须在 Mac 上构建，Win 版必须在 Windows 上构建。把项目 clone 到 Windows 机器上，装好依赖，直接跑 `.\build.ps1 prod` 即可。

### Windows 首次使用

```powershell
# 1. 允许执行 PowerShell 脚本（管理员权限，只需一次）
Set-ExecutionPolicy RemoteSigned

# 2. 检查依赖是否齐全
.\build.ps1 check-deps

# 3. 开始构建
.\build.ps1 prod
```

## 📦 构建脚本完整用法

```bash
./build.sh <command>
```

| 命令 | 说明 |
|------|------|
| `dev` | 开发模式：PyInstaller 打包 → Tauri dev 热重载 |
| `prod` | 生产构建：PyInstaller 打包 → Tauri build 输出安装包 |
| `pyinstaller [dev\|prod]` | 仅打包 Python 后端（不触发 Tauri） |
| `tauri-init` | 仅初始化 Tauri 骨架（首次使用） |
| `clean` | 清理所有构建产物 |

### Dev vs Prod 环境差异

| 维度 | dev | prod |
|------|-----|------|
| Python 配置 | `.env.development` | `.env.production` |
| 云端网关 | `api.miaobi-ai.tech` | `api.miaobi-ai.com` |
| Tauri 行为 | `tauri dev`（热重载） | `tauri build`（出包） |
| Rust 工具链 | 非必须 | 必须安装 |

## 🔧 手动启动（不使用构建脚本）

如果不需要 Tauri 打包，仍可手动分别启动前后端进行开发调试：

```bash
# 终端 1: 启动 Python 后端. 
python3 -m venv .venv
source .venv/bin/activate
pip install -r python-core/requirements.txt
APP_ENV=dev .venv/bin/uvicorn python-core.api.main:app --host 127.0.0.1 --port 8000 --reload

cd /Users/dl/work/code/Python/NovelSync/python-core && APP_ENV=prod /Users/dl/work/code/Python/NovelSync/.venv/bin/python main.py

# 终端 2: 启动前端  
npm install
npm run dev
```

## 📁 项目结构

```
NovelSync/
├── build.sh              # 一键构建脚本
├── python-core/          # Python 后端（FastAPI + Workers）
│   ├── api/              # HTTP 路由层
│   ├── core/             # 业务核心（MiaobiClient 等）
│   ├── storage/          # SQLite 数据层
│   ├── workers/          # 后台任务调度
│   ├── config.py         # 环境配置加载
│   ├── main.py           # Python 启动入口
│   └── requirements.txt
├── src/                  # React 前端
├── src-tauri/            # Tauri 壳（Rust + 配置）
│   └── binaries/         # PyInstaller 产物（构建时生成）
├── .env.development      # 开发环境变量
├── .env.production       # 生产环境变量
└── package.json
```
