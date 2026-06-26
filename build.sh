#!/bin/bash
# ============================================================================
# NovelSync 构建脚本 (Tauri + PyInstaller)
#
# 用法:
#   ./build.sh dev          # 开发模式：PyInstaller 打包 + Tauri dev 启动
#   ./build.sh prod         # 生产构建：PyInstaller 打包 + Tauri build 出 .dmg/.msi
#   ./build.sh pyinstaller  # 仅打包 Python 后端（不触发 Tauri）
#   ./build.sh tauri-init   # 仅初始化 Tauri 骨架（首次使用）
#   ./build.sh clean        # 清理所有构建产物
#
# 环境要求: Node.js, Python 3.10+, Rust (仅 prod 需要)
# ============================================================================

set -euo pipefail

# ---- 颜色输出 ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }
log_step()  { echo -e "${CYAN}[STEP]${NC} $*"; }

# ---- 路径定义 ----
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
PYTHON_CORE="$PROJECT_ROOT/python-core"
SRC_TAURI="$PROJECT_ROOT/src-tauri"
VENV_DIR="$PROJECT_ROOT/.venv"
BINARIES_DIR="$SRC_TAURI/binaries"
PYINSTALLER_DIST="$PROJECT_ROOT/dist-python"
RELEASE_DIR="$PROJECT_ROOT/release"

# ---- 加载 Rust 工具链 ----
if [[ -f "$HOME/.cargo/env" ]]; then
    source "$HOME/.cargo/env"
fi

# ---- 平台检测 ----
detect_platform() {
    local os arch target

    case "$(uname -s)" in
        Darwin) os="apple-darwin" ;;
        Linux)  os="unknown-linux-gnu" ;;
        MINGW*|MSYS*|CYGWIN*) os="pc-windows-msvc" ;;
        *) log_error "不支持的操作系统: $(uname -s)"; exit 1 ;;
    esac

    case "$(uname -m)" in
        x86_64|amd64)  arch="x86_64" ;;
        arm64|aarch64) arch="aarch64" ;;
        *) log_error "不支持的架构: $(uname -m)"; exit 1 ;;
    esac

    target="${arch}-${os}"
    echo "$target"
}

RUST_TARGET="$(detect_platform)"
log_info "构建目标平台: $RUST_TARGET"

# ---- 环境变量设定 ----
set_env() {
    local mode="$1"
    local env_file
    if [[ "$mode" == "prod" || "$mode" == "production" ]]; then
        export APP_ENV=prod
        export NODE_ENV=production
        env_file="$PROJECT_ROOT/.env.production"
        log_info "环境: PRODUCTION (.env.production)"
    else
        export APP_ENV=dev
        export NODE_ENV=development
        env_file="$PROJECT_ROOT/.env.development"
        log_info "环境: DEVELOPMENT (.env.development)"
    fi

    # 从 .env 文件读取版本号
    if [[ -f "$env_file" ]]; then
        APP_VERSION=$(grep -E '^APP_VERSION=' "$env_file" | cut -d'=' -f2 | tr -d '[:space:]')
    fi
    export APP_VERSION="${APP_VERSION:-0.1.0}"
    log_info "应用版本: $APP_VERSION"
}

# ---- 前置检查 ----
check_prerequisites() {
    local mode="$1"
    local missing=0

    # Node.js
    if ! command -v node &>/dev/null; then
        log_error "未找到 Node.js，请先安装: https://nodejs.org/"
        missing=1
    else
        log_info "Node.js $(node -v)"
    fi

    # Python
    if ! command -v python3 &>/dev/null; then
        log_error "未找到 Python3，请先安装"
        missing=1
    else
        log_info "Python $(python3 --version)"
    fi

    # Rust (dev 和 prod 都需要，Tauri dev 也要编译 Rust 代码)
    if ! command -v rustc &>/dev/null; then
        log_error "Tauri 需要 Rust 工具链（dev/prod 均需），请执行:"
        log_error "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
        log_error "安装后重新打开终端，或执行: source \"\$HOME/.cargo/env\""
        missing=1
    else
        log_info "Rust $(rustc --version)"
    fi

    if [[ $missing -eq 1 ]]; then
        log_error "缺少必要依赖，退出"
        exit 1
    fi
}

# ---- venv 与 Python 依赖 ----
setup_python_env() {
    log_step "配置 Python 虚拟环境..."

    if [[ ! -d "$VENV_DIR" ]]; then
        log_info "创建 venv: $VENV_DIR"
        python3 -m venv "$VENV_DIR"
    fi

    source "$VENV_DIR/bin/activate"

    log_info "安装 Python 依赖..."
    pip install -q -r "$PYTHON_CORE/requirements.txt"

    # PyInstaller 本身也要装
    pip install -q pyinstaller

    log_info "Python 环境就绪"
}

# ---- PyInstaller 打包 ----
build_python_backend() {
    log_step "使用 PyInstaller 打包 Python 后端..."

    source "$VENV_DIR/bin/activate"

    local binary_name="novelsync-server-${RUST_TARGET}"

    # Windows 加 .exe 后缀
    if [[ "$RUST_TARGET" == *"windows"* ]]; then
        binary_name="${binary_name}.exe"
    fi

    mkdir -p "$PYINSTALLER_DIST"

    # 手动清理上次的 workpath 和 spec 文件（避免 --clean 清全局缓存时的权限问题）
    rm -rf "$PROJECT_ROOT/build-python"
    rm -f "$PROJECT_ROOT"/*.spec

    # macOS SIP 会阻止 PyInstaller 扫描 ~/Library/Python/*/site-packages
    # 通过 monkey-patch site.getusersitepackages() 绕过权限错误
    local patch_script="$PROJECT_ROOT/build-python/_pyinstaller_patch.py"
    mkdir -p "$PROJECT_ROOT/build-python"
    cat > "$patch_script" << 'PATCH'
import site
_orig = site.getusersitepackages
def _safe_getusersitepackages():
    try:
        p = _orig()
        import os
        if p and not os.access(p, os.R_OK):
            return "/tmp/_nonexistent_user_site"
        return p
    except Exception:
        return "/tmp/_nonexistent_user_site"
site.getusersitepackages = _safe_getusersitepackages
PATCH

    # 生成运行时环境标识文件（打包后 Python 靠它判断加载哪个 .env）
    echo "$APP_ENV" > "$PROJECT_ROOT/.env.runtime"
    log_info "已生成 .env.runtime (APP_ENV=$APP_ENV)"

    # 执行 PyInstaller
    # --onefile: 打成单个可执行文件
    # --name: 输出文件名（遵循 Tauri sidecar 命名规范: name-target_triple）
    # --add-data: 把 .env 文件和项目子模块打包进去
    # --paths: 让 PyInstaller 知道模块搜索路径
    # --hidden-import: PyInstaller 静态分析可能遗漏的动态导入
    cd "$PROJECT_ROOT"

    # 分隔符: macOS/Linux 用 :，Windows 用 ;
    local sep=":"
    if [[ "$RUST_TARGET" == *"windows"* ]]; then
        sep=";"
    fi

    # 子目录列表，只添加存在的目录
    local sub_dirs=("api" "core" "storage" "manager" "workers" "utils" "monitor" "material_generation")
    local extra_add_data=""
    for d in "${sub_dirs[@]}"; do
        if [[ -d "$PYTHON_CORE/$d" ]]; then
            extra_add_data="$extra_add_data    '--add-data=$PYTHON_CORE/$d${sep}$d',
"

        fi
    done

    PYTHONNOUSERSITE=1 python -c "
import site, os
_orig = site.getusersitepackages
def _safe():
    try:
        p = _orig()
        if p and not os.access(p, os.R_OK):
            return '/tmp/_nonexistent_user_site'
        return p
    except Exception:
        return '/tmp/_nonexistent_user_site'
site.getusersitepackages = _safe

import sys
sys.argv = ['pyinstaller',
    '--onefile',
    '--name=$binary_name',
    '--distpath=$PYINSTALLER_DIST',
    '--workpath=$PROJECT_ROOT/build-python',
    '--paths=$PYTHON_CORE',
    '--add-data=.env.production${sep}.',
    '--add-data=.env.development${sep}.',
    '--add-data=.env.runtime${sep}.',
$extra_add_data    '--add-data=$PYTHON_CORE/config.py${sep}.',
    '--hidden-import=api',
    '--hidden-import=api.main',
    '--hidden-import=api.material_generation',
    '--hidden-import=core',
    '--hidden-import=core.miaobi_client',
    '--hidden-import=core.baijiahao_client',
    '--hidden-import=storage',
    '--hidden-import=storage.models',
    '--hidden-import=storage.database',
    '--hidden-import=storage.crud',
    '--hidden-import=manager',
    '--hidden-import=manager.sync_manager',
    '--hidden-import=workers',
    '--hidden-import=workers.scheduler',
    '--hidden-import=material_generation',
    '--hidden-import=material_generation.settings',
    '--hidden-import=material_generation.prompt_service',
    '--hidden-import=material_generation.image_service',
    '--hidden-import=material_generation.task_runner',
    '--hidden-import=material_generation.schemas',
    '--hidden-import=config',
    '--hidden-import=uvicorn.logging',
    '--hidden-import=uvicorn.loops',
    '--hidden-import=uvicorn.loops.auto',
    '--hidden-import=uvicorn.protocols',
    '--hidden-import=uvicorn.protocols.http',
    '--hidden-import=uvicorn.protocols.http.auto',
    '--hidden-import=uvicorn.protocols.websockets',
    '--hidden-import=uvicorn.protocols.websockets.auto',
    '--hidden-import=uvicorn.lifespan',
    '--hidden-import=uvicorn.lifespan.on',
    '--hidden-import=sqlmodel',
    '--hidden-import=pydantic',
    '--hidden-import=dotenv',
    '--hidden-import=watchdog',
    '--hidden-import=watchdog.observers',
    '--hidden-import=watchdog.events',
    '--hidden-import=docx',
    '--hidden-import=multipart',
    '$PYTHON_CORE/main.py',
]
from PyInstaller.__main__ import _console_script_run
_console_script_run()
"

    if [[ ! -f "$PYINSTALLER_DIST/$binary_name" ]]; then
        log_error "PyInstaller 打包失败: 找不到产物 $PYINSTALLER_DIST/$binary_name"
        exit 1
    fi

    log_info "Python 后端打包完成: $PYINSTALLER_DIST/$binary_name"

    # 复制到 Tauri sidecar 目录
    mkdir -p "$BINARIES_DIR"
    cp "$PYINSTALLER_DIST/$binary_name" "$BINARIES_DIR/"
    chmod +x "$BINARIES_DIR/$binary_name"

    log_info "已复制到 Tauri sidecar 目录: $BINARIES_DIR/$binary_name"
}

# ---- 前端依赖 ----
setup_frontend() {
    log_step "安装前端依赖..."

    cd "$PROJECT_ROOT"
    if [[ ! -d "node_modules" ]]; then
        npm install
    else
        log_info "node_modules 已存在，跳过 install（如需更新请先 rm -rf node_modules）"
    fi

    # Tauri CLI（dev 依赖）
    if ! npx tauri --version &>/dev/null 2>&1; then
        log_info "安装 @tauri-apps/cli..."
        npm install -D @tauri-apps/cli@^1
    fi
}

# ---- Tauri 初始化 ----
init_tauri() {
    log_step "初始化 Tauri 项目骨架..."

    cd "$PROJECT_ROOT"

    # 先确保 CLI 装了
    if ! npx tauri --version &>/dev/null 2>&1; then
        npm install -D @tauri-apps/cli@^1
    fi

    # 如果 tauri.conf.json 已存在就跳过 init，但仍执行 patch（幂等）
    if [[ -f "$SRC_TAURI/tauri.conf.json" ]]; then
        log_warn "src-tauri/tauri.conf.json 已存在，跳过 init"
    else
        # 非交互式初始化（--force 覆盖已有文件，如 binaries/ 目录）
        npx tauri init \
            --force \
            --app-name "NovelSync" \
            --window-title "NovelSync" \
            --dist-dir "../dist" \
            --dev-path "http://localhost:1420" \
            --ci

        log_info "Tauri 骨架创建完成"
    fi

    # 无论是否刚 init，都确保 sidecar 配置正确
    patch_tauri_config
}

# ---- 补丁 Tauri 配置（加入 sidecar 声明）----
patch_tauri_config() {
    log_step "注入 sidecar 配置到 tauri.conf.json..."

    local conf_path="$SRC_TAURI/tauri.conf.json"

    if [[ ! -f "$conf_path" ]]; then
        log_error "找不到 ${conf_path}，请先执行 tauri-init"
        exit 1
    fi

    # 写临时 CJS 文件执行（项目 package.json 设了 type:module，.js 会被当 ESM）
    local tmp_js="$PROJECT_ROOT/build-python/_patch_tauri_conf.cjs"
    mkdir -p "$PROJECT_ROOT/build-python"

    cat > "$tmp_js" << JSEOF
const fs = require('fs');
const confPath = process.argv[2];
const version = '${APP_VERSION}';
const appEnv = '${APP_ENV}';
const conf = JSON.parse(fs.readFileSync(confPath, 'utf-8'));

// 注入版本号
if (conf.package) {
    conf.package.version = version;
}

// 根据环境设置 Vite 构建的 --mode
const viteMode = (appEnv === 'prod') ? 'production' : 'development';
if (conf.build) {
    conf.build.beforeBuildCommand = 'npm run build -- --mode ' + viteMode;
}

// 注入 bundle identifier 和 externalBin
if (conf.tauri && conf.tauri.bundle) {
    conf.tauri.bundle.identifier = 'com.novelsync.app';
    conf.tauri.bundle.externalBin = ['binaries/novelsync-server'];
}

// 注入 shell sidecar 权限
if (conf.tauri) {
    conf.tauri.allowlist = conf.tauri.allowlist || {};
    conf.tauri.allowlist.shell = {
        sidecar: true,
        scope: [{ name: 'binaries/novelsync-server', sidecar: true }]
    };
}

fs.writeFileSync(confPath, JSON.stringify(conf, null, 2));
console.log('tauri.conf.json 已更新 (version=' + version + ', viteMode=' + viteMode + ')');
JSEOF

    node "$tmp_js" "$conf_path"

    log_info "sidecar 配置注入完成"
}

# ---- Tauri Rust 侧启动 sidecar 的代码 ----
patch_tauri_main_rs() {
    local main_rs="$SRC_TAURI/src/main.rs"

    if [[ ! -f "$main_rs" ]]; then
        log_warn "找不到 ${main_rs}，跳过 Rust 代码注入"
        return
    fi

    # 如果已经包含 sidecar 代码就跳过
    if grep -q "novelsync-server" "$main_rs" 2>/dev/null; then
        log_info "main.rs 已包含 sidecar 启动代码，跳过"
        return
    fi

    cat > "$main_rs" << 'RUST_CODE'
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::api::process::Command;

fn main() {
    tauri::Builder::default()
        .setup(|_app| {
            // 启动 Python 后端 sidecar
            // APP_ENV 由构建脚本注入到 .env 文件中，Python 端自行读取
            let (mut _rx, _child) = Command::new_sidecar("novelsync-server")
                .expect("Failed to create novelsync-server sidecar")
                .spawn()
                .expect("Failed to spawn novelsync-server sidecar");

            // sidecar 输出转发到 Tauri 日志
            tauri::async_runtime::spawn(async move {
                use tauri::api::process::CommandEvent;
                while let Some(event) = _rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => println!("[Python] {}", line),
                        CommandEvent::Stderr(line) => eprintln!("[Python:ERR] {}", line),
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
RUST_CODE

    log_info "main.rs sidecar 启动代码已写入"
}

# ---- 统一构建流程（dev / prod 仅环境变量不同）----
run_build() {
    local mode="$1"
    set_env "$mode"
    check_prerequisites "$mode"

    setup_python_env
    build_python_backend
    setup_frontend
    init_tauri
    patch_tauri_main_rs

    log_step "执行 Tauri 构建（${APP_ENV}）..."

    cd "$PROJECT_ROOT"
    APP_ENV="$APP_ENV" npx tauri build

    # 收集产物到 release 目录
    collect_release

    # 自动清理中间产物，只保留 release 目录下的安装包
    cleanup_build_artifacts
}

# ---- 收集产物到 release 目录 ----
collect_release() {
    log_step "收集构建产物到 release 目录..."

    mkdir -p "$RELEASE_DIR"

    local bundle_dir="$SRC_TAURI/target/release/bundle"
    if [[ ! -d "$bundle_dir" ]]; then
        log_warn "未找到 Tauri bundle 目录: $bundle_dir"
        return
    fi

    # 架构标识
    local arch_label
    case "$(uname -m)" in
        x86_64|amd64)  arch_label="x64" ;;
        arm64|aarch64) arch_label="arm64" ;;
        *) arch_label="$(uname -m)" ;;
    esac

    find "$bundle_dir" -type f \( -name "*.dmg" -o -name "*.app.tar.gz" -o -name "*.msi" -o -name "*.exe" -o -name "*.AppImage" -o -name "*.deb" \) | while read -r f; do
        local ext="${f##*.}"
        # .app.tar.gz 特殊处理
        if [[ "$f" == *.app.tar.gz ]]; then
            ext="app.tar.gz"
        fi
        local new_name="NovelSync_${APP_VERSION}_${APP_ENV}_${arch_label}.${ext}"
        cp "$f" "$RELEASE_DIR/$new_name"
        local size
        size=$(du -sh "$f" | cut -f1)
        log_info "  📦 $new_name ($size)"
    done

    log_info "========================================="
    log_info "  产物已收集到: $RELEASE_DIR"
    log_info "========================================="
}

# ---- 清理构建中间产物（prod 完成后自动调用）----
cleanup_build_artifacts() {
    log_step "清理构建中间产物..."

    rm -rf "$PYINSTALLER_DIST"
    rm -rf "$PROJECT_ROOT/build-python"
    rm -rf "$BINARIES_DIR"
    rm -rf "$SRC_TAURI/target"
    rm -rf "$PROJECT_ROOT/dist"
    rm -f "$PROJECT_ROOT"/*.spec

    log_info "中间产物已清理，最终安装包在: $RELEASE_DIR"
}

# ---- 清理 ----
run_clean() {
    log_step "清理构建产物..."

    rm -rf "$PYINSTALLER_DIST"
    rm -rf "$PROJECT_ROOT/build-python"
    rm -rf "$BINARIES_DIR"
    rm -rf "$RELEASE_DIR"
    rm -rf "$SRC_TAURI/target"
    rm -rf "$PROJECT_ROOT/dist"
    rm -f "$PROJECT_ROOT"/*.spec

    log_info "清理完成"
}

# ---- 入口 ----
main() {
    local cmd="${1:-help}"

    case "$cmd" in
        dev)
            run_build dev
            ;;
        prod|production)
            run_build prod
            ;;
        pyinstaller|py)
            set_env "${2:-dev}"
            check_prerequisites dev
            setup_python_env
            build_python_backend
            ;;
        tauri-init|init)
            setup_frontend
            init_tauri
            patch_tauri_main_rs
            ;;
        clean)
            run_clean
            ;;
        *)
            echo ""
            echo "NovelSync 构建脚本"
            echo ""
            echo "用法: $0 <command>"
            echo ""
            echo "命令:"
            echo "  dev           构建安装包（dev 环境变量，.env.development）"
            echo "  prod          构建安装包（prod 环境变量，.env.production）"
            echo "  pyinstaller   仅打包 Python 后端（可追加 dev/prod 参数）"
            echo "  tauri-init    仅初始化 Tauri 骨架（首次使用）"
            echo "  clean         清理所有构建产物"
            echo ""
            echo "示例:"
            echo "  $0 dev                # 构建 dev 环境安装包 (.dmg/.msi)"
            echo "  $0 prod               # 构建 prod 环境安装包 (.dmg/.msi)"
            echo "  $0 pyinstaller prod   # 仅做 Python 打包（生产配置）"
            echo ""
            echo "产物输出:"
            echo "  release/              最终安装包 (.dmg/.msi)"
            echo ""
            ;;
    esac
}

main "$@"
