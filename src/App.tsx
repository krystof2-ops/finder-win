import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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
import { TagView } from "./components/TagView";
import { FolderIcon, sidebarIcon, sidebarIconColor } from "./components/icons";
import { TitleBar } from "./components/TitleBar";
import { Toolbar } from "./components/Toolbar";
import { TooltipLayer } from "./components/Tooltip";
import { Skeleton, ViewTransition } from "./components/ViewTransition";
import { useColumns } from "./columns";
import {
  copyPath,
  createFile,
  createFolder,
  duplicatePath,
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
  sortEntries,
  type SortDirection,
  type SortKey,
} from "./format";
import { isTypingTarget } from "./lib/dom";
import { motionMs } from "./lib/motion";
import * as storage from "./lib/storage";
import { TAG_COLORS, TAG_HEX, TAG_LABEL } from "./lib/tags";
import { useRubberBand } from "./lib/rubberBand";
import { setSpecialFolders } from "./lib/specialFolders";
import { useStorage } from "./lib/useStorage";
import type { ViewHandle } from "./lib/viewHandle";
import { INITIAL_NAV, navReducer, type NavDirection } from "./navigation";
import { applyTheme, readStoredTheme } from "./theme";
import type {
  Clipboard,
  FavoriteSection,
  FileEntry,
  SelectMods,
  StatResult,
  TagColor,
  Theme,
  ViewMode,
} from "./types";

/** Jak dlouho hláška zůstane, než sama odjede. Musí sedět s fw-toast-out. */
const TOAST_VISIBLE_MS = 2000;
const TOAST_EXIT_MS = 240;

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

/** Výchozí název nové složky. Windows i Finder nechají uživatele hned přepsat. */
const NEW_FOLDER_NAME = "Nová složka";
/** Stejný výchozí název, jaký dává Průzkumník. */
const NEW_FILE_NAME = "Nový textový dokument.txt";

const VIEW_LABELS: Record<ViewMode, string> = {
  icon: "Ikony",
  list: "Seznam",
  column: "Sloupce",
};

const SORT_LABELS: Record<SortKey, string> = {
  name: "Název",
  modified: "Datum úpravy",
  size: "Velikost",
  kind: "Druh",
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


/** Odpověď `list_dir_stream` a jeho dávky (`dir-chunk`). */
type DirListing = { entries: FileEntry[]; more: boolean };
type DirChunk = { token: number; entries: FileEntry[]; done: boolean };

/** Zpoždění filtru výpisu za psaním do pole hledání. */
const FILTER_DEBOUNCE_MS = 100;

/** Psaní písmen skáče na položku; po téhle pauze začíná nové slovo. */
const TYPE_AHEAD_RESET_MS = 1000;

/** Do téhle doby zůstává při navigaci vidět starý výpis; déle = kostra. */
const SKELETON_DELAY_MS = 400;

/**
 * Snímek view, které se právě opouští (ikony / seznam / sloupce). Klon DOMu
 * bez identifikátorů — querySelector na data-path ani role nesmí najít jeho
 * řádky místo skutečných. Posuny vnořených scrollerů (sloupce) klon sám
 * nepřevezme, proto se kopírují ručně.
 */
function spawnViewGhost(source: HTMLElement, host: HTMLElement) {
  const ghost = source.cloneNode(true) as HTMLElement;
  for (const element of [ghost, ...ghost.querySelectorAll<HTMLElement>("*")]) {
    for (const name of ["id", "data-path", "data-column-path", "data-tooltip", "role", "tabindex"]) {
      element.removeAttribute(name);
    }
  }
  ghost.className = "fw-view-ghost";
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  host.appendChild(ghost);

  const sources = [source, ...source.querySelectorAll<HTMLElement>("*")];
  const copies = [ghost, ...ghost.querySelectorAll<HTMLElement>("*")];
  sources.forEach((element, index) => {
    if (element.scrollTop === 0 && element.scrollLeft === 0) return;
    copies[index].scrollTop = element.scrollTop;
    copies[index].scrollLeft = element.scrollLeft;
  });

  const remove = () => ghost.remove();
  ghost.addEventListener("animationend", remove, { once: true });
  // Pojistka: s vypnutými animacemi (0 ms) se animationend nemusí dostavit.
  window.setTimeout(remove, motionMs("--dur-nav") + 50);
}

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

  const [sections, setSectionsState] = useState<FavoriteSection[]>([]);
  /** Sekce sidebaru — a z Oblíbených se odvodí speciální složky s glyfem. */
  const setSections = useCallback((next: FavoriteSection[]) => {
    setSpecialFolders(next.find((section) => section.label === "Oblíbené")?.items ?? []);
    setSectionsState(next);
  }, []);
  const [nav, dispatch] = useReducer(navReducer, INITIAL_NAV);

  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  /** Velká složka se dočítá po dávkách — kolik položek už dorazilo, jinak null. */
  const [streamingCount, setStreamingCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  const [freeSpace, setFreeSpace] = useState<number | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  // Aktivní položka řídí operace pro jednu položku (přejmenování, Quick Look,
  // vlastnosti); selection drží celý výběr pro hromadné operace.
  const [active, setActive] = useState<FileEntry | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());

  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [pathEditing, setPathEditing] = useState(false);
  const [menu, setMenu] = useState<MainMenu | null>(null);
  const [propertiesFor, setPropertiesFor] = useState<FileEntry | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  // Tag view je samostatný režim hlavního panelu — nesouvisí s nav.current,
  // proto vlastní stav a ne další ViewMode.
  const [tagFilter, setTagFilter] = useState<TagColor | null>(null);
  const [tagCount, setTagCount] = useState(0);

  // Rekurzivní hledání je stejně jako tag view samostatný režim panelu. Kořen
  // se drží spolu s dotazem, aby výsledky nezůstaly viset na jiné složce, než
  // ve které se opravdu hledalo.
  const [search, setSearch] = useState<{ root: string; query: string } | null>(null);
  const [searchCount, setSearchCount] = useState(0);
  /** Co se má označit, až dorazí výpis složky `dir`. `seq` je stav načítacího
   *  čítače v okamžiku požadavku — čeká se, až se posune. Bez toho by se
   *  požadavek po přejmenování zahodil hned proti ještě starému výpisu, ve
   *  kterém nová cesta pochopitelně není. */
  const [pendingSelect, setPendingSelect] = useState<{
    dir: string;
    path: string;
    seq: number;
    /** Totéž pro Column View: `version` sloupce s cestou `dir` v okamžiku
     *  požadavku (-1, když takový sloupec není otevřený). */
    columnVersion: number;
    /** Po označení rovnou otevřít přejmenování (Přejmenovat z výsledků hledání). */
    rename?: boolean;
  } | null>(null);
  /** Složka, ke které patří obsah `entries`, a pořadí jejího načtení. Cesta
   *  není totéž co nav.current — ten se změní hned, kdežto entries dojedou až
   *  po odpovědi backendu. */
  /** `direction` = jak se do složky přišlo (null u přenačtení a přepnutí view). */
  const [loaded, setLoaded] = useState<{
    path: string | null;
    seq: number;
    direction: NavDirection | null;
  }>({ path: null, seq: 0, direction: null });
  const loadedPath = loaded.path;

  const { tags, favorites } = useStorage();

  const [viewMode, setViewMode] = useState<ViewMode>("icon");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [query, setQuery] = useState("");
  // Filtr výpisu jede se zpožděním 100 ms — v tisícové složce by každý úhoz
  // přefiltroval a překreslil všechno. Smazání pole platí hned.
  const [filterQuery, setFilterQuery] = useState("");
  useEffect(() => {
    if (query.trim() === "") {
      setFilterQuery("");
      return;
    }
    const timer = window.setTimeout(() => setFilterQuery(query), FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);
  const [quickLookOpen, setQuickLookOpen] = useState(false);
  /** Přepínač skrytých souborů. null = ještě se neví (čeká se na settings.json
   *  a případně na nastavení Průzkumníku) — výpis se do té doby nenačítá. */
  const [showHidden, setShowHidden] = useState<boolean | null>(null);
  /** Náhled položky z výsledků hledání nebo z tag view — ty nejsou ve výpisu
   *  složky, takže běžný Quick Look nad `activeEntry` je neuvidí. */
  const [overlayPreview, setOverlayPreview] = useState<FileEntry | null>(null);
  /** Vybraná položka ve výsledcích hledání / tag view (Ctrl+C, Enter). */
  const [overlaySelected, setOverlaySelected] = useState<FileEntry | null>(null);

  const requestId = useRef(0);
  /** Roste s každým dokončeným výpisem. V refu, aby si ho requestSelect mohl
   *  přečíst bez závislosti na renderu. */
  const loadSeq = useRef(0);
  /** Složka, jejíž výpis je právě v `entries` — pozná přenačtení od navigace. */
  const loadedPathRef = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /** Vrstva nad obsahem pro snímek opouštěného view (cross-fade). */
  const ghostHost = useRef<HTMLDivElement>(null);
  /** Kde byl výpis odscrollovaný, podle složky — Zpět / Vpřed se vrací na místo. */
  const scrollMemory = useRef(new Map<string, number>());
  /** View mode posledního načtení — přepnutí view není navigace, nic nepřijíždí. */
  const lastLoadView = useRef<ViewMode | null>(null);
  const navDirectionRef = useRef<NavDirection>("jump");

  /**
   * Opustí režimy, které překrývají obsah složky (tag view, výsledky hledání).
   * Každý přechod do složky je musí zavřít — jinak by sidebar zvýrazňoval
   * barvu, jejíž výsledky už nikdo nevidí, a hledání by viselo nad jinou cestou.
   */
  const leaveOverlays = useCallback(() => {
    // Čekající výběr patří složce, ze které se odchází. Kdyby zůstal, vystřelil
    // by při příštím refreshi — třeba nečekaně otevřeným přejmenováním.
    setPendingSelect(null);
    setOverlaySelected(null);
    setTagFilter(null);
    // Odchod z výsledků bere s sebou i dotaz. Bez toho by cílová složka zůstala
    // zafiltrovaná textem, kterým uživatel jen hledal, a chyběla by v ní půlka
    // souborů. Mimo hledání se filtr při navigaci nemaže — to je staré chování.
    if (search !== null) setQuery("");
    setSearch(null);
  }, [search]);

  const navigate = useCallback(
    (path: string) => {
      leaveOverlays();
      dispatch({ type: "go", path });
    },
    [leaveOverlays],
  );

  const goBack = useCallback(() => {
    leaveOverlays();
    dispatch({ type: "back" });
  }, [leaveOverlays]);

  const goForward = useCallback(() => {
    leaveOverlays();
    dispatch({ type: "forward" });
  }, [leaveOverlays]);

  const columnsApi = useColumns(
    nav.current,
    viewMode === "column",
    { key: sortKey, direction: sortDirection },
    showHidden ?? false,
    filterQuery,
    setNotice,
  );

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
    const remove = window.setTimeout(() => setNoticeState(null), TOAST_EXIT_MS);
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
  useEffect(() => storage.onError(setNotice), [setNotice]);

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
  navDirectionRef.current = nav.direction;

  useEffect(() => {
    invoke<FavoriteSection[]>("get_favorites")
      .then((result) => {
        setSections(result);
        // Výčet disků umí trvat sekundy (odpojený síťový disk). Kdo mezitím
        // sám někam došel (Ctrl+L, klik), toho to nesmí hodit zpátky.
        const first = result[0]?.items[0];
        if (first && navCurrentRef.current === null) dispatch({ type: "go", path: first.path });
      })
      .catch((err: unknown) => setError(`Postranní panel se nepodařilo načíst — ${String(err)}`));
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

  // Reset stavu patří k navigaci, ne k přenačtení — jinak by refresh
  // po každé operaci shodil výběr i rozepsané hledání.
  useEffect(() => {
    setSelection(new Set());
    setActive(null);
    setQuery("");
    setRenamingPath(null);
    setPathEditing(false);
  }, [nav.current]);

  useEffect(() => {
    // Bez známého nastavení skrytých by se složka načetla dvakrát a obsah poskočil.
    if (nav.current === null || showHidden === null) return;

    const id = ++requestId.current;
    const path = nav.current;

    // Volné místo ukazuje status bar ve všech režimech.
    invoke<number>("get_disk_free_space", { path })
      .then((bytes) => {
        if (requestId.current === id) setFreeSpace(bytes);
      })
      .catch(() => {
        if (requestId.current === id) setFreeSpace(null);
      });

    // Column view si sloupce načítá sám (columns.ts) — výpis nav.current by
    // se tu stahoval podruhé a nikde nepoužil. Při přepnutí zpátky se načte.
    if (viewMode === "column") {
      // Přerušené načtení v jiném view by jinak nechalo proužek svítit.
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    // Velká složka chodí po dávkách: prvních 300 v odpovědi, zbytek událostmi
    // dir-chunk. Při navigaci se ukazuje hned, co dorazilo; při přenačtení té
    // samé složky (hlídač, operace) až celek — jinak by výpis na okamžik
    // spadl na 300 položek a zase narostl.
    const refresh = loadedPathRef.current !== null && storage.samePath(loadedPathRef.current, path);
    const viewChanged = lastLoadView.current !== null && lastLoadView.current !== viewMode;
    lastLoadView.current = viewMode;
    const direction = refresh || viewChanged ? null : navDirectionRef.current;
    const collected: FileEntry[] = [];
    let first = true;
    let done = false;
    let frame = 0;

    const publish = () => {
      frame = 0;
      if (requestId.current !== id) return;
      setEntries(collected.slice());
      setStreamingCount(done ? null : collected.length);
      if (first || done) {
        // Směr patří k první výměně obsahu. Doběhnutí dávek ho nechává být —
        // odebraná třída by animaci utnula uprostřed.
        const seq = (loadSeq.current += 1);
        const isFirst = first;
        setLoaded((previous) => ({ path, seq, direction: isFirst ? direction : previous.direction }));
        first = false;
        loadedPathRef.current = path;
      }
    };
    const received = (batch: FileEntry[], last: boolean) => {
      if (requestId.current !== id) return;
      collected.push(...batch);
      done = last;
      if (refresh && !done) return;
      // První obsah hned; další dávky přicházejí v rychlém sledu —
      // překreslí se jednou za snímek.
      if (done || first) {
        cancelAnimationFrame(frame);
        publish();
      } else if (frame === 0) {
        frame = requestAnimationFrame(publish);
      }
    };

    // Dávky můžou předběhnout odpověď — posluchač se musí registrovat první.
    const pendingChunks: DirChunk[] = [];
    let listed = false;
    const unlisten = listen<DirChunk>("dir-chunk", ({ payload }) => {
      if (payload.token !== id) return;
      if (!listed) pendingChunks.push(payload);
      else received(payload.entries, payload.done);
    });

    unlisten
      .then(() => invoke<DirListing>("list_dir_stream", { path, showHidden, token: id }))
      .then((result) => {
        listed = true;
        received(result.entries, !result.more);
        for (const chunk of pendingChunks) received(chunk.entries, chunk.done);
      })
      .catch((err: unknown) => {
        if (requestId.current !== id) return;
        done = true;
        setStreamingCount(null);
        setEntries([]);
        // I neúspěch je "dojeto" — jinak by čekající výběr visel navždy.
        loadedPathRef.current = path;
        setLoaded({ path, seq: (loadSeq.current += 1), direction: null });
        setError(String(err));
      })
      .finally(() => {
        if (requestId.current === id) setLoading(false);
      });

    return () => {
      cancelAnimationFrame(frame);
      void unlisten.then((stop) => stop());
      if (!done) setStreamingCount(null);
    };
  }, [nav.current, refreshToken, showHidden, viewMode]);

  // Navigace čeká na data: starý výpis zůstává, kostra až po 400 ms.
  const awaitingFolder = viewMode !== "column" && nav.current !== null && loadedPath !== nav.current;
  const [skeletonShown, setSkeletonShown] = useState(false);
  useEffect(() => {
    setSkeletonShown(false);
    if (!awaitingFolder) return;
    const timer = window.setTimeout(() => setSkeletonShown(true), SKELETON_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [awaitingFolder, nav.current]);

  const sortedEntries = useMemo(
    () => sortEntries(entries, sortKey, sortDirection),
    [entries, sortKey, sortDirection],
  );

  const visibleEntries = useMemo(() => {
    const needle = filterQuery.trim().toLowerCase();
    if (!needle) return sortedEntries;
    return sortedEntries.filter((entry) => entry.name.toLowerCase().includes(needle));
  }, [sortedEntries, filterQuery]);

  // Po každé změně výpisu i filtru se výběr musí sesouhlasit s tím, co je
  // vidět. Po smazání nebo přejmenování by `active` jinak dál ukazoval na
  // neexistující cestu, a položka schovaná filtrem by šla smazat Delete
  // nebo přejmenovat F2, aniž by ji uživatel viděl. Musí to běžet před
  // efektem pendingSelect, který výběr naopak nastavuje.
  useEffect(() => {
    setActive((current) =>
      current === null
        ? null
        : (visibleEntries.find((entry) => entry.path === current.path) ?? null),
    );

    setSelection((current) => {
      if (current.size === 0) return current;
      const alive = new Set<string>();
      for (const entry of visibleEntries) if (current.has(entry.path)) alive.add(entry.path);
      // Stejná identita, dokud se opravdu nic nezměnilo — jinak by každý výpis
      // zbytečně překreslil všechny řádky.
      return alive.size === current.size ? current : alive;
    });
  }, [visibleEntries]);

  /* ------------------------------ výběr ---------------------------------- */

  const focusedColumn = columnsApi.columns[columnsApi.focusedIndex];
  // Jen mezi viditelnými: vybraná položka, kterou schoval filtr, není cíl akcí.
  const columnSelected =
    columnsApi
      .visibleEntries(columnsApi.focusedIndex)
      .find((entry) => entry.path === focusedColumn?.selectedPath) ?? null;

  const isColumnView = viewMode === "column";
  const currentDir = isColumnView ? columnsApi.activePath : nav.current;

  /**
   * Enter v poli hledání. Filtr aktuálního výpisu se povýší na průchod stromem
   * od složky, ve které uživatel právě je — v column view od té nejhlubší.
   */
  const submitSearch = useCallback(() => {
    const needle = query.trim();
    if (needle === "" || currentDir === null) return;

    setTagFilter(null);
    setOverlaySelected(null);
    setSearch({ root: currentDir, query: needle });
  }, [query, currentDir]);

  // Vyprázdněné pole (křížek, Escape, smazání textu) zavírá výsledky —
  // jinak by nad panelem visel výsledek dotazu, který už nikde není vidět.
  useEffect(() => {
    if (query.trim() === "") setSearch(null);
  }, [query]);

  /** Kotva pro Shift+klik / Shift+šipky: poslední položka vybraná bez Shiftu. */
  const anchorRef = useRef<string | null>(null);

  const selectEntry = useCallback((entry: FileEntry) => {
    setActive(entry);
    setSelection(new Set([entry.path]));
    anchorRef.current = entry.path;
  }, []);

  /** Cesty mezi kotvou a `path` v pořadí výpisu (včetně obou konců). */
  const rangeTo = useCallback(
    (path: string): string[] => {
      const anchor = anchorRef.current ?? path;
      const from = visibleEntries.findIndex((entry) => entry.path === anchor);
      const to = visibleEntries.findIndex((entry) => entry.path === path);
      if (from < 0 || to < 0) return [path];
      return visibleEntries
        .slice(Math.min(from, to), Math.max(from, to) + 1)
        .map((entry) => entry.path);
    },
    [visibleEntries],
  );

  /** Klik v Icon / List View: sám vybere, Ctrl přepne, Shift vybere rozsah. */
  const clickSelect = useCallback(
    (entry: FileEntry, mods: SelectMods) => {
      if (mods.range) {
        const range = rangeTo(entry.path);
        // Ctrl+Shift přidává rozsah k dosavadnímu výběru.
        setSelection((current) => new Set(mods.toggle ? [...current, ...range] : range));
        setActive(entry);
        return;
      }

      if (mods.toggle) {
        anchorRef.current = entry.path;
        const removing = selection.has(entry.path);
        setSelection((current) => {
          const next = new Set(current);
          if (removing) next.delete(entry.path);
          else next.add(entry.path);
          return next;
        });
        // Odznačená položka nesmí zůstat cílem operací pro jednu položku.
        setActive(removing ? null : entry);
        return;
      }

      selectEntry(entry);
    },
    [rangeTo, selection, selectEntry],
  );

  /**
   * Výběr položky na indexu `index` (Icon / List View). S Shiftem rozšiřuje
   * od kotvy. Nová aktivní položka se vždy doscrolluje do obrazu.
   */
  // Posouvaný kontejner výpisu a ovládání virtualizovaného view. Kontejner se
  // s view mode přemountuje (key); stav navíc vynutí překreslení, aby si
  // virtualizace nový prvek převzala — v době jejího layout efektu ještě
  // ref rodiče připojený není.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [, setScrollElement] = useState<HTMLDivElement | null>(null);
  const attachScroll = useCallback((element: HTMLDivElement | null) => {
    scrollRef.current = element;
    setScrollElement(element);
  }, []);
  const viewHandle = useRef<ViewHandle | null>(null);

  /** Doscrolluje na položku i když zrovna není vykreslená. Column view
   *  virtualizaci nevystavuje — tam si výběr hlídá každý sloupec sám. */
  const scrollToPath = useCallback((path: string, behavior: "auto" | "smooth" = "auto") => {
    if (viewHandle.current) {
      viewHandle.current.scrollToPath(path, behavior);
      return;
    }
    requestAnimationFrame(() => {
      document.querySelector(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }, []);

  /** Kolik položek je v řádku a kolik řádků na obrazovce (pro šipky, PgUp/PgDn). */
  const viewMetrics = () => viewHandle.current?.metrics() ?? { columns: 1, rowsPerPage: 1 };

  const selectIndex = useCallback(
    (index: number, extend: boolean) => {
      if (visibleEntries.length === 0) return;
      const next = visibleEntries[Math.min(Math.max(index, 0), visibleEntries.length - 1)];

      if (extend) {
        if (anchorRef.current === null && active) anchorRef.current = active.path;
        setSelection(new Set(rangeTo(next.path)));
        setActive(next);
      } else {
        selectEntry(next);
      }

      scrollToPath(next.path);
    },
    [visibleEntries, active, rangeTo, selectEntry, scrollToPath],
  );

  /** Posun o `delta` položek od aktivní; bez aktivní začíná od kraje. */
  const moveSelection = useCallback(
    (delta: number, extend: boolean) => {
      const current = active ? visibleEntries.findIndex((entry) => entry.path === active.path) : -1;
      if (current < 0) selectIndex(delta > 0 ? 0 : visibleEntries.length - 1, extend);
      else selectIndex(current + delta, extend);
    },
    [active, visibleEntries, selectIndex],
  );

  // Type-ahead: písmena psaná rychle za sebou tvoří slovo a výběr skočí na
  // první položku, která jím začíná.
  const typeAhead = useRef({ text: "", at: 0 });
  const findByPrefix = useCallback((key: string, entries: FileEntry[]): FileEntry | null => {
    const now = Date.now();
    const state = typeAhead.current;
    state.text = now - state.at > TYPE_AHEAD_RESET_MS ? key : state.text + key;
    state.at = now;

    const prefix = state.text.toLocaleLowerCase("cs");
    return entries.find((entry) => entry.name.toLocaleLowerCase("cs").startsWith(prefix)) ?? null;
  }, []);

  /**
   * Položky, na které míří operace — výběr v Icon / List View, v column view
   * vícenásobný výběr zaměřeného sloupce, nebo jen jeho aktivní položka.
   */
  const targetEntries = useMemo((): FileEntry[] => {
    if (isColumnView) {
      const multi = focusedColumn?.selectedPaths ?? [];
      if (multi.length > 0) {
        return columnsApi
          .visibleEntries(columnsApi.focusedIndex)
          .filter((entry) => multi.includes(entry.path));
      }
      return columnSelected ? [columnSelected] : [];
    }
    return visibleEntries.filter((entry) => selection.has(entry.path));
  }, [isColumnView, focusedColumn, columnsApi, columnSelected, visibleEntries, selection]);

  const activeEntry = isColumnView ? columnSelected : active;

  // Soubor v náhledu zmizel (smazán zvenčí, sloupec zrušil výběr) — Quick Look
  // se odmontuje sám, ale příznak by zůstal a jako "otevřený modal" by
  // blokoval všechny zkratky i tlačítka myši až do restartu.
  const quickLookShown = quickLookOpen && activeEntry !== null && !activeEntry.is_dir;
  useEffect(() => {
    if (quickLookOpen && !quickLookShown) setQuickLookOpen(false);
  }, [quickLookOpen, quickLookShown]);

  /* ---------------------------- operace ---------------------------------- */

  const refresh = useCallback(() => {
    setRefreshToken((token) => token + 1);
    columnsApi.refresh();
  }, [columnsApi]);

  /* ---------------------- živé obnovení otevřených složek ------------------- */

  // Backend hlídá jen to, co je vidět: v column view všechny sloupce, jinak
  // aktuální složku. Klíč místo pole, ať se hlídač nepřestavuje při každém renderu.
  const watchedKey = (
    isColumnView ? columnsApi.columns.map((column) => column.path) : [nav.current]
  )
    .filter((path): path is string => path !== null)
    .join("\n");

  // Pořadové číslo: volání běží souběžně a backend podle něj zahodí to starší,
  // kdyby doběhlo až po novějším.
  const watchGeneration = useRef(0);
  useEffect(() => {
    const paths = watchedKey === "" ? [] : watchedKey.split("\n");
    watchGeneration.current += 1;
    invoke("watch_dirs", { paths, generation: watchGeneration.current }).catch(
      (err: unknown) => setNotice(`Složku nejde hlídat, změny se neukážou samy — ${String(err)}`),
    );
  }, [watchedKey]);

  // Změnu na disku (nový soubor z prohlížeče, smazání v Průzkumníku…) ukáže
  // výpis sám. Ve výsledcích hledání ne — přehledávat kvůli každé změně
  // v podkladové složce celý strom by bylo drahé a výsledky by poskakovaly.
  const liveRefresh = useRef({ refresh, searching: false });
  liveRefresh.current = { refresh, searching: search !== null };

  useEffect(() => {
    const unlisten = listen("dir-changed", () => {
      if (!liveRefresh.current.searching) liveRefresh.current.refresh();
    });
    return () => void unlisten.then((stop) => stop());
  }, []);

  /** Jediná cesta k otevření souboru — proto se nedávné zapisují právě tady. */
  const openFile = useCallback((entry: FileEntry) => {
    invoke("open_file", { path: entry.path })
      // Zapisuje se až po úspěchu — jinak by se do nedávných dostaly i soubory,
      // které se otevřít nepodařilo.
      .then(() => storage.addRecent(entry.path, entry.name, "file"))
      .catch((err: unknown) => setNotice(`Soubor se nepodařilo otevřít — ${String(err)}`));
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

  // requestSelect si potřebuje přečíst aktuální sloupce bez závislosti na renderu.
  const columnsRef = useRef(columnsApi.columns);
  columnsRef.current = columnsApi.columns;

  /**
   * Označí `path` ve složce `dir`, jakmile dorazí čerstvý výpis té složky —
   * buď hlavního výpisu (Icon / List), nebo sloupce s tou cestou (Column View,
   * i jiného než kořenového: Nová složka ve třetím sloupci).
   */
  const requestSelect = useCallback((dir: string, path: string, rename = false) => {
    const column = columnsRef.current.find((item) => storage.samePath(item.path, dir));
    setPendingSelect({
      dir,
      path,
      seq: loadSeq.current,
      columnVersion: column?.version ?? -1,
      rename,
    });
  }, []);

  /** Skočí do nadřazené složky a označí v ní danou položku. */
  const reveal = useCallback(
    (path: string, rename = false) => {
      const parent = parentPath(path);
      if (parent === null) return;

      const alreadyThere = nav.current !== null && storage.samePath(parent, nav.current);
      navigate(parent);
      requestSelect(parent, path, rename);
      // Navigace na tutéž složku nic nenačte a čekající výběr by se nikdy
      // nedočkal čerstvého výpisu — vyvolá se proto ručně.
      if (alreadyThere) refresh();
    },
    [nav.current, navigate, requestSelect, refresh],
  );

  // Čeká se na *čerstvý* výpis té složky, do které se odkrývá. Na `loading` se
  // spolehnout nedá — v prvním průchodu efektů je ještě false z předchozí
  // složky. Porovnání seq / version navíc pokrývá odkrytí v už otevřené složce
  // (po přejmenování), kde by samotná shoda cesty prošla hned proti starým datům.
  useEffect(() => {
    if (pendingSelect === null) return;

    /** Po označení: přejmenování a doscrollování, ať není mimo obrazovku. */
    const finish = (found: FileEntry | undefined) => {
      if (found) {
        if (pendingSelect.rename) setRenamingPath(found.path);
        scrollToPath(found.path);
      }
      // Zahazuje se i když se položka nenašla, ať požadavek nevisí dál.
      setPendingSelect(null);
    };

    if (isColumnView) {
      const index = columnsApi.columns.findIndex(
        (column) => storage.samePath(column.path, pendingSelect.dir) && !column.loading,
      );
      const column = columnsApi.columns[index];
      if (!column || column.version <= pendingSelect.columnVersion) return;

      const found = column.entries.find((entry) => storage.samePath(entry.path, pendingSelect.path));
      if (found) columnsApi.select(index, found);
      finish(found);
      return;
    }

    if (
      loaded.path === null ||
      !storage.samePath(loaded.path, pendingSelect.dir) ||
      loaded.seq <= pendingSelect.seq
    )
      return;

    const found = entries.find((entry) => storage.samePath(entry.path, pendingSelect.path));
    if (found) {
      setActive(found);
      setSelection(new Set([found.path]));
    }
    finish(found);
  }, [entries, loaded, pendingSelect, isColumnView, columnsApi]);

  /**
   * Kopie nenásleduje symlinky a junctions. Když nějaké přeskočila, musí se to
   * uživatel dozvědět — jinak by si myslel, že má úplnou kopii.
   */
  const noteSkippedLinks = useCallback((count: number) => {
    if (count > 0) showInfo(`Přeskočeno ${count} odkazů (symlinky a junctions).`);
  }, [showInfo]);

  /** Společné ošetření chyb + refresh po každé mutující operaci. */
  const runOperation = useCallback(
    async (label: string, action: () => Promise<unknown>) => {
      setNotice(null);
      try {
        await action();
      } catch (err: unknown) {
        setNotice(`${label} — ${String(err)}`);
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
    async <T,>(label: string, items: T[], action: (item: T) => Promise<unknown>) => {
      if (items.length === 0) return { ok: 0, failed: 0 };
      setNotice(null);

      let first: string | null = null;
      let failed = 0;

      for (const item of items) {
        try {
          await action(item);
        } catch (err: unknown) {
          failed += 1;
          if (first === null) first = String(err);
        }
      }

      if (failed === 1) setNotice(`${label} — ${first}`);
      else if (failed > 1) setNotice(`${label} u ${failed} z ${items.length} položek — ${first}`);

      refresh();
      return { ok: items.length - failed, failed };
    },
    [refresh],
  );

  const submitRename = useCallback(
    (entry: FileEntry, name: string) => {
      setRenamingPath(null);
      const next = name.trim();
      if (next === entry.name) return;

      const dir = parentPath(entry.path);

      void runOperation("Přejmenování selhalo", async () => {
        const renamed = await renamePath(entry.path, next);
        // Tagy, oblíbené a nedávné jsou klíčované cestou — musí jít s položkou.
        await storage.remapPath(entry.path, renamed);
        // Přejmenovaná položka má novou cestu, takže by po refreshi vypadla
        // z výběru. Takhle zůstane označená, jak to dělá Finder i Průzkumník.
        if (dir !== null) requestSelect(dir, renamed);
      });
    },
    [runOperation, requestSelect],
  );

  const deleteEntries = useCallback(
    (items: FileEntry[]) => {
      const paths = items.map((entry) => entry.path);
      if (paths.length === 0) return;

      const run = () => void runOperation("Smazání selhalo", () => moveToTrash(paths));

      // Flashka (FAT32 / exFAT) ani síťová cesta Koš nemají — "do koše" by tam
      // smazalo trvale a bez varování. Když se to nedá zjistit, radši se ptát.
      trashIsPermanent(paths)
        .catch(() => true)
        .then((permanent) => {
          if (!permanent) return run();
          setConfirm({
            title:
              paths.length === 1
                ? `Smazat „${items[0].name}" trvale?`
                : `Smazat ${formatItemCount(paths.length)} trvale?`,
            message:
              "Tento disk nemá Koš (flashka nebo síťová složka). Položky budou smazány trvale a nepůjde je obnovit.",
            confirmLabel: "Smazat trvale",
            danger: true,
            onConfirm: run,
          });
        });
    },
    [runOperation],
  );

  const deleteTargets = useCallback(() => deleteEntries(targetEntries), [deleteEntries, targetEntries]);

  /** `select` = kopii rovnou označit. Ve výsledcích hledání se nesmí — označení
   *  by čekalo na výpis složky, ve které uživatel vůbec není. */
  const duplicateEntry = useCallback(
    (entry: FileEntry, select = true) => {
      const dir = parentPath(entry.path);

      void runOperation("Duplikace selhala", async () => {
        const copy = await duplicatePath(entry.path);
        await storage.copyTags(entry.path, copy.path);
        if (select && dir !== null) requestSelect(dir, copy.path);
        noteSkippedLinks(copy.skipped_links);
      });
    },
    [runOperation, requestSelect, noteSkippedLinks],
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

    void runOperation("Složku se nepodařilo vytvořit", async () => {
      const created = await createFolder(dir, NEW_FOLDER_NAME);
      requestSelect(dir, created);
      setRenamingPath(created);
    });
  }, [currentDir, runOperation, requestSelect]);

  /** Prázdný textový soubor, rovnou v přejmenování — stejně jako Nová složka. */
  const newFile = useCallback(
    (dir: string) => {
      void runOperation("Soubor se nepodařilo vytvořit", async () => {
        const created = await createFile(dir, NEW_FILE_NAME);
        requestSelect(dir, created, true);
      });
    },
    [runOperation, requestSelect],
  );

  const copyText = useCallback((text: string, label: string) => {
    writeText(text).catch((err: unknown) =>
      setNotice(`${label} se nepodařilo zkopírovat — ${String(err)}`),
    );
  }, []);

  const copyToClipboard = useCallback(
    (mode: "copy" | "cut", items: FileEntry[] = targetEntries) => {
      if (items.length === 0) return;
      setClipboard({ paths: items.map((entry) => entry.path), mode });
    },
    [targetEntries],
  );

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
        setNotice(`Cíl se nepodařilo zkontrolovat — ${String(err)}`);
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

      const { ok } = await runBatch(
        mode === "copy" ? "Kopírování selhalo" : "Přesun selhal",
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
        },
      );

      noteSkippedLinks(skipped);
      return ok;
    },
    [runBatch, noteSkippedLinks, askConflict, setNotice],
  );

  /** Vloží do `into`, bez něj do složky, ve které uživatel stojí. */
  const paste = useCallback(
    (into?: string) => {
      const target = into ?? currentDir;
      if (!clipboard || target === null) return;
      const { paths, mode } = clipboard;

      // Vyjmuto a vloženo tam, kde už to leží — není co přesouvat, schránka pryč.
      const alreadyThere = paths.every((path) => {
        const parent = parentPath(path);
        return parent !== null && storage.samePath(parent, target);
      });

      void transfer(paths, target, mode).then((ok) => {
        // Vyjmuté položky se dají vložit jen jednou. Schránka se ale čistí jen
        // když se aspoň něco přesunulo — po úplném selhání by uživatel jinak
        // přišel i o to, co měl vyjmuté.
        if (mode === "cut" && (ok > 0 || alreadyThere)) setClipboard(null);
      });
    },
    [clipboard, currentDir, transfer],
  );

  /** Přetažení na složku: přesun, s Ctrl kopie. */
  const dropInto = useCallback(
    (folder: string, paths: string[], copy: boolean) => {
      void transfer(paths, folder, copy ? "copy" : "cut");
    },
    [transfer],
  );

  /** Nahoru o úroveň — a v rodiči se označí složka, ze které se přišlo. */
  const goToParent = useCallback(() => {
    if (currentDir === null) return;
    const parent = parentPath(currentDir);
    if (parent === null) return;
    navigate(parent);
    requestSelect(parent, currentDir);
  }, [currentDir, navigate, requestSelect]);

  const selectAll = useCallback(() => {
    if (isColumnView) return;
    setSelection(new Set(visibleEntries.map((entry) => entry.path)));
    if (visibleEntries.length > 0) {
      setActive(visibleEntries[0]);
      anchorRef.current = visibleEntries[0].path;
    }
  }, [isColumnView, visibleEntries]);

  // Gumička v prázdné ploše Icon / List View. S Ctrl/Shift přidává k výběru,
  // který byl na začátku tažení — ten musí zůstat stejný, jinak by výběr
  // při couvání myší jen rostl.
  const bandBase = useRef<Set<string>>(new Set());
  const band = useRubberBand({
    onStart: (additive) => {
      bandBase.current = additive ? new Set(selection) : new Set();
    },
    // Řádky mimo obrazovku nejsou v DOM — zásah spočítá výpis z geometrie.
    hitTest: (box) => viewHandle.current?.hitTest(box) ?? [],
    onChange: (paths) => {
      setSelection(new Set([...bandBase.current, ...paths]));
      const first = visibleEntries.find((entry) => paths.includes(entry.path)) ?? null;
      setActive(first);
      anchorRef.current = first?.path ?? null;
    },
  });

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
      if (isTypingTarget(event.target)) return;

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
          setClipboard({ paths: [overlaySelected.path], mode: "copy" });
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
          moveSelection(event.key === "PageDown" ? page : -page, event.shiftKey);
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

  /**
   * Přepnutí ikony / seznam / sloupce: nové view se vykreslí hned a starý
   * snímek nad ním zhasne (cross-fade, oba chvíli v DOM). Vybraná položka
   * zůstane vybraná a doscrolluje se do obrazu.
   */
  const changeViewMode = useCallback(
    (mode: ViewMode) => {
      if (mode === viewMode) return;

      const scroller = scrollRef.current;
      if (scroller && ghostHost.current) spawnViewGhost(scroller, ghostHost.current);

      if (viewMode === "column") {
        // Ze sloupců do složky zaměřeného sloupce s jeho výběrem; bez výběru
        // do nejhlubšího sloupce, jako dřív.
        const column = columnsApi.columns[columnsApi.focusedIndex];
        const target = column?.selectedPath ? column.path : columnsApi.activePath;
        if (target !== null && target !== nav.current) navigate(target);
        if (column?.selectedPath) requestSelect(column.path, column.selectedPath);
      } else if (mode === "column" && active !== null && nav.current !== null) {
        requestSelect(nav.current, active.path);
      }

      setViewMode(mode);
    },
    [viewMode, columnsApi, nav.current, navigate, requestSelect, active],
  );

  // Ikony ↔ seznam: výběr zůstává, jen se musí doscrollovat v novém view.
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (viewMode !== "column" && activeRef.current) scrollToPath(activeRef.current.path);
  }, [viewMode, scrollToPath]);

  const sortBy = useCallback((key: SortKey) => {
    setSortKey((currentKey) => {
      setSortDirection((currentDirection) =>
        currentKey === key ? (currentDirection === "asc" ? "desc" : "asc") : "asc",
      );
      return key;
    });
  }, []);

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
    setMenu({ kind: "entry", x, y, entry, overlay: false });
  }, []);

  /** Položka z výsledků hledání nebo z tag view. Výběr podkladové složky se
   *  nechává být — ta položka v něm vůbec není. */
  const openOverlayMenu = useCallback((entry: FileEntry, x: number, y: number) => {
    setMenu({ kind: "entry", x, y, entry, overlay: true });
  }, []);

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
      setMenu({ kind: "background", x: event.clientX, y: event.clientY, dir });
    },
    [tagFilter, search, currentDir],
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
      void runOperation("Průzkumníka se nepodařilo otevřít", () => openInExplorer(path));
    },
    [runOperation],
  );

  const openTerminalAt = useCallback(
    (path: string) => {
      void runOperation("Terminál se nepodařilo otevřít", () => openTerminal(path));
    },
    [runOperation],
  );

  const menuItems = useMemo((): MenuItem[] => {
    if (menu === null) return [];

    const copyPathItem = (path: string, label = "Kopírovat cestu"): MenuItem => ({
      type: "item",
      label,
      onSelect: () => copyText(path, "Cestu"),
    });

    if (menu.kind === "status") {
      return [
        copyPathItem(menu.dir, "Kopírovat cestu aktuální složky"),
        { type: "item", label: "Upravit cestu", shortcut: "Ctrl+L", onSelect: () => setPathEditing(true) },
      ];
    }

    if (menu.kind === "quicklook") {
      const { entry } = menu;

      return [
        { type: "item", label: "Otevřít", onSelect: () => openFile(entry) },
        {
          type: "item",
          label: "Otevřít v Průzkumníku",
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
          label: "Nová složka",
          shortcut: "Ctrl+Shift+N",
          onSelect: () => newFolder(dir),
        },
        { type: "item", label: "Nový soubor", onSelect: () => newFile(dir) },
        { type: "separator" },
        {
          type: "item",
          label: "Vložit",
          shortcut: "Ctrl+V",
          disabled: clipboard === null,
          onSelect: () => paste(dir),
        },
        { type: "separator" },
        {
          type: "item",
          label: "Otevřít v Průzkumníku",
          onSelect: () => revealInExplorer(dir),
        },
        { type: "item", label: "Otevřít v Terminálu", onSelect: () => openTerminalAt(dir) },
        copyPathItem(dir),
        { type: "separator" },
        {
          type: "submenu",
          label: "Zobrazit",
          items: [
            ...(Object.keys(VIEW_LABELS) as ViewMode[]).map(
              (mode): MenuItem & { type: "item" } => ({
                type: "item",
                label: VIEW_LABELS[mode],
                checked: viewMode === mode,
                onSelect: () => changeViewMode(mode),
              }),
            ),
            { type: "separator" },
            {
              type: "item",
              label: "Skryté soubory",
              shortcut: "Ctrl+Shift+.",
              checked: showHidden === true,
              onSelect: toggleHidden,
            },
          ],
        },
        {
          type: "submenu",
          label: "Seřadit podle",
          items: [
            ...(Object.keys(SORT_LABELS) as SortKey[]).map(
              (key): MenuItem & { type: "item" } => ({
                type: "item",
                label: SORT_LABELS[key],
                checked: sortKey === key,
                onSelect: () => setSortKey(key),
              }),
            ),
            { type: "separator" },
            {
              type: "item",
              label: "Vzestupně",
              checked: sortDirection === "asc",
              onSelect: () => setSortDirection("asc"),
            },
            {
              type: "item",
              label: "Sestupně",
              checked: sortDirection === "desc",
              onSelect: () => setSortDirection("desc"),
            },
          ],
        },
        { type: "separator" },
        {
          type: "item",
          label: "Vybrat vše",
          shortcut: "Ctrl+A",
          // V column view výběr celé složky neexistuje, řádky jsou po jednom.
          disabled: isColumnView || visibleEntries.length === 0,
          onSelect: selectAll,
        },
        { type: "item", label: "Aktualizovat", shortcut: "F5", onSelect: refresh },
        // Bez tohohle šlo do sidebaru dostat jen složku, kterou uživatel vidí
        // ve výpisu — tu, ve které zrovna stojí, nijak.
        {
          type: "item",
          label: dirIsFavorite ? "Odebrat z oblíbených" : "Přidat do oblíbených",
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
          label: "Vlastnosti složky",
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
        label: "Otevřít",
        shortcut: "Enter",
        // open() by soubor označil v podkladové složce, kde vůbec není.
        onSelect: () => (overlay ? openFromResults(entry) : open(entry)),
      },
      // Výsledky hledání a tag view jsou rozcestník — odtud se položka odkrývá
      // v její složce (dřív to dělal jeden klik).
      overlay && parentPath(entry.path) !== null
        ? {
            type: "item",
            label: "Zobrazit ve složce",
            onSelect: () => reveal(entry.path),
          }
        : null,
      entry.is_dir
        ? null
        : {
            type: "item",
            label: "Náhled",
            shortcut: "Space",
            onSelect: () => (overlay ? setOverlayPreview(entry) : previewEntry(entry)),
          },
      entry.is_dir
        ? null
        : {
            type: "item",
            label: "Otevřít v aplikaci…",
            disabled: !single,
            onSelect: () => {
              void runOperation("Dialog se nepodařilo otevřít", () => openWith(entry.path));
            },
          },
      { type: "separator" },
      {
        type: "item",
        label: "Otevřít v Průzkumníku",
        disabled: !single,
        onSelect: () => revealInExplorer(entry.path),
      },
      {
        type: "item",
        label: "Otevřít v Terminálu",
        disabled: !single,
        onSelect: () => openTerminalAt(entry.path),
      },
      // Do "Moje oblíbené" smí složka i soubor: klik na složku tam naviguje,
      // klik na soubor ho otevře v systémové aplikaci.
      {
        type: "item",
        label: isFavorite ? "Odebrat z oblíbených" : "Přidat do oblíbených",
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
        label: "Přejmenovat",
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
        label: "Duplikovat",
        shortcut: "Ctrl+D",
        disabled: !single,
        onSelect: () => duplicateEntry(entry, !overlay),
      },
      { type: "separator" },
      {
        type: "item",
        label: single ? "Kopírovat" : `Kopírovat ${formatItemCount(count)}`,
        shortcut: "Ctrl+C",
        onSelect: () => copyToClipboard("copy", targets),
      },
      {
        type: "item",
        label: single ? "Vyjmout" : `Vyjmout ${formatItemCount(count)}`,
        shortcut: "Ctrl+X",
        onSelect: () => copyToClipboard("cut", targets),
      },
      {
        type: "item",
        label: "Vložit",
        shortcut: "Ctrl+V",
        disabled: clipboard === null || pasteTarget === null,
        onSelect: () => paste(pasteTarget ?? undefined),
      },
      { type: "separator" },
      {
        type: "item",
        label: single ? "Kopírovat cestu" : "Kopírovat cesty",
        // U výběru se kopírují všechny cesty po řádcích — tak je vezme každý editor.
        onSelect: () =>
          copyText(
            single ? entry.path : targets.map((item) => item.path).join("\r\n"),
            single ? "Cestu" : "Cesty",
          ),
      },
      {
        type: "item",
        label: single ? "Kopírovat název" : "Kopírovat názvy",
        onSelect: () =>
          copyText(
            single ? entry.name : targets.map((item) => item.name).join("\r\n"),
            single ? "Název" : "Názvy",
          ),
      },
      { type: "separator" },
      {
        type: "item",
        label: single ? "Smazat" : `Smazat ${formatItemCount(count)}`,
        shortcut: "Delete",
        danger: true,
        onSelect: () => deleteEntries(targets),
      },
      { type: "separator" },
      {
        type: "tags",
        label: "Tagy",
        active: single ? entryTags : sharedTags,
        // U výběru se barva přidá všem (nebo všem odebere, když ji mají všichni).
        onToggle: (color) =>
          single
            ? void storage.toggleTag(entry.path, color)
            : void storage.setTag(targetPaths, color, !sharedTags.includes(color)),
      },
      !anyTags
        ? null
        : {
            type: "item",
            label: "Odebrat tagy",
            onSelect: () => {
              for (const path of targetPaths) void storage.clearTags(path);
            },
          },
      { type: "separator" },
      {
        type: "item",
        label: "Vlastnosti",
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
    clipboard,
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
  ]);

  /* ------------------------- menu tlačítek toolbaru ------------------------ */

  const toolbarSortItems = useMemo(
    (): MenuItem[] => [
      ...(Object.keys(SORT_LABELS) as SortKey[]).map(
        (key): MenuItem => ({
          type: "item",
          label: SORT_LABELS[key],
          checked: sortKey === key,
          onSelect: () => setSortKey(key),
        }),
      ),
      { type: "separator" },
      {
        type: "item",
        label: "Vzestupně",
        checked: sortDirection === "asc",
        onSelect: () => setSortDirection("asc"),
      },
      {
        type: "item",
        label: "Sestupně",
        checked: sortDirection === "desc",
        onSelect: () => setSortDirection("desc"),
      },
    ],
    [sortKey, sortDirection],
  );

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
        label: single ? "Kopírovat cestu" : "Kopírovat cesty",
        disabled: sharePaths.length === 0,
        onSelect: () => copyText(text, single ? "Cestu" : "Cesty"),
      },
      {
        type: "item",
        label: "Kopírovat soubory do schránky",
        disabled: sharePaths.length === 0,
        // Soubory jako soubory (CF_HDROP pro vložení v Průzkumníku) zatím ne —
        // do schránky jdou cesty jako text a uživatel se to dozví.
        onSelect: () => {
          copyText(text, single ? "Cestu" : "Cesty");
          showInfo("Zkopírováno jako cesty (text) — vkládání souborů do Průzkumníku zatím neumím.");
        },
      },
      { type: "separator" },
      {
        type: "item",
        label: "Otevřít v Průzkumníku",
        disabled: sharePaths.length === 0,
        onSelect: () => revealInExplorer(sharePaths[0]),
      },
    ];
  }, [sharePaths, copyText, showInfo, revealInExplorer]);

  // Štítky výběru: barva je zaškrtnutá, když ji mají všechny vybrané položky.
  // Klik ji pak všem odebere, jinak ji přidá všem — jako ve Finderu.
  const toolbarTagItems = useMemo((): MenuItem[] | null => {
    if (targetEntries.length === 0) return null;
    const paths = targetEntries.map((entry) => entry.path);

    return TAG_COLORS.map((color): MenuItem => {
      const everywhere = paths.every((path) => storage.tagsOf(tags, path).includes(color));
      return {
        type: "item",
        label: TAG_LABEL[color],
        dot: TAG_HEX[color],
        checked: everywhere,
        onSelect: () => void storage.setTag(paths, color, !everywhere),
      };
    });
  }, [targetEntries, tags]);

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
          <Icon size={16} strokeWidth={1.75} color={sidebarIconColor(section.label, item.label)} />
        );
      }
    }
    return <FolderIcon size={16} />;
  })();

  const crumbs = nav.current ? breadcrumbs(nav.current) : [];
  const folderName =
    tagFilter !== null
      ? TAG_LABEL[tagFilter]
      : search !== null
        ? "Výsledky hledání"
        : crumbs.length > 0
          ? crumbs[crumbs.length - 1].label
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

  function renderContent() {
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
      return <Placeholder>{error ?? "Začni výběrem složky vlevo."}</Placeholder>;
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
          suspended={modalOpen || renamingPath !== null || pathEditing}
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
        {renderFolder(restoreTop)}
      </ViewTransition>
    );
  }

  /** Obsah načtené složky v Icon / List View. */
  function renderFolder(initialOffset: number) {
    if (error) return <Placeholder>Složku se nepodařilo otevřít — {error}</Placeholder>;
    if (visibleEntries.length === 0) {
      return query ? (
        <EmptyState
          Icon={SearchX}
          title={`Nic nenalezeno pro „${query.trim()}“`}
          hint="Enter prohledá i podsložky."
        />
      ) : (
        <EmptyState
          Icon={FolderOpen}
          title="Složka je prázdná"
          hint={showHidden ? undefined : "Skryté soubory ukáže Ctrl+Shift+."}
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
    <div className="surface flex h-full w-full flex-col overflow-hidden bg-window text-primary">
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
          onError={setNotice}
          onConfirm={setConfirm}
        />

        <main className="surface flex min-w-0 flex-1 flex-col bg-main">
          <Toolbar
            folderName={folderName}
            folderIcon={folderIcon}
            canGoBack={nav.back.length > 0}
            canGoForward={nav.forward.length > 0}
            onBack={goBack}
            onForward={goForward}
            viewMode={viewMode}
            onViewModeChange={changeViewMode}
            theme={theme}
            onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
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
            sortItems={toolbarSortItems}
            shareItems={toolbarShareItems}
            tagItems={toolbarTagItems}
            onMenuOpenChange={setToolbarMenuOpen}
          />

          <div className="relative flex min-h-0 flex-1 flex-col">
            {/* Navigace i přenačtení nechávají obsah na místě, takže by jinak
                nebylo nijak poznat, že se něco děje. */}
            {(loading || (isColumnView && columnsApi.rootLoading)) && !inSearch && !inTagView && (
              <div className="fw-busy-line" aria-hidden />
            )}

            {/* key vynutí nový kontejner pro každé view (virtualizace si ho
                přeměří). Menu volné plochy visí až tady, ne ve views — prázdno
                pod řádky patří tomuhle scroll kontejneru, takže by ho mřížka
                IconView nezachytila. Řádky si událost zastaví u sebe. */}
            <div
              key={viewMode}
              ref={attachScroll}
              data-view={viewMode}
              onContextMenu={openBackgroundMenu}
              onClick={clearSelectionOnBackground}
              onScroll={(event) => {
                // Pozice patří složce, jejíž výpis je právě vidět.
                const shown = loadedPathRef.current;
                if (shown !== null && !isColumnView) {
                  scrollMemory.current.set(storage.pathKey(shown), event.currentTarget.scrollTop);
                }
              }}
              onMouseDown={(event) => {
                // Gumička jen nad výpisem složky — column view má vlastní po
                // sloupcích, výsledky hledání a tag view výběr nemají.
                if (!isColumnView && tagFilter === null && search === null) band.onMouseDown(event);
              }}
              className="min-h-0 flex-1 overflow-auto"
            >
              {renderContent()}
              {band.overlay}
            </div>

            {/* Sem se při přepnutí view vloží snímek starého (spawnViewGhost).
                React do vrstvy nic nevykresluje, takže mu cizí uzel nevadí. */}
            <div ref={ghostHost} className="pointer-events-none absolute inset-0 z-10 empty:hidden" />
          </div>
        </main>
      </div>

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
              aria-label="Zavřít"
              onClick={() => setNoticeClosing(true)}
              className="shrink-0 text-secondary transition-colors duration-100 hover:text-primary"
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
