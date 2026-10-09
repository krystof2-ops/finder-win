//! Tažení položek ven z aplikace — do Průzkumníku, na plochu, do prohlížeče,
//! Discordu nebo Outlooku. Nativní OLE drag s daty ze shellu (CF_HDROP
//! i shell formáty, drag image dodá shell). Spouští ho frontend v dragstart
//! místo HTML5 dragu (NATIVE_DRAG_OUT v dnd.ts); nad vlastním oknem pak
//! WebView2 pošle obyčejné HTML5 drop události a interní cíle je obslouží
//! podle payloadu v dnd.ts jako dřív.

use serde::Serialize;
use tauri::Emitter;

use crate::{AppError, CmdResult};

/// Konec tažení pro frontend: co cíl s položkami udělal.
#[derive(Clone, Serialize)]
struct NativeDragEnd {
    /// "none" (zrušeno / cíl nepřijal), "copy", "move".
    effect: &'static str,
}

/// Spustí nativní drag s `paths`. Vrací hned — samotné tažení (modální smyčka
/// OLE) běží na hlavním vlákně okna, kde je OLE inicializované, a konec ohlásí
/// událostí `native-drag-end`. Neběží uvnitř obsluhy IPC, takže drop do
/// vlastního okna (další IPC) se během smyčky nezablokuje.
#[tauri::command(async)]
pub fn start_native_drag(window: tauri::WebviewWindow, paths: Vec<String>) -> CmdResult<()> {
    if paths.is_empty() {
        return Err(AppError::new("error.dragNoItems"));
    }
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let effect = match target.hwnd() {
                Ok(hwnd) => win::drag(hwnd, &paths).unwrap_or("none"),
                Err(_) => "none",
            };
            let _ = target.emit("native-drag-end", NativeDragEnd { effect });
        })
        .map_err(AppError::raw)
}

#[cfg(windows)]
mod win {
    use std::mem::ManuallyDrop;

    use windows::core::{implement, BOOL, HRESULT, HSTRING};
    use windows::Win32::Foundation::{GlobalFree, DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS, HWND, S_OK};
    use windows::Win32::System::Com::{
        CoTaskMemFree, IBindCtx, IDataObject, DVASPECT_CONTENT, FORMATETC, STGMEDIUM, STGMEDIUM_0, TYMED_HGLOBAL,
    };
    use windows::Win32::System::DataExchange::RegisterClipboardFormatW;
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::System::Ole::{
        OleInitialize, ReleaseStgMedium, IDropSource, IDropSource_Impl, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_MOVE,
        DROPEFFECT_NONE,
    };
    use windows::Win32::System::SystemServices::{MK_LBUTTON, MK_RBUTTON, MODIFIERKEYS_FLAGS};
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    use windows::Win32::UI::Shell::Common::ITEMIDLIST;
    use windows::Win32::UI::Shell::{
        SHCreateShellItemArrayFromIDLists, SHDoDragDrop, SHParseDisplayName, IShellItemArray, BHID_DataObject,
    };

    /// Zdroj tažení: Escape nebo pravé tlačítko zruší, puštění levého pustí.
    #[implement(IDropSource)]
    struct DropSource;

    impl IDropSource_Impl for DropSource_Impl {
        fn QueryContinueDrag(&self, escape: BOOL, keys: MODIFIERKEYS_FLAGS) -> HRESULT {
            if escape.as_bool() || keys.0 & MK_RBUTTON.0 != 0 {
                DRAGDROP_S_CANCEL
            } else if keys.0 & MK_LBUTTON.0 == 0 {
                DRAGDROP_S_DROP
            } else {
                S_OK
            }
        }

        fn GiveFeedback(&self, _effect: DROPEFFECT) -> HRESULT {
            DRAGDROP_S_USEDEFAULTCURSORS
        }
    }

    /// Data tažení ze shellu — stejná jako u tažení z Průzkumníku (CF_HDROP,
    /// Shell IDList Array …), takže je přijme kdokoli, kdo bere soubory.
    /// Položka, která mezitím zmizela, se vynechá; None = nezbyla žádná.
    fn data_object(paths: &[String]) -> windows::core::Result<Option<IDataObject>> {
        let mut pidls: Vec<*mut ITEMIDLIST> = Vec::with_capacity(paths.len());
        let result = (|| unsafe {
            for path in paths {
                let mut pidl = std::ptr::null_mut();
                if SHParseDisplayName(&HSTRING::from(path.as_str()), None::<&IBindCtx>, &mut pidl, 0, None).is_ok() {
                    pidls.push(pidl);
                }
            }
            if pidls.is_empty() {
                return Ok(None);
            }
            let items: Vec<*const ITEMIDLIST> = pidls.iter().map(|pidl| *pidl as *const ITEMIDLIST).collect();
            let array: IShellItemArray = SHCreateShellItemArrayFromIDLists(&items)?;
            array.BindToHandler::<_, IDataObject>(None::<&IBindCtx>, &BHID_DataObject).map(Some)
        })();
        for pidl in pidls {
            unsafe { CoTaskMemFree(Some(pidl as *const _)) };
        }
        result
    }

    fn hglobal_format(name: &str) -> Option<FORMATETC> {
        let format = unsafe { RegisterClipboardFormatW(&HSTRING::from(name)) };
        (format != 0).then_some(FORMATETC {
            cfFormat: format as u16,
            ptd: std::ptr::null_mut(),
            dwAspect: DVASPECT_CONTENT.0,
            lindex: -1,
            tymed: TYMED_HGLOBAL.0 as u32,
        })
    }

    /// DWORD do data objectu (Preferred DropEffect).
    fn set_dword(data: &IDataObject, name: &str, value: u32) {
        let Some(format) = hglobal_format(name) else { return };
        unsafe {
            let Ok(global) = GlobalAlloc(GMEM_MOVEABLE, std::mem::size_of::<u32>()) else { return };
            let pointer = GlobalLock(global) as *mut u32;
            if pointer.is_null() {
                let _ = GlobalFree(Some(global));
                return;
            }
            *pointer = value;
            let _ = GlobalUnlock(global);
            let medium = STGMEDIUM {
                tymed: TYMED_HGLOBAL.0 as u32,
                u: STGMEDIUM_0 { hGlobal: global },
                pUnkForRelease: ManuallyDrop::new(None),
            };
            // fRelease = true: po úspěchu paměť patří data objectu.
            if data.SetData(&format, &medium, true).is_err() {
                let _ = GlobalFree(Some(global));
            }
        }
    }

    /// DWORD z data objectu (co cíl nahlásil: Performed / Logical Performed DropEffect).
    fn get_dword(data: &IDataObject, name: &str) -> Option<u32> {
        let format = hglobal_format(name)?;
        unsafe {
            let mut medium = data.GetData(&format).ok()?;
            let value = if medium.tymed == TYMED_HGLOBAL.0 as u32 {
                let pointer = GlobalLock(medium.u.hGlobal) as *const u32;
                let value = (!pointer.is_null()).then(|| *pointer);
                let _ = GlobalUnlock(medium.u.hGlobal);
                value
            } else {
                None
            };
            ReleaseStgMedium(&mut medium);
            value
        }
    }

    pub fn drag(hwnd: HWND, paths: &[String]) -> windows::core::Result<&'static str> {
        // Mezi dragstart a touhle chvílí (IPC, fronta hlavního vlákna) mohl
        // uživatel tlačítko pustit — OLE by pak položky hned pustil tam, kde
        // zrovna je kurzor. Takové tažení se nekoná.
        if unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } as u16 & 0x8000 == 0 {
            return Ok("none");
        }
        // Hlavní vlákno okna je STA; OleInitialize tam vrátí S_FALSE („už běží").
        unsafe {
            let _ = OleInitialize(None);
        }
        let Some(data) = data_object(paths)? else {
            return Ok("none");
        };
        // Výchozí kopie (Shift = přesun) — i do Průzkumníku na stejném disku,
        // kde by jinak bylo výchozí přesunutí.
        set_dword(&data, "Preferred DropEffect", DROPEFFECT_COPY.0);
        let source: IDropSource = DropSource.into();
        let effect = unsafe { SHDoDragDrop(Some(hwnd), &data, &source, DROPEFFECT(DROPEFFECT_COPY.0 | DROPEFFECT_MOVE.0)) }?;

        // Optimalizovaný přesun (Průzkumník přesune sám) vrací NONE; co se stalo
        // doopravdy, je v Logical Performed DropEffect.
        let logical = get_dword(&data, "Logical Performed DropEffect").map(DROPEFFECT);
        let effect = match logical {
            Some(logical) if logical != DROPEFFECT_NONE => logical,
            _ => effect,
        };
        Ok(if effect.0 & DROPEFFECT_MOVE.0 != 0 {
            "move"
        } else if effect.0 & DROPEFFECT_COPY.0 != 0 {
            "copy"
        } else {
            "none"
        })
    }
}

#[cfg(not(windows))]
mod win {
    pub fn drag(_hwnd: (), _paths: &[String]) -> Result<&'static str, ()> {
        Err(())
    }
}
