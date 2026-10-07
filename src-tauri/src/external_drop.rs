//! Soubory přetažené z Průzkumníku nebo z plochy.
//!
//! Tauri onDragDropEvent by vyžadoval `dragDropEnabled: true`, a to na Windows
//! vypne HTML5 drag & drop ve WebView2 — interní tažení mezi složkami by
//! přestalo fungovat. Drop proto chytá stránka normálně v HTML5 (stejné cíle,
//! stejné zvýraznění). File objekty ale cestu nemají; WebView2 je umí předat
//! hostiteli přes `chrome.webview.postMessageWithAdditionalObjects` a tady se
//! z nich cesty vytáhnou. Frontend je dostane zpátky událostí `external-drop`.

use serde::Serialize;

#[derive(Clone, Serialize)]
struct ExternalDrop {
    id: u64,
    paths: Vec<String>,
}

/// Zpráva stránky je objekt `{"finderWinDrop": <id>}`. IPC Tauri posílá
/// řetězce, takže se s ním nedá splést (a wry tenhle objekt naopak ignoruje).
fn drop_id(json: &str) -> Option<u64> {
    json.trim()
        .strip_prefix("{\"finderWinDrop\":")?
        .strip_suffix('}')?
        .trim()
        .parse()
        .ok()
}

#[cfg(windows)]
pub fn install(window: &tauri::WebviewWindow) {
    use tauri::{Emitter, Manager};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2File, ICoreWebView2WebMessageReceivedEventArgs2,
    };
    use webview2_com::{take_pwstr, WebMessageReceivedEventHandler};
    use windows::core::{Interface, PWSTR};

    let app = window.app_handle().clone();
    let _ = window.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };

        let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };

            let mut json = PWSTR::null();
            args.WebMessageAsJson(&mut json)?;
            let Some(id) = drop_id(&take_pwstr(json)) else {
                return Ok(());
            };

            // Odpověď musí odejít vždy — i prázdná. Jinak by frontend čekal na
            // timeout a uživatel by nevěděl, proč se nic nestalo.
            let paths = dropped_files(&args).unwrap_or_default();
            let _ = app.emit("external-drop", ExternalDrop { id, paths });
            Ok(())
        }));

        let mut token = 0i64;
        let _ = core.add_WebMessageReceived(&handler, &mut token);
    });

    /// Cesty k File objektům, které stránka přiložila ke zprávě.
    unsafe fn dropped_files(
        args: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2WebMessageReceivedEventArgs,
    ) -> windows::core::Result<Vec<String>> {
        let mut paths = Vec::new();
        let objects = args
            .cast::<ICoreWebView2WebMessageReceivedEventArgs2>()?
            .AdditionalObjects()?;
        let mut count = 0;
        objects.Count(&mut count)?;
        for index in 0..count {
            // Jeden nečitelný objekt nesmí shodit celý drop — ostatní soubory projdou.
            let Ok(file) = objects
                .GetValueAtIndex(index)
                .and_then(|item| item.cast::<ICoreWebView2File>())
            else {
                continue;
            };
            let mut path = PWSTR::null();
            if file.Path(&mut path).is_ok() {
                paths.push(take_pwstr(path));
            }
        }
        Ok(paths)
    }
}

#[cfg(not(windows))]
pub fn install(_window: &tauri::WebviewWindow) {}

#[cfg(test)]
mod tests {
    use super::drop_id;

    #[test]
    fn parses_only_drop_messages() {
        assert_eq!(drop_id("{\"finderWinDrop\":12}"), Some(12));
        assert_eq!(drop_id("\"{\\\"cmd\\\":\\\"x\\\"}\""), None);
        assert_eq!(drop_id("{\"other\":1}"), None);
    }
}
