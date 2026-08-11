import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { FileEntry } from "./types";

export type Column = {
  path: string;
  entries: FileEntry[];
  loading: boolean;
  error: string | null;
  selectedPath: string | null;
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
};

/**
 * Zapíše změnu do sloupce jen tehdy, když na daném indexu pořád leží tatáž cesta.
 * Bez toho by pomalá odpověď přepsala sloupec, který uživatel mezitím vyměnil.
 */
function updateColumn(
  columns: Column[],
  index: number,
  path: string,
  update: (column: Column) => Column,
): Column[] {
  const column = columns[index];
  if (!column || column.path !== path) return columns;

  const next = [...columns];
  next[index] = update(column);
  return next;
}

/** Vybere položku ve sloupci a zahodí všechny sloupce napravo od něj. */
function selectInColumn(columns: Column[], index: number, selectedPath: string): Column[] {
  const column = columns[index];
  if (!column) return columns;

  const next = columns.slice(0, index + 1);
  next[index] = { ...column, selectedPath };
  return next;
}

export function useColumns(rootPath: string | null, enabled: boolean): ColumnsApi {
  const [columns, setColumns] = useState<Column[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(0);

  const loadColumn = useCallback(
    async (index: number, path: string, selectFirst: boolean) => {
      // Nový sloupec nahradí všechno napravo od pozice, na kterou se vkládá.
      setColumns((prev) => [
        ...prev.slice(0, index),
        { path, entries: [], loading: true, error: null, selectedPath: null },
      ]);
      if (selectFirst) setFocusedIndex(index);

      try {
        const entries = await invoke<FileEntry[]>("list_dir", { path });
        setColumns((prev) =>
          updateColumn(prev, index, path, (column) => ({
            ...column,
            entries,
            loading: false,
            selectedPath: selectFirst ? (entries[0]?.path ?? null) : null,
          })),
        );
      } catch (err: unknown) {
        setColumns((prev) =>
          updateColumn(prev, index, path, (column) => ({
            ...column,
            entries: [],
            loading: false,
            error: String(err),
          })),
        );
      }
    },
    [],
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

  const move = useCallback(
    (target: MoveTarget) => {
      setColumns((prev) => {
        const column = prev[focusedIndex];
        if (!column || column.entries.length === 0) return prev;

        const last = column.entries.length - 1;
        const current = column.entries.findIndex((entry) => entry.path === column.selectedPath);

        let next: number;
        if (target === "first") next = 0;
        else if (target === "last") next = last;
        else if (current === -1) next = target === 1 ? 0 : last;
        else next = Math.min(Math.max(current + target, 0), last);

        const chosen = column.entries[next];
        if (chosen.path === column.selectedPath) return prev;

        // Posun výběru mění, co patří napravo — stejně jako klik myší.
        return selectInColumn(prev, focusedIndex, chosen.path);
      });
    },
    [focusedIndex],
  );

  const activePath = columns.length > 0 ? columns[columns.length - 1].path : rootPath;

  return useMemo(
    () => ({ columns, focusedIndex, activePath, select, openInto, focusColumn, move }),
    [columns, focusedIndex, activePath, select, openInto, focusColumn, move],
  );
}
