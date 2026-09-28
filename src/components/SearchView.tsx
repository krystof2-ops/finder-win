import { useEffect, useRef, useState } from "react";

import { ResultsView } from "./ResultsView";
import { cancelSearch, searchRecursive } from "../fileops";
import type { FileEntry } from "../types";

/** Identita hledání pro backend — napříč všemi SearchView, proto modulová. */
let nextSearchId = 1;

/** Strop pro jedno hledání. Víc řádků stejně nikdo neprojde a průchod by rostl. */
export const MAX_RESULTS = 500;

type SearchViewProps = {
  /** Složka, od které se prohledává dolů. */
  root: string;
  query: string;
  windowFocused: boolean;
  selectedPath: string | null;
  onSelectionChange: (entry: FileEntry | null) => void;
  onOpen: (entry: FileEntry) => void;
  /** Pravý klik — stejné menu jako u běžné položky. */
  onContextMenu: (entry: FileEntry, x: number, y: number) => void;
  /** Roste po každé souborové operaci; výsledky se pak načtou znovu. */
  refreshToken: number;
  showHidden: boolean;
  /** Ať status bar hlásí počet výsledků, ne obsah podkladové složky. */
  onCountChange: (count: number) => void;
};

/** Rekurzivní hledání od `root`. Vykresluje ResultsView. */
export function SearchView({
  root,
  query,
  windowFocused,
  selectedPath,
  onSelectionChange,
  onOpen,
  onContextMenu,
  refreshToken,
  showHidden,
  onCountChange,
}: SearchViewProps) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestId = useRef(0);
  const lastSearch = useRef<string | null>(null);

  // Průchod velkého stromu trvá; bez tohohle by pomalejší odpověď na starší
  // dotaz přepsala výsledky toho, co uživatel mezitím napsal.
  useEffect(() => {
    const id = ++requestId.current;
    const searchId = nextSearchId++;
    setError(null);

    // Nový dotaz začíná načítací obrazovkou. Přenačtení po operaci (smazání,
    // přejmenování) nechá staré výsledky viset, dokud nedorazí nové.
    const key = `${root}\0${query}`;
    if (lastSearch.current !== key) {
      lastSearch.current = key;
      setEntries([]);
      setLoading(true);
    }

    searchRecursive(root, query, MAX_RESULTS, showHidden, searchId)
      .then((found) => {
        if (requestId.current !== id) return;

        setEntries(found);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (requestId.current !== id) return;

        setEntries([]);
        setError(`Hledání se nepodařilo — ${String(err)}`);
        setLoading(false);
      });

    // Nový dotaz, zavření výsledků (Escape, vymazání pole) i odchod jinam
    // zastaví průchod disku — jinak by na C:\ běžel dál naprázdno.
    return () => void cancelSearch(searchId).catch(() => undefined);
  }, [root, query, refreshToken, showHidden]);

  return (
    <ResultsView
      entries={entries}
      loading={loading}
      loadingMessage="Hledám…"
      error={error}
      emptyMessage={`Nic neodpovídá „${query}".`}
      root={root}
      footer={
        entries.length === MAX_RESULTS && (
          <div className="px-3 py-2 text-[11px] text-secondary">
            Zobrazeno prvních {MAX_RESULTS} výsledků.
          </div>
        )
      }
      windowFocused={windowFocused}
      selectedPath={selectedPath}
      onSelectionChange={onSelectionChange}
      onOpen={onOpen}
      onContextMenu={onContextMenu}
      onCountChange={onCountChange}
    />
  );
}
