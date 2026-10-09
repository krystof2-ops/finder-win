<div align="center">

<img src="src-tauri/icons/128x128.png" width="96" height="96" alt="Finder-Win icon">

# Finder-Win

**The macOS Finder experience, on Windows.**

**English** · [Čeština](README.cs.md)

[![Latest release](https://img.shields.io/github/v/release/krystof2-ops/finder-win)](https://github.com/krystof2-ops/finder-win/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/krystof2-ops/finder-win/total)](https://github.com/krystof2-ops/finder-win/releases)
[![License](https://img.shields.io/github/license/krystof2-ops/finder-win)](LICENSE)
![Windows 10/11](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?logo=windows)

<p align="center"><a href="https://github.com/krystof2-ops/finder-win/releases/latest"><img src="docs/buttons/download.svg" alt="Download for Windows" height="68"></a></p>

or: `winget install krystof2-ops.FinderWin` *(coming soon)*

<img src="docs/demo.gif" width="960" alt="Finder-Win demo: new tab, split view, F5 copy to the other panel, command palette">

</div>

## Why Finder-Win?

- **Column view** – Miller columns with a preview pane, the way Finder browses deep folder trees. File Explorer has nothing like it.
- **Keyboard first** – Ctrl+K opens a command palette for folders, actions and tags; Space opens Quick Look.
- **Two panels in one window** – split view with F5 / F6 copy and move, without a second Explorer window.
- **Small and local** – an installer under 3 MB (Tauri: Rust + WebView2), installs per user without admin rights, no account and no telemetry.

## Features

### Browse like in Finder

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/hero-light.png">
  <img src="docs/screenshots/hero-dark.png" alt="Icons view with image and video thumbnails and three tabs">
</picture>

- **Icons, List and Columns** views; thumbnails for images, videos (with a ▶ badge) and PDFs.
- **Tabs** – rounded chips, each with its own history, view, sorting and selection; drag to reorder, drop files on a tab to move them there.
- **Light and dark mode** following Windows, or set it in More → Appearance. English and Czech UI.

### Split view

![Split view: Column view on the left, List view on the right](docs/screenshots/split-view.png)

- **Ctrl+Shift+D** splits the window into two independent panels; `Tab` switches between them.
- **F5 / F6** copy or move the selection to the other panel, like in Total Commander.
- Drag the divider to resize (double-click = 1:1); the ratio is remembered.

### Command palette

![Command palette with "dow" typed](docs/screenshots/command-palette.png)

- **Ctrl+K** searches folders (favorites, recents, tabs, subfolders), actions and tags.
- Type `~` or a path to go there directly; **Ctrl+Enter** searches files in the current folder.
- Actions show their keyboard shortcut, and the commands you use most come first.

### Previews and Quick Look

![Column view with a video preview, duration and resolution](docs/screenshots/previews.png)

- The preview column shows a thumbnail plus **duration and resolution** for videos, dimensions for images and page count for PDFs.
- **Space** opens Quick Look for images, PDF, video, audio, text and source code, and rendered Markdown; ←/→ steps through files.
- Thumbnails and icons are cached locally in `%LOCALAPPDATA%\finder-win`.

### Everyday file work

- **Real Windows clipboard** – Ctrl+C / Ctrl+X / Ctrl+V work with Explorer, Outlook and browsers.
- **Drag & drop both ways** – drop files in from Explorer or the desktop; drag them out to Explorer, the desktop, a browser upload, Discord or an e-mail. Copy by default, `Shift` moves.
- **+ New button** in the toolbar – Folder, Text Document and every file type from Windows' New menu (Word, Excel, ZIP …); also in the context menu (New ▸) and the command palette. Name collisions get “(2)” like in Explorer.
- **Terminals** – PowerShell 7 and Windows PowerShell are listed separately in More → Terminal; `Shift`+click Open in Terminal picks any installed terminal.
- **Undo / Redo** (Ctrl+Z / Ctrl+Y) for the last 50 renames, moves, copies, new items, deletions and tag changes.
- **Sidebar** with standard folders, all drives (updates when a USB drive is plugged in), custom favorites, recents and Finder-style color tags.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close tab |
| `Ctrl+K` | Command palette (`Ctrl+Enter` = search files) |
| `Ctrl+Shift+D` | Split window into two panels |
| `F5` / `F6` | Copy / move selection to the other panel (split view) |
| `Space` | Quick Look |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |

<details>
<summary>All shortcuts</summary>

| Shortcut | Action |
|---|---|
| `↑` `↓` `←` `→` | Move the selection (Icons follow the grid, Columns move between columns) |
| `Shift` + arrows / click | Extend the selection |
| `Ctrl` + click | Add / remove an item from the selection |
| `Home` / `End`, `PgUp` / `PgDn` | First / last item, page up / down |
| Typing letters | Jump to the item whose name starts with them |
| `Enter` / `Ctrl+↓` | Open selected item |
| `Backspace` / `Alt+←` | Back |
| `Alt+→` | Forward |
| `Alt+↑` / `Ctrl+↑` | Go to parent folder |
| `Ctrl+L` | Edit path |
| `Ctrl+F` | Focus search field (`Enter` = recursive search, `↓` = into results, `Esc` = clear) |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / cut / paste (Windows clipboard) |
| `Ctrl+Shift+Z` | Redo |
| `Tab` | Switch active panel (split view) |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+1` … `Ctrl+9` | Go to tab 1–8 / the last tab |
| `Ctrl+D` | Duplicate |
| `Ctrl+A` | Select all (not in Column view) |
| `Ctrl+Shift+N` | New folder |
| `F2` | Rename |
| `Delete` | Move to Recycle Bin |
| `Ctrl+R` / `F5` | Refresh (`F5` outside split view) |
| `Ctrl+Shift+.` | Show / hide hidden files |
| `Esc` | Clear selection; close search results; close menus and dialogs |
| `←` / `→`, `Esc` | Previous / next file, close (in Quick Look) |
| Mouse button 4 / 5 | Back / forward |
| Middle click on a folder / tab | Open in a new tab / close the tab |

</details>

## Install

1. Download `Finder-Win_…_x64-setup.exe` from the [latest release](https://github.com/krystof2-ops/finder-win/releases/latest) and run it. It installs for the current user only; no administrator rights needed.
2. The installer is not code-signed, so Windows SmartScreen shows *"Windows protected your PC"*. Click **More info** → **Run anyway**.

Also coming: **winget** (`winget install krystof2-ops.FinderWin`; the manifest is in [`winget/`](winget)) and **Microsoft Store**.

<details>
<summary>Known limitations</summary>

- Windows only.
- Undo history lives only while the app runs. A file overwritten by *Replace* can't be brought back.
- Phones and cameras (MTP) are listed, but open in Windows Explorer.
- Recursive search matches file names only and stops at 500 results.
- Tabs, but no multiple windows.

</details>

## Privacy

Finder-Win makes exactly one kind of network request: at most once a day it asks the GitHub API (`api.github.com/repos/krystof2-ops/finder-win/releases/latest`) whether a newer version exists and, if so, shows a small bar with a link to the release page. No telemetry, nothing about you or your files is sent. Turn the check off in More → Check for Updates.

## Build from source

Prerequisites: [Node.js](https://nodejs.org/) 20+, [Rust](https://rustup.rs/) (stable), [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) ("Desktop development with C++") and WebView2 (preinstalled on Windows 10/11).

```powershell
npm install
npm run tauri dev     # run in development mode
npm run tauri build   # build the installer → src-tauri/target/release/bundle/nsis/
```

## Contributing

Bug reports and pull requests are welcome in [Issues](https://github.com/krystof2-ops/finder-win/issues). Before a PR, run `npm run build` and, in `src-tauri`, `cargo clippy -- -D warnings` and `cargo test`. UI texts go through the translation files in `src/i18n/` (English and Czech). Security issues: see [SECURITY.md](SECURITY.md).

Release notes are in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
