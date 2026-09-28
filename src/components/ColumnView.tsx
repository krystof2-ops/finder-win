import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

import { FolderIcon, SmallEntryIcon, fileVisual } from "./icons";
import { RenameInput } from "./RenameInput";
import { TagDots } from "./TagDots";
import { endDrag, startDrag } from "../lib/dnd";
import { formatModified, formatSize, kindLabel } from "../format";
import type { Column, ColumnsApi } from "../columns";
import type { FileEntry, TagMap } from "../types";

/* --------------------------------- sloupec -------------------------------- */

type ColumnPaneProps = {
  column: Column;
  /** Položky k vykreslení — po případném filtru, proto ne column.entries. */
  entries: FileEntry[];
  index: number;
  isFocused: boolean;
  windowFocused: boolean;
  onSelect: (columnIndex: number, entry: FileEntry) => void;
  onOpen: (columnIndex: number, entry: FileEntry) => void;
  onFocus: (columnIndex: number) => void;
  onContextMenu?: (entry: FileEntry, x: number, y: number) => void;
  cutPaths: Set<string>;
  renamingPath: string | null;
  onRenameSubmit: (entry: FileEntry, name: string) => void;
  onRenameCancel: () => void;
  tags: TagMap;
  /** Sloupec, který se právě zahazuje — jen dohrává odchod, nereaguje. */
  exiting?: boolean;
};

function ColumnPane({
  column,
  entries,
  index,
  isFocused,
  windowFocused,
  onSelect,
  onOpen,
  onFocus,
  onContextMenu,
  cutPaths,
  renamingPath,
  onRenameSubmit,
  onRenameCancel,
  tags,
  exiting = false,
}: ColumnPaneProps) {
  const selectedRef = useRef<HTMLDivElement>(null);

  // Když se výběr posune klávesnicí, musí zůstat vidět. Odcházející sloupec
  // by tím ale přetáhl scroll zpátky doprava, proto ne u něj.
  useEffect(() => {
    if (exiting) return;
    selectedRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [column.selectedPath, exiting]);

  return (
    <div
      onMouseDown={() => onFocus(index)}
      className={`surface flex w-[240px] shrink-0 flex-col overflow-y-auto border-r border-line py-1 ${
        exiting ? "fw-column-out" : "fw-column-in"
      }`}
      style={{ backgroundColor: isFocused ? "var(--bg-toolbar)" : "var(--bg-main)" }}
    >
      {column.loading && <div className="px-2.5 py-1 text-[13px] text-secondary">Načítám…</div>}

      {column.error && (
        <div className="px-2.5 py-1 text-[12px] leading-snug text-secondary">
          Složku se nepodařilo otevřít — {column.error}
        </div>
      )}

      {!column.loading && !column.error && entries.length === 0 && (
        <div className="px-2.5 py-1 text-[13px] text-secondary">
          {column.entries.length === 0 ? "Prázdná složka" : "Nic neodpovídá hledání"}
        </div>
      )}

      {entries.map((entry) => {
        const isSelected = entry.path === column.selectedPath;
        const isRenaming = entry.path === renamingPath;
        const selectedClass = windowFocused ? "bg-selected" : "bg-selected-inactive";

        return (
          <div
            key={entry.path}
            ref={isSelected ? selectedRef : undefined}
            data-path={entry.path}
            title={entry.name}
            draggable={!isRenaming}
            onDragStart={(event) =>
              startDrag(
                { kind: "entry", path: entry.path, name: entry.name, isDir: entry.is_dir },
                event.dataTransfer,
              )
            }
            onDragEnd={endDrag}
            onClick={() => onSelect(index, entry)}
            onDoubleClick={() => onOpen(index, entry)}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSelect(index, entry);
              onContextMenu?.(entry, event.clientX, event.clientY);
            }}
            className={`fw-col-row flex h-6 shrink-0 items-center gap-2 px-2.5 text-[13px] text-primary transition-colors duration-100 ${
              isSelected && !isRenaming ? selectedClass : "hover:bg-hover"
            }`}
            style={{ opacity: cutPaths.has(entry.path) ? 0.5 : 1 }}
          >
            <SmallEntryIcon entry={entry} />
            {isRenaming ? (
              <RenameInput entry={entry} onSubmit={onRenameSubmit} onCancel={onRenameCancel} />
            ) : (
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            )}
            {!entry.is_dir && !isRenaming && (
              <TagDots colors={tags[entry.path] ?? []} size={6} />
            )}
            {entry.is_dir && !isRenaming && (
              <ChevronRight
                size={13}
                strokeWidth={2}
                className="fw-chevron shrink-0 text-secondary"
              />
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
      className="fw-info-panel surface flex w-[280px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-line p-4"
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
  cutPaths: Set<string>;
  renamingPath: string | null;
  onRenameSubmit: (entry: FileEntry, name: string) => void;
  onRenameCancel: () => void;
  onContextMenu?: (entry: FileEntry, x: number, y: number) => void;
  /** Filtruje se jen zaměřený sloupec, ostatní zůstávají celé. */
  query: string;
  tags: TagMap;
};

export function ColumnView({
  api,
  windowFocused,
  onOpenFile,
  cutPaths,
  renamingPath,
  onRenameSubmit,
  onRenameCancel,
  onContextMenu,
  query,
  tags,
}: ColumnViewProps) {
  const { columns, focusedIndex, select, openInto, focusColumn, move } = api;

  const containerRef = useRef<HTMLDivElement>(null);
  /** Živé sloupce bez těch odcházejících — cíl pro doscrollování doprava. */
  const liveRef = useRef<HTMLDivElement>(null);

  // Zahozené sloupce se ještě chvíli dorenderují, aby stihly odjet doprava.
  // useColumns je zahazuje okamžitě, o odchod se proto musí postarat view.
  const [exiting, setExiting] = useState<Column[]>([]);
  const previousColumns = useRef<Column[]>(columns);
  const exitTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const previous = previousColumns.current;
    previousColumns.current = columns;

    // První index, kde se cesty rozešly — od něj doprava je všechno pryč.
    // Porovnává se podle cesty, ne podle délky: klik na jinou složku sloupec
    // na témže indexu vymění, takže délka zůstane a změnu by to neodhalilo.
    let changed = -1;
    for (let index = 0; index < previous.length; index += 1) {
      if (index >= columns.length || previous[index].path !== columns[index].path) {
        changed = index;
        break;
      }
    }

    if (changed < 0) return;

    setExiting(previous.slice(changed));

    // Časovač visí v refu, ne v cleanupu efektu. React pouští cleanup před
    // každým dalším během, a běh, který skončí na `changed < 0` (což dělá každé
    // select() — mění jen selectedPath, cesty zůstanou), by nový časovač
    // nenastavil. Odcházející sloupce by tak zůstaly navždy: fw-column-out je
    // forwards na opacity 0, takže neviditelné, ale pořád zabírají 240 px.
    window.clearTimeout(exitTimer.current);
    exitTimer.current = window.setTimeout(() => setExiting([]), 180);
  }, [columns]);

  useEffect(() => () => window.clearTimeout(exitTimer.current), []);

  const needle = query.trim().toLowerCase();
  const filterEntries = (entries: FileEntry[]) =>
    needle ? entries.filter((entry) => entry.name.toLowerCase().includes(needle)) : entries;

  const lastColumn = columns.length > 0 ? columns[columns.length - 1] : null;
  const selectedInLast =
    lastColumn?.entries.find((entry) => entry.path === lastColumn.selectedPath) ?? null;
  // Info panel patří jen souboru — složka místo něj vždycky otevře další sloupec.
  const infoEntry = selectedInLast && !selectedInLast.is_dir ? selectedInLast : null;

  // Klávesnice musí fungovat hned po přepnutí do column view.
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Nově otevřený sloupec (nebo info panel) si musí sám doscrollovat do zorného
  // pole. Cílem je poslední *živý* prvek — lastElementChild scrolleru by během
  // odchodu ukázal na sloupec, který za chvíli zmizí.
  useEffect(() => {
    liveRef.current?.lastElementChild?.scrollIntoView({
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
      <div className="flex min-w-0 flex-1 overflow-x-auto">
        <div ref={liveRef} className="flex shrink-0">
          {columns.map((column, index) => (
            <ColumnPane
              key={`${index}/${column.path}`}
              column={column}
              entries={index === focusedIndex ? filterEntries(column.entries) : column.entries}
              index={index}
              isFocused={index === focusedIndex}
              windowFocused={windowFocused}
              onSelect={select}
              onOpen={activate}
              onFocus={focusColumn}
              onContextMenu={onContextMenu}
              cutPaths={cutPaths}
              renamingPath={renamingPath}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              tags={tags}
            />
          ))}

          {infoEntry && lastColumn && (
            <InfoPanel entry={infoEntry} parentPath={lastColumn.path} onOpen={onOpenFile} />
          )}
        </div>

        {/* Dohrávají odchod napravo od živých sloupců, pak zmizí. */}
        {exiting.map((column, index) => (
          <ColumnPane
            key={`exit-${index}-${column.path}`}
            column={column}
            entries={column.entries}
            index={-1}
            isFocused={false}
            windowFocused={windowFocused}
            onSelect={() => undefined}
            onOpen={() => undefined}
            onFocus={() => undefined}
            cutPaths={cutPaths}
            renamingPath={null}
            onRenameSubmit={() => undefined}
            onRenameCancel={() => undefined}
            tags={tags}
            exiting
          />
        ))}
      </div>
    </div>
  );
}
