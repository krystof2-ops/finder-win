# Finder-Win

[![Download](https://img.shields.io/github/v/release/krystof2-ops/finder-win?label=Download%20for%20Windows&style=for-the-badge)](https://github.com/krystof2-ops/finder-win/releases/latest) ![Downloads](https://img.shields.io/github/downloads/krystof2-ops/finder-win/total?style=for-the-badge) ![License](https://img.shields.io/github/license/krystof2-ops/finder-win?style=for-the-badge)

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
  - **custom favorites** – drag folders or files onto the sidebar to add them, drag to reorder, right-click to rename or remove; saved between sessions,
  - **Recents** – recently opened items with relative times,
  - **Tags** – colors that are in use, with item counts,
  - collapsible sections.
- **Selection** – Ctrl+click, Shift+click, Shift+arrow keys and rubber-band selection by dragging in empty space (in every view).
- **Drag & drop inside the app** – drag items onto a folder to move them (hold Ctrl to copy); drag onto the sidebar to add favorites.
- **Name conflicts** – when pasting or dropping, a dialog offers *Replace* (folders are merged), *Keep both* or *Skip*, with *Apply to all*.
- **Quick Look** (Space) – preview images, PDF, video, audio, text/source code and rendered Markdown; ←/→ to step through files.
- **File operations** – rename inline, duplicate, new folder / new file, move to Recycle Bin (asks first on drives without one), copy / cut / paste within the app, Open with…, open in Explorer, open in Windows Terminal, copy path / name, properties with folder size.
- **Toolbar** – Sort (by name, date, size, kind), Share (copy path, open in Explorer), Tags for the whole selection.
- **Context menus** on files, empty space, sidebar items, status bar and Quick Look, also keyboard-navigable.
- **Color tags** – 7 Finder colors; tags follow files when they are renamed or moved inside the app.
- **Search** – typing filters the current folder; Enter runs a recursive search by file name (cancelled by Esc).
- **Hidden files** – follows the Explorer setting, toggle with Ctrl+Shift+.
- **Live updates** – the folder listing refreshes by itself when files change on disk.
- **Light and dark mode**, smooth macOS-like animations (disabled when Windows "reduce motion" is on), works offline.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `↑` `↓` `←` `→` | Move the selection (Icons follow the grid, Columns move between columns) |
| `Shift` + arrows / click | Extend the selection |
| `Ctrl` + click | Add / remove an item from the selection |
| `Home` / `End`, `PgUp` / `PgDn` | First / last item, page up / down |
| Typing letters | Jump to the item whose name starts with them |
| `Enter` / `Ctrl+↓` | Open selected item |
| `Space` | Quick Look |
| `Backspace` / `Alt+←` | Back |
| `Alt+→` | Forward |
| `Alt+↑` / `Ctrl+↑` | Go to parent folder |
| `Ctrl+L` | Edit path |
| `Ctrl+F` | Focus search field (`Enter` = recursive search, `↓` = into results, `Esc` = clear) |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / cut / paste |
| `Ctrl+D` | Duplicate |
| `Ctrl+A` | Select all (not in Column view) |
| `Ctrl+Shift+N` | New folder |
| `F2` | Rename |
| `Delete` | Move to Recycle Bin |
| `Ctrl+R` / `F5` | Refresh |
| `Ctrl+Shift+.` | Show / hide hidden files |
| `Esc` | Clear selection; close search results; close menus and dialogs |
| `←` / `→`, `Esc` | Previous / next file, close (in Quick Look) |
| Mouse button 4 / 5 | Back / forward |

## Install

Download the latest `Finder-Win_…_x64-setup.exe` from the [Releases](https://github.com/krystof2-ops/finder-win/releases/latest) page and run it. It installs for the current user only, no administrator rights needed.

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
npm run tauri build   # build the installer
```

The installer is written to `src-tauri/target/release/bundle/nsis/`.

## Known limitations

- **UI is Czech only**, no localization yet.
- **Windows only.**
- **No Undo** – deletions go to the Recycle Bin, but renames, moves and replacements can't be undone from the app.
- **No Windows clipboard for files** – copy / cut / paste works only inside the app; you can't paste files into Explorer or from it. "Copy path" does use the system clipboard.
- **No dragging to or from Windows Explorer** – drag & drop works only inside the app.
- **No shell icons** – `.lnk`, `.exe` and other files show a generic icon by type, not the icon Windows shows. No image thumbnails either.
- **Phones and cameras** (iPhone, Android — MTP devices) are listed, but clicking them opens Windows Explorer; they can't be browsed inside the app.
- Recursive search matches **file names only**, stops at **500 results** and skips `.git`, `node_modules` and Rust `target` folders (only those next to a `Cargo.toml`).
- No tabs or multiple windows.
- The installer is **not code-signed** (see SmartScreen above).

## Changelog

### 1.1.0

- **Audit fixes** – selection and navigation logic, safer file operations, security and configuration hardening.
- **Multi-select and keyboard navigation** – Ctrl/Shift selection, arrow keys across all views, Sort, Share and Tags buttons in the toolbar.
- **Collision dialog** – paste and move ask what to do when a file with the same name already exists (replace, keep both, skip).
- **New design with shell icons** – real Windows file icons, Sonoma-style folders, image thumbnails, reworked toolbar, sidebar, views and dialogs, WCAG AA contrast in both themes.
- **Animations and virtualization** – virtualized listings with streamed directory loading, jump-free navigation, micro-interactions, smoother scrolling and `prefers-reduced-motion` support.

## License

[MIT](LICENSE)
