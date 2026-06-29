// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Command as StdCommand,
    sync::Mutex,
    thread,
    time::Duration,
};
use tauri::api::process::{Command as TauriCommand, CommandChild};
use tauri::Manager;

const SIDECAR_NAME: &str = "novelsync-server";
const APP_LOCK_FILE: &str = "novelsync-app.pid";
const SIDECAR_PID_FILE: &str = "novelsync-server.pid";

#[derive(Clone, Copy)]
enum CleanupPhase {
    Startup,
    Exit,
}

/// 持有 sidecar 子进程句柄，Tauri 退出时主动 kill
#[derive(Default)]
struct SidecarState {
    child: Mutex<Option<CommandChild>>,
    sidecar_pid_file: Mutex<Option<PathBuf>>,
    app_lock_file: Mutex<Option<PathBuf>>,
}

fn parse_pid_value(value: &str) -> Option<u32> {
    value.trim().parse::<u32>().ok().filter(|pid| *pid > 0)
}

fn read_pid_file(path: &Path) -> Option<u32> {
    fs::read_to_string(path)
        .ok()
        .and_then(|value| parse_pid_value(&value))
}

fn write_pid_file(path: &Path, pid: u32) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(path, pid.to_string());
}

fn remove_file_if_exists(path: &Path) {
    let _ = fs::remove_file(path);
}

#[cfg(target_os = "windows")]
fn hide_console_window(command: &mut StdCommand) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn hide_console_window(_command: &mut StdCommand) {}

#[cfg(target_os = "windows")]
fn process_is_running(pid: u32) -> bool {
    let filter = format!("PID eq {}", pid);
    let mut command = StdCommand::new("tasklist");
    command.args(["/FI", &filter, "/FO", "CSV", "/NH"]);
    hide_console_window(&mut command);
    let output = command.output();
    match output {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            stdout.contains(&format!("\"{}\"", pid)) && !stdout.contains("INFO:")
        }
        _ => false,
    }
}

#[cfg(not(target_os = "windows"))]
fn process_is_running(pid: u32) -> bool {
    let mut command = StdCommand::new("kill");
    command.args(["-0", &pid.to_string()]);
    hide_console_window(&mut command);
    command
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn another_instance_running(lock_file: &Path) -> bool {
    let current_pid = std::process::id();
    read_pid_file(lock_file)
        .map(|pid| pid != current_pid && process_is_running(pid))
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn kill_process_tree(pid: u32) {
    if pid == 0 || pid == std::process::id() {
        return;
    }
    let mut command = StdCommand::new("taskkill");
    command.args(["/F", "/T", "/PID", &pid.to_string()]);
    hide_console_window(&mut command);
    let _ = command.output();
}

#[cfg(not(target_os = "windows"))]
fn kill_process_tree(pid: u32) {
    if pid == 0 || pid == std::process::id() {
        return;
    }
    let mut term = StdCommand::new("kill");
    term.args(["-TERM", &pid.to_string()]);
    hide_console_window(&mut term);
    let _ = term.status();
    thread::sleep(Duration::from_millis(300));
    if process_is_running(pid) {
        let mut kill = StdCommand::new("kill");
        kill.args(["-KILL", &pid.to_string()]);
        hide_console_window(&mut kill);
        let _ = kill.status();
    }
}

#[cfg(target_os = "windows")]
fn kill_sidecars_by_name() {
    let script = "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'novelsync-server*.exe' } | ForEach-Object { taskkill /F /T /PID $_.ProcessId | Out-Null }";
    let mut command = StdCommand::new("powershell.exe");
    command.args([
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        script,
    ]);
    hide_console_window(&mut command);
    let _ = command.output();
}

#[cfg(not(target_os = "windows"))]
fn kill_sidecars_by_name() {
    let mut command = StdCommand::new("pkill");
    command.args(["-f", SIDECAR_NAME]);
    hide_console_window(&mut command);
    let _ = command.output();
}

fn cleanup_sidecar_pid_file(pid_file: &Path) {
    if let Some(pid) = read_pid_file(pid_file) {
        kill_process_tree(pid);
    }
    remove_file_if_exists(pid_file);
}

fn should_kill_sidecars_by_name(phase: CleanupPhase) -> bool {
    matches!(phase, CleanupPhase::Startup)
}

fn cleanup_stale_sidecars(pid_file: Option<&Path>, phase: CleanupPhase) {
    if let Some(pid_file) = pid_file {
        cleanup_sidecar_pid_file(pid_file);
    }

    if should_kill_sidecars_by_name(phase) {
        kill_sidecars_by_name();
    }
}

fn lifecycle_dir(app: &tauri::App) -> PathBuf {
    app.path_resolver()
        .app_data_dir()
        .unwrap_or_else(|| std::env::temp_dir().join("NovelSync"))
}

/// 从托管状态中取出并 kill sidecar 子进程
fn kill_sidecar(state: &SidecarState) {
    if let Ok(mut guard) = state.child.lock() {
        if let Some(child) = guard.take() {
            let pid = child.pid();
            println!("[Tauri] Killing sidecar process (PID={})...", pid);

            kill_process_tree(pid);
            let _ = child.kill();
        }
    }

    let sidecar_pid_file = state
        .sidecar_pid_file
        .lock()
        .ok()
        .and_then(|guard| guard.clone());
    cleanup_stale_sidecars(sidecar_pid_file.as_deref(), CleanupPhase::Exit);

    if let Ok(mut guard) = state.app_lock_file.lock() {
        if let Some(lock_file) = guard.take() {
            remove_file_if_exists(&lock_file);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_pid_value_accepts_positive_integer() {
        assert_eq!(parse_pid_value(" 12345\n"), Some(12345));
    }

    #[test]
    fn parse_pid_value_rejects_empty_zero_and_invalid_values() {
        assert_eq!(parse_pid_value(""), None);
        assert_eq!(parse_pid_value("0"), None);
        assert_eq!(parse_pid_value("not-a-pid"), None);
    }

    #[test]
    fn cleanup_phase_only_scans_sidecars_by_name_on_startup() {
        assert!(should_kill_sidecars_by_name(CleanupPhase::Startup));
        assert!(!should_kill_sidecars_by_name(CleanupPhase::Exit));
    }
}

fn main() {
    let app = tauri::Builder::default()
        .manage(SidecarState::default())
        .setup(|app| {
            let data_dir = lifecycle_dir(app);
            let _ = fs::create_dir_all(&data_dir);
            let app_lock_file = data_dir.join(APP_LOCK_FILE);
            if another_instance_running(&app_lock_file) {
                tauri::api::dialog::blocking::message(
                    None::<&tauri::Window>,
                    "NovelSync 已在运行",
                    "NovelSync 已经在后台运行，请先关闭已有实例。",
                );
                std::process::exit(0);
            }
            write_pid_file(&app_lock_file, std::process::id());

            let sidecar_pid_file = data_dir.join(SIDECAR_PID_FILE);
            cleanup_stale_sidecars(Some(&sidecar_pid_file), CleanupPhase::Startup);

            let mut sidecar_env = HashMap::new();
            sidecar_env.insert(
                "NOVELSYNC_PARENT_PID".to_string(),
                std::process::id().to_string(),
            );
            sidecar_env.insert(
                "NOVELSYNC_SIDECAR_PID_FILE".to_string(),
                sidecar_pid_file.to_string_lossy().to_string(),
            );

            let sidecar_result = TauriCommand::new_sidecar(SIDECAR_NAME)
                .and_then(|cmd| Ok(cmd.envs(sidecar_env).spawn()?));

            match sidecar_result {
                Ok((mut rx, child)) => {
                    // 保存子进程句柄到托管状态
                    let state = app.state::<SidecarState>();
                    write_pid_file(&sidecar_pid_file, child.pid());
                    *state.child.lock().unwrap() = Some(child);
                    *state.sidecar_pid_file.lock().unwrap() = Some(sidecar_pid_file);
                    *state.app_lock_file.lock().unwrap() = Some(app_lock_file);

                    tauri::async_runtime::spawn(async move {
                        use tauri::api::process::CommandEvent;
                        while let Some(event) = rx.recv().await {
                            match event {
                                CommandEvent::Stdout(line) => println!("[Python] {}", line),
                                CommandEvent::Stderr(line) => eprintln!("[Python:ERR] {}", line),
                                _ => {}
                            }
                        }
                    });
                }
                Err(e) => {
                    remove_file_if_exists(&app_lock_file);
                    let msg = format!(
                        "无法启动后端服务 (novelsync-server):\n{}\n\n请确认安装了正确架构的版本。",
                        e
                    );
                    eprintln!("[Tauri] {}", msg);
                    // 弹窗提示用户，而非直接 crash
                    tauri::api::dialog::blocking::message(
                        None::<&tauri::Window>,
                        "NovelSync 启动失败",
                        &msg,
                    );
                    std::process::exit(1);
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // 处理应用生命周期事件，确保 sidecar 被正确清理
    app.run(|app_handle, event| {
        match event {
            // macOS: 关闭最后一个窗口时退出应用（默认行为是驻留 Dock）
            tauri::RunEvent::WindowEvent {
                event: tauri::WindowEvent::CloseRequested { .. },
                ..
            } => {
                let state = app_handle.state::<SidecarState>();
                kill_sidecar(state.inner());
                // 退出整个应用，不要驻留在 Dock
                app_handle.exit(0);
            }
            // 应用退出时兜底清理（Cmd+Q / 强制退出等场景）
            tauri::RunEvent::Exit => {
                let state = app_handle.state::<SidecarState>();
                kill_sidecar(state.inner());
            }
            _ => {}
        }
    });
}
