/**
 * Čeština. Klíče jsou ploché s tečkovou hierarchií, en.ts musí mít tytéž.
 * Plurály: one = 1, few = 2–4, other = 0 a 5+ (Intl.PluralRules("cs")).
 * Parametry `{name}` dosazuje t(); čísla dostanou oddělovač tisíců.
 */
export const cs = {
  /* ---------------------------------- obecné --------------------------------- */
  "common.close": "Zavřít",
  "common.cancel": "Zrušit",
  "common.open": "Otevřít",
  "common.loading": "Načítám…",

  "items.count": { one: "{count} položka", few: "{count} položky", other: "{count} položek" },

  /* ---------------------------------- zobrazení ------------------------------- */
  "view.icons": "Ikony",
  "view.list": "Seznam",
  "view.columns": "Sloupce",

  "sort.name": "Název",
  "sort.modified": "Datum úpravy",
  "sort.size": "Velikost",
  "sort.kind": "Druh",
  "sort.ascending": "Vzestupně",
  "sort.descending": "Sestupně",

  /* ---------------------------------- toolbar --------------------------------- */
  "toolbar.back": "Zpět",
  "toolbar.forward": "Vpřed",
  "toolbar.view": "Zobrazení",
  "toolbar.viewAsIcons": "Zobrazit jako ikony",
  "toolbar.viewAsList": "Zobrazit jako seznam",
  "toolbar.viewAsColumns": "Zobrazit jako sloupce",
  "toolbar.sort": "Seřadit",
  "toolbar.share": "Sdílet",
  "toolbar.tags": "Štítky",
  "toolbar.tagsUnavailable": "Vyberte soubor",
  "toolbar.more": "Více",
  "toolbar.lightMode": "Světlý režim",
  "toolbar.darkMode": "Tmavý režim",
  "toolbar.search": "Hledat",
  "toolbar.clearSearch": "Zrušit hledání",
  "toolbar.searchResults": "Výsledky hledání",
  "toolbar.parentFolder": "Nadřazená složka",
  "toolbar.showHidden": "Zobrazit skryté soubory",
  "toolbar.animations": "Animace",
  "toolbar.about": "O aplikaci Finder-Win",

  "motion.system": "Podle systému",
  "motion.on": "Zapnuto",
  "motion.off": "Vypnuto",

  /* ----------------------------------- menu ----------------------------------- */
  "menu.open": "Otevřít",
  "menu.openWith": "Otevřít v aplikaci…",
  "menu.openInExplorer": "Otevřít v Průzkumníku",
  "menu.openInTerminal": "Otevřít v Terminálu",
  "menu.showInFolder": "Zobrazit ve složce",
  "menu.quickLook": "Náhled",
  "menu.newFolder": "Nová složka",
  "menu.newFile": "Nový soubor",
  "menu.rename": "Přejmenovat",
  "menu.duplicate": "Duplikovat",
  "menu.copy": "Kopírovat",
  "menu.copyCount": {
    one: "Kopírovat {count} položku",
    few: "Kopírovat {count} položky",
    other: "Kopírovat {count} položek",
  },
  "menu.cut": "Vyjmout",
  "menu.cutCount": {
    one: "Vyjmout {count} položku",
    few: "Vyjmout {count} položky",
    other: "Vyjmout {count} položek",
  },
  "menu.paste": "Vložit",
  "menu.copyPath": "Kopírovat cestu",
  "menu.copyPaths": "Kopírovat cesty",
  "menu.copyCurrentPath": "Kopírovat cestu aktuální složky",
  "menu.copyName": "Kopírovat název",
  "menu.copyNames": "Kopírovat názvy",
  "menu.copyFiles": "Kopírovat soubory do schránky",
  "menu.editPath": "Upravit cestu",
  "menu.delete": "Smazat",
  "menu.deleteCount": {
    one: "Smazat {count} položku",
    few: "Smazat {count} položky",
    other: "Smazat {count} položek",
  },
  "menu.tags": "Tagy",
  "menu.removeTags": "Odebrat tagy",
  "menu.properties": "Vlastnosti",
  "menu.folderProperties": "Vlastnosti složky",
  "menu.view": "Zobrazit",
  "menu.hiddenFiles": "Skryté soubory",
  "menu.sortBy": "Seřadit podle",
  "menu.selectAll": "Vybrat vše",
  "menu.refresh": "Aktualizovat",
  "menu.addToFavorites": "Přidat do oblíbených",
  "menu.removeFromFavorites": "Odebrat z oblíbených",
  "menu.addCurrentToFavorites": "Přidat aktuální složku do oblíbených",
  "menu.currentAlreadyFavorite": "Aktuální složka už je v oblíbených",
  "menu.expandSection": "Rozbalit sekci",
  "menu.collapseSection": "Sbalit sekci",
  "menu.clearRecents": "Vymazat nedávné",
  "menu.clearAllRecents": "Vymazat všechny nedávné",
  "menu.removeFromRecents": "Odebrat z nedávných",
  "menu.removeTagEverywhere": "Odebrat štítek {tag} ze všech položek",
  "menu.showPath": "Zobrazit cestu",

  /* ---------------------------------- sidebar --------------------------------- */
  "sidebar.favorites": "Oblíbené",
  "sidebar.cloud": "Cloud",
  "sidebar.devices": "Zařízení",
  "sidebar.custom": "Moje oblíbené",
  "sidebar.recents": "Nedávné",
  "sidebar.tags": "Tagy",
  "sidebar.dropHere": "Přetáhni sem složku nebo soubor",
  "sidebar.nothingYet": "Zatím nic",
  "sidebar.opensInExplorer": "Otevře se v Průzkumníku",
  "sidebar.resize": "Šířka postranního panelu",

  "folder.desktop": "Plocha",
  "folder.downloads": "Stažené",
  "folder.documents": "Dokumenty",
  "folder.pictures": "Obrázky",
  "folder.music": "Hudba",
  "folder.videos": "Videa",
  "folder.home": "Domů",

  "drive.local": "Místní disk ({letter}:)",
  "drive.usb": "USB disk ({letter}:)",
  "drive.network": "Síťový disk ({letter}:)",
  "drive.optical": "Mechanika ({letter}:)",
  "drive.labeled": "{label} ({letter}:)",
  "drive.phone": "Telefon",

  "tag.red": "Červený",
  "tag.orange": "Oranžový",
  "tag.yellow": "Žlutý",
  "tag.green": "Zelený",
  "tag.blue": "Modrý",
  "tag.purple": "Fialový",
  "tag.grey": "Šedý",

  /* -------------------------------- status bar -------------------------------- */
  "status.loading": {
    one: "načítám… {count} položka",
    few: "načítám… {count} položky",
    other: "načítám… {count} položek",
  },
  "status.selected": "Vybráno {selected} z {count}",
  "status.filtered": "{shown} z {count} (filtr)",
  "status.freeSpace": "{size} volných",

  /* ------------------------------ prázdné stavy ------------------------------- */
  "empty.start": "Začni výběrem složky vlevo.",
  "empty.folder": "Složka je prázdná",
  "empty.folderHint": "Skryté soubory ukáže Ctrl+Shift+.",
  "empty.noMatches": "Nic nenalezeno pro „{query}“",
  "empty.noMatchesHint": "Enter prohledá i podsložky.",

  /* ------------------------------- potvrzení ---------------------------------- */
  "confirm.deleteOne": "Smazat „{name}“ trvale?",
  "confirm.deleteMany": {
    one: "Smazat {count} položku trvale?",
    few: "Smazat {count} položky trvale?",
    other: "Smazat {count} položek trvale?",
  },
  "confirm.deleteMessage":
    "Tento disk nemá Koš (flashka nebo síťová složka). Položky budou smazány trvale a nepůjde je obnovit.",
  "confirm.deleteConfirm": "Smazat trvale",
  "confirm.clearRecentsTitle": "Vymazat nedávné?",
  "confirm.clearRecentsMessage":
    "Seznam naposledy otevřených položek se vyprázdní. Soubory samotné zůstanou.",
  "confirm.clearRecentsConfirm": "Vymazat",
  "confirm.removeTagTitle": "Odebrat štítek {tag}?",
  "confirm.removeTagMessage": {
    one: "Štítek se odebere u {count} položky. Soubory samotné zůstanou, ale vrátit štítky zpátky nepůjde.",
    few: "Štítek se odebere u {count} položek. Soubory samotné zůstanou, ale vrátit štítky zpátky nepůjde.",
    other: "Štítek se odebere u {count} položek. Soubory samotné zůstanou, ale vrátit štítky zpátky nepůjde.",
  },
  "confirm.removeTagConfirm": "Odebrat",

  /* --------------------------------- hlášky ----------------------------------- */
  "toast.skippedLinks": {
    one: "Přeskočen {count} odkaz (symlinky a junctions).",
    few: "Přeskočeny {count} odkazy (symlinky a junctions).",
    other: "Přeskočeno {count} odkazů (symlinky a junctions).",
  },
  "toast.copiedAsPaths":
    "Zkopírováno jako cesty (text) — vkládání souborů do Průzkumníku zatím neumím.",

  /* Operace: „{action} — {detail}", u hromadných i počet. */
  "error.operation": "{action} — {detail}",
  "error.batch": "{action} u {failed} z {count} položek — {detail}",
  "op.rename": "Přejmenování selhalo",
  "op.delete": "Smazání selhalo",
  "op.duplicate": "Duplikace selhala",
  "op.newFolder": "Složku se nepodařilo vytvořit",
  "op.newFile": "Soubor se nepodařilo vytvořit",
  "op.copy": "Kopírování selhalo",
  "op.move": "Přesun selhal",
  "op.explorer": "Průzkumníka se nepodařilo otevřít",
  "op.terminal": "Terminál se nepodařilo otevřít",
  "op.openWith": "Dialog se nepodařilo otevřít",
  "op.device": "Zařízení se nepodařilo otevřít",
  "op.openFile": "Soubor se nepodařilo otevřít",
  "op.openFolder": "Složku se nepodařilo otevřít",
  "op.sidebar": "Postranní panel se nepodařilo načíst",
  "op.watch": "Složku nejde hlídat, změny se neukážou samy",
  "op.checkTarget": "Cíl se nepodařilo zkontrolovat",
  "op.copyPath": "Cestu se nepodařilo zkopírovat",
  "op.copyPaths": "Cesty se nepodařilo zkopírovat",
  "op.copyName": "Název se nepodařilo zkopírovat",
  "op.copyNames": "Názvy se nepodařilo zkopírovat",
  "op.loadSettings": "Nastavení se nepodařilo načíst, oblíbené a tagy jsou prázdné",
  "op.saveSettings": "Nastavení se nepodařilo uložit",

  /* ------------------------------ výchozí názvy ------------------------------- */
  "name.newFolder": "Nová složka",
  "name.newFile": "Nový textový dokument.txt",
} as const;
