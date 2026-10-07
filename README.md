# Finder-Win

[![Download](https://img.shields.io/github/v/release/krystof2-ops/finder-win?label=Download%20for%20Windows&style=for-the-badge)](https://github.com/krystof2-ops/finder-win/releases/latest) ![Downloads](https://img.shields.io/github/downloads/krystof2-ops/finder-win/total?style=for-the-badge) ![License](https://img.shields.io/github/license/krystof2-ops/finder-win?style=for-the-badge)

![Finder-Win demo](docs/demo.gif)

**English** · [Čeština](README.cs.md)

A macOS Finder-like file explorer for Windows, built with Tauri 2, React and Rust.

## Screenshots

![Column view](docs/screenshots/main-column-view.png)
![Quick Look](docs/screenshots/quick-look.png)
![Light mode](docs/screenshots/light-mode.png)

## Features

- **Three view modes** – Icons, List (sortable columns, striped rows) and Columns (Miller columns with an info panel for the selected file).
- **Tabs** – Ctrl+T opens the current folder in a new tab, middle-click or *Open in New Tab* opens a folder; each tab keeps its own history, view, sorting, selection and search. Drag tabs to reorder, drop files on a tab to move them there; tabs are restored on the next start.
- **macOS-style window** – custom title bar with traffic-light buttons, rounded corners, thin scrollbars.
- **Sidebar**
  - standard folders (Desktop, Downloads, Documents, Pictures, Music, Videos, Home), OneDrive / iCloud Drive when present,
  - **all connected drives** (USB drives get their own icon) and phones / cameras; the list updates as soon as a device is plugged in or removed,
  - **custom favorites** – drag folders or files onto the sidebar to add them, drag to reorder, right-click to rename or remove; saved between sessions,
  - **Recents** – recently opened items with relative times,
  - **Tags** – colors that are in use, with item counts,
  - collapsible sections.
- **Selection** – Ctrl+click, Shift+click, Shift+arrow keys and rubber-band selection by dragging in empty space (in every view).
- **Drag & drop** – drag items onto a folder, a sidebar location or a tab to move them (hold Ctrl to copy); drag onto *My Favorites* to add favorites. Files dragged in from Explorer or the desktop land in the folder under the cursor, or in the current folder.
- **Windows clipboard** – Ctrl+C / Ctrl+X put real files on the clipboard: paste them in Explorer, attach them in Outlook or a web mail, or paste files copied in Explorer into Finder-Win. Cut files are moved and the clipboard is cleared, like in Explorer.
- **Undo / Redo** – Ctrl+Z / Ctrl+Shift+Z for the last 50 renames, moves, copies, new items, deletions (restored from the Recycle Bin) and tag changes; More shows what will be undone.
- **Name conflicts** – when pasting or dropping, a dialog offers *Replace* (folders are merged), *Keep both* or *Skip*, with *Apply to all*.
- **Quick Look** (Space) – preview images, PDF, video, audio, text/source code and rendered Markdown; ←/→ to step through files.
- **File operations** – rename inline, duplicate, new folder / new file, move to Recycle Bin (asks first on drives without one), copy / cut / paste, Open with…, open in Explorer, open in Windows Terminal, copy path / name, properties with folder size.
- **Toolbar** – Sort (by name, date, size, kind), Share (copy path, copy files, open in Explorer), Tags for the whole selection.
- **Context menus** on files, empty space, sidebar items, status bar and Quick Look, also keyboard-navigable.
- **Color tags** – 7 Finder colors; tags follow files when they are renamed or moved inside the app.
- **Search** – typing filters the current folder; Enter runs a recursive search by file name (cancelled by Esc).
- **Hidden files** – follows the Explorer setting, toggle with Ctrl+Shift+.
- **Live updates** – the folder listing refreshes by itself when files change on disk.
- **Light and dark mode**, smooth macOS-like animations (disabled when Windows "reduce motion" is on), works offline.
- **English and Czech UI, follows your Windows language** – switch any time in More → Language / Jazyk.
- **Install with winget** and an optional once-a-day update check (see below).

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
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / cut / paste (Windows clipboard) |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Ctrl+T` / `Ctrl+W` | New tab / close tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+1` … `Ctrl+9` | Go to tab 1–8 / the last tab |
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
| Middle click on a folder / tab | Open in a new tab / close the tab |

## Install

Download the latest `Finder-Win_…_x64-setup.exe` from the [Releases](https://github.com/krystof2-ops/finder-win/releases/latest) page and run it. It installs for the current user only, no administrator rights needed.

### Windows SmartScreen warning

The installer is not code-signed, so Windows SmartScreen will show *"Windows protected your PC"*. To install anyway, click **More info** and then **Run anyway**.

### winget

```powershell
winget install krystof2-ops.FinderWin
```

The manifest lives in [`winget/`](winget) (format 1.6). After a release is published, the *Update winget manifest* workflow downloads the installer, recomputes its SHA256 and opens a pull request in this repository (allow *Settings → Actions → General → Allow GitHub Actions to create and approve pull requests* for that). Submitting to [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) is a manual step, either with [wingetcreate](https://github.com/microsoft/winget-create):

```powershell
wingetcreate submit --token <GITHUB_PAT> winget
```

or by a pull request that copies the three files to `manifests/k/krystof2-ops/FinderWin/<version>/` in winget-pkgs (validate first with `winget validate winget`).

### Update check

Once a day at most, the app asks `https://api.github.com/repos/krystof2-ops/finder-win/releases/latest` whether a newer version exists and, if so, shows a small bar at the bottom with a link to the release page. That single GET is the only network request the app makes — no telemetry, nothing is sent. Turn it off in More → Check for Updates.

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

- **Windows only.**
- **Undo history is not saved** – it lives only while the app runs (last 50 operations). A file overwritten by *Replace* can't be brought back, and undoing a copy or a new item on a drive without a Recycle Bin is refused rather than deleting permanently.
- **No dragging out of the app** – files can be dragged *into* Finder-Win from Explorer, but not from Finder-Win to Explorer, the desktop or other apps. Use Ctrl+C and paste there instead.
- **Phones and cameras** (iPhone, Android — MTP devices) are listed, but clicking them opens Windows Explorer; they can't be browsed inside the app.
- Recursive search matches **file names only**, stops at **500 results** and skips `.git`, `node_modules` and Rust `target` folders (only those next to a `Cargo.toml`).
- Tabs, but no multiple windows.
- The installer is **not code-signed** (see SmartScreen above).

## Changelog

### 1.3.0

- **Tabs** – Ctrl+T / Ctrl+W / Ctrl+Tab / Ctrl+1…9, middle-click and *Open in New Tab*; each tab has its own history, view, sorting, selection, columns and search; reorder by dragging, drop files on a tab, restored on start.
- **Windows clipboard** – copy / cut / paste files between Finder-Win, Explorer, Outlook and browsers (CF_HDROP).
- **Drag & drop from Explorer** – drop files from Explorer or the desktop onto a folder, a sidebar item, a tab or empty space.
- **Undo / Redo** – rename, move, copy, new item, delete (from the Recycle Bin) and tags, last 50 operations.
- **winget manifest** and an opt-out update check (one GET to the GitHub API per day, no telemetry).

### 1.2.0

- **English UI, language switcher, localized dates, sizes and plurals** – the app follows your Windows language (English or Czech) and can be switched in More → Language / Jazyk without a restart.

### 1.1.0

- **Audit fixes** – selection and navigation logic, safer file operations, security and configuration hardening.
- **Multi-select and keyboard navigation** – Ctrl/Shift selection, arrow keys across all views, Sort, Share and Tags buttons in the toolbar.
- **Collision dialog** – paste and move ask what to do when a file with the same name already exists (replace, keep both, skip).
- **New design with shell icons** – real Windows file icons, Sonoma-style folders, image thumbnails, reworked toolbar, sidebar, views and dialogs, WCAG AA contrast in both themes.
- **Animations and virtualization** – virtualized listings with streamed directory loading, jump-free navigation, micro-interactions, smoother scrolling and `prefers-reduced-motion` support.

## License

[MIT](LICENSE)
