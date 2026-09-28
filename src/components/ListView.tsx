import { ChevronDown, ChevronUp } from "lucide-react";

import { SmallEntryIcon } from "./icons";
import { RenameInput } from "./RenameInput";
import { TagDots } from "./TagDots";
import { endDrag, startDrag } from "../lib/dnd";
import { tagsOf } from "../lib/storage";
import {
  entryOpacity,
  formatModified,
  formatSize,
  kindLabel,
  type SortDirection,
  type SortKey,
} from "../format";
import type { FileEntry, TagMap } from "../types";

const COLUMNS: { key: SortKey; label: string; width: string; align: "left" | "right" }[] = [
  { key: "name", label: "Název", width: "minmax(0, 1fr)", align: "left" },
  { key: "modified", label: "Datum úpravy", width: "140px", align: "left" },
  { key: "size", label: "Velikost", width: "80px", align: "right" },
  { key: "kind", label: "Druh", width: "100px", align: "left" },
];

/** Sloupec s puntíky tagů stojí před Názvem a nemá hlavičku, jen prázdné místo. */
const TAG_COLUMN = "24px";

const GRID_TEMPLATE = [TAG_COLUMN, ...COLUMNS.map((column) => column.width)].join(" ");

type ListViewProps = {
  entries: FileEntry[];
  selectedPaths: Set<string>;
  cutPaths: Set<string>;
  windowFocused: boolean;
  renamingPath: string | null;
  onRenameSubmit: (entry: FileEntry, name: string) => void;
  onRenameCancel: () => void;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSort: (key: SortKey) => void;
  onSelect: (entry: FileEntry) => void;
  onOpen: (entry: FileEntry) => void;
  onContextMenu?: (entry: FileEntry, x: number, y: number) => void;
  tags: TagMap;
};

export function ListView({
  entries,
  selectedPaths,
  cutPaths,
  windowFocused,
  renamingPath,
  onRenameSubmit,
  onRenameCancel,
  sortKey,
  sortDirection,
  onSort,
  onSelect,
  onOpen,
  onContextMenu,
  tags,
}: ListViewProps) {
  const SortArrow = sortDirection === "asc" ? ChevronUp : ChevronDown;

  return (
    <div className="min-w-0">
      <div
        className="surface sticky top-0 z-10 grid h-6 items-center gap-3 border-b border-line bg-toolbar px-3 text-[11px] font-medium text-secondary"
        style={{ gridTemplateColumns: GRID_TEMPLATE, backdropFilter: "blur(20px)" }}
      >
        <span aria-hidden />

        {COLUMNS.map((column) => (
          <button
            key={column.key}
            type="button"
            onClick={() => onSort(column.key)}
            className={`flex items-center gap-0.5 truncate transition-colors duration-100 hover:text-primary ${
              column.align === "right" ? "justify-end" : "justify-start"
            }`}
          >
            <span className="truncate">{column.label}</span>
            {sortKey === column.key && <SortArrow size={11} strokeWidth={2.5} />}
          </button>
        ))}
      </div>

      {entries.map((entry, index) => {
        const isSelected = selectedPaths.has(entry.path);
        const isRenaming = entry.path === renamingPath;

        // Pruhování se počítá z indexu, ne přes :nth-child — hlavička je
        // sourozenec řádků, takže by CSS napočítalo o jedna vedle.
        const stripeClass = index % 2 === 1 ? "fw-stripe" : "";
        const stateClass =
          isSelected && !isRenaming ? (windowFocused ? "is-selected" : "is-selected-dim") : "";

        return (
          <div
            key={entry.path}
            data-path={entry.path}
            role="option"
            aria-selected={isSelected}
            tabIndex={0}
            draggable={!isRenaming}
            onDragStart={(event) =>
              startDrag(
                { kind: "entry", path: entry.path, name: entry.name, isDir: entry.is_dir },
                event.dataTransfer,
              )
            }
            onDragEnd={endDrag}
            onClick={() => onSelect(entry)}
            onDoubleClick={() => onOpen(entry)}
            onContextMenu={(event) => {
              event.preventDefault();
              // Nebublat na kontejner — ten má menu volné plochy. Výběr řeší
              // App: pravý klik do už vybrané skupiny ji nesmí shodit na jednu.
              event.stopPropagation();
              onContextMenu?.(entry, event.clientX, event.clientY);
            }}
            className={`fw-list-row fw-row grid h-6 items-center gap-3 px-3 text-[13px] text-primary transition-colors duration-100 ${stripeClass} ${stateClass}`}
            style={{
              gridTemplateColumns: GRID_TEMPLATE,
              opacity: entryOpacity(entry, cutPaths.has(entry.path)),
            }}
          >
            {/* Obal drží buňku v gridu i pro netagované řádky, kde TagDots nic nevrátí. */}
            <span className="flex items-center">
              <TagDots colors={tagsOf(tags, entry.path)} size={8} />
            </span>

            <div className="flex min-w-0 items-center gap-2">
              <SmallEntryIcon entry={entry} />
              {isRenaming ? (
                <RenameInput entry={entry} onSubmit={onRenameSubmit} onCancel={onRenameCancel} />
              ) : (
                <span className="truncate">{entry.name}</span>
              )}
            </div>
            <span className="truncate text-secondary">{formatModified(entry.modified)}</span>
            <span className="truncate text-right text-secondary">
              {formatSize(entry.size, entry.is_dir)}
            </span>
            <span className="truncate text-secondary">{kindLabel(entry)}</span>
          </div>
        );
      })}
    </div>
  );
}
