# ============================================================================
# NovelSync 构建脚本 - Windows PowerShell 版 (Tauri + PyInstaller)
#
# 用法:
#   .\build.ps1 dev          # 开发模式
#   .\build.ps1 prod         # 生产构建 → .msi
#   .\build.ps1 pyinstaller  # 仅打包 Python 后端
#   .\build.ps1 tauri-init   # 仅初始化 Tauri 骨架
#   .\build.ps1 clean        # 清理构建产物
#   .\build.ps1 check-deps   # 检查所有依赖是否已安装
#
# 环境要求:
#   - Node.js 18+
#   - Python 3.10+
#   - Rust (rustup) + Visual Studio Build Tools
#   - WebView2 Runtime (Win10/11 一般自带)
#
# 首次使用前请以管理员身份运行: Set-ExecutionPolicy RemoteSigned
# ============================================================================

param(
    [Parameter(Position = 0)]
    [string]$Command = "help",

    [Parameter(Position = 1)]
    [string]$EnvMode = "dev"
)

$ErrorActionPreference = "Stop"

# 确保控制台输出使用 UTF-8 编码（避免中文乱码）
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# ---- 路径定义 ----
$ProjectRoot  = $PSScriptRoot
$PythonCore   = Join-Path $ProjectRoot "python-core"
$SrcTauri     = Join-Path $ProjectRoot "src-tauri"
$VenvDir      = Join-Path $ProjectRoot ".venv"
$BinariesDir  = Join-Path $SrcTauri "binaries"
$PyDistDir    = Join-Path $ProjectRoot "dist-python"
$BuildWorkDir = Join-Path $ProjectRoot "build-python"
$ReleaseDir   = Join-Path $ProjectRoot "release"

# ---- 日志函数 ----
function Log-Info  { param($Msg) Write-Host "[INFO] $Msg" -ForegroundColor Green }
function Log-Warn  { param($Msg) Write-Host "[WARN] $Msg" -ForegroundColor Yellow }
function Log-Error { param($Msg) Write-Host "[ERROR] $Msg" -ForegroundColor Red }
function Log-Step  { param($Msg) Write-Host "[STEP] $Msg" -ForegroundColor Cyan }

# ---- 平台检测 ----
function Get-RustTarget {
    $arch = if ([Environment]::Is64BitOperatingSystem) { "x86_64" } else { "i686" }
    return "$arch-pc-windows-msvc"
}

$RustTarget = Get-RustTarget
Log-Info "构建目标平台: $RustTarget"

# ---- 环境变量 ----
function Set-BuildEnv {
    param([string]$Mode)
    if ($Mode -in @("prod", "production")) {
        $env:APP_ENV  = "prod"
        $env:NODE_ENV = "production"
        $envFile = Join-Path $ProjectRoot ".env.production"
        Log-Info "环境: PRODUCTION (.env.production)"
    } else {
        $env:APP_ENV  = "dev"
        $env:NODE_ENV = "development"
        $envFile = Join-Path $ProjectRoot ".env.development"
        Log-Info "环境: DEVELOPMENT (.env.development)"
    }

    # 从 .env 文件读取版本号
    $appVersion = "0.1.0"
    if (Test-Path $envFile) {
        $match = Select-String -Path $envFile -Pattern '^APP_VERSION=(.+)$' | Select-Object -First 1
        if ($match) {
            $appVersion = $match.Matches[0].Groups[1].Value.Trim()
        }
    }
    $env:APP_VERSION = $appVersion
    Log-Info "应用版本: $appVersion"
}

# ---- 依赖检查 ----
function Test-Prerequisites {
    param([string]$Mode)
    $missing = 0

    # Node.js
    if (Get-Command node -ErrorAction SilentlyContinue) {
        Log-Info "Node.js $(node -v)"
    } else {
        Log-Error "未找到 Node.js，请安装: https://nodejs.org/"
        $missing++
    }

    # Python
    $pythonCmd = if (Get-Command python -ErrorAction SilentlyContinue) { "python" }
                 elseif (Get-Command python3 -ErrorAction SilentlyContinue) { "python3" }
                 else { $null }
    if ($pythonCmd) {
        Log-Info "Python $(& $pythonCmd --version 2>&1)"
    } else {
        Log-Error "未找到 Python，请安装: https://www.python.org/downloads/"
        Log-Error "  安装时务必勾选 'Add Python to PATH'"
        $missing++
    }

    # Rust (dev 和 prod 都需要，Tauri dev 也要编译 Rust 代码)
    if (Get-Command rustc -ErrorAction SilentlyContinue) {
        Log-Info "Rust $(rustc --version)"
    } else {
        Log-Error "Tauri 需要 Rust 工具链（dev/prod 均需），请安装: https://rustup.rs/"
        Log-Error "  安装 rustup 时会自动安装 Visual Studio Build Tools"
        $missing++
    }

    # WebView2
    $webview2 = Get-ItemProperty -Path "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
    if ($webview2) {
        Log-Info "WebView2 Runtime 已安装"
    } else {
        Log-Warn "未检测到 WebView2 Runtime（Win10/11 通常自带）"
        Log-Warn "  如果缺失请从 https://developer.microsoft.com/en-us/microsoft-edge/webview2/ 下载"
    }

    if ($missing -gt 0) {
        Log-Error "缺少 $missing 项必要依赖，请安装后重试"
        exit 1
    }
}

# ---- Python 环境 ----
function Setup-PythonEnv {
    Log-Step "配置 Python 虚拟环境..."

    $pythonCmd = if (Get-Command python -ErrorAction SilentlyContinue) { "python" } else { "python3" }

    if (-not (Test-Path $VenvDir)) {
        Log-Info "创建 venv: $VenvDir"
        & $pythonCmd -m venv $VenvDir
    }

    # 激活 venv
    $activateScript = Join-Path $VenvDir "Scripts\Activate.ps1"
    & $activateScript

    Log-Info "安装 Python 依赖..."
    pip install -q -r (Join-Path $PythonCore "requirements.txt")
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    pip install -q pyinstaller
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Log-Info "Python 环境就绪"
}

# ---- PyInstaller 打包 ----
function Build-PythonBackend {
    Log-Step "使用 PyInstaller 打包 Python 后端..."

    # 确保 venv 激活
    $activateScript = Join-Path $VenvDir "Scripts\Activate.ps1"
    & $activateScript

    $binaryName = "novelsync-server-$RustTarget.exe"

    New-Item -ItemType Directory -Force -Path $PyDistDir | Out-Null

    # 清理上次的 workpath 和 spec 文件
    if (Test-Path $BuildWorkDir) {
        Remove-Item -Recurse -Force $BuildWorkDir
    }
    Get-ChildItem -Path $ProjectRoot -Filter "*.spec" -ErrorAction SilentlyContinue | Remove-Item -Force

    $entryPoint = Join-Path $PythonCore "main.py"

    # 生成运行时环境标识文件
    $runtimeEnvPath = Join-Path $ProjectRoot ".env.runtime"
    # 使用 .NET API 写入无 BOM 的 UTF-8 文件（Windows PowerShell 5.1 的 -Encoding UTF8 会写 BOM）
    [System.IO.File]::WriteAllText($runtimeEnvPath, $env:APP_ENV, (New-Object System.Text.UTF8Encoding $false))
    Log-Info "已生成 .env.runtime (APP_ENV=$($env:APP_ENV))"

    # Windows 下 --add-data 用分号分隔
    # 动态拼接参数：子目录若不存在则跳过，避免空目录未被 git 追踪时报错
    Set-Location $ProjectRoot

    $pyArgs = @(
        '--onefile',
        "--name", $binaryName,
        "--distpath", $PyDistDir,
        "--workpath", $BuildWorkDir,
        "--paths", $PythonCore,
        "--add-data", ".env.production;.",
        "--add-data", ".env.development;.",
        "--add-data", ".env.runtime;.",
        "--add-data", "$PythonCore\config.py;."
    )

    # 子目录列表：目录存在才加入参数
    $subDirs = @('api','core','storage','manager','workers','utils','monitor')
    foreach ($d in $subDirs) {
        $dirPath = Join-Path $PythonCore $d
        if (Test-Path $dirPath) {
            $pyArgs += "--add-data"
            $pyArgs += "$dirPath;$d"
        } else {
            Log-Warn "跳过不存在的目录: $dirPath"
        }
    }

    $pyArgs += @(
        '--hidden-import', 'api',
        '--hidden-import', 'api.main',
        '--hidden-import', 'core',
        '--hidden-import', 'core.miaobi_client',
        '--hidden-import', 'core.baijiahao_client',
        '--hidden-import', 'storage',
        '--hidden-import', 'storage.models',
        '--hidden-import', 'storage.database',
        '--hidden-import', 'storage.crud',
        '--hidden-import', 'manager',
        '--hidden-import', 'manager.sync_manager',
        '--hidden-import', 'workers',
        '--hidden-import', 'workers.scheduler',
        '--hidden-import', 'config',
        '--hidden-import', 'uvicorn.logging',
        '--hidden-import', 'uvicorn.loops',
        '--hidden-import', 'uvicorn.loops.auto',
        '--hidden-import', 'uvicorn.protocols',
        '--hidden-import', 'uvicorn.protocols.http',
        '--hidden-import', 'uvicorn.protocols.http.auto',
        '--hidden-import', 'uvicorn.protocols.websockets',
        '--hidden-import', 'uvicorn.protocols.websockets.auto',
        '--hidden-import', 'uvicorn.lifespan',
        '--hidden-import', 'uvicorn.lifespan.on',
        '--hidden-import', 'sqlmodel',
        '--hidden-import', 'pydantic',
        '--hidden-import', 'dotenv',
        '--hidden-import', 'watchdog',
        '--hidden-import', 'watchdog.observers',
        '--hidden-import', 'watchdog.events',
        '--hidden-import', 'docx',
        '--hidden-import', 'multipart',
        $entryPoint
    )

    & pyinstaller @pyArgs
    if ($LASTEXITCODE -ne 0) {
        Log-Error "PyInstaller 打包失败配置环境可能有误"
        exit $LASTEXITCODE
    }

    $output = Join-Path $PyDistDir $binaryName
    if (-not (Test-Path $output)) {
        Log-Error "PyInstaller 打包失败: 找不到产物 $output"
        exit 1
    }

    Log-Info "Python 后端打包完成: $output"

    # 复制到 Tauri sidecar 目录
    New-Item -ItemType Directory -Force -Path $BinariesDir | Out-Null
    Copy-Item $output -Destination $BinariesDir -Force

    Log-Info "已复制到 Tauri sidecar 目录: $BinariesDir\$binaryName"
}

# ---- 前端依赖 ----
function Setup-Frontend {
    Log-Step "安装前端依赖..."

    Set-Location $ProjectRoot

    npm install --include=dev
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# ---- Tauri 初始化 ----
function Initialize-Tauri {
    Log-Step "初始化 Tauri 项目骨架..."

    Set-Location $ProjectRoot

    $confPath = Join-Path $SrcTauri "tauri.conf.json"

    if (Test-Path $confPath) {
        Log-Warn "src-tauri/tauri.conf.json 已存在，跳过 init"
    } else {
        npx tauri init `
            --force `
            --app-name "NovelSync" `
            --window-title "NovelSync" `
            --dist-dir "../dist" `
            --dev-path "http://localhost:1420" `
            --ci
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

        Log-Info "Tauri 骨架创建完成"
    }

    # 无论是否刚 init，都确保 sidecar 配置和 main.rs 正确（幂等）
    Patch-TauriConfig
    Patch-TauriMainRs
}

# ---- 补丁 Tauri 配置 ----
function Patch-TauriConfig {
    Log-Step "注入 sidecar 配置到 tauri.conf.json..."

    $confPath = Join-Path $SrcTauri "tauri.conf.json"
    if (-not (Test-Path $confPath)) {
        Log-Error "找不到 $confPath，请先执行 tauri-init"
        exit 1
    }

    # 写临时 JS 文件执行（避免内联代码的引号转义问题）
    $tmpJsDir = Join-Path $ProjectRoot "build-python"
    New-Item -ItemType Directory -Force -Path $tmpJsDir | Out-Null

    $tmpJs = Join-Path $tmpJsDir "_patch_tauri_conf.cjs"
    $jsCode = @"
const fs = require('fs');
const confPath = process.argv[2];
const version = '$($env:APP_VERSION)';
const appEnv = '$($env:APP_ENV)';
const conf = JSON.parse(fs.readFileSync(confPath, 'utf-8'));

// inject version
if (conf.package) {
    conf.package.version = version;
}

// Windows 打包固定使用 production 模式，.env.production 已在构建流程中复制为 .env
const viteMode = 'production';
if (conf.build) {
    conf.build.beforeBuildCommand = 'npm run build -- --mode ' + viteMode;
}

// inject bundle identifier and externalBin
if (conf.tauri && conf.tauri.bundle) {
    conf.tauri.bundle.identifier = 'com.novelsync.app';
    conf.tauri.bundle.externalBin = ['binaries/novelsync-server'];
}

// inject shell sidecar allowlist
if (conf.tauri) {
    conf.tauri.allowlist = conf.tauri.allowlist || {};
    conf.tauri.allowlist.shell = {
        sidecar: true,
        scope: [{ name: 'binaries/novelsync-server', sidecar: true }]
    };
}

fs.writeFileSync(confPath, JSON.stringify(conf, null, 2));
console.log('tauri.conf.json injected (version=' + version + ', viteMode=' + viteMode + ')');
"@
    Set-Content -Path $tmpJs -Value $jsCode -Encoding UTF8

    node $tmpJs $confPath
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Log-Info "sidecar 配置注入完成"
}

# ---- 补丁 main.rs ----
function Patch-TauriMainRs {
    $mainRs = Join-Path $SrcTauri "src\main.rs"
    if (-not (Test-Path $mainRs)) {
        Log-Error "找不到 $mainRs，请确认 src-tauri/src/main.rs 已提交到仓库"
        exit 1
    }
    Log-Info "main.rs 已由仓库维护，无需注入"
}

# ---- 收集产物到 release 目录 ----
function Collect-Release {
    Log-Step "收集构建产物到 release 目录..."

    New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null

    $bundleDir = Join-Path $SrcTauri "target\release\bundle"
    if (-not (Test-Path $bundleDir)) {
        Log-Warn "未找到 Tauri bundle 目录: $bundleDir"
        return
    }

    # 架构标识
    $archLabel = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }

    $installers = Get-ChildItem -Path $bundleDir -Recurse -Include "*.msi","*.exe","*.nsis" -ErrorAction SilentlyContinue
    if ($installers.Count -eq 0) {
        Log-Warn "未找到安装包产物"
        return
    }

    foreach ($file in $installers) {
        $ext = $file.Extension
        $newName = "NovelSync_$($env:APP_VERSION)_$($env:APP_ENV)_${archLabel}${ext}"
        Copy-Item $file.FullName -Destination (Join-Path $ReleaseDir $newName) -Force
        $size = "{0:N1} MB" -f ($file.Length / 1MB)
        Log-Info "  📦 $newName ($size)"
    }

    Log-Info "========================================="
    Log-Info "  产物已收集到: $ReleaseDir"
    Log-Info "========================================="
}

# ---- 统一构建流程（dev / prod 仅环境变量不同）----
function Run-Build {
    param([string]$Mode)
    Set-BuildEnv $Mode
    Test-Prerequisites $Mode
    Setup-PythonEnv
    Build-PythonBackend
    Setup-Frontend
    Initialize-Tauri

    # 强制使用 .env.production，彻底避免打包进 dev 环境
    $envOverride = Join-Path $ProjectRoot ".env"
    $envProd     = Join-Path $ProjectRoot ".env.production"
    Copy-Item $envProd -Destination $envOverride -Force
    Log-Info "已将 .env.production 复制为 .env（覆盖 Vite 默认加载）"

    Log-Step "执行 Tauri 构建（固定 production 模式）..."

    Set-Location $ProjectRoot
    npx tauri build
    if ($LASTEXITCODE -ne 0) {
        Log-Error "Tauri 构建发生错误，已中止并保留所有构建现场和中间产物供排查。"
        exit $LASTEXITCODE
    }

    # 清理临时 .env 覆盖文件
    if (Test-Path $envOverride) {
        Remove-Item $envOverride -Force
        Log-Info "已清理临时 .env 文件"
    }

    # 收集产物到 release 目录
    Collect-Release

    # 自动清理中间产物，只保留 release 目录下的安装包
    Cleanup-BuildArtifacts
}

# ---- 清理构建中间产物（构建完成后自动调用）----
function Cleanup-BuildArtifacts {
    Log-Step "清理构建中间产物..."

    $dirs = @($PyDistDir, $BuildWorkDir, $BinariesDir,
              (Join-Path $SrcTauri "target"),
              (Join-Path $ProjectRoot "dist"))

    foreach ($dir in $dirs) {
        if (Test-Path $dir) {
            Remove-Item -Recurse -Force $dir
        }
    }

    # 清理 spec 文件
    Get-ChildItem -Path $ProjectRoot -Filter "*.spec" -ErrorAction SilentlyContinue | Remove-Item -Force

    Log-Info "中间产物已清理，最终安装包在: $ReleaseDir"
}

# ---- 清理 ----
function Run-Clean {
    Log-Step "清理构建产物..."

    $dirs = @($PyDistDir, $BuildWorkDir, $BinariesDir, $ReleaseDir,
              (Join-Path $SrcTauri "target"),
              (Join-Path $ProjectRoot "dist"))

    foreach ($dir in $dirs) {
        if (Test-Path $dir) {
            Remove-Item -Recurse -Force $dir
            Log-Info "已删除: $dir"
        }
    }

    # 清理 spec 文件
    Get-ChildItem -Path $ProjectRoot -Filter "*.spec" -ErrorAction SilentlyContinue | Remove-Item -Force

    Log-Info "清理完成"
}

# ---- 入口 ----
switch ($Command) {
    "dev" {
        Run-Build "dev"
    }
    { $_ -in @("prod", "production") } {
        Run-Build "prod"
    }
    { $_ -in @("pyinstaller", "py") } {
        Set-BuildEnv $EnvMode
        Test-Prerequisites "dev"
        Setup-PythonEnv
        Build-PythonBackend
    }
    { $_ -in @("tauri-init", "init") } {
        Setup-Frontend
        Initialize-Tauri
    }
    "check-deps" {
        Test-Prerequisites "prod"
    }
    "clean" {
        Run-Clean
    }
    default {
        Write-Host ""
        Write-Host "NovelSync 构建脚本 (Windows)"
        Write-Host ""
        Write-Host "用法: .\build.ps1 [command]"
        Write-Host ""
        Write-Host "命令:"
        Write-Host "  dev           构建安装包（dev 环境变量，.env.development）"
        Write-Host "  prod          构建安装包（prod 环境变量，.env.production）"
        Write-Host "  pyinstaller   仅打包 Python 后端（可追加 dev/prod 参数）"
        Write-Host "  tauri-init    仅初始化 Tauri 骨架（首次使用）"
        Write-Host "  check-deps    检查所有依赖是否已安装"
        Write-Host "  clean         清理所有构建产物"
        Write-Host ""
        Write-Host "示例:"
        Write-Host "  .\build.ps1 dev                # 构建 dev 环境安装包 (.msi)"
        Write-Host "  .\build.ps1 prod               # 构建 prod 环境安装包 (.msi)"
        Write-Host "  .\build.ps1 pyinstaller prod   # 仅 Python 打包（生产配置）"
        Write-Host ""
        Write-Host "产物输出:"
        Write-Host "  release\          最终安装包 (.msi)"
        Write-Host ""
    }
}
