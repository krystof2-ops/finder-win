import { useEffect, useRef, useState } from "react";

import { SmallEntryIcon } from "./icons";
import { TagDots } from "./TagDots";
import { entryOpacity, formatModified } from "../format";
import { relativeParent, searchRecursive } from "../fileops";
import { useStorage } from "../lib/useStorage";
import type { FileEntry } from "../types";

/** Strop pro jedno hledání. Víc řádků stejně nikdo neprojde a průchod by rostl. */
export const MAX_RESULTS = 500;

/** Sloupec s puntíky, Název, Kde je, Datum úpravy — stejné rozvržení jako tag view. */
const GRID_TEMPLATE = "24px minmax(0, 1fr) minmax(0, 1.2fr) 140px";

type SearchViewProps = {
  /** Složka, od které se prohledává dolů. */
  root: string;
  query: string;
  windowFocused: boolean;
  /** Naviguje do rodičovské složky a označí tam položku. */
  onReveal: (path: string) => void;
  onOpen: (entry: FileEntry) => void;
  /** Pravý klik — stejné menu jako u běžné položky. */
  onContextMenu: (entry: FileEntry, x: number, y: number) => void;
  /** Roste po každé souborové operaci; výsledky se pak načtou znovu. */
  refreshToken: number;
  showHidden: boolean;
  /** Ať status bar hlásí počet výsledků, ne obsah podkladové složky. */
  onCountChange: (count: number) => void;
};

export function SearchView({
  root,
  query,
  windowFocused,
  onReveal,
  onOpen,
  onContextMenu,
  refreshToken,
  showHidden,
  onCountChange,
}: SearchViewProps) {
  const { tags } = useStorage();

  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const requestId = useRef(0);
  const lastSearch = useRef<string | null>(null);

  // Průchod velkého stromu trvá; bez tohohle by pomalejší odpověď na starší
  // dotaz přepsala výsledky toho, co uživatel mezitím napsal.
  useEffect(() => {
    const id = ++requestId.current;
    setError(null);

    // Nový dotaz začíná načítací obrazovkou. Přenačtení po operaci (smazání,
    // přejmenování) nechá staré výsledky viset, dokud nedorazí nové.
    const key = `${root}\0${query}`;
    if (lastSearch.current !== key) {
      lastSearch.current = key;
      setLoading(true);
      setSelected(null);
    }

    searchRecursive(root, query, MAX_RESULTS, showHidden)
      .then((found) => {
        if (requestId.current !== id) return;

        setEntries(found);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (requestId.current !== id) return;

        setEntries([]);
        setError(String(err));
        setLoading(false);
      });
  }, [root, query, refreshToken, showHidden]);

  useEffect(() => {
    onCountChange(entries.length);
  }, [entries.length, onCountChange]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-[13px] text-secondary">
        Hledám…
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-secondary">
        Hledání se nepodařilo — {error}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-secondary">
        Nic neodpovídá „{query}".
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div
        className="surface sticky top-0 z-10 grid h-6 items-center gap-3 border-b border-line bg-toolbar px-3 text-[11px] font-medium text-secondary"
        style={{ gridTemplateColumns: GRID_TEMPLATE, backdropFilter: "blur(20px)" }}
      >
        <span aria-hidden />
        <span className="truncate">Název</span>
        <span className="truncate">Kde je</span>
        <span className="truncate">Datum úpravy</span>
      </div>

      {entries.map((entry) => {
        const isSelected = entry.path === selected;
        const selectedClass = windowFocused ? "bg-selected" : "bg-selected-inactive";
        const where = relativeParent(entry.path, root);

        return (
          <div
            key={entry.path}
            role="button"
            tabIndex={0}
            data-tooltip={entry.path}
            // Jeden klik odkrývá — výsledky jsou rozcestník, ne obsah složky.
            onClick={() => {
              setSelected(entry.path);
              onReveal(entry.path);
            }}
            onDoubleClick={() => onOpen(entry)}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSelected(entry.path);
              onContextMenu(entry, event.clientX, event.clientY);
            }}
            className={`grid h-6 items-center gap-3 px-3 text-[13px] text-primary outline-none transition-colors duration-100 ${
              isSelected ? selectedClass : "hover:bg-hover"
            }`}
            style={{ gridTemplateColumns: GRID_TEMPLATE, opacity: entryOpacity(entry, false) }}
          >
            <span className="flex items-center">
              <TagDots colors={tags[entry.path] ?? []} size={8} />
            </span>

            <div className="flex min-w-0 items-center gap-2">
              <SmallEntryIcon entry={entry} />
              <span className="truncate">{entry.name}</span>
            </div>

            {/* Prázdné "kde" znamená přímo v prohledávané složce. */}
            <span className="truncate text-secondary">{where === "" ? "—" : where}</span>
            <span className="truncate text-secondary">{formatModified(entry.modified)}</span>
          </div>
        );
      })}

      {entries.length === MAX_RESULTS && (
        <div className="px-3 py-2 text-[11px] text-secondary">
          Zobrazeno prvních {MAX_RESULTS} výsledků.
        </div>
      )}
    </div>
  );
}
