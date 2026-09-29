import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { sortEntries, type SortDirection, type SortKey } from "./format";
import type { FileEntry, SelectMods } from "./types";

export type Column = {
  path: string;
  entries: FileEntry[];
  loading: boolean;
  error: string | null;
  /** Aktivní položka — ta, na které stojí klávesnice a kterou otevírá Enter. */
  selectedPath: string | null;
  /** Vícenásobný výběr (Ctrl/Shift+klik, gumička). Prázdné = jen selectedPath. */
  selectedPaths: string[];
  /** Kotva pro Shift: poslední položka vybraná bez Shiftu. */
  anchorPath: string | null;
  /** Identita posledního požadavku na výpis. Odpověď s jiným tokenem je stará
   *  (klik na složku a hned Enter spustí dva loady téhož sloupce) a zahodí se. */
  token: number;
  /** Roste s každým dorazivším výpisem. Podle ní App pozná, že sloupec má
   *  čerstvá data a může v něm označit nově vytvořenou položku. */
  version: number;
};

/** Posun o počet řádků (šipky ±1, PgUp/PgDn o stránku) nebo na kraj. */
export type MoveTarget = number | "first" | "last";

export type ColumnsApi = {
  columns: Column[];
  focusedIndex: number;
  /** Cesta nejhlubšího sloupce — to je "kde uživatel je", když se přepíná view mode. */
  activePath: string | null;
  /** Načítá se nový kořen (navigace). Dosavadní sloupce do té doby zůstávají. */
  rootLoading: boolean;
  /** Klik na položku: vybere ji a u složky rovnou natáhne sloupec napravo.
   *  S modifikátory přepíná (Ctrl) nebo vybírá rozsah od kotvy (Shift). */
  select: (columnIndex: number, entry: FileEntry, mods?: SelectMods) => void;
  /** Shift+↑/↓: rozšíří výběr od kotvy v zaměřeném sloupci. */
  extend: (delta: 1 | -1) => void;
  /** Gumička: začátek tažení (additive = Ctrl/Shift, přidává k výběru). */
  startBand: (columnIndex: number, additive: boolean) => void;
  /** Gumička: položky pod obdélníkem. */
  bandSelect: (columnIndex: number, paths: string[]) => void;
  /** Šipka vpravo / Enter nad složkou: otevře ji a přesune fokus do nového sloupce. */
  openInto: (columnIndex: number, entry: FileEntry) => void;
  focusColumn: (columnIndex: number) => void;
  move: (target: MoveTarget) => void;
  /** Klik do prázdna / Escape: zruší výběr ve sloupci a zahodí sloupce napravo. */
  clearSelection: (columnIndex: number) => void;
  /** Přenačte obsah všech otevřených sloupců beze změny hierarchie. */
  refresh: () => void;
  /** Položky sloupce tak, jak je uživatel vidí — seřazené a v zaměřeném
   *  sloupci i vyfiltrované. Šipky i akce pracují jen nad nimi. */
  visibleEntries: (columnIndex: number) => FileEntry[];
};

/** Každý load dostane nový token — čísla se nikdy neopakují. */
let nextToken = 1;

/** Vybere položku ve sloupci a zahodí všechny sloupce napravo od něj. */
function selectInColumn(columns: Column[], index: number, selectedPath: string | null): Column[] {
  const column = columns[index];
  if (!column) return columns;

  const next = columns.slice(0, index + 1);
  next[index] = { ...column, selectedPath, selectedPaths: [], anchorPath: selectedPath };
  return next;
}

/**
 * Vícenásobný výběr ve sloupci. Jedna položka se chová jako obyčejný výběr
 * (selectedPaths prázdné), víc položek zahodí sloupce napravo — u výběru
 * víc složek není co otevírat.
 */
function selectManyInColumn(
  columns: Column[],
  index: number,
  paths: string[],
  active: string | null,
  anchor: string | null,
): Column[] {
  const column = columns[index];
  if (!column) return columns;

  const next = columns.slice(0, index + 1);
  const single = paths.length <= 1;
  next[index] = {
    ...column,
    selectedPath: single ? (paths[0] ?? null) : active,
    selectedPaths: single ? [] : paths,
    anchorPath: anchor,
  };
  return next;
}

/** Vybrané cesty sloupce — jedna i víc. */
function selectionOf(column: Column): string[] {
  if (column.selectedPaths.length > 0) return column.selectedPaths;
  return column.selectedPath === null ? [] : [column.selectedPath];
}

/** Rozsah mezi dvěma cestami v pořadí `entries` (včetně obou konců). */
function rangeBetween(entries: FileEntry[], from: string, to: string): string[] {
  const start = entries.findIndex((entry) => entry.path === from);
  const end = entries.findIndex((entry) => entry.path === to);
  if (start < 0 || end < 0) return [to];
  const [low, high] = start <= end ? [start, end] : [end, start];
  return entries.slice(low, high + 1).map((entry) => entry.path);
}

function matchesFilter(entry: FileEntry, needle: string): boolean {
  return needle === "" || entry.name.toLowerCase().includes(needle);
}

export type ColumnSort = { key: SortKey; direction: SortDirection };

export function useColumns(
  rootPath: string | null,
  enabled: boolean,
  sort: ColumnSort,
  showHidden: boolean,
  /** Text z pole hledání — filtruje jen zaměřený sloupec. */
  filter: string,
  /** Chyby, které nemají vlastní místo v UI (refresh sloupce). */
  onError: (message: string) => void,
): ColumnsApi {
  // Ve stavu leží výpisy tak, jak přišly z backendu. Řadí se až na výstupu,
  // takže změna řazení nic nepřenačítá — jen šipky a "vyber první" musí
  // pracovat se stejným pořadím, jaké uživatel vidí.
  const [rawColumns, setColumns] = useState<Column[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [rootLoading, setRootLoading] = useState(false);
  /** Token posledního požadavku na kořen — starší odpověď se zahodí. */
  const rootToken = useRef(0);

  // Refresh a gumička potřebují aktuální sloupce, ale nesmí se kvůli nim
  // překreslovat — jinak by se identita callbacků měnila při každém výběru.
  const columnsRef = useRef<Column[]>([]);
  useEffect(() => {
    columnsRef.current = rawColumns;
  }, [rawColumns]);

  // V refech, ať se kvůli nim nemění identita callbacků.
  const sortRef = useRef(sort);
  sortRef.current = sort;
  const showHiddenRef = useRef(showHidden);
  showHiddenRef.current = showHidden;
  const needle = filter.trim().toLowerCase();
  const filterRef = useRef({ needle, focusedIndex });
  filterRef.current = { needle, focusedIndex };
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  /** Seřazené a u zaměřeného sloupce vyfiltrované — přesně to, co je vidět. */
  const shown = useCallback((entries: FileEntry[], index: number) => {
    const ordered = sortEntries(entries, sortRef.current.key, sortRef.current.direction);
    const { needle: current, focusedIndex: focused } = filterRef.current;
    return index === focused ? ordered.filter((entry) => matchesFilter(entry, current)) : ordered;
  }, []);

  const columns = useMemo(
    () =>
      rawColumns.map((column) => ({
        ...column,
        entries: sortEntries(column.entries, sort.key, sort.direction),
      })),
    [rawColumns, sort.key, sort.direction],
  );

  const loadColumn = useCallback(
    async (index: number, path: string, selectFirst: boolean) => {
      const token = nextToken++;

      // Nový sloupec nahradí všechno napravo od pozice, na kterou se vkládá.
      setColumns((prev) => [
        ...prev.slice(0, index),
        {
          path,
          entries: [],
          loading: true,
          error: null,
          selectedPath: null,
          selectedPaths: [],
          anchorPath: null,
          token,
          version: prev[index]?.path === path ? prev[index].version : 0,
        },
      ]);
      if (selectFirst) setFocusedIndex(index);

      /** Zapíše výsledek, jen když sloupec pořád čeká právě na tenhle požadavek. */
      const apply = (update: (column: Column) => Column) =>
        setColumns((prev) => {
          const column = prev[index];
          if (!column || column.path !== path || column.token !== token) return prev;
          const next = [...prev];
          next[index] = update(column);
          return next;
        });

      try {
        const entries = await invoke<FileEntry[]>("list_dir", {
          path,
          showHidden: showHiddenRef.current,
        });
        apply((column) => {
          const first = selectFirst ? (shown(entries, index)[0]?.path ?? null) : null;
          return {
            ...column,
            entries,
            loading: false,
            version: column.version + 1,
            selectedPath: first,
            anchorPath: first,
          };
        });
      } catch (err: unknown) {
        apply((column) => ({
          ...column,
          entries: [],
          loading: false,
          version: column.version + 1,
          error: String(err),
        }));
      }
    },
    [shown],
  );

  // Změna cesty zvenčí (sidebar, Back/Forward, breadcrumb) i vstup do column view
  // začínají vždy jedním sloupcem. Dosavadní sloupce ale zůstanou vidět, dokud
  // nový kořen nedorazí — panel se při navigaci nevyprazdňuje.
  useEffect(() => {
    const token = nextToken++;
    rootToken.current = token;

    if (!enabled || rootPath === null) {
      setFocusedIndex(0);
      setColumns([]);
      setRootLoading(false);
      return;
    }

    setRootLoading(true);
    const finish = (entries: FileEntry[], error: string | null) => {
      if (rootToken.current !== token) return;
      setRootLoading(false);
      setFocusedIndex(0);
      setColumns((prev) => [
        {
          path: rootPath,
          entries,
          loading: false,
          error,
          selectedPath: null,
          selectedPaths: [],
          anchorPath: null,
          token,
          version: (prev[0]?.path === rootPath ? prev[0].version : 0) + 1,
        },
      ]);
    };

    invoke<FileEntry[]>("list_dir", { path: rootPath, showHidden: showHiddenRef.current })
      .then((entries) => finish(entries, null))
      .catch((err: unknown) => finish([], String(err)));
  }, [enabled, rootPath]);

  const select = useCallback(
    (columnIndex: number, entry: FileEntry, mods?: SelectMods) => {
      setFocusedIndex(columnIndex);

      if (mods?.toggle || mods?.range) {
        setColumns((prev) => {
          const column = prev[columnIndex];
          if (!column) return prev;

          if (mods.range) {
            const anchor = column.anchorPath ?? column.selectedPath ?? entry.path;
            const range = rangeBetween(shown(column.entries, columnIndex), anchor, entry.path);
            // Ctrl+Shift přidává rozsah k dosavadnímu výběru.
            const paths = mods.toggle ? [...new Set([...selectionOf(column), ...range])] : range;
            return selectManyInColumn(prev, columnIndex, paths, entry.path, anchor);
          }

          const current = selectionOf(column);
          const paths = current.includes(entry.path)
            ? current.filter((path) => path !== entry.path)
            : [...current, entry.path];
          return selectManyInColumn(prev, columnIndex, paths, entry.path, entry.path);
        });
        return;
      }

      setColumns((prev) => selectInColumn(prev, columnIndex, entry.path));
      if (entry.is_dir) void loadColumn(columnIndex + 1, entry.path, false);
    },
    [loadColumn, shown],
  );

  const extend = useCallback(
    (delta: 1 | -1) => {
      setColumns((prev) => {
        const column = prev[focusedIndex];
        if (!column) return prev;

        const entries = shown(column.entries, focusedIndex);
        if (entries.length === 0) return prev;

        const current = entries.findIndex((entry) => entry.path === column.selectedPath);
        const next = entries[Math.min(Math.max(current + delta, 0), entries.length - 1)];
        const anchor = column.anchorPath ?? column.selectedPath ?? next.path;
        return selectManyInColumn(
          prev,
          focusedIndex,
          rangeBetween(entries, anchor, next.path),
          next.path,
          anchor,
        );
      });
    },
    [focusedIndex, shown],
  );

  // Výběr v okamžiku, kdy gumička začala — s Ctrl se k němu přidává, a musí
  // zůstat stejný po celou dobu tažení (jinak by se výběr jen rozrůstal).
  const bandBase = useRef<string[]>([]);

  const startBand = useCallback((columnIndex: number, additive: boolean) => {
    setFocusedIndex(columnIndex);
    const column = columnsRef.current[columnIndex];
    bandBase.current = additive && column ? selectionOf(column) : [];
  }, []);

  const bandSelect = useCallback((columnIndex: number, paths: string[]) => {
    setColumns((prev) => {
      const all = [...new Set([...bandBase.current, ...paths])];
      return selectManyInColumn(prev, columnIndex, all, all[all.length - 1] ?? null, all[0] ?? null);
    });
  }, []);

  const openInto = useCallback(
    (columnIndex: number, entry: FileEntry) => {
      if (!entry.is_dir) return;

      setColumns((prev) => selectInColumn(prev, columnIndex, entry.path));
      void loadColumn(columnIndex + 1, entry.path, true);
    },
    [loadColumn],
  );

  const focusColumn = useCallback((columnIndex: number) => {
    setFocusedIndex((current) => (columnIndex >= 0 ? columnIndex : current));
  }, []);

  const clearSelection = useCallback((columnIndex: number) => {
    setColumns((prev) => selectInColumn(prev, columnIndex, null));
    setFocusedIndex((current) => (columnIndex >= 0 ? columnIndex : current));
  }, []);

  const move = useCallback(
    (target: MoveTarget) => {
      setColumns((prev) => {
        const column = prev[focusedIndex];
        if (!column) return prev;

        // Jen viditelné řádky — jinak by šipka vybrala položku skrytou filtrem
        // a Delete / F2 / mezerník by zafungovaly na něco, co není vidět.
        const entries = shown(column.entries, focusedIndex);
        if (entries.length === 0) return prev;

        const last = entries.length - 1;
        const current = entries.findIndex((entry) => entry.path === column.selectedPath);

        let next: number;
        if (target === "first") next = 0;
        else if (target === "last") next = last;
        else if (current === -1) next = target > 0 ? 0 : last;
        else next = Math.min(Math.max(current + target, 0), last);

        const chosen = entries[next];
        if (chosen.path === column.selectedPath) return prev;

        // Posun výběru mění, co patří napravo — stejně jako klik myší.
        return selectInColumn(prev, focusedIndex, chosen.path);
      });
    },
    [focusedIndex, shown],
  );

  const refresh = useCallback(() => {
    const snapshot = columnsRef.current;

    void Promise.all(
      snapshot.map((column) =>
        invoke<FileEntry[]>("list_dir", {
          path: column.path,
          showHidden: showHiddenRef.current,
        })
          .then((entries) => ({ entries, error: null }))
          .catch((err: unknown) => ({ entries: null, error: String(err) })),
      ),
    ).then((results) => {
      // První sloupec, jehož složka zmizela (smazaná, odpojený disk) — od něj
      // doprava nic nemá smysl ukazovat. Kořenový sloupec se nechává, ten patří
      // nav.current a chybu u něj ukáže hlavní výpis.
      const failedAt = results.findIndex((result, index) => index > 0 && result.error !== null);
      if (failedAt > 0) onErrorRef.current(`Složka zmizela — ${results[failedAt].error}`);

      setColumns((prev) => {
        const kept = failedAt > 0 ? prev.slice(0, failedAt) : prev;

        const next = kept.map((column, index) => {
          const result = results[index];
          // Sloupec se mezitím mohl vyměnit — pak jeho data nechceme přepsat.
          if (!result || result.entries === null) return column;
          if (snapshot[index]?.path !== column.path || snapshot[index]?.token !== column.token) {
            return column;
          }

          const alive = new Set(result.entries.map((entry) => entry.path));
          return {
            ...column,
            entries: result.entries,
            version: column.version + 1,
            selectedPath: column.selectedPath !== null && alive.has(column.selectedPath) ? column.selectedPath : null,
            selectedPaths: column.selectedPaths.filter((path) => alive.has(path)),
          };
        });

        // V rodiči zmizelé složky se zruší výběr, jinak by ukazoval na nic.
        if (failedAt > 0 && next[failedAt - 1]) {
          next[failedAt - 1] = { ...next[failedAt - 1], selectedPath: null };
        }
        return next;
      });

      if (failedAt > 0) setFocusedIndex((current) => Math.min(current, failedAt - 1));
    });
  }, []);

  // Přepnutí skrytých souborů přenačte otevřené sloupce, hierarchie zůstane.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    refresh();
  }, [showHidden, refresh]);

  const visibleEntries = useCallback(
    (columnIndex: number) => {
      const column = columns[columnIndex];
      if (!column) return [];
      return columnIndex === focusedIndex
        ? column.entries.filter((entry) => matchesFilter(entry, needle))
        : column.entries;
    },
    [columns, focusedIndex, needle],
  );

  const activePath = columns.length > 0 ? columns[columns.length - 1].path : rootPath;

  return useMemo(
    () => ({
      columns,
      focusedIndex,
      activePath,
      rootLoading,
      select,
      extend,
      startBand,
      bandSelect,
      openInto,
      focusColumn,
      move,
      clearSelection,
      refresh,
      visibleEntries,
    }),
    [
      columns,
      focusedIndex,
      activePath,
      rootLoading,
      select,
      extend,
      startBand,
      bandSelect,
      openInto,
      focusColumn,
      move,
      clearSelection,
      refresh,
      visibleEntries,
    ],
  );
}
