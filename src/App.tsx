import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { CircleAlert, CircleCheck, FolderOpen, Search, SearchX, X } from "lucide-react";

import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { ColumnView } from "./components/ColumnView";
import {
  ConflictDialog,
  type ConflictAnswer,
  type ConflictRequest,
} from "./components/ConflictDialog";
import { ConfirmDialog, type ConfirmRequest } from "./components/ConfirmDialog";
import { ContextMenu, type MenuItem } from "./components/ContextMenu";
import { EmptyState } from "./components/EmptyState";
import { AboutDialog } from "./components/AboutDialog";
import { PropertiesDialog } from "./components/PropertiesDialog";
import { IconView } from "./components/IconView";
import { ListView } from "./components/ListView";
import { QuickLook } from "./components/QuickLook";
import { SearchView } from "./components/SearchView";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TabBar } from "./components/TabBar";
import { TagView } from "./components/TagView";
import { FolderIcon, folderDisplayName, sidebarIcon, sidebarIconColor } from "./components/icons";
import { TitleBar } from "./components/TitleBar";
import { Toolbar } from "./components/Toolbar";
import { TooltipLayer } from "./components/Tooltip";
import { Skeleton, ViewTransition } from "./components/ViewTransition";
import {
  clipboardClear,
  clipboardHasFiles,
  clipboardReadFiles,
  clipboardWriteFiles,
  copyPath,
  createFile,
  createFolder,
  duplicatePath,
  invoke,
  movePath,
  moveToTrash,
  openInExplorer,
  openTerminal,
  openWith,
  parentPath,
  renamePath,
  statPaths,
  trashIsPermanent,
  type OnConflict,
} from "./fileops";
import {
  breadcrumbs,
  formatItemCount,
  type SortKey,
} from "./format";
import { errorText, failure, t, useLocale, type MessageKey } from "./i18n";
import { canDropInto, droppedPaths, endDrag, getDrag, isExternalFileDrag } from "./lib/dnd";
import { isTypingTarget } from "./lib/dom";
import { applyMotion, motionEnabled, motionMs, smoothIfAllowed } from "./lib/motion";
import * as storage from "./lib/storage";
import { TAG_COLORS, TAG_HEX, tagLabel } from "./lib/tags";
import { useStableCallback } from "./lib/rowDnd";
import { usePanel, type Panel } from "./panel";

/** Jen funkce panelu (settery, navigace) — viz activeFns. */
type PanelFunctions = {
  [K in keyof Panel as Panel[K] extends (...args: never[]) => unknown ? K : never]: Panel[K];
};
import { setSpecialFolders } from "./lib/specialFolders";
import { checkForUpdate, type AvailableUpdate } from "./lib/updates";
import { useStorage } from "./lib/useStorage";
import { blankSnapshot, newTab, tabFace, type Tab, type TabSnapshot } from "./browser";
import { applyTheme, readStoredTheme } from "./theme";
import { redoOp, trashTimestamp, undoLabel, undoOp, UNDO_LIMIT, type UndoOp } from "./undo";
import type {
  Clipboard,
  FavoriteSection,
  FileEntry,
  StatResult,
  TagColor,
  Theme,
  ViewMode,
} from "./types";

/** Jak dlouho hláška zůstane, než sama odjede. */
const TOAST_VISIBLE_MS = 2000;

/**
 * Kontextové menu hlavního panelu. Pravý klik na položku a pravý klik na
 * volnou plochu nabízejí jiné věci, ale otevírají se stejnou komponentou.
 */
type MainMenu =
  /** `overlay` = položka z výsledků hledání nebo z tag view. Leží mimo výpis
   *  aktuální složky, takže operace míří jen na ni a ne na výběr pod ní. */
  | { kind: "entry"; x: number; y: number; entry: FileEntry; overlay: boolean }
  | { kind: "background"; x: number; y: number; dir: string }
  | { kind: "status"; x: number; y: number; dir: string }
  | { kind: "quicklook"; x: number; y: number; entry: FileEntry };

const VIEW_LABELS: Record<ViewMode, MessageKey> = {
  icon: "view.icons",
  list: "view.list",
  column: "view.columns",
};

const SORT_LABELS: Record<SortKey, MessageKey> = {
  name: "sort.name",
  modified: "sort.modified",
  size: "sort.size",
  kind: "sort.kind",
};

/**
 * Syntetická položka pro složku, ve které uživatel stojí. Vlastnosti si stejně
 * všechno dotáhnou z backendu podle cesty, potřebují jen název a `is_dir`.
 */
function folderEntry(path: string): FileEntry {
  return {
    name: storage.lastSegment(path),
    path,
    is_dir: true,
    size: 0,
    modified: 0,
    created: 0,
    extension: null,
    hidden: false,
    is_symlink: false,
  };
}

/** Užší okno rozdělení schová (stav zůstává a vrátí se po zvětšení). */
const SPLIT_MIN_WIDTH = 1000;

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-secondary">
      {children}
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const [windowFocused, setWindowFocused] = useState(true);
  /** Fokus okna — panely si z něj odvodí vlastní (neaktivní panel je „bez fokusu"). */
  const windowFocusedAll = windowFocused;

  const [sections, setSectionsState] = useState<FavoriteSection[]>([]);
  /** Sekce sidebaru — a z Oblíbených se odvodí speciální složky s glyfem. */
  const setSections = useCallback((next: FavoriteSection[]) => {
    setSpecialFolders(next);
    setSectionsState(next);
  }, []);

  /** Záložky. Živý stav (browser výš) má jen aktivní, ostatní leží jako snímky. */
  const [initialTab] = useState(() => newTab(null));
  const [tabs, setTabs] = useState<Tab[]>(() => [initialTab]);
  const [activeTabId, setActiveTabId] = useState(initialTab.id);
  /** applyTab pro efekt startu, který běží dřív, než je funkce definovaná. */
  const applyTabRef = useRef<(tab: Tab) => void>(() => undefined);
  /** Záložky se do nastavení zapisují až po jejich obnovení při startu. */
  const tabsLoaded = useRef(false);

  /** `sticky` = chyba, visí do kliknutí / Escape. Informace mizí sama — ale
   *  "nemáte oprávnění" by se za dvě sekundy nedalo dočíst. */
  const [notice, setNoticeState] = useState<{ text: string; sticky: boolean } | null>(null);
  /** Hláška ještě visí, ale už odjíždí dolů. */
  const [noticeClosing, setNoticeClosing] = useState(false);
  /** Chybová hláška (zůstává). Stabilní identita — předává se i do useColumns. */
  const setNotice = useCallback((text: string | null) => {
    setNoticeState(text === null ? null : { text, sticky: true });
  }, []);
  /** Informativní hláška, sama zmizí. */
  const showInfo = useCallback((text: string) => setNoticeState({ text, sticky: false }), []);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  /** Otevřený dialog kolize a funkce, která vrátí odpověď čekající operaci. */
  const [conflict, setConflict] = useState<{
    request: ConflictRequest;
    resolve: (answer: ConflictAnswer | null) => void;
  } | null>(null);

  /** Zeptá se na kolizi; null = uživatel operaci zastavil. */
  const askConflict = useCallback(
    (request: ConflictRequest) =>
      new Promise<ConflictAnswer | null>((resolve) => setConflict({ request, resolve })),
    [],
  );
  /** Menu z toolbaru (Seřadit / Sdílet / Štítky / Více) — drží ho Toolbar. */
  const [toolbarMenuOpen, setToolbarMenuOpen] = useState(false);

  /** Kopie systémové schránky — jen pro průhlednost vyjmutých položek.
   *  Vkládá se vždy z té skutečné (Ctrl+V čte schránku Windows). */
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  /** Má systémová schránka soubory? Zjišťuje se při otevření menu (Vložit). */
  const [clipboardHasItems, setClipboardHasItems] = useState(false);
  const [menu, setMenu] = useState<MainMenu | null>(null);
  const [propertiesFor, setPropertiesFor] = useState<FileEntry | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);


  const { tags, favorites, motion, updates, splitRatio } = useStorage();
  // Překreslení po přepnutí jazyka; texty se berou z `t`, které čte aktuální locale.
  const locale = useLocale();
  useEffect(() => applyMotion(motion), [motion]);

  const [quickLookOpen, setQuickLookOpen] = useState(false);
  /** Přepínač skrytých souborů. null = ještě se neví (čeká se na settings.json
   *  a případně na nastavení Průzkumníku) — výpis se do té doby nenačítá. */
  const [showHidden, setShowHidden] = useState<boolean | null>(null);

  /* ---------------------------- dva panely ------------------------------- */

  /** Rozdělené okno zapnuté uživatelem (Ctrl+Shift+D). */
  const [splitOn, setSplitOn] = useState(false);
  /** Panel, na který míří klávesnice, toolbar, status bar i sidebar. */
  const [activePanel, setActivePanel] = useState<0 | 1>(0);
  /** Úzké okno — rozdělení se schová a po zvětšení vrátí. */
  const [narrow, setNarrow] = useState(() => window.innerWidth < SPLIT_MIN_WIDTH);
  const splitVisible = splitOn && !narrow;

  const panels = [
    usePanel({ slot: 0, showHidden, setNotice }),
    usePanel({ slot: 1, showHidden, setNotice }),
  ] as const;
  /** Aktivní panel — zbytek App pracuje s ním (jména jako dřív). */
  const panel = panels[activePanel];
  const otherPanel = splitVisible ? panels[activePanel === 0 ? 1 : 0] : null;
  const panelRef = useRef(panel);
  panelRef.current = panel;
  /** Panely, které jsou vidět (bez rozdělení jen aktivní). */
  const visiblePanels: (0 | 1)[] = splitVisible ? [0, 1] : [activePanel];
  const panelsRef = useRef(panels);
  panelsRef.current = panels;

  /**
   * Funkce aktivního panelu se stabilní identitou, které vždy zavolají ten
   * panel, který je aktivní právě teď. Settery a callbacky jsou totiž pro
   * každý panel jiné — memoizovaný callback v App by jinak po přepnutí panelu
   * dál ovládal ten původní (pravý klik by měnil výběr v druhém panelu).
   */
  const activeFns = useMemo(() => {
    const proxies: Record<string, (...args: unknown[]) => unknown> = {};
    for (const [key, value] of Object.entries(panelRef.current)) {
      if (typeof value !== "function") continue;
      proxies[key] = (...args: unknown[]) =>
        (panelRef.current as unknown as Record<string, (...args: unknown[]) => unknown>)[key](...args);
    }
    return proxies as unknown as PanelFunctions;
  }, []);
  const {
    dispatch,
    setSortKey,
    setSortDirection,
    setQuery,
    setTagFilter,
    setSearch,
    setActive,
    setSelection,
    setError,
    setRenamingPath,
    setPathEditing,
    setOverlaySelected,
    navigate,
    goBack,
    goForward,
    submitSearch,
    selectEntry,
    viewMetrics,
    selectIndex,
    moveSelection,
    findByPrefix,
    requestSelect,
    reveal,
    goToParent,
    selectAll,
    changeViewMode,
  } = activeFns;
  const {
    nav,
    viewMode,
    sortKey,
    sortDirection,
    query,
    tagFilter,
    search,
    streamingCount,
    freeSpace,
    pathEditing,
    tagCount,
    searchCount,
    filterQuery,
    overlaySelected,
    columnsApi,
    sortedEntries,
    visibleEntries,
    focusedColumn,
    columnSelected,
    isColumnView,
    currentDir,
    targetEntries,
    activeEntry,
  } = panel;

  /** Klik do panelu ho aktivuje hned — ještě než dojde na výběr, menu nebo
   *  tažení, které tak už míří na něj. */
  const activatePanel = useCallback(
    (index: 0 | 1) => {
      if (index === activePanel) return;
      flushSync(() => setActivePanel(index));
    },
    [activePanel],
  );

  // Fokus nesmí zůstat v neaktivním panelu (sloupce si ho drží na svém
  // kontejneru) — šipky by jinak ovládaly jiný panel než Delete a Ctrl+C.
  // Aktivní sloupcový panel si ho po „probuzení" vezme sám.
  useEffect(() => {
    const focused = document.activeElement;
    const owner = focused instanceof Element ? focused.closest(".fw-panel") : null;
    if (owner && !owner.classList.contains("is-active") && focused instanceof HTMLElement) focused.blur();
  }, [activePanel]);

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < SPLIT_MIN_WIDTH);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /** Zapne / vypne rozdělení. Prázdný druhý panel začne ve stejné složce. */
  const toggleSplit = useCallback(() => {
    if (splitOn) {
      setSplitOn(false);
      return;
    }
    const current = panelRef.current;
    const other = panelsRef.current[activePanel === 0 ? 1 : 0];
    if (other.nav.current === null && current.currentDir !== null) {
      other.applySnapshot(
        blankSnapshot(current.currentDir, {
          viewMode: current.viewMode,
          sortKey: current.sortKey,
          sortDirection: current.sortDirection,
        }),
      );
    }
    setSplitOn(true);
  }, [splitOn, activePanel]);

  /**
   * Dělicí čára. Během tažení se mění jen styl levého panelu (jednou za
   * snímek) — přes úložiště by každý pohyb myši překreslil celou aplikaci.
   * Do nastavení až na konci; konec je i ztráta myši (Alt+Tab během tažení).
   */
  const panelsBoxRef = useRef<HTMLDivElement>(null);
  const startSplitResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const box = panelsBoxRef.current?.getBoundingClientRect();
    const left = panelsBoxRef.current?.querySelector<HTMLElement>(":scope > .fw-panel");
    if (!box || !left) return;
    handle.setPointerCapture(event.pointerId);
    let ratio = splitRatio;
    let frame = 0;
    const onMove = (move: PointerEvent) => {
      ratio = storage.clampSplitRatio((move.clientX - box.left) / box.width);
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        left.style.flexBasis = `${ratio * 100}%`;
      });
    };
    const finish = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      handle.removeEventListener("lostpointercapture", finish);
      cancelAnimationFrame(frame);
      document.body.style.cursor = "";
      void storage.setSplitRatio(ratio);
    };
    document.body.style.cursor = "col-resize";
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("lostpointercapture", finish);
  };

  /** Po operaci se přenačtou viditelné panely — kopie mezi nimi mění oba.
   *  Skrytý panel nikdo nevidí ani nehlídá; obnoví se, až se ukáže. */
  const visibleRef = useRef(visiblePanels);
  visibleRef.current = visiblePanels;
  const refresh = useCallback(() => {
    for (const index of visibleRef.current) panelsRef.current[index].refresh();
  }, []);
  const secondShown = splitVisible;
  useEffect(() => {
    if (secondShown) panelsRef.current[activePanel === 0 ? 1 : 0].refresh();
    // Jen při zobrazení druhého panelu, ne při každém přepnutí aktivního.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondShown]);
  /** Náhled položky z výsledků hledání nebo z tag view — ty nejsou ve výpisu
   *  složky, takže běžný Quick Look nad `activeEntry` je neuvidí. */
  const [overlayPreview, setOverlayPreview] = useState<FileEntry | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);


  // Persistentní nastavení se načte jednou; do té doby jedou sekce prázdné.
  // Přepínač skrytých souborů bere uloženou volbu, a dokud si ho uživatel
  // nezměnil sám, platí to, co má nastavené Průzkumník.
  useEffect(() => {
    void storage.init().then(() => {
      const saved = storage.getSnapshot().showHidden;
      if (saved !== null) {
        setShowHidden(saved);
        return;
      }
      invoke<boolean>("explorer_shows_hidden")
        .then(setShowHidden)
        .catch(() => setShowHidden(false));
    });
  }, []);

  const toggleHidden = useCallback(() => {
    setShowHidden((current) => {
      const next = !current;
      void storage.setShowHidden(next);
      return next;
    });
  }, []);

  useEffect(() => applyTheme(theme), [theme]);

  /**
   * Světlý <-> tmavý. Celé okno se prolne naráz přes View Transition: snímek
   * starého vzhledu zhasne nad novým, takže žádná plocha nedobíhá svým tempem.
   * Nový stav musí být v DOM hotový uvnitř callbacku — proto flushSync.
   */
  const toggleTheme = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    const root = document.documentElement;
    const apply = () => {
      flushSync(() => setTheme(next));
      applyTheme(next);
    };
    const done = () => root.classList.remove("is-theming");

    root.classList.add("is-theming");
    const withTransition = document as Document & {
      startViewTransition?: (update: () => void) => { finished: Promise<void> };
    };
    if (withTransition.startViewTransition && motionEnabled()) {
      withTransition.startViewTransition(apply).finished.finally(done);
    } else {
      apply();
      // Až po vykreslení nového stavu, ať se nic nerozjede dodatečně.
      requestAnimationFrame(() => requestAnimationFrame(done));
    }
  }, [theme]);

  // Okno startuje skryté (tauri.conf.json). Ukáže se, až je hotový první
  // render, nastavení (téma je už z localStorage, main.tsx) a písmo — bez
  // bílého záblesku a bez přeskočení fontu. Když JS spadne, ukáže ho Rust
  // sám po 1,5 s.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([storage.init(), document.fonts?.ready])
      .catch(() => undefined)
      // Volba animací musí platit už pro rozsvícení okna.
      .then(() => applyMotion(storage.getSnapshot().motion))
      .then(() => invoke("app_ready"))
      .catch(() => undefined)
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Nová verze na GitHubu: nejvýš jednou denně, až když okno stojí.
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    // Kontrola aktualizací nesmí nic rozbít ani hlásit — tiše bez proužku.
    void checkForUpdate()
      .then((found) => {
        if (alive) setUpdate(found);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ready, updates.check]);

  // Informace se sama sveze dolů po dvou sekundách, chyba zůstává. Časovač
  // visí na `notice`, takže nová hláška ten starý zruší a odpočet začne znovu.
  useEffect(() => {
    if (notice === null) return;

    setNoticeClosing(false);
    if (notice.sticky) return;

    const startExit = window.setTimeout(() => setNoticeClosing(true), TOAST_VISIBLE_MS);
    return () => window.clearTimeout(startExit);
  }, [notice]);

  // Odjezd (automatický, křížkem i Escapem) dohraje animaci a pak hlášku zahodí.
  useEffect(() => {
    if (!noticeClosing) return;
    const remove = window.setTimeout(() => setNoticeState(null), motionMs("--dur-slow"));
    return () => window.clearTimeout(remove);
  }, [noticeClosing]);

  useEffect(() => {
    if (!notice?.sticky) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setNoticeClosing(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [notice]);

  // Chyby zápisu nastavení (oblíbené, tagy) — jinak by skončily jen v konzoli.
  useEffect(
    () =>
      storage.onError((kind, detail) =>
        setNotice(failure(kind === "load" ? "op.loadSettings" : "op.saveSettings", detail)),
      ),
    [setNotice],
  );

  /*
   * Pravý klik — kde co otevírá (vše přes jednu komponentu ContextMenu):
   *
   * | Plocha                                  | Menu                                                     | Kde se otevírá            |
   * |-----------------------------------------|----------------------------------------------------------|---------------------------|
   * | položka v Icon / List / Column View     | Otevřít, Náhled, Otevřít v aplikaci, Průzkumník,         | App: openContextMenu      |
   * |                                         | Terminál, Oblíbené, Přejmenovat, Duplikovat, Kopírovat,  |                           |
   * |                                         | Vyjmout, Vložit, Kopírovat cestu/název, Smazat, Tagy,    |                           |
   * |                                         | Vlastnosti                                               |                           |
   * | položka ve výsledcích hledání / TagView | totéž (operace míří jen na ni, ne na výběr pod ní)       | App: openOverlayMenu      |
   * | volná plocha Icon / List View           | Nová složka, Nový soubor, Vložit, Průzkumník, Terminál,  | App: openBackgroundMenu   |
   * | volná plocha sloupce v Column View      | Kopírovat cestu, Zobrazit ▸, Seřadit podle ▸, Vybrat vše,|   (sloupec = jeho složka) |
   * |                                         | Aktualizovat, Oblíbené, Vlastnosti složky                |                           |
   * | stavový řádek                           | Kopírovat cestu aktuální složky, Upravit cestu           | App: openStatusMenu       |
   * | Quick Look                              | Otevřít, Otevřít v Průzkumníku, Kopírovat cestu          | App: openQuickLookMenu    |
   * | položky sidebaru                        | podle sekce (oblíbené, nedávné, systémové, tagy)         | Sidebar                   |
   * | nadpis sekce sidebaru                   | Sbalit/Rozbalit; u Nedávných i Vymazat nedávné           | Sidebar                   |
   * | volná plocha sidebaru                   | Přidat aktuální složku do oblíbených, Vymazat nedávné    | Sidebar                   |
   * | Toolbar, TitleBar, info panel, dialogy  | žádné — jen se blokuje nativní menu                      | tenhle handler            |
   * | INPUT / TEXTAREA                        | nativní menu webview (Kopírovat / Vložit)                | —                         |
   *
   * Handler běží v capture fázi. V bubble fázi by do window nedorazil nic, co
   * cestou zastavil stopPropagation (řádky si ho volají, aby se neotevřelo
   * i menu volné plochy) — a nativní menu by prošlo všude, kde komponenta
   * zapomene na vlastní preventDefault.
   */
  useEffect(() => {
    function onContextMenu(event: MouseEvent) {
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
    }

    window.addEventListener("contextmenu", onContextMenu, { capture: true });
    return () => window.removeEventListener("contextmenu", onContextMenu, { capture: true });
  }, []);

  useEffect(() => {
    const onFocus = () => setWindowFocused(true);
    const onBlur = () => setWindowFocused(false);

    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Kde uživatel právě je — pro odpovědi, které dorazí se zpožděním.
  const navCurrentRef = useRef(nav.current);
  navCurrentRef.current = nav.current;

  useEffect(() => {
    const favorites = invoke<FavoriteSection[]>("get_favorites");
    favorites.then(setSections).catch((err: unknown) => setError(failure("op.sidebar", err)));

    // Záložky z minulého spuštění — jen ty, jejichž složka pořád jde otevřít.
    // Pomalý síťový disk se nečeká: co neodpoví do chvilky, zůstane taky.
    const savedTabs = storage.init().then(async () => {
      const { items, active } = storage.getSnapshot().tabs;
      const checked = await Promise.all(
        items.map((item) =>
          Promise.race([
            invoke("can_list_dir", { path: item.path }).then(
              () => true,
              () => false,
            ),
            new Promise<boolean>((resolve) => window.setTimeout(() => resolve(true), 1500)),
          ]).then((ok) => (ok ? item : null)),
        ),
      );
      // Rozdělená záložka s nedostupnou složkou vpravo (odpojený disk) se vrátí
      // jen s levým panelem.
      const seconds = await Promise.all(
        checked.map((item) =>
          item?.second
            ? invoke("can_list_dir", { path: item.second.path }).then(
                () => true,
                () => false,
              )
            : Promise.resolve(true),
        ),
      );
      const cleaned = checked.map((item, index) =>
        item && item.second && !seconds[index] ? { ...item, second: undefined, activePanel: 0 as const } : item,
      );
      return { items: cleaned.filter((item) => item !== null), active: cleaned[active] ?? null };
    });

    void Promise.all([favorites.catch(() => [] as FavoriteSection[]), savedTabs.catch(() => null)]).then(
      ([result, saved]) => {
        tabsLoaded.current = true;
        // Výčet disků umí trvat sekundy (odpojený síťový disk). Kdo mezitím
        // sám někam došel (Ctrl+L, klik), toho to nesmí hodit zpátky.
        if (navCurrentRef.current !== null) return;

        if (saved && saved.items.length > 0) {
          const restored = saved.items.map((item): Tab => {
            const tab = newTab(item.path, {
              viewMode: item.view,
              sortKey: item.sortKey,
              sortDirection: item.sortDirection,
            });
            if (!item.second) return tab;
            const { path, view, sortKey: key, sortDirection: direction } = item.second;
            return {
              ...tab,
              second: blankSnapshot(path, { viewMode: view, sortKey: key, sortDirection: direction }),
              split: true,
              activePanel: item.activePanel ?? 0,
            };
          });
          const index = saved.active === null ? 0 : Math.max(0, saved.items.indexOf(saved.active));
          setTabs(restored);
          setActiveTabId(restored[index].id);
          applyTabRef.current(restored[index]);
          return;
        }

        const first = result[0]?.items[0];
        if (first) dispatch({ type: "go", path: first.path });
      },
    );
  }, []);

  // Připojený nebo odpojený disk (USB, síťový) se v sidebaru ukáže hned.
  // Tady se už nenaviguje — uživatel zůstává, kde je.
  useEffect(() => {
    const unlisten = listen("drives-changed", () => {
      invoke<FavoriteSection[]>("get_favorites")
        .then(setSections)
        .catch(() => undefined);
    });
    return () => void unlisten.then((stop) => stop());
  }, []);


  // Soubor v náhledu zmizel (smazán zvenčí, sloupec zrušil výběr) — Quick Look
  // se odmontuje sám, ale příznak by zůstal a jako "otevřený modal" by
  // blokoval všechny zkratky i tlačítka myši až do restartu.
  const quickLookShown = quickLookOpen && activeEntry !== null && !activeEntry.is_dir;
  useEffect(() => {
    if (quickLookOpen && !quickLookShown) setQuickLookOpen(false);
  }, [quickLookOpen, quickLookShown]);

  /* ---------------------------- operace ---------------------------------- */


  /* ---------------------- živé obnovení otevřených složek ------------------- */

  // Backend hlídá jen to, co je vidět: v column view všechny sloupce, jinak
  // aktuální složku. Klíč místo pole, ať se hlídač nepřestavuje při každém renderu.
  const watchedKey = [...new Set(visiblePanels.flatMap((index) => panels[index].watchedPaths))].join("\n");

  // Pořadové číslo: volání běží souběžně a backend podle něj zahodí to starší,
  // kdyby doběhlo až po novějším.
  const watchGeneration = useRef(0);
  useEffect(() => {
    const paths = watchedKey === "" ? [] : watchedKey.split("\n");
    watchGeneration.current += 1;
    invoke("watch_dirs", { paths, generation: watchGeneration.current }).catch(
      (err: unknown) => setNotice(failure("op.watch", err)),
    );
  }, [watchedKey]);

  // Změnu na disku (nový soubor z prohlížeče, smazání v Průzkumníku…) ukáže
  // výpis sám. Ve výsledcích hledání ne — přehledávat kvůli každé změně
  // v podkladové složce celý strom by bylo drahé a výsledky by poskakovaly.
  useEffect(() => {
    const unlisten = listen("dir-changed", () => {
      for (const index of visibleRef.current) {
        const target = panelsRef.current[index];
        if (target.search === null) target.refresh();
      }
    });
    return () => void unlisten.then((stop) => stop());
  }, []);

  /** Jediná cesta k otevření souboru — proto se nedávné zapisují právě tady. */
  const openFile = useCallback((entry: FileEntry) => {
    invoke("open_file", { path: entry.path })
      // Zapisuje se až po úspěchu — jinak by se do nedávných dostaly i soubory,
      // které se otevřít nepodařilo.
      .then(() => storage.addRecent(entry.path, entry.name, "file"))
      .catch((err: unknown) => setNotice(failure("op.openFile", err)));
  }, []);

  const open = useCallback(
    (entry: FileEntry) => {
      if (entry.is_dir) {
        void storage.addRecent(entry.path, entry.name, "folder");

        // V column view se složka otevírá do dalšího sloupce (jako Enter a →).
        // navigate() by sloupce zbořil na jediný.
        if (isColumnView) {
          const parent = parentPath(entry.path);
          const index = columnsApi.columns.findIndex(
            (column) => parent !== null && storage.samePath(column.path, parent),
          );
          if (index >= 0) {
            columnsApi.openInto(index, entry);
            return;
          }
        }

        selectEntry(entry);
        navigate(entry.path);
      } else {
        selectEntry(entry);
        openFile(entry);
      }
    },
    [navigate, openFile, selectEntry, isColumnView, columnsApi],
  );

  /** Dvojklik ve výsledcích hledání / tag view: složka se otevře (a výsledky
   *  se tím zavřou), soubor spustí výchozí aplikací. Výběr v podkladové
   *  složce se nemění — položka v ní vůbec nemusí být. */
  const openFromResults = useCallback(
    (entry: FileEntry) => {
      if (!entry.is_dir) return openFile(entry);
      void storage.addRecent(entry.path, entry.name, "folder");
      navigate(entry.path);
    },
    [navigate, openFile],
  );

  /** Sidebar volá s holou cestou — nedávné o FileEntry nevědí. */
  const openRecentFile = useCallback(
    (path: string, name: string) => {
      openFile({
        name,
        path,
        is_dir: false,
        size: 0,
        modified: 0,
        created: 0,
        extension: null,
        hidden: false,
        is_symlink: false,
      });
    },
    [openFile],
  );


  /**
   * Kopie nenásleduje symlinky a junctions. Když nějaké přeskočila, musí se to
   * uživatel dozvědět — jinak by si myslel, že má úplnou kopii.
   */
  const noteSkippedLinks = useCallback((count: number) => {
    if (count > 0) showInfo(t("toast.skippedLinks", { count }));
  }, [showInfo]);

  /** Společné ošetření chyb + refresh po každé mutující operaci. */
  const runOperation = useCallback(
    async (label: MessageKey, action: () => Promise<unknown>) => {
      setNotice(null);
      try {
        await action();
      } catch (err: unknown) {
        setNotice(failure(label, err));
      } finally {
        // Refresh patří i k neúspěchu. Operace mohla část práce stihnout a
        // zastaralý výpis, který ukazuje smazané soubory, je horší než chyba.
        refresh();
      }
    },
    [refresh],
  );

  /**
   * Hromadná operace nad výběrem. Nezastaví se na první chybě — jeden zamčený
   * soubor by jinak nechal zbytek výběru nedotčený a uživatel by se dozvěděl
   * jen o něm. Vrací, kolik položek prošlo.
   */
  const runBatch = useCallback(
    async <T,>(label: MessageKey, items: T[], action: (item: T) => Promise<unknown>) => {
      if (items.length === 0) return { ok: 0, failed: 0 };
      setNotice(null);

      let first: string | null = null;
      let failed = 0;

      for (const item of items) {
        try {
          await action(item);
        } catch (err: unknown) {
          failed += 1;
          if (first === null) first = errorText(err);
        }
      }

      if (failed === 1) setNotice(failure(label, first));
      else if (failed > 1) {
        setNotice(
          t("error.batch", { action: t(label), failed, count: items.length, detail: first ?? "" }),
        );
      }

      refresh();
      return { ok: items.length - failed, failed };
    },
    [refresh],
  );

  /* ------------------------------ zpět / znovu ----------------------------- */

  const [history, setHistory] = useState<{ undo: UndoOp[]; redo: UndoOp[] }>({ undo: [], redo: [] });
  const historyRef = useRef(history);
  historyRef.current = history;
  /** Zpět / Znovu běží po jednom — dvojí Ctrl+Z by jinak vracelo totéž dvakrát. */
  const historyBusy = useRef(false);

  /** Nová operace: na vrchol zásobníku, Znovu tím propadá. */
  const record = useCallback((op: UndoOp) => {
    setHistory((current) => ({ undo: [...current.undo, op].slice(-UNDO_LIMIT), redo: [] }));
  }, []);

  const stepHistory = useCallback(
    async (direction: "undo" | "redo") => {
      const stack = historyRef.current[direction];
      const op = stack[stack.length - 1];
      if (op === undefined || historyBusy.current) return;

      historyBusy.current = true;
      // Ze zásobníku pryč hned — když inverze selže, operace se zahodí.
      setHistory((current) => ({ ...current, [direction]: current[direction].slice(0, -1) }));
      setNotice(null);
      try {
        if (direction === "undo") {
          await undoOp(op);
          setHistory((current) => ({ ...current, redo: [...current.redo, op] }));
        } else {
          const again = await redoOp(op);
          setHistory((current) => ({ ...current, undo: [...current.undo, again].slice(-UNDO_LIMIT) }));
        }
      } catch (err: unknown) {
        setNotice(failure(direction === "undo" ? "op.undo" : "op.redo", err));
      } finally {
        historyBusy.current = false;
        refresh();
      }
    },
    [refresh, setNotice],
  );

  /** Změna tagů s možností Zpět: stav před a po pro dotčené cesty. */
  const changeTags = useCallback(
    (paths: string[], action: () => Promise<void>) => {
      const snapshot = () => {
        const tags = storage.getSnapshot().tags;
        return Object.fromEntries(paths.map((path) => [path, storage.tagsOf(tags, path)]));
      };
      const before = snapshot();
      void action()
        .then(() => {
          const after = snapshot();
          // Klik, který nic nezměnil, nemá být krok Zpět.
          if (JSON.stringify(before) !== JSON.stringify(after)) record({ kind: "tags", before, after });
        })
        .catch((err: unknown) => setNotice(failure("op.saveSettings", err)));
    },
    [record, setNotice],
  );

  const submitRename = useCallback(
    (entry: FileEntry, name: string) => {
      setRenamingPath(null);
      const next = name.trim();
      if (next === entry.name) return;

      const dir = parentPath(entry.path);

      void runOperation("op.rename", async () => {
        const renamed = await renamePath(entry.path, next);
        // Tagy, oblíbené a nedávné jsou klíčované cestou — musí jít s položkou.
        await storage.remapPath(entry.path, renamed);
        record({ kind: "rename", from: entry.path, to: renamed });
        // Přejmenovaná položka má novou cestu, takže by po refreshi vypadla
        // z výběru. Takhle zůstane označená, jak to dělá Finder i Průzkumník.
        if (dir !== null) requestSelect(dir, renamed);
      });
    },
    [runOperation, requestSelect, record],
  );

  const deleteEntries = useCallback(
    (items: FileEntry[]) => {
      const paths = items.map((entry) => entry.path);
      if (paths.length === 0) return;

      // Zpět jde jen u Koše — trvale smazané se vrátit nedá.
      const run = (undoable: boolean) =>
        void runOperation("op.delete", async () => {
          const since = trashTimestamp();
          await moveToTrash(paths);
          if (undoable) record({ kind: "trash", paths, since });
        });

      // Flashka (FAT32 / exFAT) ani síťová cesta Koš nemají — "do koše" by tam
      // smazalo trvale a bez varování. Když se to nedá zjistit, radši se ptát.
      trashIsPermanent(paths)
        .catch(() => true)
        .then((permanent) => {
          if (!permanent) return run(true);
          setConfirm({
            title:
              paths.length === 1
                ? t("confirm.deleteOne", { name: items[0].name })
                : t("confirm.deleteMany", { count: paths.length }),
            message: t("confirm.deleteMessage"),
            confirmLabel: t("confirm.deleteConfirm"),
            danger: true,
            onConfirm: () => run(false),
          });
        });
    },
    [runOperation, record],
  );

  const deleteTargets = useCallback(() => deleteEntries(targetEntries), [deleteEntries, targetEntries]);

  /** `select` = kopii rovnou označit. Ve výsledcích hledání se nesmí — označení
   *  by čekalo na výpis složky, ve které uživatel vůbec není. */
  const duplicateEntry = useCallback(
    (entry: FileEntry, select = true) => {
      const dir = parentPath(entry.path);

      void runOperation("op.duplicate", async () => {
        const copy = await duplicatePath(entry.path);
        await storage.copyTags(entry.path, copy.path);
        record({ kind: "copy", items: [{ from: entry.path, to: copy.path }] });
        if (select && dir !== null) requestSelect(dir, copy.path);
        noteSkippedLinks(copy.skipped_links);
      });
    },
    [runOperation, requestSelect, noteSkippedLinks, record],
  );

  const duplicateActive = useCallback(() => {
    if (activeEntry) duplicateEntry(activeEntry);
  }, [activeEntry, duplicateEntry]);

  /**
   * Vytvoří složku a nechá uživatele hned psát název, jako Finder i Průzkumník.
   * Kolizi názvu řeší backend číslem, takže druhá složka vznikne taky.
   */
  const newFolder = useCallback((into?: string) => {
    const dir = into ?? currentDir;
    if (dir === null) return;

    void runOperation("op.newFolder", async () => {
      const created = await createFolder(dir, t("name.newFolder"));
      record({ kind: "create", path: created, folder: true });
      requestSelect(dir, created);
      setRenamingPath(created);
    });
  }, [currentDir, runOperation, requestSelect, record]);

  /** Prázdný textový soubor, rovnou v přejmenování — stejně jako Nová složka. */
  const newFile = useCallback(
    (dir: string) => {
      void runOperation("op.newFile", async () => {
        const created = await createFile(dir, t("name.newFile"));
        record({ kind: "create", path: created, folder: false });
        requestSelect(dir, created, true);
      });
    },
    [runOperation, requestSelect, record],
  );

  /** `failed` = hláška pro případ, že schránka zápis odmítne. */
  const copyText = useCallback((text: string, failed: MessageKey) => {
    writeText(text).catch((err: unknown) => setNotice(failure(failed, err)));
  }, []);

  /** Cesty jako soubory do schránky Windows — vloží je Průzkumník, Outlook
   *  i prohlížeč. Interní kopie se drží jen kvůli vzhledu vyjmutých. */
  const putOnClipboard = useCallback(
    (paths: string[], mode: "copy" | "cut") => {
      if (paths.length === 0) return;
      setClipboard({ paths, mode });
      clipboardWriteFiles(paths, mode === "cut").catch((err: unknown) => {
        setClipboard(null);
        setNotice(failure("op.clipboard", err));
      });
    },
    [setNotice],
  );

  const copyToClipboard = useCallback(
    (mode: "copy" | "cut", items: FileEntry[] = targetEntries) => {
      putOnClipboard(items.map((entry) => entry.path), mode);
    },
    [targetEntries, putOnClipboard],
  );

  /** Stav schránky pro „Vložit" v menu — čte se při otevření, ne v intervalu. */
  const checkClipboard = useCallback(() => {
    clipboardHasFiles()
      .then(setClipboardHasItems)
      .catch(() => setClipboardHasItems(false));
  }, []);

  // Návrat do okna: schránku mohl mezitím přepsat kdokoli jiný (Ctrl+X
  // v Průzkumníku, zkopírovaný text). Průhlednost vyjmutých jde za ní.
  useEffect(() => {
    function sync() {
      clipboardReadFiles()
        .then((files) => {
          setClipboard((current) => {
            if (files === null) return null;
            const mode = files.cut ? "cut" : "copy";
            const same =
              current !== null &&
              current.mode === mode &&
              current.paths.length === files.paths.length &&
              current.paths.every((path, index) => storage.samePath(path, files.paths[index]));
            return same ? current : { paths: files.paths, mode };
          });
        })
        .catch(() => undefined);
    }
    window.addEventListener("focus", sync);
    return () => window.removeEventListener("focus", sync);
  }, []);

  /**
   * Kopie nebo přesun cest do složky `target` — společné pro Vložit
   * a přetažení na složku. Vrací, kolik položek prošlo.
   */
  const transfer = useCallback(
    async (sources: string[], target: string, mode: "copy" | "cut"): Promise<number> => {
      // Přesun tam, kde položka už je, nic nedělá — dřív z toho byla "X (kopie)".
      const paths =
        mode === "cut"
          ? sources.filter((path) => {
              const parent = parentPath(path);
              return parent === null || !storage.samePath(parent, target);
            })
          : sources;
      if (paths.length === 0) return 0;

      // Kolize: položka stejného jména v cíli. Zjistí se předem, jedním
      // voláním, a na každou se zeptá dialog (dokud nepadne "pro všechny").
      // Kopie do vlastní složky se neptá — tam je "ponechat obě" jediné rozumné.
      const destination = (path: string) =>
        target.endsWith("\\") ? `${target}${storage.lastSegment(path)}` : `${target}\\${storage.lastSegment(path)}`;
      let sourceStats: StatResult[];
      let targetStats: StatResult[];
      try {
        [sourceStats, targetStats] = await Promise.all([
          statPaths(paths),
          statPaths(paths.map(destination)),
        ]);
      } catch (err: unknown) {
        setNotice(failure("op.checkTarget", err));
        return 0;
      }
      const collides = paths.map((path, index) => {
        const parent = parentPath(path);
        return targetStats[index]?.entry != null && !(parent !== null && storage.samePath(parent, target));
      });

      let remaining = collides.filter(Boolean).length;
      let forAll: OnConflict | null = null;
      const plan: { path: string; onConflict: OnConflict }[] = [];

      for (const [index, path] of paths.entries()) {
        let onConflict: OnConflict = "rename";
        const source = sourceStats[index]?.entry;
        const found = targetStats[index]?.entry;

        if (collides[index] && source && found) {
          remaining -= 1;
          if (forAll !== null) {
            onConflict = forAll;
          } else {
            const answer = await askConflict({ source, existing: found, targetDir: target, remaining, mode });
            // Zastavit: co už je rozhodnuté, se neprovede — nic se nezměnilo.
            if (answer === null) return 0;
            onConflict = answer.choice;
            if (answer.applyToAll) forAll = answer.choice;
          }
        }

        plan.push({ path, onConflict });
      }

      let skipped = 0;
      const done: { from: string; to: string }[] = [];

      const { ok } = await runBatch(
        mode === "copy" ? "op.copy" : "op.move",
        plan,
        async ({ path, onConflict }) => {
          const result =
            mode === "copy"
              ? await copyPath(path, target, onConflict)
              : await movePath(path, target, onConflict);
          if (result.skipped) return;

          if (mode === "copy") await storage.copyTags(path, result.path);
          else await storage.remapPath(path, result.path);
          skipped += result.skipped_links;
          // „Nahradit" přepsalo cizí položku — Zpět by ji nevrátil, jen by
          // smazal i tu novou. Taková operace do historie nepatří.
          if (onConflict !== "replace" && !storage.samePath(path, result.path)) {
            done.push({ from: path, to: result.path });
          }
        },
      );

      if (done.length > 0) record({ kind: mode === "copy" ? "copy" : "move", items: done });
      noteSkippedLinks(skipped);
      return ok;
    },
    [runBatch, noteSkippedLinks, askConflict, setNotice, record],
  );

  /** Vloží do `into`, bez něj do složky, ve které uživatel stojí. */
  const paste = useCallback(
    (into?: string) => {
      const target = into ?? currentDir;
      if (target === null) return;

      void clipboardReadFiles()
        // Schránku drží jiná aplikace — poslouží interní kopie, když nějaká je.
        .catch(() => (clipboard ? { paths: clipboard.paths, cut: clipboard.mode === "cut" } : null))
        .then((files) => {
          // Text nebo obrázek: Vložit tu nemá co dělat, chyba to ale není.
          if (files === null || files.paths.length === 0) {
            setClipboard(null);
            return;
          }
          const { paths } = files;
          const mode = files.cut ? "cut" : "copy";

          // Vyjmuto a vloženo tam, kde už to leží — není co přesouvat, schránka pryč.
          const alreadyThere = paths.every((path) => {
            const parent = parentPath(path);
            return parent !== null && storage.samePath(parent, target);
          });

          return transfer(paths, target, mode).then((ok) => {
            // Vyjmuté položky se dají vložit jen jednou (jako v Průzkumníku).
            // Schránka se ale čistí jen když se aspoň něco přesunulo — po
            // úplném selhání by uživatel jinak přišel i o to, co měl vyjmuté.
            if (mode === "cut" && (ok > 0 || alreadyThere)) {
              setClipboard(null);
              setClipboardHasItems(false);
              clipboardClear().catch(() => undefined);
            }
          });
        })
        .catch((err: unknown) => setNotice(failure("op.paste", err)));
    },
    [clipboard, currentDir, transfer, setNotice],
  );

  /** F5 / F6 a kontextové menu: výběr aktivního panelu do složky druhého. */
  // Výsledky hledání a tag view nejsou složka — ani zdroj (výběr pod nimi je
  // neviditelný), ani cíl (jejich podkladová složka není vidět).
  const otherDir =
    otherPanel !== null &&
    otherPanel.search === null &&
    otherPanel.tagFilter === null &&
    search === null &&
    tagFilter === null
      ? otherPanel.currentDir
      : null;
  const transferToOther = useCallback(
    (mode: "copy" | "cut", items: FileEntry[] = targetEntries) => {
      if (otherDir === null || items.length === 0) return;
      transfer(
        items.map((entry) => entry.path),
        otherDir,
        mode,
      ).catch((err: unknown) => setNotice(failure(mode === "copy" ? "op.copy" : "op.move", err)));
    },
    [otherDir, targetEntries, transfer, setNotice],
  );

  /** Přetažení na složku: přesun, s Ctrl kopie. */
  const dropInto = useCallback(
    (folder: string, paths: string[], copy: boolean) => {
      transfer(paths, folder, copy ? "copy" : "cut").catch((err: unknown) =>
        setNotice(failure(copy ? "op.copy" : "op.move", err)),
      );
    },
    [transfer, setNotice],
  );

  /** Soubory z Průzkumníku nad volnou plochou — padnou do aktuální složky
   *  (v column view do sloupce pod myší). Řádky složek si je chytí samy. */
  const [backgroundDrop, setBackgroundDrop] = useState<0 | 1 | null>(null);
  const backgroundDropDir = (q: Panel, event: React.DragEvent): string | null => {
    if (q.tagFilter !== null || q.search !== null) return null;
    const column = (event.target as Element).closest<HTMLElement>("[data-column-path]");
    const dir = column?.dataset.columnPath ?? q.currentDir;
    if (dir === null) return null;
    if (isExternalFileDrag(event)) return dir;
    // Položky z výpisu: jen když míří jinam, než kde už leží (typicky z druhého panelu).
    const payload = getDrag();
    if (payload?.kind !== "entry" || !canDropInto(dir, payload)) return null;
    const elsewhere = payload.items.some((item) => {
      const parent = parentPath(item.path);
      return parent === null || !storage.samePath(parent, dir);
    });
    return elsewhere ? dir : null;
  };


  /* -------------------------------- záložky -------------------------------- */

  /** Stav celé aktivní záložky: oba panely, rozdělení a aktivní panel. */
  const captureTab = (): Pick<Tab, "snapshot" | "second" | "split" | "activePanel"> => ({
    snapshot: panels[0].captureSnapshot(),
    second: panels[1].captureSnapshot(),
    split: splitOn,
    activePanel,
  });

  /** Nahraje záložku do obou panelů. */
  const applyTab = (tab: Tab) => {
    panels[0].applySnapshot(tab.snapshot);
    panels[1].applySnapshot(tab.second ?? blankSnapshot(null));
    setSplitOn(tab.split === true);
    setActivePanel(tab.activePanel ?? 0);
    setOverlayPreview(null);
    setQuickLookOpen(false);
  };
  applyTabRef.current = applyTab;

  /** Otevřené záložky v pořadí lišty (bez těch, co právě odjíždějí). */
  const openTabs = tabs.filter((tab) => !tab.closing);

  const switchTab = useStableCallback((id: number) => {
    if (id === activeTabId) return;
    const target = openTabs.find((tab) => tab.id === id);
    if (!target) return;

    const captured = captureTab();
    setTabs((current) => current.map((tab) => (tab.id === activeTabId ? { ...tab, ...captured } : tab)));
    setActiveTabId(id);
    applyTab(target);
  });

  /** Nová záložka na konci lišty (jako ve Finderu), hned aktivní. */
  const openTab = useStableCallback((path: string | null) => {
    if (path === null) return;
    const tab = { ...newTab(path, { viewMode, sortKey, sortDirection }), fresh: true };
    const captured = captureTab();
    setTabs((current) => [
      ...current.map((item) => (item.id === activeTabId ? { ...item, ...captured } : item)),
      tab,
    ]);
    setActiveTabId(tab.id);
    applyTab(tab);
    // Příznak jen na dobu animace — jinak by ouško vjelo znovu při každém
    // dalším připojení lišty.
    window.setTimeout(
      () => setTabs((current) => current.map((item) => (item.id === tab.id ? { ...item, fresh: false } : item))),
      motionMs("--dur-nav") + 50,
    );
  });

  /** Poslední záložka se nezavírá — okno s jedinou záložkou zůstává. */
  const closeTab = useStableCallback((id: number) => {
    if (openTabs.length <= 1) return;
    const index = openTabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;

    if (id === activeTabId) {
      const neighbor = openTabs[index + 1] ?? openTabs[index - 1];
      setActiveTabId(neighbor.id);
      applyTab(neighbor);
    }
    setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, closing: true } : tab)));
    // Ouško se zúží a zhasne, pak teprve zmizí z pole.
    window.setTimeout(
      () => setTabs((current) => current.filter((tab) => tab.id !== id)),
      motionMs("--dur-nav"),
    );
  });

  const reorderTab = useCallback((id: number, index: number) => {
    setTabs((current) => {
      const from = current.findIndex((tab) => tab.id === id);
      if (from < 0 || from === index) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      return next;
    });
  }, []);

  /** Ctrl+Tab / Ctrl+Shift+Tab — dokola. */
  const cycleTab = useStableCallback((delta: number) => {
    const index = openTabs.findIndex((tab) => tab.id === activeTabId);
    if (index < 0 || openTabs.length < 2) return;
    switchTab(openTabs[(index + delta + openTabs.length) % openTabs.length].id);
  });

  /** Ctrl+1…8 přímo, Ctrl+9 poslední — jako v prohlížeči. */
  const switchToTabNumber = useStableCallback((number: number) => {
    const tab = number === 9 ? openTabs[openTabs.length - 1] : openTabs[number - 1];
    if (tab) switchTab(tab.id);
  });


  // Otevřené záložky do settings.json — při startu se obnoví. S jedinou
  // záložkou se nic neukládá: start zůstává jako dřív, v první oblíbené.
  useEffect(() => {
    if (!tabsLoaded.current) return;
    const saved = (state: Pick<TabSnapshot, "nav" | "viewMode" | "sortKey" | "sortDirection">) =>
      state.nav.current === null
        ? null
        : { path: state.nav.current, view: state.viewMode, sortKey: state.sortKey, sortDirection: state.sortDirection };
    // Rozdělená záložka se ukládá i s jedinou záložkou — jinak by se rozdělení ztratilo.
    const worthSaving = openTabs.length >= 2 || splitOn;
    const items = !worthSaving ? [] : openTabs.flatMap((tab) => {
      const live = tab.id === activeTabId;
      const state = live ? { ...captureTab(), id: tab.id } : tab;
      const first = saved(state.snapshot);
      if (first === null) return [];
      const second = state.split && state.second ? saved(state.second) : null;
      return [second ? { ...first, second, activePanel: state.activePanel ?? 0 } : first];
    });
    const value = { items, active: Math.max(0, openTabs.findIndex((tab) => tab.id === activeTabId)) };
    if (JSON.stringify(storage.getSnapshot().tabs) !== JSON.stringify(value)) void storage.setSavedTabs(value);
  }, [tabs, activeTabId, nav.current, viewMode, sortKey, sortDirection, splitOn, activePanel, panels[1].nav.current]);

  // Prostřední tlačítko na složce ve výpisu = otevřít v nové záložce.
  const folderAt = useStableCallback((path: string): boolean => {
    const lists = panels.flatMap((item) => [item.visibleEntries, ...item.columnsApi.columns.map((column) => column.entries)]);
    return lists.some((list) => list.some((entry) => entry.path === path && entry.is_dir));
  });
  useEffect(() => {
    function onMiddle(event: MouseEvent) {
      if (event.button !== 1) return;
      const row = (event.target as Element | null)?.closest<HTMLElement>("[data-path]");
      const path = row?.dataset.path;
      if (!path || !folderAt(path)) return;
      // Bez tohohle by webview spustilo automatické posouvání kolečkem.
      event.preventDefault();
      if (event.type === "auxclick") openTab(path);
    }
    window.addEventListener("mousedown", onMiddle, true);
    window.addEventListener("auxclick", onMiddle, true);
    return () => {
      window.removeEventListener("mousedown", onMiddle, true);
      window.removeEventListener("auxclick", onMiddle, true);
    };
  }, [folderAt, openTab]);

  /* --------------------------- klávesové zkratky -------------------------- */

  /** Cokoliv, co překrývá hlavní panel a obsluhuje si klávesy samo. */
  const modalOpen =
    quickLookOpen ||
    overlayPreview !== null ||
    menu !== null ||
    propertiesFor !== null ||
    aboutOpen ||
    confirm !== null ||
    conflict !== null ||
    toolbarMenuOpen;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Modal si klávesy obsluhuje sám. Platí to pro všechny, ne jen Quick Look:
      // pod otevřenými Vlastnostmi šel dřív stisknout Delete a smazat výběr,
      // který uživatel za dialogem ani neviděl.
      if (modalOpen) return;
      // Menu, která drží vlastní stav mimo App (Více v toolbaru, sidebar) —
      // pod nimi nesmí projít Delete, F2 ani Ctrl+V. Menu se pozná podle DOM.
      if (document.querySelector("[data-fw-menu]")) return;

      // Záložky jako v prohlížeči — fungují i s fokusem v poli hledání.
      const tabCtrl = (event.ctrlKey || event.metaKey) && !event.altKey;
      if (tabCtrl && event.key === "Tab") {
        event.preventDefault();
        cycleTab(event.shiftKey ? -1 : 1);
        return;
      }
      if (tabCtrl && !event.shiftKey && /^Digit[1-9]$/.test(event.code)) {
        event.preventDefault();
        switchToTabNumber(Number(event.code.slice(5)));
        return;
      }
      if (tabCtrl && event.shiftKey && event.code === "KeyD") {
        event.preventDefault();
        toggleSplit();
        return;
      }
      if (tabCtrl && !event.shiftKey && (event.key.toLowerCase() === "t" || event.key.toLowerCase() === "w")) {
        event.preventDefault();
        if (event.key.toLowerCase() === "t") openTab(currentDir);
        else closeTab(activeTabId);
        return;
      }

      if (isTypingTarget(event.target)) return;

      // Rozdělené okno: Tab přepíná panel, F5 / F6 kopíruje / přesouvá výběr
      // do druhého panelu (jako Total Commander).
      if (splitVisible && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.key === "Tab") {
          event.preventDefault();
          setActivePanel(activePanel === 0 ? 1 : 0);
          return;
        }
        if ((event.key === "F5" || event.key === "F6") && !event.shiftKey) {
          event.preventDefault();
          // Ve výsledcích hledání / tag view nic — viz otherDir.
          transferToOther(event.key === "F5" ? "copy" : "cut");
          return;
        }
      }

      // Escape ve výsledcích hledání je zavře (a tím zastaví běžící průchod
      // disku), i když fokus není v poli hledání.
      if (event.key === "Escape" && search !== null) {
        event.preventDefault();
        setQuery("");
        return;
      }

      const ctrl = event.ctrlKey || event.metaKey;

      // Historie a rodič fungují všude — i ve výsledcích hledání a v tag view
      // (odchod z nich je zavře).
      if (event.altKey && !ctrl) {
        const action =
          event.key === "ArrowLeft"
            ? goBack
            : event.key === "ArrowRight"
              ? goForward
              : event.key === "ArrowUp"
                ? goToParent
                : null;
        if (action) {
          event.preventDefault();
          action();
          return;
        }
      }
      if (event.key === "Backspace" && !ctrl && !event.altKey) {
        event.preventDefault();
        goBack();
        return;
      }

      // Zpět / Znovu míří na operace, ne na výběr — fungují všude kromě
      // textových polí (tam má Ctrl+Z vlastní význam, odfiltrováno výš).
      if (ctrl && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === "z" || key === "y") {
          event.preventDefault();
          void stepHistory(key === "z" && !event.shiftKey ? "undo" : "redo");
          return;
        }
      }

      // Tag view a výsledky hledání nemají výběr v hlavním panelu — zkratky
      // by mířily na položky podkladové složky, které uživatel nevidí
      // (nejnebezpečnější je Delete). Projdou jen ty bezpečné.
      if (tagFilter !== null || search !== null) {
        const key = event.key.toLowerCase();
        if (ctrl && key === "f") {
          event.preventDefault();
          searchRef.current?.focus();
          searchRef.current?.select();
        } else if (ctrl && key === "l") {
          event.preventDefault();
          setPathEditing(true);
        } else if (event.key === "F5" || (ctrl && key === "r")) {
          event.preventDefault();
          refresh();
        } else if (ctrl && key === "c" && overlaySelected) {
          event.preventDefault();
          putOnClipboard([overlaySelected.path], "copy");
        }
        return;
      }

      // Ctrl+Shift+. (jako Cmd+Shift+. ve Finderu) — podle fyzické klávesy,
      // tečka je na české klávese jinde než na anglické.
      if (ctrl && event.shiftKey && event.code === "Period") {
        event.preventDefault();
        toggleHidden();
        return;
      }

      if (ctrl) {
        switch (event.key.toLowerCase()) {
          case "arrowup":
            event.preventDefault();
            goToParent();
            return;
          case "arrowdown":
            event.preventDefault();
            if (activeEntry) open(activeEntry);
            return;
          case "l":
            event.preventDefault();
            setPathEditing(true);
            return;
          case "f":
            event.preventDefault();
            searchRef.current?.focus();
            searchRef.current?.select();
            return;
          case "c":
            event.preventDefault();
            copyToClipboard("copy");
            return;
          case "x":
            event.preventDefault();
            copyToClipboard("cut");
            return;
          case "v":
            event.preventDefault();
            paste();
            return;
          case "d":
            event.preventDefault();
            duplicateActive();
            return;
          case "a":
            event.preventDefault();
            selectAll();
            return;
          case "n":
            // Samotné Ctrl+N nemá co dělat — nové okno aplikace neumí.
            if (!event.shiftKey) return;
            event.preventDefault();
            newFolder();
            return;
          case "r":
            event.preventDefault();
            refresh();
            return;
          default:
            return;
        }
      }

      switch (event.key) {
        case "F5":
          event.preventDefault();
          refresh();
          break;
        case "F2":
          event.preventDefault();
          if (activeEntry) setRenamingPath(activeEntry.path);
          break;
        case "Delete":
          event.preventDefault();
          deleteTargets();
          break;
        case " ":
          if (activeEntry && !activeEntry.is_dir) {
            event.preventDefault();
            setQuickLookOpen(true);
          }
          break;
        // Column view si šipky, Home/End a psaní obsluhuje sám na svém
        // kontejneru — tady jen Icon a List View.
        case "ArrowRight":
        case "ArrowLeft":
          // V seznamu vodorovný pohyb nemá kam jít.
          if (viewMode !== "icon") break;
          event.preventDefault();
          moveSelection(event.key === "ArrowRight" ? 1 : -1, event.shiftKey);
          break;
        case "ArrowDown":
        case "ArrowUp": {
          if (isColumnView) break;
          event.preventDefault();
          // V mřížce o celý řádek — počet sloupců podle skutečné šířky okna.
          const step = viewMode === "icon" ? viewMetrics().columns : 1;
          moveSelection(event.key === "ArrowDown" ? step : -step, event.shiftKey);
          break;
        }
        case "Home":
        case "End":
          if (isColumnView) break;
          event.preventDefault();
          selectIndex(event.key === "Home" ? 0 : visibleEntries.length - 1, event.shiftKey);
          break;
        case "PageDown":
        case "PageUp": {
          if (isColumnView) break;
          event.preventDefault();
          const { columns, rowsPerPage } = viewMetrics();
          const page = columns * rowsPerPage;
          moveSelection(event.key === "PageDown" ? page : -page, event.shiftKey, smoothIfAllowed());
          break;
        }
        default:
          // Type-ahead: písmena a číslice skáčou na položku (mezerník je Quick Look).
          if (isColumnView || ctrl || event.altKey || event.key.length !== 1 || event.key === " ") break;
          {
            const found = findByPrefix(event.key, visibleEntries);
            if (found) selectIndex(visibleEntries.indexOf(found), false);
          }
          break;
        case "Escape":
          // Zrušit výběr jako ve Finderu i Průzkumníku. Column view si Escape
          // obsluhuje sám (zruší výběr v zaměřeném sloupci).
          if (isColumnView) break;
          setSelection(new Set());
          setActive(null);
          break;
        case "Enter":
          // V column view má Enter vlastní obsluhu na jeho kontejneru.
          if (isColumnView) break;
          event.preventDefault();
          if (activeEntry) open(activeEntry);
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    modalOpen,
    tagFilter,
    search,
    isColumnView,
    activeEntry,
    goToParent,
    open,
    copyToClipboard,
    paste,
    duplicateActive,
    selectAll,
    refresh,
    deleteTargets,
    newFolder,
    moveSelection,
    selectIndex,
    findByPrefix,
    visibleEntries,
    viewMode,
    goBack,
    goForward,
    overlaySelected,
    toggleHidden,
    putOnClipboard,
    stepHistory,
    toggleSplit,
    splitVisible,
    activePanel,
    transferToOther,
    cycleTab,
    switchToTabNumber,
    openTab,
    closeTab,
    currentDir,
    activeTabId,
  ]);

  /* -------------------------- boční tlačítka myši ------------------------- */

  // MB4/MB5 = zpět/vpřed v historii, přesně jako šipky v toolbaru.
  //
  // Posluchače běží v capture fázi. React má delegaci až na kontejneru a Quick
  // Look si v onMouseDown volá stopPropagation, takže v bubble fázi by událost
  // do window vůbec nedorazila.
  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      if (event.button !== 3 && event.button !== 4) return;
      // Quick Look si boční tlačítka obsluhuje sám — přepíná jimi soubory.
      if (quickLookOpen || overlayPreview !== null) return;
      if (isTypingTarget(event.target)) return;

      event.preventDefault();
      if (event.button === 3) goBack();
      else goForward();
    }

    // Bez tohohle by webview na boční tlačítka odnavigovalo vlastní historii
    // a odešlo pryč ze stránky aplikace. Ruší se proto vždy, i v Quick Look.
    function swallow(event: MouseEvent) {
      if (event.button === 3 || event.button === 4) event.preventDefault();
    }

    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mouseup", swallow, true);
    window.addEventListener("auxclick", swallow, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mouseup", swallow, true);
      window.removeEventListener("auxclick", swallow, true);
    };
  }, [quickLookOpen, overlayPreview, goBack, goForward]);

  /* ----------------------------- view mode -------------------------------- */


  const cutPaths = useMemo(
    () => new Set(clipboard?.mode === "cut" ? clipboard.paths : []),
    [clipboard],
  );

  /* ---------------------------- context menu ------------------------------ */

  const openContextMenu = useCallback((entry: FileEntry, x: number, y: number) => {
    // Pravý klik na položku, která už ve výběru je, výběr nezahazuje — jinak by
    // ze "Smazat 5 položek" zbyla jedna. Aktivní se stane ta, na které je menu
    // otevřené, aby operace pro jednu položku mířily tam, kam uživatel klikl.
    setSelection((current) => (current.has(entry.path) ? current : new Set([entry.path])));
    setActive(entry);
    checkClipboard();
    setMenu({ kind: "entry", x, y, entry, overlay: false });
  }, [checkClipboard]);

  /** Položka z výsledků hledání nebo z tag view. Výběr podkladové složky se
   *  nechává být — ta položka v něm vůbec není. */
  const openOverlayMenu = useCallback((entry: FileEntry, x: number, y: number) => {
    checkClipboard();
    setMenu({ kind: "entry", x, y, entry, overlay: true });
  }, [checkClipboard]);

  /** Pravý klik do volné plochy panelu — menu složky, ve které uživatel stojí. */
  const openBackgroundMenu = useCallback(
    (event: React.MouseEvent) => {
      // Tag view ani výsledky hledání nejsou složka, takže "Nová složka" ani
      // "Vložit" by neměly kam mířit. Nativní menu tam blokuje globální handler.
      if (tagFilter !== null || search !== null || currentDir === null) return;
      // V rozepsaném přejmenování má pravý klik nechat projít menu webview —
      // jinak by přes input vyskočilo menu složky a uživatel se nedostal
      // k vložení názvu ze schránky.
      if (isTypingTarget(event.target)) return;

      // V column view patří prázdné místo pod řádky sloupci, do kterého uživatel
      // klikl — ne nejhlubšímu otevřenému. Mimo sloupce (info panel) zbývá ten.
      const column = (event.target as Element).closest<HTMLElement>("[data-column-path]");
      const dir = column?.dataset.columnPath ?? currentDir;

      event.preventDefault();
      checkClipboard();
      setMenu({ kind: "background", x: event.clientX, y: event.clientY, dir });
    },
    [tagFilter, search, currentDir, checkClipboard],
  );

  /** Klik do prázdné plochy Icon / List View zruší výběr. Column view to řeší
   *  po sloupcích sám, overlaye výběr v podkladové složce nemají. */
  const clearSelectionOnBackground = useCallback(
    (event: React.MouseEvent) => {
      if (isColumnView || tagFilter !== null || search !== null) return;
      if ((event.target as Element).closest("[data-path]")) return;
      setSelection(new Set());
      setActive(null);
    },
    [isColumnView, tagFilter, search],
  );

  /** Tag view a výsledky hledání se navzájem vylučují — jinak by status bar
   *  hlásil počet z hledání a živé obnovení zůstalo vypnuté. */
  const selectTag = useCallback(
    (color: TagColor) => {
      if (search !== null) setQuery("");
      setSearch(null);
      setOverlaySelected(null);
      setTagFilter(color);
    },
    [search],
  );

  const openStatusMenu = useCallback(
    (x: number, y: number) => {
      if (currentDir !== null) setMenu({ kind: "status", x, y, dir: currentDir });
    },
    [currentDir],
  );

  /** Soubor přepnutý šipkami v Quick Look se označí i ve výpisu. */
  const syncQuickLookSelection = useCallback(
    (entry: FileEntry) => {
      if (isColumnView) columnsApi.select(columnsApi.focusedIndex, entry);
      else selectEntry(entry);
    },
    [isColumnView, columnsApi, selectEntry],
  );

  const openQuickLookMenu = useCallback((entry: FileEntry, x: number, y: number) => {
    setMenu({ kind: "quicklook", x, y, entry });
  }, []);

  const previewEntry = useCallback(
    (entry: FileEntry) => {
      // Náhled patří k jedné položce — výběr se proto scvrkne na ni.
      selectEntry(entry);
      setQuickLookOpen(true);
    },
    [selectEntry],
  );

  const revealInExplorer = useCallback(
    (path: string) => {
      void runOperation("op.explorer", () => openInExplorer(path));
    },
    [runOperation],
  );

  const openTerminalAt = useCallback(
    (path: string) => {
      void runOperation("op.terminal", () => openTerminal(path));
    },
    [runOperation],
  );

  const menuItems = useMemo((): MenuItem[] => {
    if (menu === null) return [];

    const copyPathItem = (path: string, label = t("menu.copyPath")): MenuItem => ({
      type: "item",
      label,
      onSelect: () => copyText(path, "op.copyPath"),
    });

    if (menu.kind === "status") {
      return [
        copyPathItem(menu.dir, t("menu.copyCurrentPath")),
        { type: "item", label: t("menu.editPath"), shortcut: "Ctrl+L", onSelect: () => setPathEditing(true) },
      ];
    }

    if (menu.kind === "quicklook") {
      const { entry } = menu;

      return [
        { type: "item", label: t("menu.open"), onSelect: () => openFile(entry) },
        {
          type: "item",
          label: t("menu.openInExplorer"),
          onSelect: () => revealInExplorer(entry.path),
        },
        { type: "separator" },
        copyPathItem(entry.path),
      ];
    }

    if (menu.kind === "background") {
      const { dir } = menu;
      const dirIsFavorite = favorites.some((item) => storage.samePath(item.path, dir));

      return [
        {
          type: "item",
          label: t("menu.newFolder"),
          shortcut: "Ctrl+Shift+N",
          onSelect: () => newFolder(dir),
        },
        { type: "item", label: t("menu.newFile"), onSelect: () => newFile(dir) },
        { type: "separator" },
        {
          type: "item",
          label: t("menu.paste"),
          shortcut: "Ctrl+V",
          disabled: !clipboardHasItems,
          onSelect: () => paste(dir),
        },
        { type: "separator" },
        {
          type: "item",
          label: t("menu.openInExplorer"),
          onSelect: () => revealInExplorer(dir),
        },
        { type: "item", label: t("menu.openInTerminal"), onSelect: () => openTerminalAt(dir) },
        copyPathItem(dir),
        { type: "separator" },
        {
          type: "submenu",
          label: t("menu.view"),
          items: [
            ...(Object.keys(VIEW_LABELS) as ViewMode[]).map(
              (mode): MenuItem & { type: "item" } => ({
                type: "item",
                label: t(VIEW_LABELS[mode]),
                checked: viewMode === mode,
                onSelect: () => changeViewMode(mode),
              }),
            ),
            { type: "separator" },
            {
              type: "item",
              label: t("menu.hiddenFiles"),
              shortcut: "Ctrl+Shift+.",
              checked: showHidden === true,
              onSelect: toggleHidden,
            },
          ],
        },
        {
          type: "submenu",
          label: t("menu.sortBy"),
          items: [
            ...(Object.keys(SORT_LABELS) as SortKey[]).map(
              (key): MenuItem & { type: "item" } => ({
                type: "item",
                label: t(SORT_LABELS[key]),
                checked: sortKey === key,
                onSelect: () => setSortKey(key),
              }),
            ),
            { type: "separator" },
            {
              type: "item",
              label: t("sort.ascending"),
              checked: sortDirection === "asc",
              onSelect: () => setSortDirection("asc"),
            },
            {
              type: "item",
              label: t("sort.descending"),
              checked: sortDirection === "desc",
              onSelect: () => setSortDirection("desc"),
            },
          ],
        },
        { type: "separator" },
        {
          type: "item",
          label: t("menu.selectAll"),
          shortcut: "Ctrl+A",
          // V column view výběr celé složky neexistuje, řádky jsou po jednom.
          disabled: isColumnView || visibleEntries.length === 0,
          onSelect: selectAll,
        },
        { type: "item", label: t("menu.refresh"), shortcut: "F5", onSelect: refresh },
        // Bez tohohle šlo do sidebaru dostat jen složku, kterou uživatel vidí
        // ve výpisu — tu, ve které zrovna stojí, nijak.
        {
          type: "item",
          label: dirIsFavorite ? t("menu.removeFromFavorites") : t("menu.addToFavorites"),
          onSelect: () => {
            if (dirIsFavorite) void storage.removeFavorite(dir);
            else
              void storage.addFavorite({
                label: storage.lastSegment(dir),
                path: dir,
                icon: "Folder",
                type: "folder",
              });
          },
        },
        { type: "separator" },
        {
          type: "item",
          label: t("menu.folderProperties"),
          onSelect: () => setPropertiesFor(folderEntry(dir)),
        },
      ];
    }

    const { entry, overlay } = menu;
    // Ve výsledcích hledání a v tag view míří všechno jen na položku pod myší.
    const targets = overlay ? [entry] : targetEntries;
    const count = targets.length;
    // Operace pro jednu položku nemají u víceřádkového výběru co dělat —
    // přejmenovat pět souborů jedním inputem nejde a Vlastnosti by ukázaly jedny.
    const single = count <= 1;
    const isFavorite = favorites.some((item) => storage.samePath(item.path, entry.path));
    const entryTags = storage.tagsOf(tags, entry.path);
    // Vložit z výsledků hledání míří do té složky (nebo do složky toho souboru),
    // na kterou uživatel klikl — podkladová složka pod výsledky není vidět.
    const pasteTarget = overlay ? (entry.is_dir ? entry.path : parentPath(entry.path)) : undefined;

    // null = položka, která se v tomhle menu nehodí (náhled u složky, oblíbené
    // u souboru). Vyfiltruje se až nakonec, aby se seznam dal psát lineárně.
    // Tagy celého výběru: barva je "zapnutá", když ji mají všechny položky.
    const targetPaths = targets.map((item) => item.path);
    const sharedTags = TAG_COLORS.filter((color) =>
      targetPaths.every((path) => storage.tagsOf(tags, path).includes(color)),
    );
    const anyTags = targetPaths.some((path) => storage.tagsOf(tags, path).length > 0);

    const items: (MenuItem | null)[] = [
      // Menu nad výběrem víc položek řekne rovnou, na kolik míří.
      single ? null : { type: "header", label: formatItemCount(count) },
      {
        type: "item",
        label: t("menu.open"),
        shortcut: "Enter",
        // open() by soubor označil v podkladové složce, kde vůbec není.
        onSelect: () => (overlay ? openFromResults(entry) : open(entry)),
      },
      entry.is_dir
        ? { type: "item", label: t("menu.openInNewTab"), onSelect: () => openTab(entry.path) }
        : null,
      // Výsledky hledání a tag view jsou rozcestník — odtud se položka odkrývá
      // v její složce (dřív to dělal jeden klik).
      overlay && parentPath(entry.path) !== null
        ? {
            type: "item",
            label: t("menu.showInFolder"),
            onSelect: () => reveal(entry.path),
          }
        : null,
      entry.is_dir
        ? null
        : {
            type: "item",
            label: t("menu.quickLook"),
            shortcut: "Space",
            onSelect: () => (overlay ? setOverlayPreview(entry) : previewEntry(entry)),
          },
      entry.is_dir
        ? null
        : {
            type: "item",
            label: t("menu.openWith"),
            disabled: !single,
            onSelect: () => {
              void runOperation("op.openWith", () => openWith(entry.path));
            },
          },
      { type: "separator" },
      {
        type: "item",
        label: t("menu.openInExplorer"),
        disabled: !single,
        onSelect: () => revealInExplorer(entry.path),
      },
      {
        type: "item",
        label: t("menu.openInTerminal"),
        disabled: !single,
        onSelect: () => openTerminalAt(entry.path),
      },
      // Do "Moje oblíbené" smí složka i soubor: klik na složku tam naviguje,
      // klik na soubor ho otevře v systémové aplikaci.
      {
        type: "item",
        label: isFavorite ? t("menu.removeFromFavorites") : t("menu.addToFavorites"),
        disabled: !single,
        onSelect: () => {
          if (isFavorite) void storage.removeFavorite(entry.path);
          else
            void storage.addFavorite({
              label: entry.name,
              path: entry.path,
              icon: "Folder",
              type: entry.is_dir ? "folder" : "file",
            });
        },
      },
      { type: "separator" },
      {
        type: "item",
        label: t("menu.rename"),
        shortcut: "F2",
        disabled: !single,
        // Výsledky hledání nemají inline přejmenování — odkryje se položka v její
        // složce a přejmenování se otevře až tam.
        onSelect: () => {
          if (overlay) reveal(entry.path, true);
          else setRenamingPath(entry.path);
        },
      },
      {
        type: "item",
        label: t("menu.duplicate"),
        shortcut: "Ctrl+D",
        disabled: !single,
        onSelect: () => duplicateEntry(entry, !overlay),
      },
      { type: "separator" },
      {
        type: "item",
        label: single ? t("menu.copy") : t("menu.copyCount", { count }),
        shortcut: "Ctrl+C",
        onSelect: () => copyToClipboard("copy", targets),
      },
      {
        type: "item",
        label: single ? t("menu.cut") : t("menu.cutCount", { count }),
        shortcut: "Ctrl+X",
        onSelect: () => copyToClipboard("cut", targets),
      },
      {
        type: "item",
        label: t("menu.paste"),
        shortcut: "Ctrl+V",
        disabled: !clipboardHasItems || pasteTarget === null,
        onSelect: () => paste(pasteTarget ?? undefined),
      },
      otherDir === null || overlay ? null : { type: "separator" },
      otherDir === null || overlay
        ? null
        : { type: "item", label: t("split.copyToOther"), shortcut: "F5", onSelect: () => transferToOther("copy", targets) },
      otherDir === null || overlay
        ? null
        : { type: "item", label: t("split.moveToOther"), shortcut: "F6", onSelect: () => transferToOther("cut", targets) },
      { type: "separator" },
      {
        type: "item",
        label: single ? t("menu.copyPath") : t("menu.copyPaths"),
        // U výběru se kopírují všechny cesty po řádcích — tak je vezme každý editor.
        onSelect: () =>
          copyText(
            single ? entry.path : targets.map((item) => item.path).join("\r\n"),
            single ? "op.copyPath" : "op.copyPaths",
          ),
      },
      {
        type: "item",
        label: single ? t("menu.copyName") : t("menu.copyNames"),
        onSelect: () =>
          copyText(
            single ? entry.name : targets.map((item) => item.name).join("\r\n"),
            single ? "op.copyName" : "op.copyNames",
          ),
      },
      { type: "separator" },
      {
        type: "item",
        label: single ? t("menu.delete") : t("menu.deleteCount", { count }),
        shortcut: "Delete",
        danger: true,
        onSelect: () => deleteEntries(targets),
      },
      { type: "separator" },
      {
        type: "tags",
        label: t("menu.tags"),
        active: single ? entryTags : sharedTags,
        // U výběru se barva přidá všem (nebo všem odebere, když ji mají všichni).
        onToggle: (color) =>
          single
            ? changeTags([entry.path], () => storage.toggleTag(entry.path, color))
            : changeTags(targetPaths, () => storage.setTag(targetPaths, color, !sharedTags.includes(color))),
      },
      !anyTags
        ? null
        : {
            type: "item",
            label: t("menu.removeTags"),
            onSelect: () =>
              changeTags(targetPaths, async () => {
                for (const path of targetPaths) await storage.clearTags(path);
              }),
          },
      { type: "separator" },
      {
        type: "item",
        label: t("menu.properties"),
        disabled: !single,
        onSelect: () => setPropertiesFor(entry),
      },
    ];

    return items.filter((item): item is MenuItem => item !== null);
  }, [
    menu,
    tags,
    favorites,
    targetEntries,
    clipboardHasItems,
    isColumnView,
    visibleEntries.length,
    viewMode,
    sortKey,
    sortDirection,
    showHidden,
    toggleHidden,
    open,
    openFile,
    openFromResults,
    reveal,
    previewEntry,
    revealInExplorer,
    openTerminalAt,
    runOperation,
    duplicateEntry,
    copyToClipboard,
    copyText,
    paste,
    deleteEntries,
    newFolder,
    newFile,
    refresh,
    selectAll,
    changeViewMode,
    changeTags,
    openTab,
    otherDir,
    transferToOther,
    locale,
  ]);

  /* ------------------------- menu tlačítek toolbaru ------------------------ */

  const toolbarSortItems = useMemo(
    (): MenuItem[] => [
      ...(Object.keys(SORT_LABELS) as SortKey[]).map(
        (key): MenuItem => ({
          type: "item",
          label: t(SORT_LABELS[key]),
          checked: sortKey === key,
          onSelect: () => setSortKey(key),
        }),
      ),
      { type: "separator" },
      {
        type: "item",
        label: t("sort.ascending"),
        checked: sortDirection === "asc",
        onSelect: () => setSortDirection("asc"),
      },
      {
        type: "item",
        label: t("sort.descending"),
        checked: sortDirection === "desc",
        onSelect: () => setSortDirection("desc"),
      },
    ],
    [sortKey, sortDirection, locale],
  );

  /** Zpět / Znovu na začátku menu Více — s názvem operace, jako ve Finderu. */
  const historyItems = useMemo((): MenuItem[] => {
    const lastUndo = history.undo[history.undo.length - 1];
    const lastRedo = history.redo[history.redo.length - 1];
    return [
      {
        type: "item",
        label: lastUndo ? t("undo.undoAction", { action: undoLabel(lastUndo) }) : t("undo.undo"),
        shortcut: "Ctrl+Z",
        disabled: lastUndo === undefined,
        onSelect: () => void stepHistory("undo"),
      },
      {
        type: "item",
        label: lastRedo ? t("undo.redoAction", { action: undoLabel(lastRedo) }) : t("undo.redo"),
        shortcut: "Ctrl+Shift+Z",
        disabled: lastRedo === undefined,
        onSelect: () => void stepHistory("redo"),
      },
    ];
  }, [history, stepHistory, locale]);

  // Sdílet míří na výběr; bez výběru na složku, ve které uživatel stojí.
  const sharePaths = useMemo(
    () =>
      targetEntries.length > 0
        ? targetEntries.map((entry) => entry.path)
        : currentDir !== null
          ? [currentDir]
          : [],
    [targetEntries, currentDir],
  );

  const toolbarShareItems = useMemo((): MenuItem[] => {
    const single = sharePaths.length === 1;
    const text = sharePaths.join("\r\n");

    return [
      {
        type: "item",
        label: single ? t("menu.copyPath") : t("menu.copyPaths"),
        disabled: sharePaths.length === 0,
        onSelect: () => copyText(text, single ? "op.copyPath" : "op.copyPaths"),
      },
      {
        type: "item",
        label: t("menu.copyFiles"),
        disabled: sharePaths.length === 0,
        // Jako soubory (CF_HDROP) — vloží je Průzkumník i příloha v mailu.
        onSelect: () => putOnClipboard(sharePaths, "copy"),
      },
      { type: "separator" },
      {
        type: "item",
        label: t("menu.openInExplorer"),
        disabled: sharePaths.length === 0,
        onSelect: () => revealInExplorer(sharePaths[0]),
      },
    ];
  }, [sharePaths, copyText, putOnClipboard, revealInExplorer, locale]);

  // Štítky výběru: barva je zaškrtnutá, když ji mají všechny vybrané položky.
  // Klik ji pak všem odebere, jinak ji přidá všem — jako ve Finderu.
  const toolbarTagItems = useMemo((): MenuItem[] | null => {
    if (targetEntries.length === 0) return null;
    const paths = targetEntries.map((entry) => entry.path);

    return TAG_COLORS.map((color): MenuItem => {
      const everywhere = paths.every((path) => storage.tagsOf(tags, path).includes(color));
      return {
        type: "item",
        label: tagLabel(color),
        dot: TAG_HEX[color],
        checked: everywhere,
        onSelect: () => changeTags(paths, () => storage.setTag(paths, color, !everywhere)),
      };
    });
  }, [targetEntries, tags, changeTags, locale]);

  // Ikona před názvem v toolbaru: stejná jako u složky v sidebaru, jinak
  // obecná složka; v tag view puntík barvy, ve výsledcích lupa.
  const folderIcon = (() => {
    if (tagFilter !== null) {
      return (
        <span
          className="block rounded-full"
          style={{ width: 12, height: 12, background: TAG_HEX[tagFilter] }}
        />
      );
    }
    if (search !== null) return <Search size={16} strokeWidth={1.75} className="text-secondary" />;

    for (const section of sections) {
      const item = section.items.find(
        (candidate) => nav.current !== null && storage.samePath(candidate.path, nav.current),
      );
      if (item) {
        const Icon = sidebarIcon(item.icon_name);
        return (
          <Icon size={16} strokeWidth={1.75} color={sidebarIconColor(section.id)} />
        );
      }
    }
    return <FolderIcon size={16} />;
  })();

  const crumbs = nav.current ? breadcrumbs(nav.current) : [];
  const folderName =
    tagFilter !== null
      ? tagLabel(tagFilter)
      : search !== null
        ? t("toolbar.searchResults")
        : crumbs.length > 0
          ? folderDisplayName(crumbs[crumbs.length - 1].path, crumbs[crumbs.length - 1].label)
          : "Finder";

  // Status bar i Quick Look musí počítat s tím, co je opravdu vidět —
  // v column view tedy se zaměřeným sloupcem, ne s obsahem nav.current.
  const needle = filterQuery.trim().toLowerCase();

  const columnEntries = focusedColumn?.entries ?? [];
  const visibleColumnEntries = needle
    ? columnEntries.filter((entry) => entry.name.toLowerCase().includes(needle))
    : columnEntries;

  const previewEntries = isColumnView ? visibleColumnEntries : visibleEntries;

  const inTagView = tagFilter !== null;
  const inSearch = search !== null;

  // Ve výsledcích hledání není "z kolika" — počet nálezů je zároveň celek,
  // jinak by status bar hlásil zavádějící "N z M (filtr)".
  const statusVisibleCount = inSearch
    ? searchCount
    : inTagView
      ? tagCount
      : isColumnView
        ? visibleColumnEntries.length
        : visibleEntries.length;
  const statusTotalCount = inSearch
    ? searchCount
    : inTagView
      ? tagCount
      : isColumnView
        ? columnEntries.length
        : sortedEntries.length;

  // "Vybráno N z M" — ve výsledcích a v tag view výběr v podkladové složce není.
  const statusSelectedCount =
    inSearch || inTagView ? 0 : isColumnView ? (columnSelected ? 1 : 0) : targetEntries.length;

  /** Jeden panel: proužek načítání, výpis a vrstva pro snímek při přepnutí view. */
  function renderPanel(index: 0 | 1) {
    const q = panels[index];
    return (
      <div
        className={`fw-panel relative flex min-h-0 min-w-0 flex-col ${
          splitVisible && index === activePanel ? "is-active" : ""
        }`}
        style={splitVisible ? { flex: index === 0 ? `0 0 ${splitRatio * 100}%` : "1 1 0" } : { flex: "1 1 0" }}
        // Klik kamkoli do panelu ho nejdřív aktivuje — teprve pak dojde na
        // výběr, menu nebo tažení, a ty už míří na tenhle panel.
        onMouseDownCapture={() => activatePanel(index)}
        onDragStartCapture={() => activatePanel(index)}
      >
          {/* Navigace i přenačtení nechávají obsah na místě, takže by jinak
              nebylo nijak poznat, že se něco děje. */}
          {(q.loading || (q.isColumnView && q.columnsApi.rootLoading)) && q.search === null && q.tagFilter === null && (
            <div className="fw-busy-line" aria-hidden />
          )}

          {/* key vynutí nový kontejner pro každé view (virtualizace si ho
              přeměří). Menu volné plochy visí až tady, ne ve views — prázdno
              pod řádky patří tomuhle scroll kontejneru, takže by ho mřížka
              IconView nezachytila. Řádky si událost zastaví u sebe. */}
          <div
            key={q.viewMode}
            ref={q.attachScroll}
            data-view={q.viewMode}
            onContextMenu={openBackgroundMenu}
            onClick={clearSelectionOnBackground}
            onScroll={(event) => {
              // Pozice patří složce, jejíž výpis je právě vidět.
              const shown = q.loadedPathRef.current;
              if (shown !== null && !q.isColumnView) {
                q.scrollMemory.current.set(storage.pathKey(shown), event.currentTarget.scrollTop);
              }
            }}
            onMouseDown={(event) => {
              // Gumička jen nad výpisem složky — column view má vlastní po
              // sloupcích, výsledky hledání a tag view výběr nemají.
              if (!q.isColumnView && q.tagFilter === null && q.search === null) q.band.onMouseDown(event);
            }}
            onDragOver={(event) => {
              if (backgroundDropDir(q, event) === null) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = event.ctrlKey ? "copy" : "move";
              setBackgroundDrop(index);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setBackgroundDrop(null);
            }}
            onDrop={(event) => {
              setBackgroundDrop(null);
              const dir = backgroundDropDir(q, event);
              if (dir === null) return;
              event.preventDefault();
              const copy = event.ctrlKey;
              const payload = getDrag();
              if (!isExternalFileDrag(event) && payload?.kind === "entry") {
                // Položky z druhého panelu do složky, kterou ukazuje tenhle.
                endDrag();
                dropInto(dir, payload.items.map((item) => item.path), copy);
                return;
              }
              void droppedPaths(event.dataTransfer).then((paths) => {
                if (paths.length > 0) dropInto(dir, paths, copy);
              });
            }}
            className={`fw-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto ${
              backgroundDrop === index ? "fw-drop-zone" : ""
            }`}
          >
            {renderContent(q)}
            {q.band.overlay}
          </div>

          {/* Sem se při přepnutí view vloží snímek starého (spawnViewGhost).
              React do vrstvy nic nevykresluje, takže mu cizí uzel nevadí. */}
          <div ref={q.ghostHost} className="pointer-events-none absolute inset-0 z-10 empty:hidden" />
      </div>
    );
  }

  function renderContent(q: Panel) {
    const {
      tagFilter,
      overlaySelected,
      setOverlaySelected,
      refreshToken,
      setTagCount,
      search,
      setSearchCount,
      nav,
      error,
      isColumnView,
      columnsApi,
      renamingPath,
      setRenamingPath,
      pathEditing,
      awaitingFolder,
      skeletonShown,
      loadedPath,
      viewMode,
      loaded,
      scrollMemory,
    } = q;
    // Neaktivní panel ukazuje výběr šedě, jako okno bez fokusu.
    const windowFocused = windowFocusedAll && q === panel;

    if (tagFilter !== null) {
      return (
        <TagView
          color={tagFilter}
          windowFocused={windowFocused}
          selectedPath={overlaySelected?.path ?? null}
          onSelectionChange={setOverlaySelected}
          onOpen={openFromResults}
          onContextMenu={openOverlayMenu}
          refreshToken={refreshToken}
          onCountChange={setTagCount}
        />
      );
    }

    if (search !== null) {
      return (
        <SearchView
          root={search.root}
          query={search.query}
          windowFocused={windowFocused}
          selectedPath={overlaySelected?.path ?? null}
          onSelectionChange={setOverlaySelected}
          onOpen={openFromResults}
          onContextMenu={openOverlayMenu}
          refreshToken={refreshToken}
          showHidden={showHidden ?? false}
          onCountChange={setSearchCount}
        />
      );
    }

    if (nav.current === null) {
      // Bez složky je jediné místo pro chybu (typicky z get_favorites) tady —
      // jinak by uživatel koukal na prázdný sidebar i panel bez vysvětlení.
      return <Placeholder>{error ?? t("empty.start")}</Placeholder>;
    }

    if (isColumnView) {
      return (
        <ColumnView
          api={columnsApi}
          windowFocused={windowFocused}
          onOpenFile={openFile}
          cutPaths={cutPaths}
          renamingPath={renamingPath}
          onRenameSubmit={submitRename}
          onRenameCancel={() => setRenamingPath(null)}
          onContextMenu={openContextMenu}
          tags={tags}
          suspended={modalOpen || renamingPath !== null || pathEditing || q !== panel}
          onDropInto={dropInto}
        />
      );
    }

    // Navigace obsah nevyprazdňuje: dokud nedorazí nová složka, zůstává
    // (neaktivní) ta předchozí pod proužkem načítání. Kostra až po 400 ms,
    // a hned jen tam, kde žádný předchozí obsah není (start aplikace).
    if (awaitingFolder && (skeletonShown || loadedPath === null)) {
      return skeletonShown ? <Skeleton view={viewMode === "list" ? "list" : "icon"} /> : null;
    }

    // Zpět / Vpřed se vrací tam, kde uživatel ve složce byl; jinak od začátku.
    const restoreTop =
      loaded.direction === "back" || loaded.direction === "forward"
        ? (scrollMemory.current.get(storage.pathKey(loadedPath ?? "")) ?? 0)
        : 0;

    return (
      <ViewTransition
        id={loadedPath}
        direction={loaded.direction}
        scrollTop={restoreTop}
        inert={awaitingFolder}
      >
        {renderFolder(q, restoreTop)}
      </ViewTransition>
    );
  }

  /** Obsah načtené složky v Icon / List View. */
  function renderFolder(q: Panel, initialOffset: number) {
    const {
      error,
      visibleEntries,
      query,
      selection,
      renamingPath,
      setRenamingPath,
      clickSelect,
      scrollRef,
      viewHandle,
      viewMode,
      sortKey,
      sortDirection,
      sortBy,
    } = q;
    const windowFocused = windowFocusedAll && q === panel;

    if (error) return <Placeholder>{failure("op.openFolder", error)}</Placeholder>;
    if (visibleEntries.length === 0) {
      return query ? (
        <EmptyState
          Icon={SearchX}
          title={t("empty.noMatches", { query: query.trim() })}
          hint={t("empty.noMatchesHint")}
        />
      ) : (
        <EmptyState
          Icon={FolderOpen}
          title={t("empty.folder")}
          hint={showHidden ? undefined : t("empty.folderHint")}
        />
      );
    }

    const shared = {
      entries: visibleEntries,
      selectedPaths: selection,
      cutPaths,
      windowFocused,
      renamingPath,
      onRenameSubmit: submitRename,
      onRenameCancel: () => setRenamingPath(null),
      onSelect: clickSelect,
      onDropInto: dropInto,
      onOpen: open,
      onContextMenu: openContextMenu,
      tags,
      scrollRef,
      handleRef: viewHandle,
      initialOffset,
    };

    if (viewMode === "list") {
      return (
        <ListView
          {...shared}
          sortKey={sortKey}
          sortDirection={sortDirection}
          onSort={sortBy}
        />
      );
    }

    return <IconView {...shared} />;
  }

  return (
    // 100 %, ne 100vw/100vh: vw se při zlomkovém škálování zaokrouhlí a na
    // okraji by zůstal proužek podkladu.
    <div
      className={`fw-app flex h-full w-full flex-col overflow-hidden bg-window text-primary ${
        ready ? "is-ready" : ""
      }`}
    >
      <TitleBar />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          sections={sections}
          currentPath={nav.current}
          windowFocused={windowFocused}
          onNavigate={navigate}
          onOpenFile={openRecentFile}
          onReveal={reveal}
          activeTag={tagFilter}
          onSelectTag={selectTag}
          onDropInto={dropInto}
          onError={setNotice}
          onConfirm={setConfirm}
        />

        <main className="flex min-w-0 flex-1 flex-col bg-main">
          <Toolbar
            folderName={folderName}
            // Přeložený popisek ("Pictures") nesmí schovat, kde složka opravdu je.
            folderPath={tagFilter === null && search === null ? nav.current : null}
            folderIcon={folderIcon}
            canGoBack={nav.back.length > 0}
            canGoForward={nav.forward.length > 0}
            onBack={goBack}
            onForward={goForward}
            viewMode={viewMode}
            onViewModeChange={changeViewMode}
            theme={theme}
            onToggleTheme={toggleTheme}
            query={query}
            onQueryChange={setQuery}
            onSearchSubmit={submitSearch}
            onSearchArrowDown={() =>
              // Z pole hledání šipkou dolů rovnou do výsledků.
              document.querySelector<HTMLElement>('[role="listbox"] [role="option"]')?.focus()
            }
            searchRef={searchRef}
            onRefresh={refresh}
            onGoToParent={goToParent}
            canGoToParent={currentDir !== null && parentPath(currentDir) !== null}
            onShowAbout={() => setAboutOpen(true)}
            showHidden={showHidden ?? false}
            onToggleHidden={toggleHidden}
            motion={motion}
            onMotionChange={(value) => void storage.setMotion(value)}
            checkUpdates={updates.check}
            onCheckUpdatesChange={(value) => void storage.setUpdates({ check: value })}
            sortItems={toolbarSortItems}
            shareItems={toolbarShareItems}
            tagItems={toolbarTagItems}
            historyItems={historyItems}
            onNewTab={() => openTab(currentDir)}
            canNewTab={currentDir !== null}
            split={splitOn}
            onToggleSplit={toggleSplit}
            onMenuOpenChange={setToolbarMenuOpen}
          />

          {tabs.length > 1 && (
            <TabBar
              tabs={tabs.map((tab) => ({
                id: tab.id,
                path: tab.id === activeTabId ? nav.current : tabFace(tab).nav.current,
                closing: tab.closing === true,
                fresh: tab.fresh === true,
              }))}
              activeId={activeTabId}
              windowFocused={windowFocused}
              onSelect={switchTab}
              onClose={closeTab}
              onReorder={reorderTab}
              onDropInto={dropInto}
              onNew={() => openTab(currentDir)}
            />
          )}

          <div ref={panelsBoxRef} className="flex min-h-0 flex-1">
            {visiblePanels.map((index) => (
              <Fragment key={index}>
                {index === 1 && splitVisible && (
                  <div
                    className="fw-split-divider"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={t("split.divider")}
                    onPointerDown={startSplitResize}
                    onDoubleClick={() => void storage.setSplitRatio(0.5)}
                  />
                )}
                {renderPanel(index)}
              </Fragment>
            ))}
          </div>
        </main>
      </div>

      {update && updates.check && (
        <div className="fw-update-bar" role="status">
          <span className="min-w-0 truncate">{t("update.available", { version: update.version })}</span>
          <button
            type="button"
            className="fw-update-link"
            onClick={() =>
              invoke("open_release_page", { url: update.url }).catch((err: unknown) =>
                setNotice(failure("op.openRelease", err)),
              )
            }
          >
            {t("update.download")}
          </button>
          <button
            type="button"
            aria-label={t("update.dismiss")}
            data-tooltip={t("update.dismiss")}
            onClick={() => setUpdate(null)}
            className="ml-auto shrink-0 text-secondary hover:text-primary"
          >
            <X size={12} strokeWidth={2.5} />
          </button>
        </div>
      )}

      <StatusBar
        path={currentDir}
        itemCount={statusVisibleCount}
        streamingCount={isColumnView || inSearch || inTagView ? null : streamingCount}
        totalCount={statusTotalCount}
        // Ve výsledcích hledání a v tag view je dotaz celek, ne filtr —
        // jinak by status hlásil "12 z 12 (filtr)".
        filtered={needle.length > 0 && !inSearch && !inTagView}
        selectedCount={statusSelectedCount}
        freeSpace={freeSpace}
        onNavigate={navigate}
        editing={pathEditing}
        onEditingChange={setPathEditing}
        onContextMenu={openStatusMenu}
      />

      {/* Hláška plave nad status barem. Vnější obal centruje, vnitřní animuje —
          keyframes přepisují transform, takže by centrování translateX sežraly. */}
      {notice && (
        <div
          className="pointer-events-none fixed inset-x-0 z-40 flex justify-center"
          style={{ bottom: 32 }}
        >
          <div
            role={notice.sticky ? "alert" : "status"}
            className={`fw-popover pointer-events-auto flex max-w-[70%] items-center gap-2.5 rounded-[8px] px-3 py-2 text-[13px] ${
              noticeClosing ? "fw-toast-out" : "fw-toast-in"
            }`}
          >
            {/* Chyba (zůstává) červeně, informace / úspěch zeleně. */}
            {notice.sticky ? (
              <CircleAlert size={16} strokeWidth={2} className="shrink-0" color="var(--danger)" aria-hidden />
            ) : (
              <CircleCheck size={16} strokeWidth={2} className="shrink-0" color="var(--success)" aria-hidden />
            )}
            <span className="min-w-0 flex-1 text-primary">{notice.text}</span>
            <button
              type="button"
              aria-label={t("common.close")}
              onClick={() => setNoticeClosing(true)}
              className="shrink-0 text-secondary hover:text-primary"
            >
              <X size={12} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}

      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}

      {conflict && (
        <ConflictDialog
          {...conflict.request}
          onAnswer={(answer) => {
            setConflict(null);
            conflict.resolve(answer);
          }}
          onCancel={() => {
            setConflict(null);
            conflict.resolve(null);
          }}
        />
      )}

      {propertiesFor && (
        <PropertiesDialog entry={propertiesFor} onClose={() => setPropertiesFor(null)} />
      )}

      {aboutOpen && (
        <AboutDialog onClose={() => setAboutOpen(false)} />
      )}

      {quickLookOpen && activeEntry && !activeEntry.is_dir && (
        <QuickLook
          entries={previewEntries}
          entry={activeEntry}
          onClose={() => setQuickLookOpen(false)}
          onOpenFile={openFile}
          onContextMenu={openQuickLookMenu}
          onCurrentChange={syncQuickLookSelection}
        />
      )}

      {overlayPreview && (
        <QuickLook
          entries={[overlayPreview]}
          entry={overlayPreview}
          onClose={() => setOverlayPreview(null)}
          onOpenFile={openFile}
          onContextMenu={openQuickLookMenu}
        />
      )}

      <TooltipLayer />
    </div>
  );
}
