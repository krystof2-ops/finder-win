import { memo, useEffect, useImperativeHandle, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronUp } from "lucide-react";

import { SmallEntryIcon } from "./icons";
import { RenameInput } from "./RenameInput";
import { TagDots } from "./TagDots";
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
import {
  entryOpacity,
  formatModified,
  formatSize,
  kindLabel,
  type SortDirection,
  type SortKey,
} from "../format";
import type { FileEntry, SelectMods, TagColor, TagMap } from "../types";

const COLUMNS: { key: SortKey; label: string; width: string; align: "left" | "right" }[] = [
  { key: "name", label: "Název", width: "minmax(0, 1fr)", align: "left" },
  // Data a velikosti doprava, s tabulárními číslicemi — čísla pod sebou lícují.
  { key: "modified", label: "Datum úpravy", width: "140px", align: "right" },
  { key: "size", label: "Velikost", width: "80px", align: "right" },
  { key: "kind", label: "Druh", width: "100px", align: "left" },
];

/** Sloupec s puntíky tagů stojí před Názvem a nemá hlavičku, jen prázdné místo. */
const TAG_COLUMN = "24px";

const GRID_TEMPLATE = [TAG_COLUMN, ...COLUMNS.map((column) => column.width)].join(" ");

/** Výška řádku i lepkavé hlavičky — virtualizace s ní počítá. */
const ROW_HEIGHT = 24;
const HEADER_HEIGHT = 24;

/* ---------------------------------- řádek ---------------------------------- */

type RowHandlers = {
  select: (entry: FileEntry, mods: SelectMods) => void;
  open: (entry: FileEntry) => void;
  contextMenu: (entry: FileEntry, x: number, y: number) => void;
  dragItems: (entry: FileEntry) => ReturnType<typeof dragItemsFor>;
  renameSubmit: (entry: FileEntry, name: string) => void;
  renameCancel: () => void;
  drop: FolderDropHandlers;
};

type RowProps = {
  entry: FileEntry;
  index: number;
  top: number;
  selected: boolean;
  cut: boolean;
  renaming: boolean;
  dropTarget: boolean;
  windowFocused: boolean;
  tags: TagColor[];
  handlers: RowHandlers;
};

/**
 * Jeden řádek. Memoizovaný s porovnáním jen toho, co řádek ukazuje — klik na
 * jednu položku překreslí dva řádky (starý a nový výběr), ne celou složku.
 */
const ListRow = memo(
  function ListRow({
    entry,
    index,
    top,
    selected,
    cut,
    renaming,
    dropTarget,
    windowFocused,
    tags,
    handlers,
  }: RowProps) {
    // Pruhování podle indexu, ne přes :nth-child — virtuální řádky nejsou
    // sourozenci v pořadí výpisu.
    const stripeClass = index % 2 === 1 ? "fw-stripe" : "";
    const stateClass =
      selected && !renaming ? (windowFocused ? "is-selected" : "is-selected-dim") : "";

    return (
      <div
        data-path={entry.path}
        role="option"
        aria-selected={selected}
        tabIndex={0}
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
        className={`fw-list-row fw-row absolute right-0 left-0 grid h-6 items-center gap-3 px-3 text-[13px] text-primary ${stripeClass} ${stateClass} ${
          dropTarget ? "fw-drop-target" : ""
        }`}
        style={{
          top: 0,
          transform: `translateY(${top}px)`,
          gridTemplateColumns: GRID_TEMPLATE,
          opacity: entryOpacity(entry, cut),
        }}
      >
        {/* Obal drží buňku v gridu i pro netagované řádky, kde TagDots nic nevrátí. */}
        <span className="flex items-center">
          <TagDots colors={tags} size={8} />
        </span>

        <div className="flex min-w-0 items-center gap-2">
          <SmallEntryIcon entry={entry} />
          {renaming ? (
            <RenameInput
              entry={entry}
              onSubmit={handlers.renameSubmit}
              onCancel={handlers.renameCancel}
            />
          ) : (
            <span className="truncate">{entry.name}</span>
          )}
        </div>
        <span className="truncate text-right text-secondary tabular-nums">
          {formatModified(entry.modified)}
        </span>
        <span className="truncate text-right text-secondary tabular-nums">
          {formatSize(entry.size, entry.is_dir)}
        </span>
        <span className="truncate text-secondary">{kindLabel(entry)}</span>
      </div>
    );
  },
  (a, b) =>
    sameEntry(a.entry, b.entry) &&
    a.index % 2 === b.index % 2 &&
    a.top === b.top &&
    a.selected === b.selected &&
    a.cut === b.cut &&
    a.renaming === b.renaming &&
    a.dropTarget === b.dropTarget &&
    a.windowFocused === b.windowFocused &&
    a.tags === b.tags &&
    a.handlers === b.handlers,
);

/* ---------------------------------- výpis ---------------------------------- */

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
  onSelect: (entry: FileEntry, mods: SelectMods) => void;
  onOpen: (entry: FileEntry) => void;
  onContextMenu?: (entry: FileEntry, x: number, y: number) => void;
  onDropInto: DropInto;
  tags: TagMap;
  /** Posouvaný kontejner (drží ho App) — virtualizace podle něj měří. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Ovládání výpisu pro App (posun na položku, gumička, klávesnice). */
  handleRef: ViewHandleRef;
  /** Počáteční posun (návrat Zpět). Virtualizace si při připojení scroller
   *  sama nastaví na svou pozici — bez tohohle by ho vrátila na začátek. */
  initialOffset?: number;
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
  onDropInto,
  tags,
  scrollRef,
  handleRef,
  initialOffset = 0,
}: ListViewProps) {
  const SortArrow = sortDirection === "asc" ? ChevronUp : ChevronDown;
  const { dropTarget, handlers: drop } = useFolderDrop(onDropInto);

  // Jen viditelné řádky + 10 navíc. Řádky začínají pod lepkavou hlavičkou,
  // proto scrollMargin; scrollPaddingStart drží vybraný řádek pod ní.
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    initialOffset,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    scrollMargin: HEADER_HEIGHT,
    scrollPaddingStart: HEADER_HEIGHT,
  });

  // Stabilní handlery pro memoizované řádky — volají vždy nejnovější props.
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
  const handlers = useMemo<RowHandlers>(
    () => ({ select, open, contextMenu, dragItems, renameSubmit, renameCancel, drop }),
    [select, open, contextMenu, dragItems, renameSubmit, renameCancel, drop],
  );

  useImperativeHandle(
    handleRef,
    () => ({
      scrollToPath: (path, behavior = "auto") => {
        const index = entries.findIndex((entry) => entry.path === path);
        if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto", behavior });
      },
      hitTest: (box) => {
        const element = scrollRef.current;
        if (!element) return [];
        const rect = element.getBoundingClientRect();
        if (box.right < rect.left || box.left > rect.right) return [];
        // Souřadnice obsahu: řádek i začíná v HEADER + i * ROW.
        const top = box.top - rect.top + element.scrollTop - HEADER_HEIGHT;
        const bottom = box.bottom - rect.top + element.scrollTop - HEADER_HEIGHT;
        const first = Math.max(0, Math.floor(top / ROW_HEIGHT));
        const last = Math.min(entries.length - 1, Math.floor(bottom / ROW_HEIGHT));
        return entries.slice(first, last + 1).map((entry) => entry.path);
      },
      metrics: () => ({
        columns: 1,
        rowsPerPage: Math.max(
          1,
          Math.floor(((scrollRef.current?.clientHeight ?? 0) - HEADER_HEIGHT) / ROW_HEIGHT) - 1,
        ),
      }),
    }),
    [entries, virtualizer, scrollRef],
  );

  // Kontejner se mění s view mode — virtualizace ho musí přeměřit.
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer]);

  return (
    <div className="min-w-0">
      <div
        className="sticky top-0 z-10 grid h-6 items-center gap-3 border-b border-line bg-toolbar px-3 text-[11px] font-medium text-secondary"
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

      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const entry = entries[item.index];
          return (
            <ListRow
              key={entry.path}
              entry={entry}
              index={item.index}
              top={item.start - HEADER_HEIGHT}
              selected={selectedPaths.has(entry.path)}
              cut={cutPaths.has(entry.path)}
              renaming={entry.path === renamingPath}
              dropTarget={dropTarget === entry.path}
              windowFocused={windowFocused}
              tags={tagsOf(tags, entry.path)}
              handlers={handlers}
            />
          );
        })}
      </div>
    </div>
  );
}

