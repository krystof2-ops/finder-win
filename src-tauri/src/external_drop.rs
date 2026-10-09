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

/// Zpráva stránky je řetězec `finderWinDrop:<id>`. Musí to být řetězec: wry
/// registruje svůj handler dřív a u neřetězcové zprávy vrátí chybu, po které
/// WebView2 (runtime 154+) další handlery nezavolá. IPC Tauri posílá JSON
/// objekt s `cmd`, takže se prefix s ním nesplete.
fn drop_id(message: &str) -> Option<u64> {
    message.strip_prefix("finderWinDrop:")?.parse().ok()
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

            let mut text = PWSTR::null();
            // Neřetězcové zprávy nejsou naše – ticho, ne chyba.
            if args.TryGetWebMessageAsString(&mut text).is_err() {
                return Ok(());
            }
            let Some(id) = drop_id(&take_pwstr(text)) else {
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
        assert_eq!(drop_id("finderWinDrop:12"), Some(12));
        // IPC Tauri, starý objektový tvar a neúplné zprávy nejsou drop.
        assert_eq!(drop_id("{\"cmd\":\"x\",\"callback\":1}"), None);
        assert_eq!(drop_id("{\"finderWinDrop\":12}"), None);
        assert_eq!(drop_id("finderWinDrop:"), None);
        assert_eq!(drop_id("finderWinDrop:abc"), None);
    }
}
