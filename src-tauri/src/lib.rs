use std::{fs, io::ErrorKind, path::Path, path::PathBuf};
use tauri::{AppHandle, Manager, ipc::Response};

/// 저장 파일 이름 허용 목록 (%APPDATA%/<identifier>/<name>.json)
const STATE_FILES: [&str; 2] = ["library", "playlist"];

/// 오디오 파일 전체를 바이트 그대로 돌려준다 (JSON 직렬화 없이 전달)
#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    fs::read(&path)
        .map(Response::new)
        .map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    Path::new(&path).is_file()
}

fn state_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if !STATE_FILES.contains(&name) {
        return Err(format!("unknown state file: {name}"));
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{name}.json")))
}

#[tauri::command]
fn load_state(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let path = state_path(&app, &name)?;
    match fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

/// 임시 파일에 쓴 뒤 교체한다. 쓰는 도중 앱이 꺼져도 기존 파일이 깨지지 않는다
#[tauri::command]
fn save_state(app: AppHandle, name: String, contents: String) -> Result<(), String> {
    let path = state_path(&app, &name)?;
    let dir = path.parent().ok_or("no parent directory")?;
    fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, contents).map_err(|e| format!("{}: {e}", tmp.display()))?;
    fs::rename(&tmp, &path).map_err(|e| format!("{}: {e}", path.display()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            file_exists,
            load_state,
            save_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
