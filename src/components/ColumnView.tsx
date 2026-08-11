import { useEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";

import { FolderIcon, SmallEntryIcon, fileVisual } from "./icons";
import { formatModified, formatSize, kindLabel } from "../format";
import type { Column, ColumnsApi } from "../columns";
import type { FileEntry } from "../types";

/* --------------------------------- sloupec -------------------------------- */

type ColumnPaneProps = {
  column: Column;
  index: number;
  isFocused: boolean;
  windowFocused: boolean;
  onSelect: (columnIndex: number, entry: FileEntry) => void;
  onOpen: (columnIndex: number, entry: FileEntry) => void;
  onFocus: (columnIndex: number) => void;
};

function ColumnPane({
  column,
  index,
  isFocused,
  windowFocused,
  onSelect,
  onOpen,
  onFocus,
}: ColumnPaneProps) {
  const selectedRef = useRef<HTMLDivElement>(null);

  // Když se výběr posune klávesnicí, musí zůstat vidět.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [column.selectedPath]);

  return (
    <div
      onMouseDown={() => onFocus(index)}
      className="surface flex w-[240px] shrink-0 flex-col overflow-y-auto border-r border-line py-1"
      style={{ backgroundColor: isFocused ? "var(--bg-toolbar)" : "var(--bg-main)" }}
    >
      {column.loading && <div className="px-2.5 py-1 text-[13px] text-secondary">Načítám…</div>}

      {column.error && (
        <div className="px-2.5 py-1 text-[12px] leading-snug text-secondary">
          Složku se nepodařilo otevřít — {column.error}
        </div>
      )}

      {!column.loading && !column.error && column.entries.length === 0 && (
        <div className="px-2.5 py-1 text-[13px] text-secondary">Prázdná složka</div>
      )}

      {column.entries.map((entry) => {
        const isSelected = entry.path === column.selectedPath;
        const selectedClass = windowFocused ? "bg-selected" : "bg-selected-inactive";

        return (
          <div
            key={entry.path}
            ref={isSelected ? selectedRef : undefined}
            title={entry.name}
            onClick={() => onSelect(index, entry)}
            onDoubleClick={() => onOpen(index, entry)}
            className={`flex h-6 shrink-0 items-center gap-2 px-2.5 text-[13px] text-primary transition-colors duration-100 ${
              isSelected ? selectedClass : "hover:bg-hover"
            }`}
          >
            <SmallEntryIcon entry={entry} />
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            {entry.is_dir && (
              <ChevronRight size={13} strokeWidth={2} className="shrink-0 text-secondary" />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------- info panel ------------------------------- */

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-secondary">{label}</span>
      <span className="truncate text-right text-primary">{value || "—"}</span>
    </div>
  );
}

type InfoPanelProps = {
  entry: FileEntry;
  parentPath: string;
  onOpen: (entry: FileEntry) => void;
};

function InfoPanel({ entry, parentPath, onOpen }: InfoPanelProps) {
  const { Icon, tint } = fileVisual(entry);

  return (
    <div
      className="surface flex w-[280px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-line p-4"
      style={{ backgroundColor: "var(--bg-main)" }}
    >
      <div className="flex justify-center pt-2">
        {entry.is_dir ? (
          <FolderIcon size={96} />
        ) : (
          <Icon size={96} color={tint} strokeWidth={1.25} />
        )}
      </div>

      <p className="text-center text-[14px] font-semibold break-words text-primary">{entry.name}</p>

      <div className="flex flex-col border-t border-line pt-2 text-[12px]">
        <InfoRow label="Typ" value={kindLabel(entry)} />
        <InfoRow label="Velikost" value={formatSize(entry.size, entry.is_dir)} />
        <InfoRow label="Vytvořeno" value={formatModified(entry.created)} />
        <InfoRow label="Změněno" value={formatModified(entry.modified)} />

        <div className="flex flex-col gap-0.5 py-1">
          <span className="text-secondary">Kde</span>
          <span className="font-mono text-[11px] leading-snug break-all text-primary">
            {parentPath}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onOpen(entry)}
        className="mt-auto w-full shrink-0 rounded-md bg-accent py-1.5 text-[13px] font-medium text-white transition-opacity duration-100 hover:opacity-90"
      >
        Otevřít
      </button>
    </div>
  );
}

/* -------------------------------- column view ------------------------------ */

type ColumnViewProps = {
  api: ColumnsApi;
  windowFocused: boolean;
  onOpenFile: (entry: FileEntry) => void;
};

export function ColumnView({ api, windowFocused, onOpenFile }: ColumnViewProps) {
  const { columns, focusedIndex, select, openInto, focusColumn, move } = api;

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const lastColumn = columns.length > 0 ? columns[columns.length - 1] : null;
  const selectedInLast =
    lastColumn?.entries.find((entry) => entry.path === lastColumn.selectedPath) ?? null;
  // Info panel patří jen souboru — složka místo něj vždycky otevře další sloupec.
  const infoEntry = selectedInLast && !selectedInLast.is_dir ? selectedInLast : null;

  // Klávesnice musí fungovat hned po přepnutí do column view.
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Nově otevřený sloupec (nebo info panel) si musí sám doscrollovat do zorného pole.
  useEffect(() => {
    scrollerRef.current?.lastElementChild?.scrollIntoView({
      inline: "end",
      block: "nearest",
      behavior: "smooth",
    });
  }, [columns.length, infoEntry?.path]);

  const focusedColumn = columns[focusedIndex];
  const focusedEntry =
    focusedColumn?.entries.find((entry) => entry.path === focusedColumn.selectedPath) ?? null;

  /** Dvojklik i Enter: složka se otevře do dalšího sloupce, soubor v systému. */
  function activate(columnIndex: number, entry: FileEntry) {
    if (entry.is_dir) openInto(columnIndex, entry);
    else onOpenFile(entry);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Home":
        event.preventDefault();
        move("first");
        break;
      case "End":
        event.preventDefault();
        move("last");
        break;
      case "ArrowRight":
        event.preventDefault();
        if (focusedEntry?.is_dir) openInto(focusedIndex, focusedEntry);
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (focusedIndex > 0) focusColumn(focusedIndex - 1);
        break;
      case "Enter":
        event.preventDefault();
        if (focusedEntry) activate(focusedIndex, focusedEntry);
        break;
    }
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex h-full outline-none"
    >
      <div ref={scrollerRef} className="flex min-w-0 flex-1 overflow-x-auto">
        {columns.map((column, index) => (
          <ColumnPane
            key={`${index}/${column.path}`}
            column={column}
            index={index}
            isFocused={index === focusedIndex}
            windowFocused={windowFocused}
            onSelect={select}
            onOpen={activate}
            onFocus={focusColumn}
          />
        ))}

        {infoEntry && lastColumn && (
          <InfoPanel entry={infoEntry} parentPath={lastColumn.path} onOpen={onOpenFile} />
        )}
      </div>
    </div>
  );
}
