import { useReducer, useState } from "react";

import type { ColumnSnapshot } from "./columns";
import type { SortDirection, SortKey } from "./format";
import { INITIAL_NAV, navReducer, type NavState } from "./navigation";
import type { FileEntry, TagColor, ViewMode } from "./types";

/**
 * Stav jednoho „prohlížeče" — toho, co má každá záložka vlastní: historie,
 * zobrazení, řazení, hledání, výběr. Sdílené věci (sidebar, schránka, Zpět,
 * téma, jazyk) drží App.
 *
 * Živý je vždy jen prohlížeč aktivní záložky; neaktivní záložky leží jako
 * TabSnapshot a při přepnutí se do tohohle stavu nahrají zpátky. Díky tomu
 * hlídá složky a načítá výpisy jen ta záložka, na kterou uživatel kouká.
 */
export function useBrowserState() {
  const [nav, dispatch] = useReducer(navReducer, INITIAL_NAV);
  const [viewMode, setViewMode] = useState<ViewMode>("icon");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [query, setQuery] = useState("");

  // Tag view je samostatný režim hlavního panelu — nesouvisí s nav.current,
  // proto vlastní stav a ne další ViewMode.
  const [tagFilter, setTagFilter] = useState<TagColor | null>(null);

  // Rekurzivní hledání je stejně jako tag view samostatný režim panelu. Kořen
  // se drží spolu s dotazem, aby výsledky nezůstaly viset na jiné složce, než
  // ve které se opravdu hledalo.
  const [search, setSearch] = useState<{ root: string; query: string } | null>(null);

  // Aktivní položka řídí operace pro jednu položku (přejmenování, Quick Look,
  // vlastnosti); selection drží celý výběr pro hromadné operace.
  const [active, setActive] = useState<FileEntry | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());

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
  };
}

/** Uložený stav neaktivní záložky. */
export type TabSnapshot = {
  nav: NavState;
  viewMode: ViewMode;
  sortKey: SortKey;
  sortDirection: SortDirection;
  query: string;
  search: { root: string; query: string } | null;
  tagFilter: TagColor | null;
  selection: string[];
  active: string | null;
  scrollTop: number;
  /** Column view: hierarchie sloupců s výběry a zaměřený sloupec. */
  columns: ColumnSnapshot[];
  columnFocus: number;
};

export type Tab = {
  id: number;
  /** Levý panel. Pro aktivní záložku zastaralý — platí živý stav panelů. */
  snapshot: TabSnapshot;
  /** Pravý panel (rozdělené okno); chybí, dokud záložka rozdělená nebyla. */
  second?: TabSnapshot;
  /** Záložka je rozdělená na dva panely. */
  split?: boolean;
  /** Který panel byl aktivní (0 = levý). */
  activePanel?: 0 | 1;
  /** Záložka se právě zavírá (animace) — už není cílem zkratek ani kliků. */
  closing?: boolean;
  /** Právě otevřená — ouško vjede animací (jen chvíli po otevření). */
  fresh?: boolean;
};

let nextTabId = 1;

/** Nová záložka ve složce `path`; zobrazení a řazení si vezme po otevírající. */
export function newTab(path: string | null, from?: Pick<TabSnapshot, "viewMode" | "sortKey" | "sortDirection">): Tab {
  return { id: nextTabId++, snapshot: blankSnapshot(path, from) };
}

/** Panel ve složce `path` bez historie a výběru (null = prázdný panel). */
export function blankSnapshot(
  path: string | null,
  from?: Pick<TabSnapshot, "viewMode" | "sortKey" | "sortDirection">,
): TabSnapshot {
  return {
    nav: { current: path, back: [], forward: [], direction: "jump" },
    viewMode: from?.viewMode ?? "icon",
    sortKey: from?.sortKey ?? "name",
    sortDirection: from?.sortDirection ?? "asc",
    query: "",
    search: null,
    tagFilter: null,
    selection: [],
    active: null,
    scrollTop: 0,
    columns: [],
    columnFocus: 0,
  };
}

/** Panel, který záložka ukazuje navenek (název ouška, uložení) — ten aktivní. */
export function tabFace(tab: Tab): TabSnapshot {
  return tab.activePanel === 1 && tab.second ? tab.second : tab.snapshot;
}
