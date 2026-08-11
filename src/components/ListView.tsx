import { ChevronDown, ChevronUp } from "lucide-react";

import { SmallEntryIcon } from "./icons";
import { formatModified, formatSize, kindLabel, type SortDirection, type SortKey } from "../format";
import type { FileEntry } from "../types";

const COLUMNS: { key: SortKey; label: string; width: string; align: "left" | "right" }[] = [
  { key: "name", label: "Název", width: "minmax(0, 1fr)", align: "left" },
  { key: "modified", label: "Datum úpravy", width: "140px", align: "left" },
  { key: "size", label: "Velikost", width: "80px", align: "right" },
  { key: "kind", label: "Druh", width: "100px", align: "left" },
];

const GRID_TEMPLATE = COLUMNS.map((column) => column.width).join(" ");

type ListViewProps = {
  entries: FileEntry[];
  selectedPath: string | null;
  windowFocused: boolean;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSort: (key: SortKey) => void;
  onSelect: (entry: FileEntry) => void;
  onOpen: (entry: FileEntry) => void;
};

export function ListView({
  entries,
  selectedPath,
  windowFocused,
  sortKey,
  sortDirection,
  onSort,
  onSelect,
  onOpen,
}: ListViewProps) {
  const SortArrow = sortDirection === "asc" ? ChevronUp : ChevronDown;

  return (
    <div className="min-w-0">
      <div
        className="surface sticky top-0 z-10 grid h-6 items-center gap-3 border-b border-line bg-toolbar px-3 text-[11px] font-medium text-secondary"
        style={{ gridTemplateColumns: GRID_TEMPLATE, backdropFilter: "blur(20px)" }}
      >
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

      {entries.map((entry) => {
        const isSelected = entry.path === selectedPath;
        const selectedClass = windowFocused ? "bg-selected" : "bg-selected-inactive";

        return (
          <div
            key={entry.path}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(entry)}
            onDoubleClick={() => onOpen(entry)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onOpen(entry);
            }}
            className={`grid h-6 items-center gap-3 px-3 text-[13px] text-primary outline-none transition-colors duration-100 ${
              isSelected ? selectedClass : "hover:bg-hover"
            }`}
            style={{ gridTemplateColumns: GRID_TEMPLATE }}
          >
            <div className="flex min-w-0 items-center gap-2">
              <SmallEntryIcon entry={entry} />
              <span className="truncate">{entry.name}</span>
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
