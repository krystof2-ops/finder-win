# Changelog

Notable changes in each Finder-Win release. Installers are on the [Releases](https://github.com/krystof2-ops/finder-win/releases) page.

## [1.4.2](https://github.com/krystof2-ops/finder-win/releases/tag/v1.4.2) – 2026-10-09

- **Drag out of the app** – drag files and folders from Finder-Win to File Explorer, the desktop, a browser upload, Discord or an e-mail. Copy by default, Shift moves. Drag & drop now works both ways.
- **New button** – **+ New** in the toolbar, like File Explorer: Folder, Text Document and every file type Windows offers in New (Word, Excel, ZIP …); also in the context menu (New ▸) and the command palette.
- **Rounded tabs** – each tab is a rounded chip; the active one is highlighted without blending into the content.
- **Terminals** – More → Terminal lists PowerShell 7 and Windows PowerShell separately; unavailable ones are greyed out. Shift+click Open in Terminal picks any installed terminal.
- **Names like File Explorer** – new items that collide get “(2)”, e.g. “New folder (2)”.

## [1.4.1](https://github.com/krystof2-ops/finder-win/releases/tag/v1.4.1) – 2026-10-09

- **Fixed:** drag & drop from File Explorer did not work.

## [1.4.0](https://github.com/krystof2-ops/finder-win/releases/tag/v1.4.0) – 2026-10-07

- **Split window** – two independent panels (Ctrl+Shift+D), Tab switches, F5 / F6 copy / move to the other panel, draggable divider with a remembered ratio.
- **Command palette** – Ctrl+K: folders, actions, tags, paths, Ctrl+Enter file search; one command registry drives shortcuts, the More menu, toolbar and palette.
- **Video and PDF thumbnails** – in Icons view and the preview column, plus duration, resolution and page count; cached locally on disk.
- **Terminal choice** – More → Terminal: Automatic, Windows Terminal, PowerShell, Command Prompt.
- **Explorer-style tabs** – tab bar always visible, content-sized tabs, **+** right after the last tab, × on hover.
- **Appearance menu** – Light · Dark · Match System (default, follows Windows live); lower title bar (32 px).
- **Czech installer** – language choice during setup.

## 1.3.0 – 2026-10-07

- **Tabs** – Ctrl+T / Ctrl+W / Ctrl+Tab / Ctrl+1…9, middle-click and *Open in New Tab*; each tab has its own history, view, sorting, selection, columns and search; reorder by dragging, drop files on a tab, restored on start (folder, view and sorting).
- **Windows clipboard** – copy / cut / paste files between Finder-Win, Explorer, Outlook and browsers (CF_HDROP).
- **Drag & drop from Explorer** – drop files from Explorer or the desktop onto a folder, a sidebar item, a tab or empty space.
- **Undo / Redo** – rename, move, copy, new item, delete (from the Recycle Bin) and tags, last 50 operations.
- **winget manifest** and an opt-out update check (one GET to the GitHub API per day, no telemetry).

## [1.2.1](https://github.com/krystof2-ops/finder-win/releases/tag/v1.2.1) – 2026-10-04

- **New app icon.**

## [1.2.0](https://github.com/krystof2-ops/finder-win/releases/tag/v1.2.0) – 2026-10-02

- **English UI, language switcher, localized dates, sizes and plurals** – the app follows your Windows language (English or Czech) and can be switched in More → Language / Jazyk without a restart.

## [1.1.0](https://github.com/krystof2-ops/finder-win/releases/tag/v1.1.0) – 2026-10-01

- **Audit fixes** – selection and navigation logic, safer file operations, security and configuration hardening.
- **Multi-select and keyboard navigation** – Ctrl/Shift selection, arrow keys across all views, Sort, Share and Tags buttons in the toolbar.
- **Collision dialog** – paste and move ask what to do when a file with the same name already exists (replace, keep both, skip).
- **New design with shell icons** – real Windows file icons, Sonoma-style folders, image thumbnails, reworked toolbar, sidebar, views and dialogs, WCAG AA contrast in both themes.
- **Animations and virtualization** – virtualized listings with streamed directory loading, jump-free navigation, micro-interactions, smoother scrolling and `prefers-reduced-motion` support.

## [1.0.0](https://github.com/krystof2-ops/finder-win/releases/tag/v1.0.0) – 2026-09-28

- First public release.
