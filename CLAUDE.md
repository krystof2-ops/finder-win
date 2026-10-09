# Finder-Win – pokyny pro Claude Code

Finder-like správce souborů pro Windows (jen Windows). Tauri 2 + React 19/TS + Rust, verze v `package.json` a `src-tauri/Cargo.toml` (+ `Cargo.lock`, `package-lock.json`).

## Stack a struktura
- `src/App.tsx` – hlavní stav a operace (historie Zpět/Znovu, schránka, drag & drop, záložky).
- `src/panel.ts` – stav jednoho panelu (`usePanel`, v `App.tsx` volaný 2× kvůli rozdělenému oknu).
- `src/commands.ts` – registr příkazů (CommandId + DEFINITIONS): jediný zdroj zkratek, menu Více, toolbaru a palety.
- `src/theme.ts` – `ThemePreference`, zrcadlo v localStorage jen pro první render; pravdu drží storage.
- `src/browser.ts` – stav jedné záložky (`TabSnapshot`); `src/columns.ts` – sloupcové zobrazení (vč. restore); `src/undo.ts` – Zpět/Znovu (limit 50, jen v paměti).
- `src/fileops.ts` – typované wrappery nad `invoke`, vč. `localizeError`.
- `src/lib/*` – `storage.ts` (settings.json přes tauri-plugin-store), `dnd.ts`, `motion.ts`, `updates.ts` (kontrola aktualizací) aj.
- `src/i18n/cs.ts` + `en.ts` – překlady; `src/components/` – UI (např. `TabBar.tsx`, `CommandPalette.tsx`).
- `src-tauri/src/main.rs` – commandy a souborové operace; `clipboard.rs` – schránka Windows (CF_HDROP); `external_drop.rs` – drop z Průzkumníku.
- `winget/` + `.github/workflows/winget-manifest.yml` – manifest a workflow (bere tag jen ve tvaru `vX.Y.Z`).
- `src-tauri/nsis/Czech.nsh` – vlastní český překlad NSIS instalátoru (`bundle.windows.nsis.customLanguageFiles`).
- README existuje ve dvou verzích (`README.md`, `README.cs.md`) – měň je společně. Changelog je v `CHANGELOG.md` (README jen odkazuje).
- `docs/screenshots/`, `docs/demo.gif`, `docs/demo/` (demo data) a `scripts/docs-media/` (generátory) – viz sekce Screenshoty a demo.

## Konvence
- Texty UI jen přes `t()` a klíče v `cs.ts` i `en.ts`; hlídá `npm run i18n:check` (běží v `npm run build`). Výjimka jde označit komentářem `i18n-ignore`.
- Nový příkaz: přidat do `src/commands.ts` (CommandId + DEFINITIONS), handler do `App.tsx`, texty do obou slovníků.
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

## Vydání
- Verze v `package.json`, `src-tauri/Cargo.toml` (+ `Cargo.lock`, `package-lock.json`), záznam do `CHANGELOG.md`, commit „Release X.Y.Z“.
- `npm run tauri build`, pak přegeneruj download tlačítka: `node scripts/docs-media/buttons.mjs` (verze z `package.json`, velikost z `Finder-Win_<verze>_x64-setup.exe` v `bundle/nsis/`) a commitni `docs/buttons/`.
- Microsoft Store: `scripts/build-msix.ps1` (Windows SDK) → nepodepsaný `bundle/msix/Finder-Win_<verze>.0_x64.msix`, `-TestSign` jen pro lokální test (WACK), nikdy do Storu. Store build = `FINDERWIN_STORE=1` (`__STORE__` ve frontendu) + Cargo feature `store` + `tauri.store.conf.json` (CSP bez GitHubu), vlastní `CARGO_TARGET_DIR` `target/store`; bez kontroly aktualizací a bez jakýchkoli síťových požadavků. Texty listingu `docs/store-listing.md`, zásady `PRIVACY.md` (URL v Partner Center míří na master).
- Store verze má vlastní data: identifier `com.krystof2ops.finderwin.store` (settings.json, WebView2) a cache `%LOCALAPPDATA%\finder-win-store` (`CACHE_DIR`), aby se nesdílela s NSIS verzí a odinstalace MSIX je smazala. Při prvním startu (vlastní settings.json chybí) převezme settings.json z NSIS verze (`import_nsis_settings`, NSIS soubor jen čte).
- Ochranná známka: v textech pro Store nepoužívat „Finder“ / „macOS Finder“ (jen „Mac-style“, „inspired by macOS“). Pokud certifikace odmítne název kvůli ochranné známce, přejmenuje se jen Store verze (DisplayName v `build-msix.ps1` + listing); GitHub/NSIS zůstane Finder-Win.

## Screenshoty a demo
- `docs/screenshots/{hero-dark,hero-light,split-view,command-palette,previews}.png` (1280×800, ~100–140 kB) a `docs/demo.gif` (960 px, 15 fps, ~14 s, max 8 MB); používají je oba README.
- Demo data v `docs/demo` – složka je v `.gitignore`, existuje jen lokálně (`Animace.gif` je netrackovaný, nekopírovat). Generování běží nad kopií v `C:\Demo` (cesty bez jména uživatele).
- Skripty `scripts/docs-media/`: `cdp.mjs` (CDP klient, port 9333), `setup.mjs` (patch IPC `get_favorites` → složky na `C:\Demo`, reset záložek/tématu/jazyka, viewport 1280×800), `shots.mjs` (5 scén, argumentem jedna scéna), `demo.mjs` (screencast + ffmpeg palettegen → `docs/demo.gif`), `mksettings.mjs` (demo `settings.json`), `demo-conf.json` (identifier `….demo`), `buttons.mjs` (SVG tlačítka `docs/buttons/download{,-cs}.svg`, text jako křivky z Inter přes `opentype.js`).
- Postup: 1) zkopírovat `docs/demo/{Documents,Downloads,Music,Photos,Projects,Videos}` do `C:\Demo`; 2) `node scripts/docs-media/mksettings.mjs` (aplikace nesmí běžet); 3) `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333 npm run tauri dev -- --config scripts/docs-media/demo-conf.json` (jiný identifier, skutečné nastavení se nedotkne); 4) `node scripts/docs-media/shots.mjs` a `node scripts/docs-media/demo.mjs` (před demem smazat `C:\Demo\Projects\meeting-notes.md`, F5 ho tam kopíruje); 5) uklidit `C:\Demo`, `%APPDATA%` a `%LOCALAPPDATA%\com.krystof2ops.finderwin.demo`, ukončit dev i osiřelý vite.
- ffmpeg: `winget install Gyan.FFmpeg`; alias je v `%LOCALAPPDATA%\Microsoft\WinGet\Links`, v Git Bash nemusí být v PATH.
- Pasti: `__TAURI_INTERNALS__.invoke` je non-writable → patchuje se `window.fetch` na `http://ipc.localhost/<cmd>`; `addScriptToEvaluateOnNewDocument` i `Emulation` platí jen po dobu jedné CDP session; store drží Rust v paměti, změna `settings.json` na disku se projeví až po restartu aplikace.

## Známé pasti
- `dragDropEnabled` v `tauri.conf.json` musí zůstat `false` – jinak WebView2 vypne HTML5 drag & drop a interní tažení přestane fungovat. Drop zvenku jde přes `postMessageWithAdditionalObjects` (`dnd.ts` → `external_drop.rs`).
- Zprávy do `WebMessageReceived` (`chrome.webview.postMessage*`) posílat jen jako řetězce (`finderWinDrop:<id>`). wry má svůj handler první a u neřetězcové zprávy vrátí chybu – WebView2 (runtime 154+) pak další handlery nezavolá a drop z Průzkumníku tiše selže. Každý drop proto v konzoli webview zanechá jeden `console.error` z Tauri IPC (cizí zpráva), je neškodný.
- Tažení ven z aplikace není (tauri-plugin-drag by kolidoval s HTML5 dragem).
- Záložky: živý je jen stav aktivní záložky, ostatní jsou `TabSnapshot`; watcher (`watch_dirs`) běží jen pro aktivní. Na disk se ukládají jen při 2+ záložkách (cesta, zobrazení, řazení).
- Aplikace je GUI bez konzole: cmd/PowerShell se nesmí spouštět přes `Command::spawn` (prázdný stdin, hned skončí) – jde to přes ShellExecuteW (`shell_execute` v `main.rs`).
- Ikony a náhledy se cachují na disku v `%LOCALAPPDATA%\finder-win\{icons,thumbnails}` (Store build `finder-win-store`, `CACHE_DIR`); timeout shellu u náhledu se v paměti necachuje.
- Nastavení `theme` a `terminal` jsou v settings.json.
- Při změně `nsis.languages` musí mít jazyk mimo seznam Tauri vlastní `.nsh` (Tauri 2.11 češtinu nemá).
- Python na tomhle stroji není – skripty přes node.
- Osiřelý vite po ukončení `tauri dev` drží port 1420.
- Pokud běží `finder-win.exe`, build přepisující binárku selže – použít jiný `CARGO_TARGET_DIR`.
- CSP `connect-src` povoluje navíc jen `api.github.com`.

## Co nedělat
- Nepřidávat telemetrii ani další síťové požadavky (jediný je denní GET na GitHub API).
- Nepushovat a netagovat bez pokynu.
- Nové nativní závislosti nebo >150 řádků Rustu jen po schválení plánu uživatelem.
