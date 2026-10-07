import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { useBrowserState, type TabSnapshot } from "./browser";
import { useColumns } from "./columns";
import { invoke, parentPath } from "./fileops";
import { sortEntries, type SortKey } from "./format";
import { errorText, useLocale } from "./i18n";
import { motionMs } from "./lib/motion";
import { useRubberBand } from "./lib/rubberBand";
import * as storage from "./lib/storage";
import type { ViewHandle } from "./lib/viewHandle";
import type { NavDirection } from "./navigation";
import type { FileEntry, SelectMods, ViewMode } from "./types";

/**
 * Jeden panel prohlížeče: složka a její výpis, historie, zobrazení, řazení,
 * výběr, sloupce, hledání. App drží dva (rozdělené okno) a zbytek kódu pracuje
 * s tím aktivním. Sdílené věci — sidebar, schránka, Zpět, záložky, dialogy —
 * zůstávají v App.
 */

/** Odpověď `list_dir_stream` a jeho dávky (`dir-chunk`). */
type DirListing = { entries: FileEntry[]; more: boolean };
type DirChunk = { token: number; entries: FileEntry[]; done: boolean };

/** Zpoždění filtru výpisu za psaním do pole hledání. */
const FILTER_DEBOUNCE_MS = 100;

/** Psaní písmen skáče na položku; po téhle pauze začíná nové slovo. */
const TYPE_AHEAD_RESET_MS = 1000;

/** Do téhle doby zůstává při navigaci vidět starý výpis; déle = kostra. */
const SKELETON_DELAY_MS = 400;

/** Tokeny výpisů napříč panely — každý požadavek má jiný. */
let lastListToken = 0;
function nextListToken(): number {
  lastListToken += 1;
  return lastListToken;
}

/**
 * Snímek view, které se právě opouští (ikony / seznam / sloupce). Klon DOMu
 * bez identifikátorů — querySelector na data-path ani role nesmí najít jeho
 * řádky místo skutečných. Posuny vnořených scrollerů (sloupce) klon sám
 * nepřevezme, proto se kopírují ručně.
 */
function spawnViewGhost(source: HTMLElement, host: HTMLElement) {
  // Posuny se čtou předem a najednou — střídání čtení se zápisem by nutilo
  // prohlížeč přepočítat layout u každého prvku. Posouvat se dají jen
  // .fw-scroll prvky, jinde není co kopírovat.
  const scrollers = [source, ...source.querySelectorAll<HTMLElement>(".fw-scroll")];
  const offsets = scrollers.map((element) => [element.scrollTop, element.scrollLeft] as const);

  const ghost = source.cloneNode(true) as HTMLElement;
  const identifying = ["id", "data-path", "data-column-path", "data-tooltip", "role", "tabindex"];
  for (const element of ghost.querySelectorAll<HTMLElement>(identifying.map((name) => `[${name}]`).join(","))) {
    for (const name of identifying) element.removeAttribute(name);
  }
  for (const name of identifying) ghost.removeAttribute(name);
  ghost.className = "fw-view-ghost";
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  host.appendChild(ghost);

  const copies = [ghost, ...ghost.querySelectorAll<HTMLElement>(".fw-scroll")];
  offsets.forEach(([top, left], index) => {
    if (top === 0 && left === 0) return;
    copies[index].scrollTop = top;
    copies[index].scrollLeft = left;
  });

  const remove = () => ghost.remove();
  ghost.addEventListener("animationend", remove, { once: true });
  // Pojistka: s vypnutými animacemi (0 ms) se animationend nemusí dostavit.
  window.setTimeout(remove, motionMs("--dur-nav") + 50);
}

export type PanelOptions = {
  /** 0 = levý, 1 = pravý — backend podle něj drží streamované výpisy zvlášť. */
  slot: number;
  /** null = ještě se neví (nastavení se načítá) — výpis do té doby čeká. */
  showHidden: boolean | null;
  /** Chyby bez vlastního místa v UI (refresh sloupce). */
  setNotice: (text: string | null) => void;
};

export function usePanel({ slot, showHidden, setNotice }: PanelOptions) {
  const locale = useLocale();
  const browser = useBrowserState();
  const {
    nav,
    dispatch,
    viewMode,
    setViewMode,
    sortKey,
    setSortKey,
    sortDirection,
    setSortDirection,
    query,
    setQuery,
    tagFilter,
    setTagFilter,
    search,
    setSearch,
    active,
    setActive,
    selection,
    setSelection,
  } = browser;

  /** Výběr a posun záložky, na kterou se přepnulo — nastaví se, až dorazí
   *  výpis její složky (dřív by ho srovnání s výpisem zahodilo). */
  const tabRestore = useRef<{
    path: string | null;
    selection: string[];
    active: string | null;
    scrollTop: number;
    seq: number;
  } | null>(null);
  /** Přepnutí záložky mění nav.current, její dotaz v poli hledání ale zůstává. */
  const keepQueryOnNav = useRef(false);

  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  /** Velká složka se dočítá po dávkách — kolik položek už dorazilo, jinak null. */
  const [streamingCount, setStreamingCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [freeSpace, setFreeSpace] = useState<number | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [pathEditing, setPathEditing] = useState(false);

  const [tagCount, setTagCount] = useState(0);

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

  /** Vybraná položka ve výsledcích hledání / tag view (Ctrl+C, Enter). */
  const [overlaySelected, setOverlaySelected] = useState<FileEntry | null>(null);

  const requestId = useRef(0);
  /** Roste s každým dokončeným výpisem. V refu, aby si ho requestSelect mohl
   *  přečíst bez závislosti na renderu. */
  const loadSeq = useRef(0);
  /** Složka, jejíž výpis je právě v `entries` — pozná přenačtení od navigace. */
  const loadedPathRef = useRef<string | null>(null);

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

  // Reset stavu patří k navigaci, ne k přenačtení — jinak by refresh
  // po každé operaci shodil výběr i rozepsané hledání.
  useEffect(() => {
    setSelection(new Set());
    setActive(null);
    if (keepQueryOnNav.current) keepQueryOnNav.current = false;
    else setQuery("");
    setRenamingPath(null);
    setPathEditing(false);
  }, [nav.current]);

  useEffect(() => {
    // Bez známého nastavení skrytých by se složka načetla dvakrát a obsah poskočil.
    if (nav.current === null || showHidden === null) return;

    // Token je společný pro oba panely — dávky dir-chunk si jinak spletou.
    const id = (requestId.current = nextListToken());
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
      .then(() => invoke<DirListing>("list_dir_stream", { path, showHidden, token: id, slot }))
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
        setError(errorText(err));
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

  // Druh i abeceda závisí na jazyce — po přepnutí se přeřadí.
  const sortedEntries = useMemo(
    () => sortEntries(entries, sortKey, sortDirection),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, sortKey, sortDirection, locale],
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
      // Jen ve vlastním panelu — druhý může ukazovat tutéž složku.
      const root = scrollRef.current ?? document;
      root.querySelector(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }, []);

  /** Kolik položek je v řádku a kolik řádků na obrazovce (pro šipky, PgUp/PgDn). */
  const viewMetrics = () => viewHandle.current?.metrics() ?? { columns: 1, rowsPerPage: 1 };

  /** Šipky a type-ahead skočí (bez animace), PgUp/PgDn posunou plynule. */
  const selectIndex = useCallback(
    (index: number, extend: boolean, behavior: ScrollBehavior = "auto") => {
      if (visibleEntries.length === 0) return;
      const next = visibleEntries[Math.min(Math.max(index, 0), visibleEntries.length - 1)];

      if (extend) {
        if (anchorRef.current === null && active) anchorRef.current = active.path;
        setSelection(new Set(rangeTo(next.path)));
        setActive(next);
      } else {
        selectEntry(next);
      }

      scrollToPath(next.path, behavior === "smooth" ? "smooth" : "auto");
    },
    [visibleEntries, active, rangeTo, selectEntry, scrollToPath],
  );

  /** Posun o `delta` položek od aktivní; bez aktivní začíná od kraje. */
  const moveSelection = useCallback(
    (delta: number, extend: boolean, behavior: ScrollBehavior = "auto") => {
      const current = active ? visibleEntries.findIndex((entry) => entry.path === active.path) : -1;
      if (current < 0) selectIndex(delta > 0 ? 0 : visibleEntries.length - 1, extend, behavior);
      else selectIndex(current + delta, extend, behavior);
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

  const refresh = useCallback(() => {
    setRefreshToken((token) => token + 1);
    columnsApi.refresh();
  }, [columnsApi]);

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

  /** Stav aktivní záložky jako snímek — při přepnutí na jinou. */
  const captureSnapshot = (): TabSnapshot => ({
    nav,
    viewMode,
    sortKey,
    sortDirection,
    query,
    search,
    tagFilter,
    selection: [...selection],
    active: active?.path ?? null,
    scrollTop: scrollRef.current?.scrollTop ?? 0,
    columns: columnsApi.columns.map((column) => ({
      path: column.path,
      selectedPath: column.selectedPath,
      selectedPaths: column.selectedPaths,
    })),
    columnFocus: columnsApi.focusedIndex,
  });

  /** Nahraje snímek záložky do živého stavu. Složka se vždy načte znovu —
   *  neaktivní záložka nic nehlídala, mezitím se v ní mohlo cokoli změnit. */
  const applySnapshot = (snapshot: TabSnapshot) => {
    keepQueryOnNav.current = snapshot.nav.current !== nav.current;
    tabRestore.current =
      snapshot.viewMode === "column"
        ? null
        : {
            path: snapshot.nav.current,
            selection: snapshot.selection,
            active: snapshot.active,
            scrollTop: snapshot.scrollTop,
            seq: loadSeq.current,
          };

    dispatch({ type: "restore", state: { ...snapshot.nav, direction: "jump" } });
    setViewMode(snapshot.viewMode);
    setSortKey(snapshot.sortKey);
    setSortDirection(snapshot.sortDirection);
    setQuery(snapshot.query);
    setSearch(snapshot.search);
    setTagFilter(snapshot.tagFilter);
    setSelection(new Set());
    setActive(null);
    setOverlaySelected(null);
    setPendingSelect(null);
    setRenamingPath(null);
    setPathEditing(false);

    if (snapshot.viewMode === "column" && snapshot.nav.current !== null) {
      columnsApi.restore(
        snapshot.columns.length > 0
          ? snapshot.columns
          : [{ path: snapshot.nav.current, selectedPath: null, selectedPaths: [] }],
        snapshot.columnFocus,
      );
    }
    setRefreshToken((token) => token + 1);
  };

  // Výběr a posun obnovené záložky, jakmile dorazí čerstvý výpis její složky.
  useEffect(() => {
    const restore = tabRestore.current;
    if (restore === null || isColumnView) return;
    if (restore.path === null) {
      tabRestore.current = null;
      return;
    }
    if (loaded.path === null || loaded.seq <= restore.seq) return;
    // Dorazila jiná složka (uživatel mezitím odešel jinam) — výběr záložky
    // už nemá kam patřit a nesmí vystřelit při pozdějším návratu.
    if (!storage.samePath(loaded.path, restore.path)) {
      tabRestore.current = null;
      return;
    }

    tabRestore.current = null;
    const chosen = new Set(restore.selection);
    setSelection(new Set(entries.filter((entry) => chosen.has(entry.path)).map((entry) => entry.path)));
    setActive(entries.find((entry) => entry.path === restore.active) ?? null);
    const top = restore.scrollTop;
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = top;
    });
  }, [entries, loaded, isColumnView]);

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

  navDirectionRef.current = nav.direction;

  // Backend hlídá jen to, co je vidět: v column view všechny sloupce, jinak
  // aktuální složku. Klíč místo pole, ať se hlídač nepřestavuje při každém renderu.
  const watchedPaths = (isColumnView ? columnsApi.columns.map((column) => column.path) : [nav.current]).filter(
    (path): path is string => path !== null,
  );

  return {
    nav,
    dispatch,
    viewMode,
    setViewMode,
    sortKey,
    setSortKey,
    sortDirection,
    setSortDirection,
    query,
    setQuery,
    tagFilter,
    setTagFilter,
    search,
    setSearch,
    active,
    setActive,
    selection,
    setSelection,
    entries,
    loading,
    streamingCount,
    error,
    setError,
    freeSpace,
    refreshToken,
    renamingPath,
    setRenamingPath,
    pathEditing,
    setPathEditing,
    tagCount,
    setTagCount,
    searchCount,
    setSearchCount,
    setPendingSelect,
    loaded,
    loadedPath,
    filterQuery,
    overlaySelected,
    setOverlaySelected,
    loadedPathRef,
    ghostHost,
    scrollMemory,
    leaveOverlays,
    navigate,
    goBack,
    goForward,
    columnsApi,
    awaitingFolder,
    skeletonShown,
    sortedEntries,
    visibleEntries,
    focusedColumn,
    columnSelected,
    isColumnView,
    currentDir,
    submitSearch,
    selectEntry,
    clickSelect,
    scrollRef,
    attachScroll,
    viewHandle,
    scrollToPath,
    viewMetrics,
    selectIndex,
    moveSelection,
    findByPrefix,
    targetEntries,
    activeEntry,
    refresh,
    watchedPaths,
    requestSelect,
    reveal,
    goToParent,
    selectAll,
    band,
    captureSnapshot,
    applySnapshot,
    changeViewMode,
    sortBy,
  };
}

export type Panel = ReturnType<typeof usePanel>;
