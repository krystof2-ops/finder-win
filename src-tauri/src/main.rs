// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// Jedna položka ve výpisu složky.
#[derive(Debug, Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    /// Vždy 0 pro složky.
    size: u64,
    /// Unix timestamp v sekundách, 0 když čas není k dispozici.
    modified: i64,
    /// Unix timestamp v sekundách, 0 když čas není k dispozici.
    created: i64,
    /// Přípona bez tečky, malými písmeny. None pro složky a soubory bez přípony.
    extension: Option<String>,
}

/// Položka v postranním panelu.
#[derive(Debug, Serialize)]
struct FavoriteEntry {
    label: String,
    path: String,
    icon_name: String,
}

/// Skupina položek v postranním panelu (Oblíbené, Cloud, …).
#[derive(Debug, Serialize)]
struct FavoriteSection {
    label: String,
    items: Vec<FavoriteEntry>,
}

/// Systémové položky, které Průzkumník taky neukazuje.
const SYSTEM_NAMES: [&str; 6] = [
    "$Recycle.Bin",
    "System Volume Information",
    "pagefile.sys",
    "hiberfil.sys",
    "DumpStack.log.tmp",
    "swapfile.sys",
];

const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;

fn is_system_name(name: &str) -> bool {
    SYSTEM_NAMES
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(name))
}

#[cfg(windows)]
fn is_hidden(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0
}

#[cfg(not(windows))]
fn is_hidden(_metadata: &fs::Metadata) -> bool {
    false
}

/// SystemTime → unix sekundy. Nedostupný čas (nebo čas před rokem 1970) dává 0.
fn to_unix_seconds(time: std::io::Result<std::time::SystemTime>) -> i64 {
    time.ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<FileEntry>, String> {
    let dir = PathBuf::from(&path);
    let reader = fs::read_dir(&dir).map_err(|err| format!("{}: {}", path, err))?;

    let mut entries = Vec::new();

    for item in reader {
        // Jednotlivé nečitelné položky výpis nezruší, jen se přeskočí.
        let Ok(item) = item else { continue };
        let Ok(metadata) = item.metadata() else {
            continue;
        };

        let name = item.file_name().to_string_lossy().to_string();
        if is_system_name(&name) || is_hidden(&metadata) {
            continue;
        }

        let is_dir = metadata.is_dir();
        let entry_path = item.path();

        entries.push(FileEntry {
            extension: if is_dir {
                None
            } else {
                entry_path
                    .extension()
                    .map(|ext| ext.to_string_lossy().to_lowercase())
            },
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_dir,
            size: if is_dir { 0 } else { metadata.len() },
            modified: to_unix_seconds(metadata.modified()),
            created: to_unix_seconds(metadata.created()),
        });
    }

    // Nejdřív složky, pak soubory; uvnitř abecedně bez ohledu na velikost písmen.
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

fn favorite(label: &str, path: impl AsRef<Path>, icon_name: &str) -> FavoriteEntry {
    FavoriteEntry {
        label: label.to_string(),
        path: path.as_ref().to_string_lossy().to_string(),
        icon_name: icon_name.to_string(),
    }
}

/// Položka se přidá jen tehdy, když složka na disku opravdu existuje.
fn favorite_if_exists(label: &str, path: PathBuf, icon_name: &str) -> Option<FavoriteEntry> {
    path.exists().then(|| favorite(label, path, icon_name))
}

fn section(label: &str, items: Vec<FavoriteEntry>) -> Option<FavoriteSection> {
    (!items.is_empty()).then(|| FavoriteSection {
        label: label.to_string(),
        items,
    })
}

#[tauri::command]
fn get_favorites() -> Vec<FavoriteSection> {
    let user = std::env::var("USERNAME").unwrap_or_default();
    let user_root = PathBuf::from(format!("C:\\Users\\{}", user));
    let in_user_root = |name: &str| user_root.join(name);

    let standard = [
        ("Desktop", dirs::desktop_dir(), "Monitor"),
        ("Downloads", dirs::download_dir(), "Download"),
        ("Documents", dirs::document_dir(), "FileText"),
        ("Pictures", dirs::picture_dir(), "Image"),
        ("Music", dirs::audio_dir(), "Music"),
        ("Videos", dirs::video_dir(), "Video"),
    ]
    .into_iter()
    .filter_map(|(label, path, icon)| path.map(|path| favorite(label, path, icon)))
    .collect();

    let cloud = [
        ("OneDrive", "OneDrive", "Cloud"),
        ("iCloud Drive", "iCloudDrive", "Cloud"),
        ("iCloud Photos", "iCloudPhotos", "Image"),
    ]
    .into_iter()
    .filter_map(|(label, dir, icon)| favorite_if_exists(label, in_user_root(dir), icon))
    .collect();

    let dev = [
        ("Projects", "Projects", "Folder"),
        ("RiderProjects", "RiderProjects", "Folder"),
        ("source", "source", "Folder"),
        ("flutter", "flutter", "Folder"),
    ]
    .into_iter()
    .filter_map(|(label, dir, icon)| favorite_if_exists(label, in_user_root(dir), icon))
    .collect();

    let projects = [
        ("dashboard", "dashboard", "LayoutDashboard"),
        ("ansel", "ansel", "Folder"),
        ("NoirPad-web", "NoirPad-web", "Folder"),
        ("studijni-partak", "studijni-partak", "GraduationCap"),
        (
            "DaVinci Resolve Media",
            "DaVinci Resolve Media",
            "Video",
        ),
    ]
    .into_iter()
    .filter_map(|(label, dir, icon)| favorite_if_exists(label, in_user_root(dir), icon))
    .collect();

    let mut devices = vec![favorite("Tento počítač (C:)", "C:\\", "HardDrive")];
    if let Some(home) = dirs::home_dir() {
        devices.push(favorite("Home", home, "Home"));
    }

    [
        section("Oblíbené", standard),
        section("iCloud", cloud),
        section("Dev", dev),
        section("Projekty", projects),
        section("Zařízení", devices),
    ]
    .into_iter()
    .flatten()
    .collect()
}

#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    opener::open(&path).map_err(|err| format!("{}: {}", path, err))
}

/* --------------------------- souborové operace ---------------------------- */

/// Znaky, které Windows v názvu souboru nepovoluje.
const INVALID_NAME_CHARS: [char; 9] = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

#[derive(Debug, Serialize)]
struct FileProperties {
    size: u64,
    created: i64,
    modified: i64,
    accessed: i64,
    is_dir: bool,
    is_readonly: bool,
    is_hidden: bool,
}

fn validate_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();

    if trimmed.is_empty() {
        return Err("název nesmí být prázdný".to_string());
    }
    if trimmed.contains(INVALID_NAME_CHARS) {
        return Err("název obsahuje nepovolený znak".to_string());
    }

    Ok(())
}

/// Najde volný název v cílové složce: "soubor.txt" → "soubor (kopie).txt"
/// → "soubor (kopie 2).txt" …
fn unique_destination(dir: &Path, file_name: &str) -> Result<PathBuf, String> {
    let direct = dir.join(file_name);
    if !direct.exists() {
        return Ok(direct);
    }

    let as_path = Path::new(file_name);
    let stem = as_path
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| file_name.to_string());
    let extension = as_path.extension().map(|ext| ext.to_string_lossy().to_string());

    for attempt in 1..10_000 {
        let suffix = if attempt == 1 {
            " (kopie)".to_string()
        } else {
            format!(" (kopie {})", attempt)
        };

        let candidate_name = match &extension {
            Some(extension) => format!("{}{}.{}", stem, suffix, extension),
            None => format!("{}{}", stem, suffix),
        };

        let candidate = dir.join(candidate_name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("nepodařilo se najít volný název".to_string())
}

fn copy_recursive(from: &Path, to: &Path) -> std::io::Result<()> {
    if from.is_dir() {
        fs::create_dir_all(to)?;
        for entry in fs::read_dir(from)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &to.join(entry.file_name()))?;
        }
    } else {
        fs::copy(from, to)?;
    }

    Ok(())
}

fn parent_of(path: &Path) -> Result<&Path, String> {
    path.parent()
        .ok_or_else(|| "cesta nemá nadřazenou složku".to_string())
}

fn file_name_of(path: &Path) -> Result<String, String> {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .ok_or_else(|| "cesta nemá název".to_string())
}

#[tauri::command]
fn rename_path(from: String, to_name: String) -> Result<String, String> {
    validate_name(&to_name)?;

    let source = PathBuf::from(&from);
    let target = parent_of(&source)?.join(to_name.trim());

    // Přejmenování na sebe sama není chyba, jen se nic nestane.
    if target == source {
        return Ok(source.to_string_lossy().to_string());
    }
    if target.exists() {
        return Err(format!("{} už existuje", target.to_string_lossy()));
    }

    fs::rename(&source, &target).map_err(|err| format!("{}: {}", from, err))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn move_to_trash(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|err| format!("{}: {}", path, err))
}

#[tauri::command]
fn copy_path(from: String, to_dir: String) -> Result<String, String> {
    let source = PathBuf::from(&from);
    let target = unique_destination(Path::new(&to_dir), &file_name_of(&source)?)?;

    copy_recursive(&source, &target).map_err(|err| format!("{}: {}", from, err))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn move_path(from: String, to_dir: String) -> Result<String, String> {
    let source = PathBuf::from(&from);
    let target = unique_destination(Path::new(&to_dir), &file_name_of(&source)?)?;

    // rename je atomický, ale funguje jen v rámci jednoho svazku.
    if fs::rename(&source, &target).is_ok() {
        return Ok(target.to_string_lossy().to_string());
    }

    copy_recursive(&source, &target).map_err(|err| format!("{}: {}", from, err))?;

    let removed = if source.is_dir() {
        fs::remove_dir_all(&source)
    } else {
        fs::remove_file(&source)
    };
    removed.map_err(|err| format!("{}: zkopírováno, ale nešlo smazat originál: {}", from, err))?;

    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn duplicate_path(path: String) -> Result<String, String> {
    let source = PathBuf::from(&path);
    let directory = parent_of(&source)?;
    let target = unique_destination(directory, &file_name_of(&source)?)?;

    copy_recursive(&source, &target).map_err(|err| format!("{}: {}", path, err))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn open_in_explorer(path: String) -> Result<(), String> {
    use std::process::Command;

    let target = PathBuf::from(&path);

    let mut command = Command::new("explorer.exe");
    if target.is_dir() {
        command.arg(&path);
    } else {
        // /select, potřebuje cestu v jednom argumentu i s uvozovkami, jinak
        // se Explorer u cest s mezerami splete — proto raw_arg.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.raw_arg(format!("/select,\"{}\"", path));
        }
        #[cfg(not(windows))]
        command.arg(&path);
    }

    // Explorer vrací nenulový exit kód i při úspěchu, proto se status neověřuje.
    command.spawn().map_err(|err| format!("{}: {}", path, err))?;
    Ok(())
}

#[tauri::command]
fn get_file_properties(path: String) -> Result<FileProperties, String> {
    let metadata = fs::metadata(&path).map_err(|err| format!("{}: {}", path, err))?;
    let is_dir = metadata.is_dir();

    Ok(FileProperties {
        size: if is_dir { 0 } else { metadata.len() },
        created: to_unix_seconds(metadata.created()),
        modified: to_unix_seconds(metadata.modified()),
        accessed: to_unix_seconds(metadata.accessed()),
        is_dir,
        is_readonly: metadata.permissions().readonly(),
        is_hidden: is_hidden(&metadata),
    })
}

/// Strop pro náhled textu. Chrání před tím, aby omylem otevřený 500MB log
/// protekl přes IPC do webview.
const MAX_PREVIEW_BYTES: u64 = 1_048_576;

/// Přečte začátek textového souboru pro Quick Look náhled.
/// Nikdy nenačte víc než 1 MB, i kdyby si volající řekl o víc.
#[tauri::command]
fn read_text_file(path: String, max_bytes: u64) -> Result<String, String> {
    use std::io::Read;

    let limit = max_bytes.min(MAX_PREVIEW_BYTES);

    let file = fs::File::open(&path).map_err(|err| format!("{}: {}", path, err))?;
    let size = file
        .metadata()
        .map_err(|err| format!("{}: {}", path, err))?
        .len();

    let mut buffer = Vec::with_capacity(limit.min(size) as usize);
    file.take(limit)
        .read_to_end(&mut buffer)
        .map_err(|err| format!("{}: {}", path, err))?;

    let truncated = size > limit;

    let mut text = match String::from_utf8(buffer) {
        Ok(text) => text,
        Err(err) => {
            // U zkráceného souboru je rozseknutý vícebajtový znak na konci v pořádku;
            // neplatné UTF-8 uprostřed znamená, že soubor prostě není textový.
            let valid_up_to = err.utf8_error().valid_up_to();
            let bytes = err.into_bytes();

            if truncated && valid_up_to + 4 >= bytes.len() {
                String::from_utf8_lossy(&bytes[..valid_up_to]).into_owned()
            } else {
                return Err(format!("{}: soubor není platný text (UTF-8)", path));
            }
        }
    };

    if truncated {
        text.push_str("\n\n… (soubor zkrácen, ukazuji první 1 MB)");
    }

    Ok(text)
}

/// Volné místo na disku, na kterém leží `path` (bajty dostupné tomuhle uživateli).
#[cfg(windows)]
#[tauri::command]
fn get_disk_free_space(path: String) -> Result<u64, String> {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let mut available: u64 = 0;

    // GetDiskFreeSpaceExW chce existující adresář, ne soubor.
    let directory = HSTRING::from(path.as_str());

    unsafe { GetDiskFreeSpaceExW(&directory, Some(&mut available), None, None) }
        .map_err(|err| format!("{}: {}", path, err))?;

    Ok(available)
}

#[cfg(not(windows))]
#[tauri::command]
fn get_disk_free_space(_path: String) -> Result<u64, String> {
    Err("podporováno jen na Windows".to_string())
}

/// Windows 11: zaoblené rohy okna. Na starších verzích DWM atribut prostě ignoruje.
#[cfg(windows)]
fn apply_rounded_corners(window: &tauri::WebviewWindow) {
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
        DWM_WINDOW_CORNER_PREFERENCE,
    };

    let Ok(hwnd) = window.hwnd() else { return };
    let preference = DWMWCP_ROUND;

    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &preference as *const DWM_WINDOW_CORNER_PREFERENCE as *const _,
            std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
        );
    }
}

#[cfg(not(windows))]
fn apply_rounded_corners(_window: &tauri::WebviewWindow) {}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                apply_rounded_corners(&window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_dir,
            get_favorites,
            open_file,
            get_disk_free_space,
            read_text_file,
            rename_path,
            move_to_trash,
            copy_path,
            move_path,
            duplicate_path,
            open_in_explorer,
            get_file_properties
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
