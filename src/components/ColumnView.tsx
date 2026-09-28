import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

import { EntryIcon, SmallEntryIcon } from "./icons";
import { RenameInput } from "./RenameInput";
import { TagDots } from "./TagDots";
import { dragItemsFor, endDrag, startDrag } from "../lib/dnd";
import { DROP_TARGET_STYLE, selectMods, useFolderDrop, type DropInto } from "../lib/rowDnd";
import { useRubberBand } from "../lib/rubberBand";
import { tagsOf } from "../lib/storage";
import { isTypingTarget } from "../lib/dom";
import { TAG_HEX, TAG_LABEL } from "../lib/tags";
import { getFileProperties } from "../fileops";
import { entryOpacity, formatModified, formatSize, kindLabel } from "../format";
import type { Column, ColumnsApi } from "../columns";
import type { FileEntry, FileProperties, SelectMods, TagMap } from "../types";

/* --------------------------------- sloupec -------------------------------- */

type ColumnPaneProps = {
  column: Column;
  /** Položky k vykreslení — po případném filtru, proto ne column.entries. */
  entries: FileEntry[];
  index: number;
  isFocused: boolean;
  windowFocused: boolean;
  onSelect: (columnIndex: number, entry: FileEntry, mods?: SelectMods) => void;
  onOpen: (columnIndex: number, entry: FileEntry) => void;
  onDropInto: DropInto;
  onBandStart: (columnIndex: number, additive: boolean) => void;
  onBandSelect: (columnIndex: number, paths: string[]) => void;
  onFocus: (columnIndex: number) => void;
  onContextMenu?: (entry: FileEntry, x: number, y: number) => void;
  cutPaths: Set<string>;
  renamingPath: string | null;
  onRenameSubmit: (entry: FileEntry, name: string) => void;
  onRenameCancel: () => void;
  tags: TagMap;
  onClearSelection: (index: number) => void;
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
  onClearSelection,
  onContextMenu,
  cutPaths,
  renamingPath,
  onRenameSubmit,
  onRenameCancel,
  tags,
  onDropInto,
  onBandStart,
  onBandSelect,
  exiting = false,
}: ColumnPaneProps) {
  const selectedRef = useRef<HTMLDivElement>(null);
  const { dropTarget, dropProps } = useFolderDrop(onDropInto);
  const band = useRubberBand({
    onStart: (additive) => onBandStart(index, additive),
    onChange: (paths) => onBandSelect(index, paths),
  });

  const multi = column.selectedPaths;
  const isInSelection = (path: string) =>
    multi.length > 0 ? multi.includes(path) : path === column.selectedPath;
  const selectedEntries = entries.filter((entry) => isInSelection(entry.path));

  // Když se výběr posune klávesnicí, musí zůstat vidět. Odcházející sloupec
  // by tím ale přetáhl scroll zpátky doprava, proto ne u něj.
  useEffect(() => {
    if (exiting) return;
    selectedRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [column.selectedPath, exiting]);

  return (
    <div
      // Podle tohohle App pozná, ve kterém sloupci padl pravý klik do volné plochy.
      data-column-path={column.path}
      onMouseDown={(event) => {
        onFocus(index);
        if (!exiting) band.onMouseDown(event);
      }}
      // Klik do prázdna pod řádky zruší výběr ve sloupci, jako ve Finderu.
      onClick={(event) => {
        if (!(event.target as Element).closest("[data-path]")) onClearSelection(index);
      }}
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

      {band.overlay}

      {!column.loading && !column.error && entries.length === 0 && (
        <div className="px-2.5 py-1 text-[13px] text-secondary">
          {column.entries.length === 0 ? "Prázdná složka" : "Nic neodpovídá hledání"}
        </div>
      )}

      {entries.map((entry) => {
        const isSelected = isInSelection(entry.path);
        const isRenaming = entry.path === renamingPath;
        const selectedClass = windowFocused ? "bg-selected" : "bg-selected-inactive";

        return (
          <div
            key={entry.path}
            ref={entry.path === column.selectedPath ? selectedRef : undefined}
            data-path={entry.path}
            role="option"
            aria-selected={isSelected}
            data-tooltip={entry.name}
            draggable={!isRenaming}
            onDragStart={(event) =>
              startDrag(
                { kind: "entry", items: dragItemsFor(entry, selectedEntries) },
                event.dataTransfer,
              )
            }
            onDragEnd={endDrag}
            {...dropProps(entry)}
            onClick={(event) => onSelect(index, entry, selectMods(event))}
            onDoubleClick={() => onOpen(index, entry)}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              // Pravý klik do vícenásobného výběru ho nezahazuje — menu pak
              // míří na všechny vybrané položky.
              if (!isSelected) onSelect(index, entry);
              onContextMenu?.(entry, event.clientX, event.clientY);
            }}
            className={`fw-col-row fw-row flex h-6 shrink-0 items-center gap-2 px-2.5 text-[13px] text-primary transition-colors duration-100 ${
              isSelected && !isRenaming ? selectedClass : "hover:bg-hover"
            }`}
            style={{
              opacity: entryOpacity(entry, cutPaths.has(entry.path)),
              ...(dropTarget === entry.path ? DROP_TARGET_STYLE : null),
            }}
          >
            <SmallEntryIcon entry={entry} />
            {isRenaming ? (
              <RenameInput entry={entry} onSubmit={onRenameSubmit} onCancel={onRenameCancel} />
            ) : (
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            )}
            {!entry.is_dir && !isRenaming && (
              <TagDots colors={tagsOf(tags, entry.path)} size={6} />
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

/* ------------------------------ náhled souboru ----------------------------- */

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="shrink-0 text-secondary">{label}</span>
      <span className="min-w-0 truncate text-right text-primary tabular-nums">{children || "—"}</span>
    </div>
  );
}

type InfoPanelProps = {
  entry: FileEntry;
  onOpen: (entry: FileEntry) => void;
  tags: TagMap;
};

/**
 * Poslední sloupec u vybraného souboru — náhled jako ve Finderu: velká ikona
 * nebo obrázek, pod ní název a údaje. Časy se berou z get_file_properties
 * (výpis nese jen změnu a vytvoření, ne přesné atributy).
 */
function InfoPanel({ entry, onOpen, tags }: InfoPanelProps) {
  const [properties, setProperties] = useState<FileProperties | null>(null);

  useEffect(() => {
    let active = true;
    setProperties(null);
    getFileProperties(entry.path)
      .then((result) => {
        if (active) setProperties(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [entry.path]);

  const colors = tagsOf(tags, entry.path);

  return (
    <div className="fw-info-panel surface flex w-[240px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-line bg-main p-4 text-[12px]">
      <div className="flex justify-center pt-2">
        <EntryIcon entry={entry} size={128} thumbnail />
      </div>

      <p className="text-center text-[13px] font-semibold break-words text-primary">{entry.name}</p>

      <div className="flex flex-col border-t border-line pt-2">
        <InfoRow label="Druh">{kindLabel(entry)}</InfoRow>
        <InfoRow label="Velikost">
          {formatSize(properties?.size ?? entry.size, entry.is_dir)}
        </InfoRow>
        <InfoRow label="Vytvořeno">{formatModified(properties?.created ?? entry.created)}</InfoRow>
        <InfoRow label="Změněno">{formatModified(properties?.modified ?? entry.modified)}</InfoRow>
        <InfoRow label="Štítky">
          {colors.length > 0 && (
            <span className="inline-flex flex-wrap justify-end gap-x-2">
              {colors.map((color) => (
                <span key={color} className="inline-flex items-center gap-1">
                  <span
                    aria-hidden
                    className="inline-block rounded-full"
                    style={{ width: 8, height: 8, background: TAG_HEX[color] }}
                  />
                  {TAG_LABEL[color]}
                </span>
              ))}
            </span>
          )}
        </InfoRow>
      </div>

      <button
        type="button"
        onClick={() => onOpen(entry)}
        className="mt-auto h-7 w-full shrink-0 rounded-[6px] bg-[color:var(--accent-fill)] text-[13px] font-medium text-[color:var(--on-accent)] transition-opacity duration-100 hover:opacity-90"
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
  tags: TagMap;
  /** Menu, dialog nebo přejmenování drží fokus u sebe. Po jejich zavření se
   *  fokus vrací sloupcům — jinak by šipky byly mrtvé do dalšího kliku. */
  suspended: boolean;
  onDropInto: DropInto;
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
  tags,
  suspended,
  onDropInto,
}: ColumnViewProps) {
  const { columns, focusedIndex, select, openInto, focusColumn, move, clearSelection, extend } = api;

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

  const lastColumn = columns.length > 0 ? columns[columns.length - 1] : null;
  // Při výběru víc položek info panel nic neukazuje — nemá o čem.
  const selectedInLast =
    lastColumn && lastColumn.selectedPaths.length === 0
      ? (lastColumn.entries.find((entry) => entry.path === lastColumn.selectedPath) ?? null)
      : null;
  // Info panel patří jen souboru — složka místo něj vždycky otevře další sloupec.
  const infoEntry = selectedInLast && !selectedInLast.is_dir ? selectedInLast : null;

  // Klávesnice musí fungovat hned po přepnutí do column view.
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Po zavření menu / potvrzení přejmenování fokus nikde není (prvek, který ho
  // měl, zmizel) — vrátí se sloupcům. Když si ho mezitím vzalo pole hledání
  // nebo jiný input, nechá se tam.
  const wasSuspended = useRef(suspended);
  useEffect(() => {
    const resumed = wasSuspended.current && !suspended;
    wasSuspended.current = suspended;
    if (!resumed) return;

    if (!isTypingTarget(document.activeElement)) {
      containerRef.current?.focus({ preventScroll: true });
    }
  }, [suspended]);

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
  // Jen mezi viditelnými — položka skrytá filtrem se aktivovat nesmí.
  const focusedEntry =
    api
      .visibleEntries(focusedIndex)
      .find((entry) => entry.path === focusedColumn?.selectedPath) ?? null;

  // Type-ahead v zaměřeném sloupci — stejně jako v Icon / List View.
  const typeAhead = useRef({ text: "", at: 0 });

  /** Dvojklik i Enter: složka se otevře do dalšího sloupce, soubor v systému. */
  function activate(columnIndex: number, entry: FileEntry) {
    if (entry.is_dir) openInto(columnIndex, entry);
    else onOpenFile(entry);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Ctrl+šipky (nadřazená složka, otevřít) patří globálním zkratkám v App.
    // Bez tohohle by se provedly obě akce naráz.
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        clearSelection(focusedIndex);
        break;
      case "ArrowDown":
        event.preventDefault();
        if (event.shiftKey) extend(1);
        else move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (event.shiftKey) extend(-1);
        else move(-1);
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
      default: {
        // Mezerník je Quick Look, ostatní tisknutelné znaky skáčou na položku.
        if (event.key.length !== 1 || event.key === " ") break;
        const now = Date.now();
        const state = typeAhead.current;
        state.text = now - state.at > 1000 ? event.key : state.text + event.key;
        state.at = now;

        const prefix = state.text.toLocaleLowerCase("cs");
        const found = api
          .visibleEntries(focusedIndex)
          .find((entry) => entry.name.toLocaleLowerCase("cs").startsWith(prefix));
        if (found) {
          event.preventDefault();
          select(focusedIndex, found);
        }
      }
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
              entries={api.visibleEntries(index)}
              index={index}
              isFocused={index === focusedIndex}
              windowFocused={windowFocused}
              onSelect={select}
              onOpen={activate}
              onFocus={focusColumn}
              onClearSelection={clearSelection}
              onContextMenu={onContextMenu}
              onDropInto={onDropInto}
              onBandStart={api.startBand}
              onBandSelect={api.bandSelect}
              cutPaths={cutPaths}
              renamingPath={renamingPath}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              tags={tags}
            />
          ))}

          {infoEntry && lastColumn && (
            <InfoPanel entry={infoEntry} onOpen={onOpenFile} tags={tags} />
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
            onClearSelection={() => undefined}
            onDropInto={() => undefined}
            onBandStart={() => undefined}
            onBandSelect={() => undefined}
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
