# Finder-Win – pokyny pro Claude Code

Finder-like správce souborů pro Windows (jen Windows). Tauri 2 + React 19/TS + Rust, verze v `package.json` a `src-tauri/Cargo.toml` (+ `Cargo.lock`, `package-lock.json`).

## Stack a struktura
- `src/App.tsx` – hlavní stav a operace (historie Zpět/Znovu, schránka, drag & drop, záložky).
- `src/browser.ts` – stav jedné záložky (`TabSnapshot`); `src/columns.ts` – sloupcové zobrazení (vč. restore); `src/undo.ts` – Zpět/Znovu (limit 50, jen v paměti).
- `src/fileops.ts` – typované wrappery nad `invoke`, vč. `localizeError`.
- `src/lib/*` – `storage.ts` (settings.json přes tauri-plugin-store), `dnd.ts`, `motion.ts`, `updates.ts` (kontrola aktualizací) aj.
- `src/i18n/cs.ts` + `en.ts` – překlady; `src/components/` – UI (např. `TabBar.tsx`).
- `src-tauri/src/main.rs` – commandy a souborové operace; `clipboard.rs` – schránka Windows (CF_HDROP); `external_drop.rs` – drop z Průzkumníku.
- `winget/` + `.github/workflows/winget-manifest.yml` – manifest a workflow (bere tag jen ve tvaru `vX.Y.Z`).
- README existuje ve dvou verzích (`README.md`, `README.cs.md`) – měň je společně.

## Konvence
- Texty UI jen přes `t()` a klíče v `cs.ts` i `en.ts`; hlídá `npm run i18n:check` (běží v `npm run build`). Výjimka jde označit komentářem `i18n-ignore`.
- Chyby z Rustu jako `AppError { key, args }`, překlad ve frontendu (`localizeError`).
- Commandy `#[tauri::command(async)]`, argumenty v `invoke` v camelCase.
- Komentáře česky. Soubory LF (`.gitattributes`).
- Commity: „Fáze N.x: …“, vydání „Release X.Y.Z“.
- Operace s „Nahradit“ se do historie Zpět nezapisují (nešly by vrátit).

## Testování a build
- `npm run build` (i18n check + `tsc` + vite), `npx tsc --noEmit`.
- V `src-tauri`: `cargo check`, `cargo clippy -- -D warnings`, `cargo test`. Test `trash_tests` je `#[ignore]` a sahá na skutečný Koš (`cargo test -- --ignored`).
- `npm run tauri dev`; `npm run tauri build` → `src-tauri/target/release/bundle/nsis/`.
- Živé testování: spustit dev s `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333` a přes CDP (`http://127.0.0.1:9333/json/list`) vyhodnocovat JS ve webview.

## Známé pasti
- `dragDropEnabled` v `tauri.conf.json` musí zůstat `false` – jinak WebView2 vypne HTML5 drag & drop a interní tažení přestane fungovat. Drop zvenku jde přes `postMessageWithAdditionalObjects` (`dnd.ts` → `external_drop.rs`).
- Tažení ven z aplikace není (tauri-plugin-drag by kolidoval s HTML5 dragem).
- Záložky: živý je jen stav aktivní záložky, ostatní jsou `TabSnapshot`; watcher (`watch_dirs`) běží jen pro aktivní. Na disk se ukládají jen při 2+ záložkách (cesta, zobrazení, řazení).
- Python na tomhle stroji není – skripty přes node.
- Osiřelý vite po ukončení `tauri dev` drží port 1420.
- Pokud běží `finder-win.exe`, build přepisující binárku selže – použít jiný `CARGO_TARGET_DIR`.
- CSP `connect-src` povoluje navíc jen `api.github.com`.

## Co nedělat
- Nepřidávat telemetrii ani další síťové požadavky (jediný je denní GET na GitHub API).
- Nepushovat a netagovat bez pokynu.
- Nové nativní závislosti nebo >150 řádků Rustu jen po schválení plánu uživatelem.
