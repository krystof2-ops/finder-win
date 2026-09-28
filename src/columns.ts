import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { sortEntries, type SortDirection, type SortKey } from "./format";
import type { FileEntry } from "./types";

export type Column = {
  path: string;
  entries: FileEntry[];
  loading: boolean;
  error: string | null;
  selectedPath: string | null;
  /** Identita posledního požadavku na výpis. Odpověď s jiným tokenem je stará
   *  (klik na složku a hned Enter spustí dva loady téhož sloupce) a zahodí se. */
  token: number;
  /** Roste s každým dorazivším výpisem. Podle ní App pozná, že sloupec má
   *  čerstvá data a může v něm označit nově vytvořenou položku. */
  version: number;
};

export type MoveTarget = 1 | -1 | "first" | "last";

export type ColumnsApi = {
  columns: Column[];
  focusedIndex: number;
  /** Cesta nejhlubšího sloupce — to je "kde uživatel je", když se přepíná view mode. */
  activePath: string | null;
  /** Klik na položku: vybere ji a u složky rovnou natáhne sloupec napravo. */
  select: (columnIndex: number, entry: FileEntry) => void;
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
  next[index] = { ...column, selectedPath };
  return next;
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
        apply((column) => ({
          ...column,
          entries,
          loading: false,
          version: column.version + 1,
          selectedPath: selectFirst ? (shown(entries, index)[0]?.path ?? null) : null,
        }));
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
  // začínají vždy jedním sloupcem.
  useEffect(() => {
    setFocusedIndex(0);

    if (!enabled || rootPath === null) {
      setColumns([]);
      return;
    }

    void loadColumn(0, rootPath, false);
  }, [enabled, rootPath, loadColumn]);

  const select = useCallback(
    (columnIndex: number, entry: FileEntry) => {
      setColumns((prev) => selectInColumn(prev, columnIndex, entry.path));
      setFocusedIndex(columnIndex);

      if (entry.is_dir) void loadColumn(columnIndex + 1, entry.path, false);
    },
    [loadColumn],
  );

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
        else if (current === -1) next = target === 1 ? 0 : last;
        else next = Math.min(Math.max(current + target, 0), last);

        const chosen = entries[next];
        if (chosen.path === column.selectedPath) return prev;

        // Posun výběru mění, co patří napravo — stejně jako klik myší.
        return selectInColumn(prev, focusedIndex, chosen.path);
      });
    },
    [focusedIndex, shown],
  );

  // Refresh potřebuje aktuální sloupce, ale nesmí se kvůli nim překreslovat,
  // jinak by se identita callbacku měnila při každém výběru.
  const columnsRef = useRef<Column[]>([]);
  useEffect(() => {
    columnsRef.current = rawColumns;
  }, [rawColumns]);

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

          const stillExists = result.entries.some((entry) => entry.path === column.selectedPath);
          return {
            ...column,
            entries: result.entries,
            version: column.version + 1,
            selectedPath: stillExists ? column.selectedPath : null,
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
      select,
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
      select,
      openInto,
      focusColumn,
      move,
      clearSelection,
      refresh,
      visibleEntries,
    ],
  );
}
