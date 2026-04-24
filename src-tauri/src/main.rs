// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::api::process::{Command, CommandChild};
use tauri::Manager;

/// 持有 sidecar 子进程句柄，Tauri 退出时主动 kill
struct SidecarState(Mutex<Option<CommandChild>>);

fn main() {
    let app = tauri::Builder::default()
        .manage(SidecarState(Mutex::new(None)))
        .setup(|app| {
            let (mut rx, child) = Command::new_sidecar("novelsync-server")
                .expect("Failed to create novelsync-server sidecar")
                .spawn()
                .expect("Failed to spawn novelsync-server sidecar");

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

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // 使用 RunEvent::Exit 清理 sidecar（app 级事件，比 WindowEvent::Destroyed 可靠）
    // Windows 上 WindowEvent::Destroyed 经常不触发或触发时 state 已失效
    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            let state = app_handle.state::<SidecarState>();
            if let Ok(mut guard) = state.0.lock() {
                if let Some(child) = guard.take() {
                    let _ = child.kill();
                }
            };
        }
    });
}
