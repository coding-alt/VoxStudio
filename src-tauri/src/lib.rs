use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::Engine;
use serde::Serialize;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// 后端服务的默认可执行文件位置（uv tool install 后的软链）
const DEFAULT_SERVER_BIN: &str = "/Users/kavin/.local/bin/voxcpmane2-server";

/// 后端进程句柄。只有由本应用拉起的服务才可被引擎关闭。
pub struct BackendProcess(pub Mutex<Option<Child>>);

#[derive(Debug, Clone, Serialize)]
pub struct BackendStatus {
    pub online: bool,
    pub managed: bool,
    pub message: String,
}

// ─────────────────────────────────────────────────────────────
// 路径与存储
// ─────────────────────────────────────────────────────────────

fn storage_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn audio_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = storage_dir(app)?.join("audio");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn reference_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = storage_dir(app)?.join("reference");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
fn storage_path(app: tauri::AppHandle) -> Result<String, String> {
    storage_dir(&app).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn default_server_bin() -> String {
    DEFAULT_SERVER_BIN.to_string()
}

// ─────────────────────────────────────────────────────────────
// 持久化：历史索引 / 设置（JSON 文件）
// ─────────────────────────────────────────────────────────────

#[tauri::command]
fn read_json(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    let path = storage_dir(&app)?.join(&name);
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some(content))
}

#[tauri::command]
fn write_json(app: tauri::AppHandle, name: String, content: String) -> Result<(), String> {
    let path = storage_dir(&app)?.join(&name);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

/// 以 base64 写入历史音频，返回落盘绝对路径
#[tauri::command]
fn save_audio(app: tauri::AppHandle, id: String, data: String) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| e.to_string())?;
    let path = audio_dir(&app)?.join(format!("{}.wav", sanitize(&id)));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn read_audio(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let path = audio_dir(&app)?.join(format!("{}.wav", sanitize(&id)));
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
fn delete_audio(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = audio_dir(&app)?.join(format!("{}.wav", sanitize(&id)));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn clear_audio_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = audio_dir(&app)?;
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        if entry.path().is_file() {
            std::fs::remove_file(entry.path()).ok();
        }
    }
    Ok(())
}

fn sanitize(id: &str) -> String {
    id.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

// ─────────────────────────────────────────────────────────────
// 参考音频导入
// ─────────────────────────────────────────────────────────────

/// 通过原生对话框挑选参考音频，返回真实绝对路径。
/// webview 内的 <input type=file> 只能拿到文件名，拿不到路径，
/// 而后端创建音色需要服务器可读的绝对路径，因此必须由原生层完成。
#[tauri::command]
async fn pick_audio_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title("选择参考音频")
        .add_filter("音频文件", &["wav", "mp3", "m4a", "flac", "aiff", "aif", "caf"])
        .pick_file(move |picked| {
            let _ = tx.send(picked.and_then(|p| p.as_path().map(|path| path.to_string_lossy().to_string())));
        });

    match rx.recv() {
        Ok(v) => Ok(v),
        Err(e) => Err(format!("对话框无响应: {}", e)),
    }
}

/// 把用户选中的参考音频复制到应用数据目录后再交给后端。
///
/// 关键点：macOS 的 Powerbox 授权是「按进程」授予的。通过原生对话框选中的
/// 文件，系统只授权给本应用进程；真正读取它的是 Python 后端进程，会拿不到
/// 权限。先复制到 Application Support 目录即可绕开这个跨进程权限问题，
/// 同时避免用户删除/移动原文件后音色失效。
#[tauri::command]
fn import_reference(app: tauri::AppHandle, src: String) -> Result<String, String> {
    let src_path = PathBuf::from(&src);
    if !src_path.exists() {
        return Err("源文件不存在".to_string());
    }
    let ext = src_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("wav")
        .to_lowercase();

    let file_name = src_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("reference")
        .to_string();
    let stem = sanitize(
        file_name
            .rsplit_once('.')
            .map(|(s, _)| s)
            .unwrap_or("reference"),
    );
    let dest = reference_dir(&app)?.join(format!("{}-{}.{}", stem, timestamp(), ext));

    std::fs::copy(&src_path, &dest).map_err(|e| format!("复制失败（可能没有读取权限）: {}", e))?;
    Ok(dest.to_string_lossy().to_string())
}

/// 把内存中的录音（麦克风录制产物，WAV base64）写入参考目录，
/// 返回可被后端读取的绝对路径，供创建自定义音色使用。
#[tauri::command]
fn save_reference(app: tauri::AppHandle, id: String, data: String) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("音频解码失败: {}", e))?;
    let name = sanitize(&id);
    let dest = reference_dir(&app)?.join(format!("{}-{}.wav", name, timestamp()));
    std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

fn timestamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

// ─────────────────────────────────────────────────────────────
// 导出
// ─────────────────────────────────────────────────────────────

/// 弹出系统保存面板，把音频写到用户指定位置
#[tauri::command]
async fn export_audio(app: tauri::AppHandle, default_name: String, data: String) -> Result<Option<String>, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| e.to_string())?;

    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title("导出音频")
        .set_file_name(&default_name)
        .add_filter("WAV 音频", &["wav"])
        .save_file(move |target| {
            let _ = tx.send(target.and_then(|p| p.as_path().map(|path| path.to_string_lossy().to_string())));
        });

    match rx.recv() {
        Ok(Some(path)) => {
            let mut target = PathBuf::from(path);
            if target.extension().is_none() {
                target.set_extension("wav");
            }
            std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
            Ok(Some(target.to_string_lossy().to_string()))
        }
        Ok(None) => Ok(None),
        Err(e) => Err(format!("对话框无响应: {}", e)),
    }
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    Command::new("open")
        .arg("-R")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────
// 后端服务生命周期
// ─────────────────────────────────────────────────────────────

fn port_open(base_url: &str) -> bool {
    let host_port = base_url
        .replace("http://", "")
        .replace("https://", "")
        .trim_end_matches('/')
        .to_string();
    let addr = if host_port.contains(':') {
        host_port
    } else {
        format!("{}:80", host_port)
    };

    // 关键：macOS 上 `localhost` 解析会优先返回 [::1]（IPv6），
    // 但很多后端（Python Flask / 某些 Node 服务）只监听 IPv4 0.0.0.0，
    // 单连一个地址失败就误判「端口未就绪」。这里遍历所有解析结果逐个尝试。
    let addrs = match addr.to_socket_addrs() {
        Ok(a) => a,
        Err(_) => return false,
    };

    for a in addrs {
        if TcpStream::connect_timeout(&a, Duration::from_millis(700)).is_ok() {
            return true;
        }
    }
    false
}

#[tauri::command]
fn backend_status(state: tauri::State<BackendProcess>, base_url: String) -> BackendStatus {
    let managed = state.0.lock().map(|g| g.is_some()).unwrap_or(false);
    if port_open(&base_url) {
        BackendStatus {
            online: true,
            managed,
            message: if managed { "已连接（由 VoxStudio 启动）".into() } else { "已连接（外部服务）".into() },
        }
    } else {
        BackendStatus {
            online: false,
            managed: false,
            message: "未连接".into(),
        }
    }
}

/// 启动后端：若端口已通则直接复用，否则拉起进程并轮询等待就绪
///
/// 等待就绪的轮询最长 180s（首次运行可能要下载模型），必须放到阻塞线程池执行：
/// 同步命令跑在主线程上，一旦主线程被 sleep 占住，macOS 就会弹出系统风火轮，
/// 给用户"程序卡死"的错觉，窗口内的 spinner 也跟着不动。
#[tauri::command]
async fn start_backend(
    state: tauri::State<'_, BackendProcess>,
    base_url: String,
    bin: Option<String>,
) -> Result<BackendStatus, String> {
    if port_open(&base_url) {
        let managed = state.0.lock().map(|g| g.is_some()).unwrap_or(false);
        return Ok(BackendStatus {
            online: true,
            managed,
            message: "服务已在运行，已直接连接".into(),
        });
    }

    let exe = resolve_server_bin(bin)?;

    // GUI 应用的 PATH 很干净，补上常见的用户级目录
    let home = std::env::var("HOME").unwrap_or_default();
    let cur_path = std::env::var("PATH").unwrap_or_default();
    let full_path = format!(
        "{}/.local/bin:{}/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:{}",
        home, home, cur_path
    );

    let child = Command::new(&exe)
        .env("PATH", full_path)
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("启动 {} 失败: {}", exe, e))?;

    {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        *guard = Some(child);
    }

    // 等待端口就绪（首次运行若需下载模型会更久，这里给足耐心）。
    // MutexGuard 已在上面的作用域内释放，不会跨越 await。
    let wait_url = base_url.clone();
    let online = tauri::async_runtime::spawn_blocking(move || {
        let deadline = Instant::now() + Duration::from_secs(180);
        while Instant::now() < deadline {
            if port_open(&wait_url) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(400));
        }
        false
    })
    .await
    .map_err(|e| format!("等待服务就绪时出错: {}", e))?;

    Ok(if online {
        BackendStatus {
            online: true,
            managed: true,
            message: "服务已启动".into(),
        }
    } else {
        BackendStatus {
            online: false,
            managed: true,
            message: "进程已启动，但端口仍未就绪（可能正在下载模型）".into(),
        }
    })
}

#[tauri::command]
async fn stop_backend(state: tauri::State<'_, BackendProcess>) -> Result<String, String> {
    // 先取出 child 再处理，避免 MutexGuard 跨越 await / 长时间持有锁
    let child = {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        guard.take()
    };
    if let Some(mut child) = child {
        let pid = child.id();
        let _ = child.kill();
        let _ = child.wait();
        return Ok(format!("已停止由 VoxStudio 启动的服务 (pid {})", pid));
    }
    // 兜底：尝试结束外部启动的服务进程
    let out = Command::new("pkill")
        .args(["-f", "voxcpmane2-server"])
        .status();
    match out {
        Ok(s) if s.success() => Ok("已停止外部服务进程".into()),
        _ => Ok("没有由 VoxStudio 启动的服务可停止；若外部终端仍在运行请手动结束".into()),
    }
}

fn resolve_server_bin(bin: Option<String>) -> Result<String, String> {
    let candidates: Vec<String> = match bin {
        Some(b) if !b.trim().is_empty() => vec![b],
        _ => {
            let home = std::env::var("HOME").unwrap_or_default();
            vec![
                DEFAULT_SERVER_BIN.to_string(),
                format!("{}/.local/bin/voxcpmane2-server", home),
                format!("{}/.cargo/bin/voxcpmane2-server", home),
                "/opt/homebrew/bin/voxcpmane2-server".to_string(),
                "/usr/local/bin/voxcpmane2-server".to_string(),
            ]
        }
    };

    for c in candidates {
        if std::path::Path::new(&c).exists() {
            return Ok(c);
        }
    }
    // 最后尝试从 PATH 里找
    if let Ok(out) = Command::new("which").arg("voxcpmane2-server").output() {
        let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !p.is_empty() {
            return Ok(p);
        }
    }
    Err(format!(
        "找不到 voxcpmane2-server（已检查 {}）。请在「设置」中手动指定完整路径。",
        DEFAULT_SERVER_BIN
    ))
}

// ─────────────────────────────────────────────────────────────
// 应用入口
// ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .manage(BackendProcess(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            storage_path,
            default_server_bin,
            read_json,
            write_json,
            save_audio,
            read_audio,
            delete_audio,
            clear_audio_dir,
            pick_audio_file,
            import_reference,
            save_reference,
            export_audio,
            reveal_in_finder,
            backend_status,
            start_backend,
            stop_backend,
        ])
        .run(tauri::generate_context!())
        .expect("启动 VoxStudio 失败");
}
