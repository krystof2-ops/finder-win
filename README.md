# Finder-Win

**English** · [Čeština](README.cs.md)

A macOS Finder-like file explorer for Windows, built with Tauri 2, React and Rust.

> **Note:** the user interface is currently in Czech only.

## Screenshots

![Column view](docs/screenshots/main-column-view.png)
![Quick Look](docs/screenshots/quick-look.png)
![Light mode](docs/screenshots/light-mode.png)

## Features

- **Three view modes** – Icons, List (sortable columns, striped rows) and Columns (Miller columns with an info panel for the selected file).
- **macOS-style window** – custom title bar with traffic-light buttons, rounded corners, thin scrollbars.
- **Sidebar**
  - standard folders (Desktop, Downloads, Documents, Pictures, Music, Videos, Home), OneDrive / iCloud Drive when present,
  - **all connected drives** (USB drives get their own icon) and phones / cameras; the list updates as soon as a device is plugged in or removed,
  - **custom favorites** – drag any folder onto the sidebar to add it, drag to reorder, right-click to rename or remove; saved between sessions,
  - **Recents** – recently opened items with relative times,
  - **Tags** – colors that are in use, with item counts.
- **Quick Look** (Space) – preview images, PDF, video, audio, text/source code and rendered Markdown; ←/→ to step through files.
- **File operations** – rename inline, duplicate, move to Recycle Bin, copy / cut / paste within the app, new folder, Open with…, open in Explorer, open in Windows Terminal, copy path / name, properties.
- **Context menus** on files, empty space and sidebar items, including multi-selection ("Delete 5 items").
- **Color tags** – 7 Finder colors; click a tag in the sidebar to see every file with that color.
- **Search** – typing filters the current folder; Enter runs a recursive search by file name.
- **Navigation** – back / forward history (also mouse buttons 4 / 5), path bar with breadcrumbs and editable path (Ctrl+L), free disk space in the status bar.
- **Light and dark mode**, smooth macOS-like animations (disabled when Windows "reduce motion" is on).

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+↑` | Go to parent folder |
| `Ctrl+↓` / `Enter` | Open selected item |
| `Space` | Quick Look |
| `Ctrl+L` | Edit path |
| `Ctrl+F` | Focus search field (`Enter` = recursive search, `Esc` = clear) |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / cut / paste |
| `Ctrl+D` | Duplicate |
| `Ctrl+A` | Select all (not in Column view) |
| `Ctrl+Shift+N` | New folder |
| `F2` | Rename |
| `Delete` | Move to Recycle Bin |
| `Ctrl+R` / `F5` | Refresh |
| `Ctrl+Shift+.` | Show / hide hidden files (follows the Explorer setting until changed) |
| `Esc` | Clear selection; close search results |
| `↑` `↓` `←` `→` `Home` `End` | Move within Column view |
| `←` / `→`, `Esc` | Previous / next file, close (in Quick Look) |
| Mouse button 4 / 5 | Back / forward |

## Install

Download the latest `Finder-Win_…_x64-setup.exe` from the [Releases](https://github.com/OWNER/finder-win/releases/latest) page and run it. It installs for the current user only, no administrator rights needed.

### Windows SmartScreen warning

The installer is not code-signed, so Windows SmartScreen will show *"Windows protected your PC"*. To install anyway, click **More info** and then **Run anyway**.

## Build from source

Prerequisites:

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) (stable)
- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) ("Desktop development with C++")
- WebView2 (preinstalled on Windows 10/11)

```powershell
npm install
npm run tauri dev     # run in development mode
npm run tauri build   # build installers
```

The installer is written to `src-tauri/target/release/bundle/nsis/`.

## Known limitations

- **UI is Czech only**, no localization yet.
- **Windows only.**
- **No drag & drop of files** between folders or from Windows Explorer. Dragging currently only adds folders to the sidebar.
- **Copy / cut / paste works only inside the app**, not through the system clipboard (you can't paste into Explorer). "Copy path" does use the system clipboard.
- The **Sort, Share and Tags buttons in the toolbar do nothing yet**. Sorting works through the List view column headers.
- **Phones and cameras** (iPhone, Android — MTP devices) are listed, but clicking them opens Windows Explorer; they can't be browsed inside the app.
- **No image thumbnails**, files show a type icon.
- Recursive search matches **file names only**, stops at **500 results** and skips `.git`, `node_modules` and Rust `target` folders (only those next to a `Cargo.toml`).
- No tabs or multiple windows.
- The installer is **not code-signed** (see SmartScreen above).

## License

[MIT](LICENSE)
