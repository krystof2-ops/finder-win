import { useEffect, useMemo, useRef, useState } from "react";

import { Tag } from "lucide-react";

import { ResultsView } from "./ResultsView";
import { statPaths } from "../fileops";
import * as storage from "../lib/storage";
import { tagLabel } from "../lib/tags";
import { useStorage } from "../lib/useStorage";
import type { FileEntry, TagColor } from "../types";

type TagViewProps = {
  color: TagColor;
  windowFocused: boolean;
  selectedPath: string | null;
  onSelectionChange: (entry: FileEntry | null) => void;
  onOpen: (entry: FileEntry) => void;
  /** Pravý klik — stejné menu jako u běžné položky. */
  onContextMenu: (entry: FileEntry, x: number, y: number) => void;
  /** Roste po každé souborové operaci; výsledky se pak načtou znovu. */
  refreshToken: number;
  /** Ať status bar hlásí počet z tag view, ne z podkladové složky. */
  onCountChange: (count: number) => void;
};

/** Virtuální složka všech položek jedné barvy. Vykresluje ResultsView. */
export function TagView({
  color,
  windowFocused,
  selectedPath,
  onSelectionChange,
  onOpen,
  onContextMenu,
  refreshToken,
  onCountChange,
}: TagViewProps) {
  const { tags } = useStorage();

  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const requestId = useRef(0);

  /**
   * Disk se kvůli tag view neprochází — mapa cesta→barvy má všechno, co je
   * potřeba, takže stačí vyfiltrovat klíče. Jediné, co se ověřuje na disku,
   * je existence, a to jedním hromadným voláním.
   */
  const paths = useMemo(
    () => Object.keys(tags).filter((path) => tags[path].includes(color)),
    [tags, color],
  );

  // Klíč místo pole v závislostech — jinak by nová identita pole po každém
  // překreslení storu spustila zbytečné načtení.
  const pathsKey = paths.join("\0");

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);

    statPaths(paths)
      .then((results) => {
        if (requestId.current !== id) return;

        const found: FileEntry[] = [];
        const gone: string[] = [];

        // Pozice odpovídají vstupu, takže se dá rozlišit "smazáno" od
        // "nedostupné". Promazává se **jen** to první — jinak by odpojený
        // síťový disk nebo chybějící oprávnění nenávratně smazaly tagy.
        results.forEach((result, index) => {
          if (result.entry !== null) found.push(result.entry);
          else if (result.missing) gone.push(paths[index]);
        });

        setEntries(found);
        setLoading(false);

        if (gone.length > 0) void storage.pruneTags(gone);
      })
      .catch(() => {
        if (requestId.current !== id) return;
        setEntries([]);
        setLoading(false);
      });
    // paths je odvozené z pathsKey; závislost na klíči drží efekt stabilní.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey, refreshToken]);

  return (
    <ResultsView
      entries={entries}
      loading={loading}
      loadingMessage="Načítám…"
      error={null}
      empty={{
        Icon: Tag,
        title: `Nic není označené barvou ${tagLabel(color).toLowerCase()}`,
        hint: "Štítek přidáte pravým klikem na položku → Tagy.",
      }}
      windowFocused={windowFocused}
      selectedPath={selectedPath}
      onSelectionChange={onSelectionChange}
      onOpen={onOpen}
      onContextMenu={onContextMenu}
      onCountChange={onCountChange}
    />
  );
}
