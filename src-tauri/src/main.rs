// Bez konzolového okna i v debug buildu — spouští se i dvojklikem na exe.
// Výpisy pod `npm run tauri dev` dál tečou do terminálu přes zděděný výstup.
#![windows_subsystem = "windows"]

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use walkdir::WalkDir;

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
    /// Atribut „skrytý" — frontend takové položky kreslí poloprůhledně.
    hidden: bool,
}

/// Položka v postranním panelu.
#[derive(Debug, Serialize)]
struct FavoriteEntry {
    label: String,
    path: String,
    icon_name: String,
    /// Zařízení bez souborového systému (telefon, fotoaparát). Cesta je
    /// shellová („::{…}\\?\usb#…"), `list_dir` ji neotevře — klik ji pošle
    /// do Průzkumníka.
    external: bool,
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

/// Adresáře, do kterých se při rekurzivním hledání nesestupuje. Bývají obrovské
/// a jejich obsah nikdo nehledá — bez nich by hledání v projektu trvalo minuty.
const SKIP_DIRS: [&str; 3] = [".git", "node_modules", "target"];

const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;

fn is_system_name(name: &str) -> bool {
    SYSTEM_NAMES
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(name))
}

#[cfg(windows)]
fn attributes(metadata: &fs::Metadata) -> u32 {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes()
}

#[cfg(not(windows))]
fn attributes(_metadata: &fs::Metadata) -> u32 {
    0
}

fn is_hidden(metadata: &fs::Metadata) -> bool {
    attributes(metadata) & FILE_ATTRIBUTE_HIDDEN != 0
}

/// „Chráněné soubory operačního systému" (skryté + systémové, např. desktop.ini).
/// Průzkumník je neukazuje ani se zapnutým zobrazením skrytých souborů.
fn is_protected(metadata: &fs::Metadata) -> bool {
    let flags = FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM;
    attributes(metadata) & flags == flags
}

/// Patří položka do výpisu? Stejná pravidla jako Průzkumník: skryté jen když
/// je uživatel chce vidět, chráněné systémové a SYSTEM_NAMES nikdy.
fn is_listed(name: &str, metadata: &fs::Metadata, show_hidden: bool) -> bool {
    if is_system_name(name) || is_protected(metadata) {
        return false;
    }
    show_hidden || !is_hidden(metadata)
}

/// Má Průzkumník zapnuté „Zobrazovat skryté soubory"? Podle toho se nastaví
/// výchozí stav, dokud si uživatel přepínač v aplikaci nezmění sám.
#[cfg(windows)]
#[tauri::command(async)]
fn explorer_shows_hidden() -> bool {
    use windows::core::w;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};

    let mut value: u32 = 0;
    let mut size = std::mem::size_of::<u32>() as u32;

    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced"),
            w!("Hidden"),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut value as *mut u32 as *mut _),
            Some(&mut size),
        )
    };

    // 1 = zobrazovat, 2 = nezobrazovat; chybějící hodnota = výchozí Windows (skrýt).
    status.is_ok() && value == 1
}

#[cfg(not(windows))]
#[tauri::command(async)]
fn explorer_shows_hidden() -> bool {
    false
}

/// SystemTime → unix sekundy. Nedostupný čas (nebo čas před rokem 1970) dává 0.
fn to_unix_seconds(time: std::io::Result<std::time::SystemTime>) -> i64 {
    time.ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

/// Cesta + metadata → položka pro frontend.
///
/// Sdílí ji `list_dir`, `stat_paths` i `search_recursive`, ať se tři místa
/// nerozejdou v tom, co je `extension` u složky nebo `size` u adresáře.
fn make_entry(path: &Path, metadata: &fs::Metadata) -> FileEntry {
    let is_dir = metadata.is_dir();

    FileEntry {
        extension: if is_dir {
            None
        } else {
            path.extension().map(|ext| ext.to_string_lossy().to_lowercase())
        },
        // Cesta bez poslední komponenty je leda kořen disku — ten se pojmenuje sám sebou.
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string_lossy().to_string()),
        path: path.to_string_lossy().to_string(),
        is_dir,
        size: if is_dir { 0 } else { metadata.len() },
        modified: to_unix_seconds(metadata.modified()),
        created: to_unix_seconds(metadata.created()),
        hidden: is_hidden(metadata),
    }
}

/// Nejdřív složky, pak soubory; uvnitř abecedně bez ohledu na velikost písmen.
fn sort_entries(entries: &mut [FileEntry]) {
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

// Všechny commandy jsou `(async)` schválně. Bez toho by je Tauri pustilo na
// hlavním vlákně a každé delší čtení disku by zmrazilo okno — a protože máme
// decorations: false, jsou i zavírací a minimalizační tlačítka HTML volaná přes
// IPC, takže by uživatel nemohl ani zavřít appku. Těla zůstávají synchronní,
// atribut je jen přesune na blocking pool.
#[tauri::command(async)]
fn list_dir(path: String, show_hidden: Option<bool>) -> Result<Vec<FileEntry>, String> {
    let show_hidden = show_hidden.unwrap_or(false);
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
        if !is_listed(&name, &metadata, show_hidden) {
            continue;
        }

        entries.push(make_entry(&item.path(), &metadata));
    }

    sort_entries(&mut entries);

    Ok(entries)
}

fn favorite(label: &str, path: impl AsRef<Path>, icon_name: &str) -> FavoriteEntry {
    FavoriteEntry {
        label: label.to_string(),
        path: path.as_ref().to_string_lossy().to_string(),
        icon_name: icon_name.to_string(),
        external: false,
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

/// Bitová maska připojených písmen disků (bit 0 = A:). Levné volání — hlídač
/// disků se ptá každou chvíli a porovnává jen tohle číslo.
#[cfg(windows)]
fn logical_drives() -> u32 {
    unsafe { windows::Win32::Storage::FileSystem::GetLogicalDrives() }
}

#[cfg(not(windows))]
fn logical_drives() -> u32 {
    0
}

/// Visí disk na USB? GetDriveTypeW to nepozná — USB SSD i většina novějších
/// flashek se hlásí jako pevný disk. Průzkumník se proto ptá na sběrnici.
#[cfg(windows)]
fn is_usb_drive(letter: char) -> bool {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::Storage::FileSystem::{
        BusTypeUsb, CreateFileW, FILE_FLAGS_AND_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE,
        OPEN_EXISTING,
    };
    use windows::Win32::System::Ioctl::{
        PropertyStandardQuery, StorageDeviceProperty, IOCTL_STORAGE_QUERY_PROPERTY,
        STORAGE_DEVICE_DESCRIPTOR, STORAGE_PROPERTY_QUERY,
    };
    use windows::Win32::System::IO::DeviceIoControl;

    let device = HSTRING::from(format!("\\\\.\\{}:", letter));

    // Přístup 0 = jen dotazy na zařízení, bez čtení dat. Nepotřebuje admina.
    let Ok(handle) = (unsafe {
        CreateFileW(
            &device,
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            FILE_FLAGS_AND_ATTRIBUTES(0),
            None,
        )
    }) else {
        return false;
    };

    let query = STORAGE_PROPERTY_QUERY {
        PropertyId: StorageDeviceProperty,
        QueryType: PropertyStandardQuery,
        ..Default::default()
    };
    let mut descriptor = STORAGE_DEVICE_DESCRIPTOR::default();
    let mut returned = 0u32;

    let ok = unsafe {
        DeviceIoControl(
            handle,
            IOCTL_STORAGE_QUERY_PROPERTY,
            Some(&query as *const STORAGE_PROPERTY_QUERY as *const _),
            std::mem::size_of::<STORAGE_PROPERTY_QUERY>() as u32,
            Some(&mut descriptor as *mut STORAGE_DEVICE_DESCRIPTOR as *mut _),
            std::mem::size_of::<STORAGE_DEVICE_DESCRIPTOR>() as u32,
            Some(&mut returned),
            None,
        )
    }
    .is_ok();

    unsafe {
        let _ = CloseHandle(handle);
    }

    ok && descriptor.BusType == BusTypeUsb
}

/// Všechny připojené disky s názvem svazku, jak je ukazuje Průzkumník:
/// „OS (C:)", „Linux Mint 22.3 Xfce 64-bit (D:)", „Místní disk (E:)".
#[cfg(windows)]
fn drive_favorites() -> Vec<FavoriteEntry> {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::{GetDriveTypeW, GetVolumeInformationW};

    // Hodnoty GetDriveTypeW (DRIVE_REMOVABLE, DRIVE_REMOTE, DRIVE_CDROM).
    const REMOVABLE: u32 = 2;
    const REMOTE: u32 = 4;
    const CDROM: u32 = 5;

    let mask = logical_drives();

    (0..26u8)
        .filter(|index| mask & (1 << index) != 0)
        .filter_map(|index| {
            let letter = (b'A' + index) as char;
            let root = format!("{}:\\", letter);
            let root_w = HSTRING::from(root.as_str());

            let kind = unsafe { GetDriveTypeW(&root_w) };
            let (fallback, icon) = match kind {
                REMOVABLE => ("USB disk", "Usb"),
                REMOTE => ("Síťový disk", "Network"),
                CDROM => ("Mechanika", "Disc"),
                // Název jako v Průzkumníku („Místní disk"), ikona podle sběrnice.
                _ if is_usb_drive(letter) => ("Místní disk", "Usb"),
                _ => ("Místní disk", "HardDrive"),
            };

            // Prázdná čtečka karet nebo mechanika bez disku svazek nemá —
            // do sidebaru nepatří, klik by jen skončil chybou.
            let mut name = [0u16; 261];
            unsafe { GetVolumeInformationW(&root_w, Some(&mut name), None, None, None, None) }
                .ok()?;

            let length = name.iter().position(|&c| c == 0).unwrap_or(name.len());
            let label = String::from_utf16_lossy(&name[..length]);
            let label = if label.trim().is_empty() { fallback.to_string() } else { label };

            Some(favorite(&format!("{} ({}:)", label, letter), &root, icon))
        })
        .collect()
}

#[cfg(not(windows))]
fn drive_favorites() -> Vec<FavoriteEntry> {
    vec![favorite("/", "/", "HardDrive")]
}

/// Zařízení bez písmena jednotky — iPhone, Android, fotoaparát. Průzkumník
/// je ukazuje v „Tento počítač", ale nejsou souborový systém (MTP), takže je
/// shell vrátí se shellovou cestou místo `X:\`.
///
/// Musí běžet na vlákně s inicializovaným COM.
#[cfg(windows)]
unsafe fn portable_devices_com() -> Vec<FavoriteEntry> {
    use windows::Win32::System::Com::{CoTaskMemFree, IBindCtx};
    use windows::Win32::System::SystemServices::SFGAO_FILESYSTEM;
    use windows::Win32::UI::Shell::{
        BHID_EnumItems, FOLDERID_ComputerFolder, IEnumShellItems, IShellItem,
        SHGetKnownFolderItem, KF_FLAG_DEFAULT, SIGDN, SIGDN_DESKTOPABSOLUTEPARSING,
        SIGDN_NORMALDISPLAY,
    };

    fn name(item: &IShellItem, kind: SIGDN) -> Option<String> {
        unsafe {
            let raw = item.GetDisplayName(kind).ok()?;
            let text = raw.to_string().ok();
            CoTaskMemFree(Some(raw.0 as *const _));
            text
        }
    }

    let Ok(computer) =
        (unsafe { SHGetKnownFolderItem::<IShellItem>(&FOLDERID_ComputerFolder, KF_FLAG_DEFAULT, None) })
    else {
        return Vec::new();
    };
    let Ok(items) =
        (unsafe { computer.BindToHandler::<_, IEnumShellItems>(None::<&IBindCtx>, &BHID_EnumItems) })
    else {
        return Vec::new();
    };

    let mut devices = Vec::new();
    loop {
        let mut batch = [None];
        let mut fetched = 0u32;
        if unsafe { items.Next(&mut batch, Some(&mut fetched)) }.is_err() || fetched == 0 {
            break;
        }
        let Some(item) = batch[0].take() else { break };

        // Disky s písmenem už obstarává drive_favorites.
        let filesystem = unsafe { item.GetAttributes(SFGAO_FILESYSTEM) }
            .map(|attributes| attributes.0 & SFGAO_FILESYSTEM.0 != 0)
            .unwrap_or(true);
        if filesystem {
            continue;
        }

        let (Some(label), Some(path)) =
            (name(&item, SIGDN_NORMALDISPLAY), name(&item, SIGDN_DESKTOPABSOLUTEPARSING))
        else {
            continue;
        };

        let mut entry = favorite(&label, &path, "Smartphone");
        entry.external = true;
        devices.push(entry);
    }

    devices
}

/// portable_devices_com na vlastním vlákně s COM. Async runtime Tauri si COM
/// na svých vláknech inicializuje po svém (trash), tam se sahat nesmí.
#[cfg(windows)]
fn portable_devices() -> Vec<FavoriteEntry> {
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};

    std::thread::spawn(|| unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let devices = portable_devices_com();
        CoUninitialize();
        devices
    })
    .join()
    .unwrap_or_default()
}

#[cfg(not(windows))]
fn portable_devices() -> Vec<FavoriteEntry> {
    Vec::new()
}

/// Otiskne sadu zařízení — hlídač pozná změnu porovnáním dvou otisků.
fn devices_fingerprint(devices: &[FavoriteEntry]) -> String {
    devices.iter().map(|device| device.path.as_str()).collect::<Vec<_>>().join("\n")
}

/// Po připojení nebo odpojení disku či telefonu pošle frontendu `drives-changed`.
/// Maska písmen je levná a ptá se na ni každých 1,5 s; výčet telefonů přes
/// shell je dražší, ten jde každé druhé kolo.
fn spawn_drive_watcher(app: tauri::AppHandle) {
    use tauri::Emitter;

    std::thread::spawn(move || {
        #[cfg(windows)]
        unsafe {
            use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
            // Vlákno běží po celou dobu aplikace, COM se uvolní s procesem.
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }

        let devices_now = || {
            #[cfg(windows)]
            let devices = unsafe { portable_devices_com() };
            #[cfg(not(windows))]
            let devices = Vec::new();
            devices_fingerprint(&devices)
        };

        let mut last_mask = logical_drives();
        let mut last_devices = devices_now();
        let mut round = 0u32;

        loop {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            round = round.wrapping_add(1);

            let mut changed = false;

            let mask = logical_drives();
            if mask != last_mask {
                last_mask = mask;
                changed = true;
            }

            if round % 2 == 0 {
                let devices = devices_now();
                if devices != last_devices {
                    last_devices = devices;
                    changed = true;
                }
            }

            if changed {
                let _ = app.emit("drives-changed", ());
            }
        }
    });
}

/// Otevře zařízení bez souborového systému (telefon) v Průzkumníku.
#[tauri::command(async)]
fn open_device(path: String) -> Result<(), String> {
    // Jen shellové cesty z portable_devices — nic jiného sem nepatří.
    if !path.starts_with("::{") {
        return Err(format!("{}: není cesta zařízení", path));
    }

    // Explorer vrací nenulový kód i při úspěchu, stav se proto nekontroluje.
    std::process::Command::new("explorer.exe")
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|err| format!("Průzkumníka se nepodařilo spustit: {}", err))
}

/* ------------------------- hlídání otevřených složek ------------------------ */

/// Hlídač složek, které má uživatel právě otevřené. Při každém `watch_dirs`
/// se starý zahodí a vznikne nový nad aktuálním seznamem.
struct DirWatcher {
    watcher: std::sync::Mutex<Option<notify::RecommendedWatcher>>,
    /// Kanál do vlákna, které změny sdružuje a posílá frontendu.
    changes: std::sync::Mutex<std::sync::mpsc::Sender<()>>,
}

/// Sdružuje změny: kopírování tisíce souborů je tisíc událostí, frontend
/// ale stačí obnovit jednou. Po první změně se čeká, až bude 250 ms klid
/// (nejdéle ale 1 s, ať výpis při dlouhé operaci aspoň průběžně naskakuje).
fn spawn_change_emitter(app: tauri::AppHandle, receiver: std::sync::mpsc::Receiver<()>) {
    use std::time::{Duration, Instant};
    use tauri::Emitter;

    std::thread::spawn(move || {
        while receiver.recv().is_ok() {
            let started = Instant::now();
            while started.elapsed() < Duration::from_secs(1)
                && receiver.recv_timeout(Duration::from_millis(250)).is_ok()
            {}
            let _ = app.emit("dir-changed", ());
        }
    });
}

#[tauri::command(async)]
fn watch_dirs(state: tauri::State<'_, DirWatcher>, paths: Vec<String>) -> Result<(), String> {
    use notify::{EventKind, RecursiveMode, Watcher};

    let sender = state.changes.lock().map_err(|err| err.to_string())?.clone();

    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        // Čtení souboru (náhled v Quick Look) výpis nemění.
        if let Ok(event) = result {
            if !matches!(event.kind, EventKind::Access(_)) {
                let _ = sender.send(());
            }
        }
    })
    .map_err(|err| err.to_string())?;

    // Složka, kterou hlídat nejde (odpojený disk, chybí práva), se přeskočí —
    // ostatní se hlídat dál mají.
    for path in &paths {
        let _ = watcher.watch(Path::new(path), RecursiveMode::NonRecursive);
    }

    // Přiřazení zahodí předchozí hlídač, a tím i jeho sledování.
    *state.watcher.lock().map_err(|err| err.to_string())? = Some(watcher);
    Ok(())
}

#[tauri::command(async)]
fn get_favorites() -> Vec<FavoriteSection> {
    let home = dirs::home_dir();

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
    .filter_map(|(label, dir, icon)| {
        let path = home.as_ref()?.join(dir);
        favorite_if_exists(label, path, icon)
    })
    .collect();

    let mut devices = drive_favorites();
    devices.extend(portable_devices());
    if let Some(home) = home {
        devices.push(favorite("Home", home, "Home"));
    }

    [
        section("Oblíbené", standard),
        section("iCloud", cloud),
        section("Zařízení", devices),
    ]
    .into_iter()
    .flatten()
    .collect()
}

#[tauri::command(async)]
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

/// Výsledek kopie, přesunu nebo duplikace. Kromě nové cesty nese počet
/// přeskočených odkazů, aby se uživatel dozvěděl, že se nezkopírovalo úplně
/// všechno.
#[derive(Debug, Serialize)]
struct OpResult {
    path: String,
    skipped_links: u32,
}

/// Odpověď `stat_paths` pro jednu cestu. Zachovává pozici ve vstupu.
#[derive(Debug, Serialize)]
struct StatResult {
    /// Metadata, když se je podařilo načíst.
    entry: Option<FileEntry>,
    /// True **jen** když položka prokazatelně neexistuje. Nedostupný síťový
    /// disk nebo chybějící oprávnění dá false — volající pak nesmí nic
    /// promazávat, jinak by odpojení NASu smazalo uživateli tagy.
    missing: bool,
}

/// Vyhrazená jména MS-DOS zařízení. Windows je odmítá i s příponou —
/// "CON.txt" je pořád CON.
const RESERVED_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Chyby z io::Error jsou anglické systémové texty ("The system cannot find
/// the path specified. (os error 3)"). Nejčastější případy proto dostanou
/// český popis, zbytek propadne na původní text.
fn describe_io(err: &std::io::Error) -> String {
    // Kódy, které ErrorKind na Windows nerozliší.
    match err.raw_os_error() {
        Some(5) => return "nemáte oprávnění".to_string(),
        Some(32) => return "položku používá jiná aplikace".to_string(),
        Some(112) => return "na disku není dost místa".to_string(),
        Some(206) => return "cesta je příliš dlouhá".to_string(),
        _ => {}
    }

    match err.kind() {
        std::io::ErrorKind::NotFound => "položka neexistuje".to_string(),
        std::io::ErrorKind::PermissionDenied => "nemáte oprávnění".to_string(),
        std::io::ErrorKind::AlreadyExists => "cíl už existuje".to_string(),
        _ => err.to_string(),
    }
}

fn validate_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();

    if trimmed.is_empty() {
        return Err("název nesmí být prázdný".to_string());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("takový název nejde použít".to_string());
    }
    if trimmed.contains(INVALID_NAME_CHARS) {
        return Err("název obsahuje nepovolený znak".to_string());
    }
    if trimmed.chars().any(|c| (c as u32) < 0x20) {
        return Err("název obsahuje řídicí znak".to_string());
    }
    // Windows tečku na konci tiše zahodí. Vzniklý soubor by měl jiné jméno,
    // než uživatel napsal, a cesta, kterou vracíme, by neseděla.
    if trimmed.ends_with('.') {
        return Err("název nesmí končit tečkou".to_string());
    }
    if trimmed.chars().count() > 255 {
        return Err("název je příliš dlouhý".to_string());
    }

    let stem = trimmed.split('.').next().unwrap_or(trimmed);
    if RESERVED_NAMES
        .iter()
        .any(|reserved| stem.eq_ignore_ascii_case(reserved))
    {
        return Err(format!("„{}“ je vyhrazený název Windows", stem));
    }

    Ok(())
}

/// Odmítne kopii nebo přesun složky do sebe sama nebo do vlastního potomka.
/// Bez toho `copy_tree` prochází cíl, který sám vytváří, a běží, dokud
/// nedojde místo na disku.
fn ensure_not_inside(source: &Path, dest_dir: &Path) -> Result<(), String> {
    // U souboru nemá smysl — vložit soubor do jeho vlastní složky je legitimní.
    if !source.is_dir() {
        return Ok(());
    }

    // Kanonizace kvůli symlinkům, relativním segmentům a velikosti písmen.
    let source_real = source
        .canonicalize()
        .map_err(|err| format!("{}: {}", source.to_string_lossy(), describe_io(&err)))?;

    // Když cíl ještě neexistuje, uvnitř zdroje ležet nemůže.
    let Ok(dest_real) = dest_dir.canonicalize() else {
        return Ok(());
    };

    if dest_real.starts_with(&source_real) {
        return Err("složku nelze vložit do sebe sama".to_string());
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

/// Zkopíruje soubor nebo celý strom; vrací počet přeskočených odkazů.
///
/// Symlinky a junctions se **nenásledují**. Uživatelský profil na Windows je
/// jich plný (Documents\My Music, staré Application Data ukazující samo na
/// sebe) a jejich následování kopii buď nafoukne o gigabajty, nebo zacyklí.
///
/// Iterativně přes zásobník, ne rekurzí — hluboký strom by rekurzí přetekl.
fn copy_tree(from: &Path, to: &Path) -> std::io::Result<u32> {
    let mut skipped = 0u32;
    let mut stack = vec![(from.to_path_buf(), to.to_path_buf())];

    while let Some((source, target)) = stack.pop() {
        // symlink_metadata na rozdíl od is_dir() odkaz nenásleduje.
        let metadata = fs::symlink_metadata(&source)?;

        if metadata.file_type().is_symlink() {
            skipped += 1;
            continue;
        }

        if metadata.is_dir() {
            fs::create_dir_all(&target)?;
            for entry in fs::read_dir(&source)? {
                let entry = entry?;
                stack.push((entry.path(), target.join(entry.file_name())));
            }
        } else {
            fs::copy(&source, &target)?;
        }
    }

    Ok(skipped)
}

/// ERROR_NOT_SAME_DEVICE — jediný důvod, proč se přesun smí degradovat na
/// kopii a smazání.
const ERROR_NOT_SAME_DEVICE: i32 = 17;

/// Přejmenuje bez přepsání cíle.
///
/// `fs::rename` na Windows používá MOVEFILE_REPLACE_EXISTING, takže existující
/// cíl tiše zahodí. Samotná kontrola `exists()` předem nestačí — mezi ní a
/// přesunem je okno, ve kterém cíl může vzniknout.
#[cfg(windows)]
fn rename_no_replace(source: &Path, target: &Path) -> std::io::Result<()> {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::{MoveFileExW, MOVE_FILE_FLAGS};

    let from = HSTRING::from(source.to_string_lossy().as_ref());
    let to = HSTRING::from(target.to_string_lossy().as_ref());

    // Bez MOVEFILE_REPLACE_EXISTING selže, když cíl existuje — atomicky.
    unsafe { MoveFileExW(&from, &to, MOVE_FILE_FLAGS(0)) }.map_err(|err| {
        // HRESULT_FROM_WIN32 má kód ve spodních 16 bitech.
        std::io::Error::from_raw_os_error(err.code().0 & 0xFFFF)
    })
}

#[cfg(not(windows))]
fn rename_no_replace(source: &Path, target: &Path) -> std::io::Result<()> {
    if target.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "cíl už existuje",
        ));
    }
    fs::rename(source, target)
}

/// Přejmenování přes dočasný název. Jediné použití je změna velikosti písmen,
/// kde zdroj i cíl ukazují na tentýž soubor.
fn rename_via_temp(source: &Path, target: &Path) -> std::io::Result<()> {
    let parent = source.parent().unwrap_or(Path::new("."));

    for attempt in 0..100 {
        let temporary = parent.join(format!(".finder-win-rename-{}", attempt));
        if temporary.exists() {
            continue;
        }

        fs::rename(source, &temporary)?;
        // Zpátky, kdyby druhý krok selhal — jinak by soubor zůstal pod
        // dočasným názvem a uživatel by ho nenašel.
        if let Err(err) = fs::rename(&temporary, target) {
            let _ = fs::rename(&temporary, source);
            return Err(err);
        }
        return Ok(());
    }

    Err(std::io::Error::other("nepodařilo se najít volný dočasný název"))
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

#[tauri::command(async)]
fn rename_path(from: String, to_name: String) -> Result<String, String> {
    validate_name(&to_name)?;

    let source = PathBuf::from(&from);
    let target = parent_of(&source)?.join(to_name.trim());

    // Přejmenování na sebe sama není chyba, jen se nic nestane.
    if target == source {
        return Ok(source.to_string_lossy().to_string());
    }

    // Změna jen velikosti písmen ("foo" → "FOO") je legitimní přejmenování,
    // ale na NTFS by kontrola existence cíle našla sama sebe. Nestačí
    // eq_ignore_ascii_case — česká jména mají diakritiku mimo ASCII.
    let case_only = source.to_string_lossy().to_lowercase() == target.to_string_lossy().to_lowercase();

    if !case_only && target.exists() {
        return Err(format!("{} už existuje", target.to_string_lossy()));
    }

    match rename_no_replace(&source, &target) {
        Ok(()) => {}
        // Některé souborové systémy ohlásí u přejmenování lišícího se jen
        // velikostí písmen "cíl už existuje" — je to totiž tentýž soubor.
        // Objížďka přes dočasný název to spolehlivě obejde.
        Err(err) if case_only && err.kind() == std::io::ErrorKind::AlreadyExists => {
            rename_via_temp(&source, &target)
                .map_err(|err| format!("{}: {}", from, describe_io(&err)))?;
        }
        Err(err) => return Err(format!("{}: {}", from, describe_io(&err))),
    }

    Ok(target.to_string_lossy().to_string())
}

#[tauri::command(async)]
fn move_to_trash(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|err| format!("{}: {}", path, err))
}

#[tauri::command(async)]
fn copy_path(from: String, to_dir: String) -> Result<OpResult, String> {
    let source = PathBuf::from(&from);
    let destination = Path::new(&to_dir);

    ensure_not_inside(&source, destination)?;

    let target = unique_destination(destination, &file_name_of(&source)?)?;

    let skipped_links =
        copy_tree(&source, &target).map_err(|err| format!("{}: {}", from, describe_io(&err)))?;

    Ok(OpResult {
        path: target.to_string_lossy().to_string(),
        skipped_links,
    })
}

#[tauri::command(async)]
fn move_path(from: String, to_dir: String) -> Result<OpResult, String> {
    let source = PathBuf::from(&from);
    let destination = Path::new(&to_dir);

    ensure_not_inside(&source, destination)?;

    let target = unique_destination(destination, &file_name_of(&source)?)?;

    // rename je atomický, ale funguje jen v rámci jednoho svazku.
    match rename_no_replace(&source, &target) {
        Ok(()) => {
            return Ok(OpResult {
                path: target.to_string_lossy().to_string(),
                skipped_links: 0,
            })
        }
        // Kopie a smazání se smí použít jen kvůli jinému svazku. Dřív se
        // polykala každá chyba, takže "přístup odepřen" i "soubor je používán"
        // tiše degradovaly na kopii — a když pak smazání originálu selhalo,
        // zůstaly po "přesunu" dvě kopie.
        Err(err) if err.raw_os_error() == Some(ERROR_NOT_SAME_DEVICE) => {}
        Err(err) => return Err(format!("{}: {}", from, describe_io(&err))),
    }

    let skipped_links =
        copy_tree(&source, &target).map_err(|err| format!("{}: {}", from, describe_io(&err)))?;

    let removed = if source.is_dir() {
        fs::remove_dir_all(&source)
    } else {
        fs::remove_file(&source)
    };
    removed.map_err(|err| {
        format!(
            "{}: zkopírováno, ale nešlo smazat originál: {}",
            from,
            describe_io(&err)
        )
    })?;

    Ok(OpResult {
        path: target.to_string_lossy().to_string(),
        skipped_links,
    })
}

#[tauri::command(async)]
fn duplicate_path(path: String) -> Result<OpResult, String> {
    let source = PathBuf::from(&path);
    let directory = parent_of(&source)?;
    let target = unique_destination(directory, &file_name_of(&source)?)?;

    let skipped_links =
        copy_tree(&source, &target).map_err(|err| format!("{}: {}", path, describe_io(&err)))?;

    Ok(OpResult {
        path: target.to_string_lossy().to_string(),
        skipped_links,
    })
}

#[tauri::command(async)]
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

/// Dialog „Otevřít v aplikaci" — systémový verb "openas".
///
/// Nejde přes `rundll32 shell32.dll,OpenAs_RunDLL`: ten na Windows 11 tichá
/// skončí bez dialogu (ověřeno s cestou s mezerami i bez). Volá se proto přímo
/// ShellExecuteW.
///
/// Shell chce apartment-threaded COM. Init běží na vlastním vlákně, aby se
/// neměnil stav vláken async runtime — na nich COM inicializuje `trash` a
/// předvybraný model se mu nesmí přepsat pod rukama.
#[cfg(windows)]
fn shell_open_as(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use std::sync::mpsc;
    use windows::core::PCWSTR;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    // Buffery se stěhují do vlákna, aby přežily celý hovor.
    let file: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let (sender, receiver) = mpsc::channel();

    std::thread::spawn(move || {
        let verb: Vec<u16> = "openas".encode_utf16().chain(Some(0)).collect();

        unsafe {
            // S_FALSE znamená „vlákno už inicializované" — to není chyba.
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

            let instance = ShellExecuteW(
                None,
                PCWSTR(verb.as_ptr()),
                PCWSTR(file.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            );

            // ShellExecuteW hlásí chybu návratovou hodnotou <= 32.
            let code = instance.0 as isize;
            let _ = sender.send(if code > 32 { Ok(()) } else { Err(code) });

            CoUninitialize();
        }
    });

    // Když si dialog vlákno podrží, ShellExecuteW se nevrátí — čekat dál nemá
    // smysl, dialog je zjevně na obrazovce.
    match receiver.recv_timeout(std::time::Duration::from_millis(1500)) {
        Ok(Err(code)) => Err(format!("dialog se nepodařilo otevřít (kód {})", code)),
        _ => Ok(()),
    }
}

#[tauri::command(async)]
fn open_with(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("{}: položka neexistuje", path));
    }

    #[cfg(windows)]
    {
        shell_open_as(&target)
    }
    #[cfg(not(windows))]
    {
        Err("Otevřít v aplikaci je jen na Windows".to_string())
    }
}

/// Otevře terminál ve složce. U souboru v jeho složce — „v souboru" se být nedá.
///
/// Nejdřív Windows Terminal, pak PowerShell. `wt.exe` je alias ze Storu,
/// který na čisté instalaci být nemusí — spawn pak selže a padne se na zálohu.
#[tauri::command(async)]
fn open_terminal(path: String) -> Result<(), String> {
    use std::process::Command;

    let target = PathBuf::from(&path);
    let directory = if target.is_dir() {
        target.clone()
    } else {
        parent_of(&target)?.to_path_buf()
    };

    if !directory.is_dir() {
        return Err(format!("{}: složka neexistuje", directory.to_string_lossy()));
    }

    if Command::new("wt.exe")
        .arg("-d")
        .arg(&directory)
        .spawn()
        .is_ok()
    {
        return Ok(());
    }

    Command::new("powershell.exe")
        .arg("-NoExit")
        .current_dir(&directory)
        .spawn()
        .map(|_| ())
        .map_err(|err| format!("{}: {}", directory.to_string_lossy(), err))
}

/// Volný název pro novou položku: „Nová složka", „Nová složka 2", …
///
/// Nepoužívá `unique_destination` — ten řeší kolizi kopie a přípona
/// „(kopie)" by u čerstvě vytvořené složky nedržela smysl.
fn unique_new_name(dir: &Path, base: &str) -> Result<PathBuf, String> {
    let direct = dir.join(base);
    if !direct.exists() {
        return Ok(direct);
    }

    for attempt in 2..10_000 {
        let candidate = dir.join(format!("{} {}", base, attempt));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("nepodařilo se najít volný název".to_string())
}

/// Vytvoří složku a vrátí její cestu. Kolizi názvu řeší číslem, ne chybou —
/// „Nová složka" už ve složce bývá.
#[tauri::command(async)]
fn create_folder(dir: String, name: String) -> Result<String, String> {
    validate_name(&name)?;

    let directory = PathBuf::from(&dir);
    if !directory.is_dir() {
        return Err(format!("{}: cílová složka neexistuje", dir));
    }

    let target = unique_new_name(&directory, name.trim())?;
    fs::create_dir(&target)
        .map_err(|err| format!("{}: {}", target.to_string_lossy(), describe_io(&err)))?;

    Ok(target.to_string_lossy().to_string())
}

/// Vytvoří prázdný soubor a vrátí jeho cestu. Číslo při kolizi patří před
/// příponu („Nový textový dokument 2.txt"), jinak by se přípona rozbila.
#[tauri::command(async)]
fn create_file(dir: String, name: String) -> Result<String, String> {
    validate_name(&name)?;

    let directory = PathBuf::from(&dir);
    if !directory.is_dir() {
        return Err(format!("{}: cílová složka neexistuje", dir));
    }

    let name = name.trim();
    let (stem, extension) = match name.rfind('.') {
        Some(dot) if dot > 0 => (&name[..dot], &name[dot..]),
        _ => (name, ""),
    };

    for attempt in 1..10_000 {
        let candidate = if attempt == 1 {
            directory.join(name)
        } else {
            directory.join(format!("{} {}{}", stem, attempt, extension))
        };

        // create_new místo exists() + create — nic se nepřepíše ani při souběhu.
        match fs::OpenOptions::new().write(true).create_new(true).open(&candidate) {
            Ok(_) => return Ok(candidate.to_string_lossy().to_string()),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => {
                return Err(format!("{}: {}", candidate.to_string_lossy(), describe_io(&err)))
            }
        }
    }

    Err("nepodařilo se najít volný název".to_string())
}

/// Načte metadata pro seznam cest naráz — jeden IPC skok místo N.
///
/// Pozice ve vstupu se zachovávají a "neexistuje" se odlišuje od "nešlo
/// přečíst". Volající podle `missing` pozná, co má u sebe promazat — a co
/// naopak nechat být, protože je jen dočasně nedostupné.
#[tauri::command(async)]
fn stat_paths(paths: Vec<String>) -> Vec<StatResult> {
    paths
        .into_iter()
        .map(|path| {
            let entry_path = PathBuf::from(&path);

            match fs::metadata(&entry_path) {
                Ok(metadata) => StatResult {
                    entry: Some(make_entry(&entry_path, &metadata)),
                    missing: false,
                },
                Err(err) => StatResult {
                    entry: None,
                    // Cokoliv jiného než NotFound (odpojený síťový disk,
                    // chybějící oprávnění) znamená "nevím" — ne "smaž".
                    missing: err.kind() == std::io::ErrorKind::NotFound,
                },
            }
        })
        .collect()
}

/// Projde strom pod `root` a vrátí prvních `max_results` položek, jejichž název
/// obsahuje `query` (case-insensitive).
///
/// Prořezává se **při sestupu** (`filter_entry`), takže se do `node_modules`
/// a spol. vůbec nevkročí, místo aby se jejich obsah zahazoval až po projití.
#[tauri::command(async)]
fn search_recursive(
    root: String,
    query: String,
    max_results: usize,
    show_hidden: Option<bool>,
) -> Result<Vec<FileEntry>, String> {
    let show_hidden = show_hidden.unwrap_or(false);
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }

    let root_path = PathBuf::from(&root);
    // Nepřístupný kořen je chyba pro uživatele; nepřístupné podsložky se níž
    // jen tiše přeskakují, aby jedna zamčená větev nezrušila celé hledání.
    fs::read_dir(&root_path).map_err(|err| format!("{}: {}", root, err))?;

    let walker = WalkDir::new(&root_path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|item| {
            // Kořen se nefiltruje — hledání ve skryté složce, do které uživatel
            // sám navigoval, musí fungovat.
            if item.depth() == 0 {
                return true;
            }

            let name = item.file_name().to_string_lossy().to_string();
            if item.file_type().is_dir()
                && SKIP_DIRS.iter().any(|skip| skip.eq_ignore_ascii_case(&name))
            {
                return false;
            }

            item.metadata()
                .map(|meta| is_listed(&name, &meta, show_hidden))
                .unwrap_or(!is_system_name(&name))
        });

    let mut entries = Vec::new();

    for item in walker {
        let Ok(item) = item else { continue };
        // Kořen sám mezi výsledky nepatří, i kdyby se jménem trefil.
        if item.depth() == 0 {
            continue;
        }

        if !item
            .file_name()
            .to_string_lossy()
            .to_lowercase()
            .contains(&needle)
        {
            continue;
        }

        let Ok(metadata) = item.metadata() else {
            continue;
        };

        entries.push(make_entry(item.path(), &metadata));

        if entries.len() >= max_results {
            break;
        }
    }

    sort_entries(&mut entries);

    Ok(entries)
}

#[tauri::command(async)]
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
/// UTF-8 náhled, který snese rozseknutý vícebajtový znak na konci zkráceného
/// souboru. Neplatné UTF-8 uprostřed znamená jiné kódování → None.
fn decode_utf8_preview(bytes: &[u8], truncated: bool) -> Option<String> {
    match std::str::from_utf8(bytes) {
        Ok(text) => Some(text.to_string()),
        Err(err) => {
            let valid_up_to = err.valid_up_to();
            if truncated && valid_up_to + 4 >= bytes.len() {
                Some(String::from_utf8_lossy(&bytes[..valid_up_to]).into_owned())
            } else {
                None
            }
        }
    }
}

/// Rozkóduje text pro náhled. Rozhoduje BOM, pak se zkusí UTF-8 a nakonec
/// CP1250 — na českých Windows je v té kódové stránce spousta starších .txt,
/// .csv a .log, které by jinak náhled odmítl jako "není platný text".
fn decode_preview(bytes: &[u8], truncated: bool) -> Option<String> {
    use encoding_rs::{UTF_16BE, UTF_16LE, WINDOWS_1250};

    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return decode_utf8_preview(rest, truncated);
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return Some(UTF_16LE.decode(rest).0.into_owned());
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return Some(UTF_16BE.decode(rest).0.into_owned());
    }

    if let Some(text) = decode_utf8_preview(bytes, truncated) {
        return Some(text);
    }

    // CP1250 namapuje každý bajt, takže by "uspěla" i na binárce. Nulový bajt
    // je nejspolehlivější znamení, že o text vůbec nejde.
    if bytes.contains(&0) {
        return None;
    }

    Some(WINDOWS_1250.decode(bytes).0.into_owned())
}

#[tauri::command(async)]
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

    let mut text = decode_preview(&buffer, truncated)
        .ok_or_else(|| format!("{}: soubor není textový", path))?;

    if truncated {
        text.push_str("\n\n… (soubor zkrácen, ukazuji první 1 MB)");
    }

    Ok(text)
}

/// Volné místo na disku, na kterém leží `path` (bajty dostupné tomuhle uživateli).
#[cfg(windows)]
#[tauri::command(async)]
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
#[tauri::command(async)]
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
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                apply_rounded_corners(&window);
            }

            let (sender, receiver) = std::sync::mpsc::channel();
            app.manage(DirWatcher {
                watcher: std::sync::Mutex::new(None),
                changes: std::sync::Mutex::new(sender),
            });
            spawn_change_emitter(app.handle().clone(), receiver);
            spawn_drive_watcher(app.handle().clone());
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
            get_file_properties,
            stat_paths,
            search_recursive,
            open_with,
            open_terminal,
            create_folder,
            create_file,
            watch_dirs,
            open_device,
            explorer_shows_hidden
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
