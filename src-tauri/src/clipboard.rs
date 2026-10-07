//! Systémová schránka se soubory — CF_HDROP a „Preferred DropEffect", tedy
//! přesně to, co si mezi sebou posílá Průzkumník. Díky tomu jde Ctrl+C / Ctrl+X
//! z Finder-Winu vložit v Průzkumníku (a naopak) i do přílohy v Outlooku nebo
//! v prohlížeči.

use serde::Serialize;

use crate::{AppError, CmdResult};

/// Soubory ve schránce a jestli byly vyjmuté (Ctrl+X) nebo zkopírované.
#[derive(Debug, Serialize)]
pub struct ClipboardFiles {
    paths: Vec<String>,
    cut: bool,
}

#[cfg(windows)]
mod win {
    use std::time::Duration;

    use windows::core::w;
    use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable,
        OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};

    use super::ClipboardFiles;
    use crate::{describe_win, AppError, CmdResult};

    /// Standardní formáty — vlastní konstanty místo celé feature Win32_System_Ole.
    const CF_HDROP: u32 = 15;
    const DROPEFFECT_COPY: u32 = 1;
    const DROPEFFECT_MOVE: u32 = 2;
    /// Velikost hlavičky DROPFILES: pFiles, POINT, fNC, fWide.
    const DROPFILES_SIZE: usize = 20;

    fn drop_effect_format() -> u32 {
        unsafe { RegisterClipboardFormatW(w!("Preferred DropEffect")) }
    }

    /// Otevřená schránka; zavře se sama i při chybě uprostřed.
    struct Opened;

    impl Drop for Opened {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }

    /// Schránku může mít zrovna otevřenou jiná aplikace (správce historie
    /// schránky, Office) — chvíli se počká, než se to vzdá.
    fn open(owner: Option<HWND>) -> CmdResult<Opened> {
        for _ in 0..10 {
            if unsafe { OpenClipboard(owner) }.is_ok() {
                return Ok(Opened);
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        Err(AppError::new("error.clipboardBusy"))
    }

    /// Bajty do globální paměti a do schránky. Po úspěchu paměť patří systému.
    fn set_data(format: u32, bytes: &[u8]) -> CmdResult<()> {
        unsafe {
            let memory: HGLOBAL = GlobalAlloc(GMEM_MOVEABLE, bytes.len()).map_err(|err| describe_win(&err))?;
            let target = GlobalLock(memory);
            if target.is_null() {
                let _ = GlobalFree(Some(memory));
                return Err(AppError::new("error.clipboardWrite"));
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), target as *mut u8, bytes.len());
            // Po posledním odemčení vrací "chybu" s kódem 0 — to je v pořádku.
            let _ = GlobalUnlock(memory);

            if let Err(err) = SetClipboardData(format, Some(HANDLE(memory.0))) {
                let _ = GlobalFree(Some(memory));
                return Err(describe_win(&err));
            }
        }
        Ok(())
    }

    /// DROPFILES + cesty v UTF-16, každá ukončená nulou, a nula navíc na konci.
    fn dropfiles(paths: &[String]) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(DROPFILES_SIZE + paths.iter().map(|p| p.len() * 2 + 2).sum::<usize>() + 2);
        bytes.extend_from_slice(&(DROPFILES_SIZE as u32).to_le_bytes()); // pFiles
        bytes.extend_from_slice(&[0; 12]); // pt (x, y), fNC
        bytes.extend_from_slice(&1u32.to_le_bytes()); // fWide
        for path in paths {
            for unit in path.encode_utf16().chain(std::iter::once(0)) {
                bytes.extend_from_slice(&unit.to_le_bytes());
            }
        }
        bytes.extend_from_slice(&[0, 0]);
        bytes
    }

    pub fn write(owner: HWND, paths: &[String], cut: bool) -> CmdResult<()> {
        // Bez vlastníka (HWND) by EmptyClipboard vlastnictví zahodilo
        // a SetClipboardData by pak selhalo.
        let _opened = open(Some(owner))?;
        unsafe { EmptyClipboard() }.map_err(|err| describe_win(&err))?;
        set_data(CF_HDROP, &dropfiles(paths))?;
        let effect = if cut { DROPEFFECT_MOVE } else { DROPEFFECT_COPY };
        set_data(drop_effect_format(), &effect.to_le_bytes())
    }

    pub fn has_files() -> bool {
        unsafe { IsClipboardFormatAvailable(CF_HDROP) }.is_ok()
    }

    /// DropEffect z bloku paměti; chybí-li, je to kopie (tak to bere i Průzkumník).
    fn read_effect() -> u32 {
        let format = drop_effect_format();
        if unsafe { IsClipboardFormatAvailable(format) }.is_err() {
            return DROPEFFECT_COPY;
        }
        unsafe {
            let Ok(handle) = GetClipboardData(format) else { return DROPEFFECT_COPY };
            let memory = HGLOBAL(handle.0);
            if GlobalSize(memory) < 4 {
                return DROPEFFECT_COPY;
            }
            let source = GlobalLock(memory) as *const u8;
            if source.is_null() {
                return DROPEFFECT_COPY;
            }
            let mut value = [0u8; 4];
            std::ptr::copy_nonoverlapping(source, value.as_mut_ptr(), 4);
            let _ = GlobalUnlock(memory);
            u32::from_le_bytes(value)
        }
    }

    pub fn read() -> CmdResult<Option<ClipboardFiles>> {
        if !has_files() {
            return Ok(None);
        }
        let _opened = open(None)?;
        let handle = unsafe { GetClipboardData(CF_HDROP) }.map_err(|err| describe_win(&err))?;
        let drop = HDROP(handle.0);

        let count = unsafe { DragQueryFileW(drop, u32::MAX, None) };
        let mut paths = Vec::with_capacity(count as usize);
        for index in 0..count {
            let length = unsafe { DragQueryFileW(drop, index, None) } as usize;
            let mut buffer = vec![0u16; length + 1];
            let written = unsafe { DragQueryFileW(drop, index, Some(&mut buffer)) } as usize;
            paths.push(String::from_utf16_lossy(&buffer[..written]));
        }

        let cut = read_effect() & DROPEFFECT_MOVE != 0;
        Ok(Some(ClipboardFiles { paths, cut }))
    }

    pub fn clear(owner: HWND) -> CmdResult<()> {
        let _opened = open(Some(owner))?;
        unsafe { EmptyClipboard() }.map_err(|err| describe_win(&err))
    }
}

/// Ctrl+C / Ctrl+X: soubory do systémové schránky.
#[cfg(windows)]
#[tauri::command(async)]
pub fn clipboard_write_files(window: tauri::WebviewWindow, paths: Vec<String>, cut: bool) -> CmdResult<()> {
    let owner = window.hwnd().map_err(|err| AppError::raw(err))?;
    win::write(owner, &paths, cut)
}

/// Soubory ze systémové schránky, nebo null, když v ní je něco jiného (text, obrázek).
#[cfg(windows)]
#[tauri::command(async)]
pub fn clipboard_read_files() -> CmdResult<Option<ClipboardFiles>> {
    win::read()
}

/// Jsou ve schránce soubory? Bez otevření schránky — pro „Vložit" v menu.
#[cfg(windows)]
#[tauri::command(async)]
pub fn clipboard_has_files() -> bool {
    win::has_files()
}

/// Po vložení vyjmutých souborů se schránka vyprázdní — jako v Průzkumníku.
#[cfg(windows)]
#[tauri::command(async)]
pub fn clipboard_clear(window: tauri::WebviewWindow) -> CmdResult<()> {
    let owner = window.hwnd().map_err(|err| AppError::raw(err))?;
    win::clear(owner)
}

#[cfg(not(windows))]
#[tauri::command(async)]
pub fn clipboard_write_files(_paths: Vec<String>, _cut: bool) -> CmdResult<()> {
    Err(AppError::new("error.windowsOnly"))
}

#[cfg(not(windows))]
#[tauri::command(async)]
pub fn clipboard_read_files() -> CmdResult<Option<ClipboardFiles>> {
    Ok(None)
}

#[cfg(not(windows))]
#[tauri::command(async)]
pub fn clipboard_has_files() -> bool {
    false
}

#[cfg(not(windows))]
#[tauri::command(async)]
pub fn clipboard_clear() -> CmdResult<()> {
    Ok(())
}
