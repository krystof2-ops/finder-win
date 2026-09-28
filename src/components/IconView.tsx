import { memo, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { LargeEntryIcon } from "./icons";
import { RenameInput } from "./RenameInput";
import { TagDots } from "./TagDots";
import { entryOpacity } from "../format";
import { dragItemsFor, endDrag, startDrag } from "../lib/dnd";
import {
  dropPropsFor,
  selectMods,
  useFolderDrop,
  useStableCallback,
  type DropInto,
  type FolderDropHandlers,
} from "../lib/rowDnd";
import { sameEntry } from "../lib/rows";
import { tagsOf } from "../lib/storage";
import type { ViewHandleRef } from "../lib/viewHandle";
import type { FileEntry, SelectMods, TagColor, TagMap } from "../types";

/** Geometrie mřížky (musí sedět s tím, co buňka vykreslí): buňka 96 × 118,
 *  mezery 16 / 24, okraj plochy 20. Virtualizace i gumička z ní počítají. */
const CELL_WIDTH = 96;
const CELL_HEIGHT = 118;
const GAP_X = 16;
const GAP_Y = 24;
const PADDING = 20;
const ROW_PITCH = CELL_HEIGHT + GAP_Y;

function columnsFor(width: number): number {
  return Math.max(1, Math.floor((width - 2 * PADDING + GAP_X) / (CELL_WIDTH + GAP_X)));
}

/* ---------------------------------- buňka ---------------------------------- */

type CellHandlers = {
  select: (entry: FileEntry, mods: SelectMods) => void;
  open: (entry: FileEntry) => void;
  contextMenu: (entry: FileEntry, x: number, y: number) => void;
  dragItems: (entry: FileEntry) => ReturnType<typeof dragItemsFor>;
  renameSubmit: (entry: FileEntry, name: string) => void;
  renameCancel: () => void;
  drop: FolderDropHandlers;
};

type CellProps = {
  entry: FileEntry;
  selected: boolean;
  cut: boolean;
  renaming: boolean;
  dropTarget: boolean;
  windowFocused: boolean;
  tags: TagColor[];
  handlers: CellHandlers;
};

/** Jedna ikona. Memoizovaná — klik překreslí jen starý a nový výběr. */
const IconCell = memo(
  function IconCell({
    entry,
    selected,
    cut,
    renaming,
    dropTarget,
    windowFocused,
    tags,
    handlers,
  }: CellProps) {
    // Během přejmenování výběr nekreslíme — podbarvení pod inputem ruší.
    const showSelection = selected && !renaming;
    // Finder: za ikonou neutrální zaoblený obdélník, název na pilulce —
    // modré s bílým textem jen v aktivním okně, jinak šedé.
    const tileBg = showSelection ? "var(--icon-selection)" : "transparent";
    const nameBg = showSelection
      ? windowFocused
        ? "var(--accent-fill)"
        : "var(--name-pill-inactive)"
      : "transparent";
    const nameColor = showSelection && windowFocused ? "var(--on-accent)" : "var(--text-primary)";

    return (
      <div
        data-path={entry.path}
        role="option"
        aria-selected={selected}
        tabIndex={0}
        data-tooltip={entry.name}
        // Přejmenovaný řádek se netahá — jinak by drag ukradl výběr v inputu.
        draggable={!renaming}
        onDragStart={(event) =>
          startDrag({ kind: "entry", items: handlers.dragItems(entry) }, event.dataTransfer)
        }
        onDragEnd={endDrag}
        {...dropPropsFor(entry, handlers.drop)}
        onClick={(event) => handlers.select(entry, selectMods(event))}
        onDoubleClick={() => handlers.open(entry)}
        onContextMenu={(event) => {
          event.preventDefault();
          // Nebublat na kontejner — ten má menu volné plochy. Výběr řeší
          // App: pravý klik do už vybrané skupiny ji nesmí shodit na jednu.
          event.stopPropagation();
          handlers.contextMenu(entry, event.clientX, event.clientY);
        }}
        className={`fw-row flex shrink-0 flex-col items-center gap-1 rounded-[8px] ${
          dropTarget ? "fw-drop-target" : ""
        }`}
        style={{ width: CELL_WIDTH, height: CELL_HEIGHT, opacity: entryOpacity(entry, cut) }}
      >
        {/* Ikona stojí volně v 64px boxu; výběr je obdélník za ní. */}
        <div className="fw-icon-tile p-1" style={{ backgroundColor: tileBg }}>
          {/* Náhled obrázku — vykreslují se jen viditelné buňky, takže
              se nedekódují tisíce fotek naráz a strop není potřeba. */}
          <LargeEntryIcon entry={entry} thumbnail />
        </div>

        {renaming ? (
          <div className="w-full px-0.5">
            <RenameInput
              entry={entry}
              onSubmit={handlers.renameSubmit}
              onCancel={handlers.renameCancel}
              variant="icon"
            />
          </div>
        ) : (
          <span
            className="fw-icon-name line-clamp-2 max-w-full text-center"
            style={{ backgroundColor: nameBg, color: nameColor, overflowWrap: "anywhere" }}
          >
            {entry.name}
          </span>
        )}

        {!renaming && <TagDots colors={tags} size={8} />}
      </div>
    );
  },
  (a, b) =>
    sameEntry(a.entry, b.entry) &&
    a.selected === b.selected &&
    a.cut === b.cut &&
    a.renaming === b.renaming &&
    a.dropTarget === b.dropTarget &&
    a.windowFocused === b.windowFocused &&
    a.tags === b.tags &&
    a.handlers === b.handlers,
);

/* --------------------------------- mřížka ---------------------------------- */

type IconViewProps = {
  entries: FileEntry[];
  selectedPaths: Set<string>;
  cutPaths: Set<string>;
  windowFocused: boolean;
  renamingPath: string | null;
  onRenameSubmit: (entry: FileEntry, name: string) => void;
  onRenameCancel: () => void;
  onSelect: (entry: FileEntry, mods: SelectMods) => void;
  onOpen: (entry: FileEntry) => void;
  onContextMenu?: (entry: FileEntry, x: number, y: number) => void;
  onDropInto: DropInto;
  tags: TagMap;
  /** Posouvaný kontejner (drží ho App) — virtualizace podle něj měří. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Ovládání výpisu pro App (posun na položku, gumička, klávesnice). */
  handleRef: ViewHandleRef;
};

export function IconView({
  entries,
  selectedPaths,
  cutPaths,
  windowFocused,
  renamingPath,
  onRenameSubmit,
  onRenameCancel,
  onSelect,
  onOpen,
  onContextMenu,
  onDropInto,
  tags,
  scrollRef,
  handleRef,
}: IconViewProps) {
  const { dropTarget, handlers: drop } = useFolderDrop(onDropInto);

  // Počet sloupců ze skutečné šířky kontejneru. ResizeObserver hlásí při
  // tažení okna desítky změn — přepočet se slije do jednoho snímku.
  const [columns, setColumns] = useState(() => columnsFor(scrollRef.current?.clientWidth ?? 800));
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setColumns(columnsFor(element.clientWidth)));
    });
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [scrollRef]);

  const rowCount = Math.ceil(entries.length / columns);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_PITCH,
    overscan: 10,
    paddingStart: PADDING,
    paddingEnd: PADDING - GAP_Y,
    scrollPaddingStart: 8,
    scrollPaddingEnd: 8,
  });

  const select = useStableCallback(onSelect);
  const open = useStableCallback(onOpen);
  const contextMenu = useStableCallback((entry: FileEntry, x: number, y: number) =>
    onContextMenu?.(entry, x, y),
  );
  const dragItems = useStableCallback((entry: FileEntry) =>
    dragItemsFor(
      entry,
      entries.filter((item) => selectedPaths.has(item.path)),
    ),
  );
  const renameSubmit = useStableCallback(onRenameSubmit);
  const renameCancel = useStableCallback(onRenameCancel);
  // Všechny položky jsou stabilní, takže i objekt vznikne jen jednou.
  const handlers = useMemo<CellHandlers>(
    () => ({ select, open, contextMenu, dragItems, renameSubmit, renameCancel, drop }),
    [select, open, contextMenu, dragItems, renameSubmit, renameCancel, drop],
  );

  useImperativeHandle(
    handleRef,
    () => ({
      scrollToPath: (path, behavior = "auto") => {
        const index = entries.findIndex((entry) => entry.path === path);
        if (index < 0) return;
        const row = Math.floor(index / columns);
        // První řádek odkryje i horní okraj mřížky, ne jen buňku.
        if (row === 0) scrollRef.current?.scrollTo({ top: 0, behavior });
        else virtualizer.scrollToIndex(row, { align: "auto", behavior });
      },
      hitTest: (box) => {
        const element = scrollRef.current;
        if (!element) return [];
        const rect = element.getBoundingClientRect();
        // Obdélník v souřadnicích obsahu mřížky.
        const left = box.left - rect.left - PADDING;
        const right = box.right - rect.left - PADDING;
        const top = box.top - rect.top + element.scrollTop - PADDING;
        const bottom = box.bottom - rect.top + element.scrollTop - PADDING;

        const hit: string[] = [];
        const firstRow = Math.max(0, Math.floor(top / ROW_PITCH));
        const lastRow = Math.min(rowCount - 1, Math.floor(bottom / ROW_PITCH));
        for (let row = firstRow; row <= lastRow; row += 1) {
          const cellTop = row * ROW_PITCH;
          if (cellTop > bottom || cellTop + CELL_HEIGHT < top) continue;
          for (let column = 0; column < columns; column += 1) {
            const cellLeft = column * (CELL_WIDTH + GAP_X);
            if (cellLeft > right || cellLeft + CELL_WIDTH < left) continue;
            const entry = entries[row * columns + column];
            if (entry) hit.push(entry.path);
          }
        }
        return hit;
      },
      metrics: () => ({
        columns,
        rowsPerPage: Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 0) / ROW_PITCH)),
      }),
    }),
    [entries, virtualizer, columns, rowCount, scrollRef],
  );

  return (
    <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((row) => {
        const start = row.index * columns;
        const cells = entries.slice(start, start + columns);

        return (
          <div
            key={row.key}
            className="absolute top-0 flex"
            style={{ left: PADDING, gap: GAP_X, transform: `translateY(${row.start}px)` }}
          >
            {cells.map((entry) => (
              <IconCell
                key={entry.path}
                entry={entry}
                selected={selectedPaths.has(entry.path)}
                cut={cutPaths.has(entry.path)}
                renaming={entry.path === renamingPath}
                dropTarget={dropTarget === entry.path}
                windowFocused={windowFocused}
                tags={tagsOf(tags, entry.path)}
                handlers={handlers}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
