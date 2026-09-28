import { useEffect, useMemo, useRef, useState } from "react";
import { SmallEntryIcon } from "./icons";
import { TagDots } from "./TagDots";
import { entryOpacity, formatModified } from "../format";
import { parentPath, statPaths } from "../fileops";
import * as storage from "../lib/storage";
import { TAG_LABEL } from "../lib/tags";
import { useStorage } from "../lib/useStorage";
import type { FileEntry, TagColor } from "../types";

/** Sloupec s puntíky, Název, Kde je, Datum úpravy. */
const GRID_TEMPLATE = "24px minmax(0, 1fr) minmax(0, 1.2fr) 140px";

type TagViewProps = {
  color: TagColor;
  windowFocused: boolean;
  /** Naviguje do rodičovské složky a označí tam položku. */
  onReveal: (path: string) => void;
  onOpen: (entry: FileEntry) => void;
  /** Pravý klik — stejné menu jako u běžné položky. */
  onContextMenu: (entry: FileEntry, x: number, y: number) => void;
  /** Roste po každé souborové operaci; výsledky se pak načtou znovu. */
  refreshToken: number;
  /** Ať status bar hlásí počet z tag view, ne z podkladové složky. */
  onCountChange: (count: number) => void;
};

export function TagView({
  color,
  windowFocused,
  onReveal,
  onOpen,
  onContextMenu,
  refreshToken,
  onCountChange,
}: TagViewProps) {
  const { tags } = useStorage();

  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

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

  const sorted = useMemo(
    () => [...entries].sort((a, b) => a.name.localeCompare(b.name, "cs", { sensitivity: "base" })),
    [entries],
  );

  useEffect(() => {
    onCountChange(sorted.length);
  }, [sorted.length, onCountChange]);

  if (loading && entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-[13px] text-secondary">
        Načítám…
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-secondary">
        Nic není označené barvou {TAG_LABEL[color].toLowerCase()}.
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

      {sorted.map((entry) => {
        const isSelected = entry.path === selected;
        const selectedClass = windowFocused ? "bg-selected" : "bg-selected-inactive";

        return (
          <div
            key={entry.path}
            role="button"
            tabIndex={0}
            data-tooltip={entry.path}
            // Jeden klik odkrývá — tag view je rozcestník, ne obsah složky.
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

            <span className="truncate text-secondary">{parentPath(entry.path) ?? entry.path}</span>
            <span className="truncate text-secondary">{formatModified(entry.modified)}</span>
          </div>
        );
      })}
    </div>
  );
}
