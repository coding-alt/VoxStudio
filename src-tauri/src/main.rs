// 防止在 Windows 上弹出额外控制台窗口（macOS 无影响）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    voxstudio_lib::run()
}
