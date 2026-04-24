// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::api::process::{Command, CommandChild};
use tauri::Manager;

/// 持有 sidecar 子进程句柄，Tauri 退出时主动 kill
struct SidecarState(Mutex<Option<CommandChild>>);

/// 从托管状态中取出并 kill sidecar 子进程
fn kill_sidecar(state: &SidecarState) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(child) = guard.take() {
            println!("[Tauri] Killing sidecar process...");
            match child.kill() {
                Ok(_) => println!("[Tauri] Sidecar process killed successfully"),
                Err(e) => eprintln!("[Tauri] Failed to kill sidecar: {}", e),
            }
        }
    }
}

fn main() {
    let app = tauri::Builder::default()
        .manage(SidecarState(Mutex::new(None)))
        .setup(|app| {
            let sidecar_result = Command::new_sidecar("novelsync-server")
                .and_then(|cmd| Ok(cmd.spawn()?));

            match sidecar_result {
                Ok((mut rx, child)) => {
                    // 保存子进程句柄到托管状态
                    let state = app.state::<SidecarState>();
                    *state.0.lock().unwrap() = Some(child);

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
