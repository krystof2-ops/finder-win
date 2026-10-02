import type { cs } from "./cs";

/** Plurál v angličtině: one = 1, other = všechno ostatní (Intl.PluralRules("en")). */
type EnPlural = { one: string; other: string };

/** Každý klíč z cs.ts — chybějící nebo navíc shodí build; plurál zůstává plurálem. */
type Dictionary = { [K in keyof typeof cs]: (typeof cs)[K] extends string ? string : EnPlural };

export const en = {
  /* ---------------------------------- common ---------------------------------- */
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.open": "Open",
  "common.loading": "Loading…",

  "items.count": { one: "{count} item", other: "{count} items" },

  /* ----------------------------------- view ----------------------------------- */
  "view.icons": "Icons",
  "view.list": "List",
  "view.columns": "Columns",

  "sort.name": "Name",
  "sort.modified": "Date Modified",
  "sort.size": "Size",
  "sort.kind": "Kind",
  "sort.ascending": "Ascending",
  "sort.descending": "Descending",

  /* ---------------------------------- toolbar --------------------------------- */
  "toolbar.back": "Back",
  "toolbar.forward": "Forward",
  "toolbar.view": "View",
  "toolbar.viewAsIcons": "View as Icons",
  "toolbar.viewAsList": "View as List",
  "toolbar.viewAsColumns": "View as Columns",
  "toolbar.sort": "Sort",
  "toolbar.share": "Share",
  "toolbar.tags": "Tags",
  "toolbar.tagsUnavailable": "Select a file",
  "toolbar.more": "More",
  "toolbar.lightMode": "Light Mode",
  "toolbar.darkMode": "Dark Mode",
  "toolbar.search": "Search",
  "toolbar.clearSearch": "Clear Search",
  "toolbar.searchResults": "Search Results",
  "toolbar.parentFolder": "Parent Folder",
  "toolbar.showHidden": "Show Hidden Files",
  "toolbar.animations": "Animations",
  "toolbar.about": "About Finder-Win",

  "motion.system": "Use System Setting",
  "motion.on": "On",
  "motion.off": "Off",

  /* ----------------------------------- menu ----------------------------------- */
  "menu.open": "Open",
  "menu.openWith": "Open With…",
  "menu.openInExplorer": "Open in File Explorer",
  "menu.openInTerminal": "Open in Terminal",
  "menu.showInFolder": "Show in Folder",
  "menu.quickLook": "Quick Look",
  "menu.newFolder": "New Folder",
  "menu.newFile": "New File",
  "menu.rename": "Rename",
  "menu.duplicate": "Duplicate",
  "menu.copy": "Copy",
  "menu.copyCount": { one: "Copy {count} Item", other: "Copy {count} Items" },
  "menu.cut": "Cut",
  "menu.cutCount": { one: "Cut {count} Item", other: "Cut {count} Items" },
  "menu.paste": "Paste",
  "menu.copyPath": "Copy Path",
  "menu.copyPaths": "Copy Paths",
  "menu.copyCurrentPath": "Copy Path of Current Folder",
  "menu.copyName": "Copy Name",
  "menu.copyNames": "Copy Names",
  "menu.copyFiles": "Copy Files to Clipboard",
  "menu.editPath": "Edit Path",
  "menu.delete": "Delete",
  "menu.deleteCount": { one: "Delete {count} Item", other: "Delete {count} Items" },
  "menu.tags": "Tags",
  "menu.removeTags": "Remove Tags",
  "menu.properties": "Properties",
  "menu.folderProperties": "Folder Properties",
  "menu.view": "View",
  "menu.hiddenFiles": "Hidden Files",
  "menu.sortBy": "Sort By",
  "menu.selectAll": "Select All",
  "menu.refresh": "Refresh",
  "menu.addToFavorites": "Add to Favorites",
  "menu.removeFromFavorites": "Remove from Favorites",
  "menu.addCurrentToFavorites": "Add Current Folder to Favorites",
  "menu.currentAlreadyFavorite": "Current Folder Is Already in Favorites",
  "menu.expandSection": "Expand Section",
  "menu.collapseSection": "Collapse Section",
  "menu.clearRecents": "Clear Recents",
  "menu.clearAllRecents": "Clear All Recents",
  "menu.removeFromRecents": "Remove from Recents",
  "menu.removeTagEverywhere": "Remove the {tag} Tag from All Items",
  "menu.showPath": "Show Path",

  /* ---------------------------------- sidebar --------------------------------- */
  "sidebar.favorites": "Favorites",
  "sidebar.cloud": "Cloud",
  "sidebar.devices": "Devices",
  "sidebar.custom": "My Favorites",
  "sidebar.recents": "Recents",
  "sidebar.tags": "Tags",
  "sidebar.dropHere": "Drag a folder or file here",
  "sidebar.nothingYet": "Nothing yet",
  "sidebar.opensInExplorer": "Opens in File Explorer",
  "sidebar.resize": "Sidebar width",

  "folder.desktop": "Desktop",
  "folder.downloads": "Downloads",
  "folder.documents": "Documents",
  "folder.pictures": "Pictures",
  "folder.music": "Music",
  "folder.videos": "Videos",
  "folder.home": "Home",

  "drive.local": "Local Disk ({letter}:)",
  "drive.usb": "USB Drive ({letter}:)",
  "drive.network": "Network Drive ({letter}:)",
  "drive.optical": "CD Drive ({letter}:)",
  "drive.labeled": "{label} ({letter}:)",
  "drive.phone": "Phone",

  "tag.red": "Red",
  "tag.orange": "Orange",
  "tag.yellow": "Yellow",
  "tag.green": "Green",
  "tag.blue": "Blue",
  "tag.purple": "Purple",
  "tag.grey": "Gray",

  /* -------------------------------- status bar -------------------------------- */
  "status.loading": { one: "loading… {count} item", other: "loading… {count} items" },
  "status.selected": "{selected} of {count} selected",
  "status.filtered": "{shown} of {count} (filtered)",
  "status.freeSpace": "{size} available",

  /* ------------------------------- empty states ------------------------------- */
  "empty.start": "Start by choosing a folder on the left.",
  "empty.folder": "This folder is empty",
  "empty.folderHint": "Press Ctrl+Shift+. to show hidden files.",
  "empty.noMatches": "No results for “{query}”",
  "empty.noMatchesHint": "Press Enter to search subfolders too.",

  /* ------------------------------- confirmations ------------------------------ */
  "confirm.deleteOne": "Delete “{name}” permanently?",
  "confirm.deleteMany": {
    one: "Delete {count} item permanently?",
    other: "Delete {count} items permanently?",
  },
  "confirm.deleteMessage":
    "This drive has no Recycle Bin (USB flash drive or network folder). The items will be deleted permanently and can't be restored.",
  "confirm.deleteConfirm": "Delete Permanently",
  "confirm.clearRecentsTitle": "Clear recents?",
  "confirm.clearRecentsMessage":
    "The list of recently opened items will be emptied. The files themselves stay.",
  "confirm.clearRecentsConfirm": "Clear",
  "confirm.removeTagTitle": "Remove the {tag} tag?",
  "confirm.removeTagMessage": {
    one: "The tag will be removed from {count} item. The files themselves stay, but the tags can't be restored.",
    other: "The tag will be removed from {count} items. The files themselves stay, but the tags can't be restored.",
  },
  "confirm.removeTagConfirm": "Remove",

  /* ---------------------------------- toasts ---------------------------------- */
  "toast.skippedLinks": {
    one: "Skipped {count} link (symlinks and junctions).",
    other: "Skipped {count} links (symlinks and junctions).",
  },
  "toast.copiedAsPaths":
    "Copied as paths (text) — pasting files into File Explorer isn't supported yet.",

  "error.operation": "{action} — {detail}",
  "error.batch": "{action} for {failed} of {count} items — {detail}",
  "op.rename": "Rename failed",
  "op.delete": "Delete failed",
  "op.duplicate": "Duplicate failed",
  "op.newFolder": "Couldn't create the folder",
  "op.newFile": "Couldn't create the file",
  "op.copy": "Copy failed",
  "op.move": "Move failed",
  "op.explorer": "Couldn't open File Explorer",
  "op.terminal": "Couldn't open Terminal",
  "op.openWith": "Couldn't open the dialog",
  "op.device": "Couldn't open the device",
  "op.openFile": "Couldn't open the file",
  "op.openFolder": "Couldn't open the folder",
  "op.sidebar": "Couldn't load the sidebar",
  "op.watch": "Can't watch this folder; changes won't show up automatically",
  "op.checkTarget": "Couldn't check the destination",
  "op.copyPath": "Couldn't copy the path",
  "op.copyPaths": "Couldn't copy the paths",
  "op.copyName": "Couldn't copy the name",
  "op.copyNames": "Couldn't copy the names",
  "op.loadSettings": "Couldn't load settings; favorites and tags are empty",
  "op.saveSettings": "Couldn't save settings",

  /* ------------------------------- default names ------------------------------ */
  "name.newFolder": "New folder",
  "name.newFile": "New Text Document.txt",
} satisfies Dictionary;
