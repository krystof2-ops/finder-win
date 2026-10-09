//! Typy z nabídky Průzkumníku Nový ▸ — z registru HKCR\<.přípona>\ShellNew,
//! případně HKCR\<.přípona>\<ProgID>\ShellNew. Seznam se načte jednou za běh
//! (při startu na pozadí) a drží se v paměti.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::Serialize;

use crate::{AppError, CmdResult};

/// Nejvýš tolik typů — víc by z menu udělalo seznam na celou výšku okna.
const MAX_ITEMS: usize = 20;
/// Obsah z hodnoty Data větší než tohle se nebere (běžně jde o desítky bajtů).
const MAX_DATA: usize = 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellNewItem {
    /// S tečkou, malými písmeny („.docx").
    extension: String,
    /// Popisek v menu jako v Průzkumníku („Dokument Microsoft Wordu").
    name: String,
    /// ItemName — název nového souboru bez přípony („Nová komprimovaná složka
    /// (metoda ZIP)"); bez něj frontend složí „Nový <name>".
    item_name: Option<String>,
    #[serde(skip)]
    source: Source,
}

/// Čím se nový soubor naplní.
#[derive(Clone, Debug, PartialEq)]
enum Source {
    /// NullFile — prázdný soubor.
    Empty,
    /// FileName — kopie šablony (relativní cesta = složka šablon / %WINDIR%\ShellNew).
    Template(String),
    /// Data — obsah přímo z registru.
    Data(Vec<u8>),
}

/// Hodnota v klíči ShellNew, jak ji vrátí registr.
#[cfg_attr(not(windows), allow(dead_code))]
enum RegValue {
    Text(String),
    Binary(Vec<u8>),
    /// Jiný typ (DWORD …) — rozhoduje jen to, že hodnota existuje.
    Other,
}

static ITEMS: OnceLock<Vec<ShellNewItem>> = OnceLock::new();

fn items() -> &'static [ShellNewItem] {
    ITEMS.get_or_init(win::load)
}

/// Načte seznam na pozadí, ať první otevření menu Nový nečeká na registr.
pub fn preload() {
    std::thread::spawn(|| {
        items();
    });
}

/// Z hodnot klíče ShellNew zdroj obsahu. Command, Config a Handler (průvodci —
/// Nový zástupce, Knihovna) Průzkumník spouští programem nebo COM objektem;
/// prázdný soubor by byl rozbitý, takže se přeskočí.
fn pick_source(get: impl Fn(&str) -> Option<RegValue>) -> Option<Source> {
    if get("Command").is_some() || get("Config").is_some() || get("Handler").is_some() {
        return None;
    }
    if get("NullFile").is_some() {
        return Some(Source::Empty);
    }
    if let Some(data) = get("Data") {
        let bytes = match data {
            RegValue::Text(text) => text.into_bytes(),
            RegValue::Binary(bytes) => bytes,
            RegValue::Other => Vec::new(),
        };
        return (bytes.len() <= MAX_DATA).then_some(Source::Data(bytes));
    }
    match get("FileName") {
        Some(RegValue::Text(file)) if !file.trim().is_empty() => Some(Source::Template(file.trim().to_string())),
        _ => None,
    }
}

/// Přípona použitelná v názvu souboru i v klíči cache: „.docx", „.library-ms".
fn valid_extension(extension: &str) -> bool {
    extension.len() >= 2
        && extension.len() <= 32
        && extension.starts_with('.')
        && extension[1..].chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_')
}

/// Název z registru (ItemName, popisek typu) jako název souboru: zakázané
/// znaky → „_", bez koncových teček a mezer, rozumná délka.
fn file_stem(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c })
        .take(120)
        .collect();
    cleaned.trim().trim_end_matches(['.', ' ']).to_string()
}

/// Abecedně, bez duplicit podle přípony, nejvýš MAX_ITEMS. `.txt` je v menu
/// napevno jako Textový dokument.
fn finalize(mut items: Vec<ShellNewItem>) -> Vec<ShellNewItem> {
    items.retain(|item| item.extension != ".txt" && valid_extension(&item.extension));
    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then(a.extension.cmp(&b.extension)));
    let mut seen = std::collections::HashSet::new();
    items.retain(|item| seen.insert(item.extension.clone()));
    items.truncate(MAX_ITEMS);
    items
}

/// Šablona s relativní cestou se hledá jako v Průzkumníku: šablony uživatele,
/// společné šablony, %WINDIR%\ShellNew.
fn resolve_template(file: &str) -> Option<PathBuf> {
    let path = Path::new(file);
    if path.is_absolute() {
        return path.is_file().then(|| path.to_path_buf());
    }
    let env = |name: &str| std::env::var_os(name).map(PathBuf::from);
    [
        env("APPDATA").map(|dir| dir.join("Microsoft\\Windows\\Templates")),
        env("ProgramData").map(|dir| dir.join("Microsoft\\Windows\\Templates")),
        env("WINDIR").map(|dir| dir.join("ShellNew")),
    ]
    .into_iter()
    .flatten()
    .map(|dir| dir.join(path))
    .find(|candidate| candidate.is_file())
}

/// Typy pro menu Nový (bez Složky a Textového dokumentu, ty má frontend napevno).
#[tauri::command(async)]
pub fn list_shell_new() -> Vec<ShellNewItem> {
    items().to_vec()
}

/// Vytvoří „<name><přípona>" (při kolizi „… (2)") s obsahem podle ShellNew
/// a vrátí cestu.
#[tauri::command(async)]
pub fn create_shell_new(dir: String, extension: String, name: String) -> CmdResult<String> {
    // Název skládá frontend z popisku v registru — ten může obsahovat znaky,
    // které Windows v názvu nedovolí.
    let name = file_stem(&name);
    crate::validate_name(&name)?;
    let directory = PathBuf::from(&dir);
    if !directory.is_dir() {
        return Err(AppError::at(&dir, AppError::new("error.targetNotFound")));
    }
    let item = items()
        .iter()
        .find(|item| item.extension.eq_ignore_ascii_case(&extension))
        .ok_or_else(|| AppError::new("error.shellNewUnknown"))?;

    let content = match &item.source {
        Source::Empty => Vec::new(),
        Source::Data(bytes) => bytes.clone(),
        Source::Template(file) => {
            let path = resolve_template(file).ok_or_else(|| AppError::at(file, AppError::new("error.shellNewTemplate")))?;
            std::fs::read(&path).map_err(|err| AppError::at(path.to_string_lossy(), crate::describe_io(&err)))?
        }
    };
    let file_name = format!("{}{}", name, item.extension);
    crate::create_unique_file(&directory, &file_name, &content).map(|path| path.to_string_lossy().to_string())
}

/// Ikona typu podle přípony (32 px PNG) — soubor k ní ještě neexistuje.
#[tauri::command(async)]
pub fn get_extension_icon(extension: String) -> CmdResult<String> {
    if !valid_extension(&extension) {
        return Err(AppError::new("error.iconNoData"));
    }
    let key = format!("ext-info:{}:32", extension.to_lowercase());
    crate::cached_png("icons", &key, move || {
        crate::on_com_thread(crate::ICON_TIMEOUT, move || win::extension_icon(&extension))
    })
}

#[cfg(windows)]
mod win {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Graphics::Gdi::{DeleteObject, HGDIOBJ};
    use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_NORMAL;
    use windows::Win32::System::Registry::{
        RegEnumKeyExW, RegGetValueW, HKEY_CLASSES_ROOT, REG_BINARY, REG_EXPAND_SZ, REG_SZ, REG_VALUE_TYPE, RRF_RT_ANY,
    };
    use windows::Win32::UI::Shell::{
        SHGetFileInfoW, SHLoadIndirectString, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGFI_USEFILEATTRIBUTES,
    };
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, ICONINFO};

    use super::{finalize, pick_source, RegValue, ShellNewItem};
    use crate::{describe_win, AppError, CmdResult};

    fn utf16_string(bytes: &[u8]) -> String {
        let wide: Vec<u16> = bytes.chunks_exact(2).map(|pair| u16::from_le_bytes([pair[0], pair[1]])).collect();
        String::from_utf16_lossy(&wide).trim_end_matches('\0').to_string()
    }

    /// Hodnota z HKCR\<sub>; `name` None = výchozí hodnota klíče. REG_EXPAND_SZ
    /// registr rovnou rozvine.
    fn value(sub: &str, name: Option<&str>) -> Option<RegValue> {
        let sub = HSTRING::from(sub);
        let name = name.map(HSTRING::from);
        let name_ptr = name.as_ref().map_or(PCWSTR::null(), |name| PCWSTR(name.as_ptr()));
        let mut kind = REG_VALUE_TYPE::default();
        let mut size = 0u32;
        unsafe { RegGetValueW(HKEY_CLASSES_ROOT, &sub, name_ptr, RRF_RT_ANY, Some(&mut kind), None, Some(&mut size)) }
            .ok()
            .ok()?;
        // Rozvinutý řetězec bývá delší, než hlásil první dotaz — pár pokusů.
        for _ in 0..3 {
            let mut buffer = vec![0u8; size as usize + 2];
            size = buffer.len() as u32;
            let status = unsafe {
                RegGetValueW(
                    HKEY_CLASSES_ROOT,
                    &sub,
                    name_ptr,
                    RRF_RT_ANY,
                    Some(&mut kind),
                    Some(buffer.as_mut_ptr() as *mut _),
                    Some(&mut size),
                )
            };
            if status.is_ok() {
                buffer.truncate(size as usize);
                return Some(match kind {
                    REG_SZ | REG_EXPAND_SZ => RegValue::Text(utf16_string(&buffer)),
                    REG_BINARY => RegValue::Binary(buffer),
                    _ => RegValue::Other,
                });
            }
        }
        None
    }

    fn text(sub: &str, name: Option<&str>) -> Option<String> {
        match value(sub, name)? {
            RegValue::Text(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
            _ => None,
        }
    }

    /// „@%SystemRoot%\system32\x.dll,-123" → přeložený text (jazyk Windows).
    fn indirect(text: String) -> Option<String> {
        if !text.starts_with('@') {
            return Some(text);
        }
        let mut buffer = [0u16; 512];
        unsafe { SHLoadIndirectString(&HSTRING::from(text.as_str()), &mut buffer, None) }.ok()?;
        let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
        let loaded = String::from_utf16_lossy(&buffer[..end]);
        (!loaded.trim().is_empty()).then(|| loaded.trim().to_string())
    }

    /// Klíče HKCR, které jsou přípony (začínají tečkou).
    fn extension_keys() -> Vec<String> {
        let mut keys = Vec::new();
        let mut buffer = [0u16; 256];
        for index in 0.. {
            let mut length = buffer.len() as u32;
            let status = unsafe {
                RegEnumKeyExW(
                    HKEY_CLASSES_ROOT,
                    index,
                    Some(windows::core::PWSTR(buffer.as_mut_ptr())),
                    &mut length,
                    None,
                    None,
                    None,
                    None,
                )
            };
            if status.is_err() {
                // ERROR_NO_MORE_ITEMS (nebo chyba) — konec výčtu.
                break;
            }
            let name = String::from_utf16_lossy(&buffer[..length as usize]);
            if name.starts_with('.') {
                keys.push(name);
            }
        }
        keys
    }

    pub fn load() -> Vec<ShellNewItem> {
        let mut items = Vec::new();
        for extension in extension_keys() {
            let prog_id = text(&extension, None);
            let mut keys = vec![format!("{extension}\\ShellNew")];
            if let Some(prog_id) = &prog_id {
                keys.push(format!("{extension}\\{prog_id}\\ShellNew"));
            }
            for key in keys {
                let Some(source) = pick_source(|name| value(&key, Some(name))) else {
                    continue;
                };
                let name = text(&key, Some("MenuText"))
                    .and_then(indirect)
                    .or_else(|| prog_id.as_deref().and_then(|id| text(id, Some("FriendlyTypeName"))).and_then(indirect))
                    .or_else(|| prog_id.as_deref().and_then(|id| text(id, None)))
                    .unwrap_or_else(|| extension.trim_start_matches('.').to_uppercase());
                let item_name = text(&key, Some("ItemName")).and_then(indirect);
                items.push(ShellNewItem { extension: extension.to_lowercase(), name, item_name, source });
                break;
            }
        }
        finalize(items)
    }

    /// Velká ikona typu přes SHGetFileInfoW s USEFILEATTRIBUTES — soubor nemusí
    /// existovat. Ikony (na rozdíl od bitmap ze shellu) mají alfu nepřednásobenou.
    pub fn extension_icon(extension: &str) -> CmdResult<Vec<u8>> {
        unsafe {
            let mut info = SHFILEINFOW::default();
            let found = SHGetFileInfoW(
                &HSTRING::from(format!("x{extension}")),
                FILE_ATTRIBUTE_NORMAL,
                Some(&mut info),
                std::mem::size_of::<SHFILEINFOW>() as u32,
                SHGFI_ICON | SHGFI_LARGEICON | SHGFI_USEFILEATTRIBUTES,
            );
            if found == 0 || info.hIcon.is_invalid() {
                return Err(AppError::new("error.iconNoData"));
            }
            let mut icon = ICONINFO::default();
            let read = GetIconInfo(info.hIcon, &mut icon);
            let _ = DestroyIcon(info.hIcon);
            read.map_err(|err| describe_win(&err))?;

            let pixels = crate::bitmap_rgba(icon.hbmColor, false);
            let _ = DeleteObject(HGDIOBJ(icon.hbmColor.0));
            let _ = DeleteObject(HGDIOBJ(icon.hbmMask.0));
            let (width, height, rgba) = pixels?;
            crate::encode_png(width, height, &rgba)
        }
    }
}

#[cfg(not(windows))]
mod win {
    use super::ShellNewItem;
    use crate::{AppError, CmdResult};

    pub fn load() -> Vec<ShellNewItem> {
        Vec::new()
    }

    pub fn extension_icon(_extension: &str) -> CmdResult<Vec<u8>> {
        Err(AppError::new("error.windowsOnly"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn values(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<RegValue> {
        move |name| pairs.iter().find(|(key, _)| *key == name).map(|(_, value)| RegValue::Text(value.to_string()))
    }

    #[test]
    fn picks_source_like_explorer() {
        assert_eq!(pick_source(values(&[("NullFile", "")])), Some(Source::Empty));
        assert_eq!(pick_source(values(&[("Data", "{\\rtf1}")])), Some(Source::Data(b"{\\rtf1}".to_vec())));
        assert_eq!(pick_source(values(&[("FileName", "excel12.xlsx")])), Some(Source::Template("excel12.xlsx".into())));
        // Průvodci a vlastní handlery se přeskočí.
        assert_eq!(pick_source(values(&[("Command", "x.exe"), ("NullFile", "")])), None);
        assert_eq!(pick_source(values(&[("Config", ""), ("NullFile", "")])), None);
        assert_eq!(pick_source(values(&[("Handler", "{ceefea1b}"), ("NullFile", "")])), None);
        assert_eq!(pick_source(values(&[("FileName", " ")])), None);
        assert_eq!(pick_source(values(&[])), None);
    }

    #[test]
    fn cleans_names_and_extensions() {
        assert_eq!(file_stem("Dokument: \"A/B\"?."), "Dokument_ _A_B__");
        assert_eq!(file_stem("  Nový  . "), "Nový");
        assert!(valid_extension(".library-ms"));
        assert!(!valid_extension(".a/.."));
        assert!(!valid_extension("."));
        assert!(!valid_extension("docx"));
    }

    #[test]
    fn sorts_dedupes_and_limits() {
        let item = |extension: &str, name: &str| ShellNewItem {
            extension: extension.into(),
            name: name.into(),
            item_name: None,
            source: Source::Empty,
        };
        let mut many = vec![item(".txt", "Textový dokument"), item(".b", "beta"), item(".a", "Alfa"), item(".b", "Beta 2")];
        many.extend((0..30).map(|i| item(&format!(".z{i}"), &format!("Zeta {i:02}"))));
        let result = finalize(many);
        assert_eq!(result.len(), MAX_ITEMS);
        assert_eq!(result[0].extension, ".a");
        assert_eq!(result[1].extension, ".b");
        assert!(result.iter().all(|item| item.extension != ".txt"));
        assert_eq!(result.iter().filter(|item| item.extension == ".b").count(), 1);
    }
}
