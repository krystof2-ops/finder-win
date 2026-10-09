//! Průhledný vzhled („glass"): Mica pod sidebarem a lištami.
//!
//! Okno je vždy `transparent` (za běhu to změnit nejde), efekt se jen
//! zapíná a vypíná. Při vypnutém efektu maluje frontend neprůhledné pozadí,
//! takže vzhled je stejný jako dřív.

use serde::Serialize;
use tauri::window::{Effect, EffectsBuilder};
use tauri::Emitter;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, ERROR_SUCCESS};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::System::Registry::{
    RegCloseKey, RegGetValueW, RegNotifyChangeKeyValue, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER,
    HKEY_LOCAL_MACHINE, KEY_NOTIFY, REG_NOTIFY_CHANGE_LAST_SET, RRF_RT_REG_DWORD, RRF_RT_REG_SZ,
};
use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

/// Mica přes DWMWA_SYSTEMBACKDROP_TYPE je dokumentovaná od Windows 11 22H2.
/// Acrylic a Blur jako náhradu nebereme — při změně velikosti okna se sekají.
const MIN_BUILD: u32 = 22621;

const PERSONALIZE: PCWSTR = w!(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");

/// Jak často se mimo změny v registru kontroluje úsporný režim baterie.
const POWER_POLL_MS: u32 = 10_000;

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlassEnv {
    /// Windows efekt umí (Windows 11 22H2+).
    supported: bool,
    /// Nastavení → Přizpůsobení → Barvy → Efekty průhlednosti.
    transparency: bool,
    /// Úsporný režim baterie / energie.
    battery_saver: bool,
}

fn windows_build() -> u32 {
    let mut buffer = [0u16; 16];
    let mut size = std::mem::size_of_val(&buffer) as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            w!(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion"),
            w!("CurrentBuildNumber"),
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut size),
        )
    };
    if status != ERROR_SUCCESS {
        return 0;
    }
    let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..len]).trim().parse().unwrap_or(0)
}

fn transparency_enabled() -> bool {
    let mut value = 0u32;
    let mut size = std::mem::size_of::<u32>() as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            PERSONALIZE,
            w!("EnableTransparency"),
            RRF_RT_REG_DWORD,
            None,
            Some((&mut value as *mut u32).cast()),
            Some(&mut size),
        )
    };
    // Hodnota chybí na čerstvé instalaci — výchozí stav Windows je zapnuto.
    status != ERROR_SUCCESS || value != 0
}

fn battery_saver_on() -> bool {
    let mut status = SYSTEM_POWER_STATUS::default();
    unsafe { GetSystemPowerStatus(&mut status) }.is_ok() && status.SystemStatusFlag == 1
}

fn current_env() -> GlassEnv {
    GlassEnv {
        supported: windows_build() >= MIN_BUILD,
        transparency: transparency_enabled(),
        battery_saver: battery_saver_on(),
    }
}

#[tauri::command(async)]
pub fn glass_env() -> GlassEnv {
    current_env()
}

/// Zapne (Mica podle tématu aplikace, ne systému) nebo vypne efekt okna.
#[tauri::command(async)]
pub fn set_glass(window: tauri::WebviewWindow, enabled: bool, dark: bool) {
    let effects = (enabled && current_env().supported).then(|| {
        EffectsBuilder::new()
            .effect(if dark { Effect::MicaDark } else { Effect::MicaLight })
            .build()
    });
    let _ = window.set_effects(effects);
}

/// Hlídá Efekty průhlednosti (změna v registru) a úsporný režim (dotaz
/// každých 10 s) a při změně pošle frontendu `glass-env-changed`.
pub fn spawn_env_watcher(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut key = HKEY::default();
        let opened =
            unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, PERSONALIZE, None, KEY_NOTIFY, &mut key) };
        let event = unsafe { CreateEventW(None, false, false, None) }.ok();
        let mut last = current_env();
        loop {
            // Bez klíče nebo události aspoň periodicky (Efekty se pak projeví později).
            let armed = match event {
                Some(event) if opened == ERROR_SUCCESS => unsafe {
                    RegNotifyChangeKeyValue(key, false, REG_NOTIFY_CHANGE_LAST_SET, Some(event), true)
                        == ERROR_SUCCESS
                },
                _ => false,
            };
            match event {
                Some(event) if armed => unsafe {
                    WaitForSingleObject(event, POWER_POLL_MS);
                },
                _ => std::thread::sleep(std::time::Duration::from_millis(POWER_POLL_MS.into())),
            }
            let env = current_env();
            if env != last {
                last = env;
                if app.emit("glass-env-changed", env).is_err() {
                    break;
                }
            }
        }
        unsafe {
            if let Some(event) = event {
                let _ = CloseHandle(event);
            }
            if opened == ERROR_SUCCESS {
                let _ = RegCloseKey(key);
            }
        }
    });
}
