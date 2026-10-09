import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight } from "lucide-react";

import { canThumbnail, EntryIcon, SmallEntryIcon } from "./icons";
import { RenameInput } from "./RenameInput";
import { TagDots } from "./TagDots";
import { dragItemsFor, endDrag, startEntryDrag } from "../lib/dnd";
import {
  dropPropsFor,
  selectMods,
  useFolderDrop,
  useStableCallback,
  type DropInto,
  type FolderDropHandlers,
} from "../lib/rowDnd";
import { sameEntry } from "../lib/rows";
import { useRubberBand } from "../lib/rubberBand";
import { tagsOf } from "../lib/storage";
import { isTypingTarget } from "../lib/dom";
import { canShellThumbnail } from "../lib/fileIcons";
import { motionMs, smoothIfAllowed } from "../lib/motion";
import { TAG_HEX, tagLabel } from "../lib/tags";
import { getFileProperties, getMediaInfo, type MediaInfo } from "../fileops";
import { entryOpacity, formatModified, formatSize, kindLabel } from "../format";
import { failure, useT } from "../i18n";
import type { Column, ColumnsApi } from "../columns";
import type { FileEntry, FileProperties, SelectMods, TagColor, TagMap } from "../types";

/** Výška řádku a horní okraj sloupce (py-1) — virtualizace i gumička z nich počítají. */
const ROW_HEIGHT = 24;
const PANE_PADDING = 4;
/** Šířka sloupce (w-[240px]) — odcházející sloupce zhasínají na svém místě. */
const PANE_WIDTH = 240;

/* ---------------------------------- řádek ---------------------------------- */

type RowHandlers = {
  select: (entry: FileEntry, mods?: SelectMods) => void;
  open: (entry: FileEntry) => void;
  contextMenu: (entry: FileEntry, selected: boolean, x: number, y: number) => void;
  dragItems: (entry: FileEntry) => ReturnType<typeof dragItemsFor>;
  renameSubmit: (entry: FileEntry, name: string) => void;
  renameCancel: () => void;
  drop: FolderDropHandlers;
};

type RowProps = {
  entry: FileEntry;
  top: number;
  selected: boolean;
  cut: boolean;
  renaming: boolean;
  dropTarget: boolean;
  windowFocused: boolean;
  tags: TagColor[];
  handlers: RowHandlers;
};

/** Řádek sloupce. Memoizovaný — klik překreslí jen starý a nový výběr. */
const ColumnRow = memo(
  function ColumnRow({
    entry,
    top,
    selected,
    cut,
    renaming,
    dropTarget,
    windowFocused,
    tags,
    handlers,
  }: RowProps) {
    const selectedClass = windowFocused ? "bg-selected" : "bg-selected-inactive";

    return (
      <div
        data-path={entry.path}
        role="option"
        aria-selected={selected}
        data-tooltip={entry.name}
        draggable={!renaming}
        onDragStart={(event) =>
          startEntryDrag(handlers.dragItems(entry), event)
        }
        onDragEnd={endDrag}
        {...dropPropsFor(entry, handlers.drop)}
        onClick={(event) => handlers.select(entry, selectMods(event))}
        onDoubleClick={() => handlers.open(entry)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          handlers.contextMenu(entry, selected, event.clientX, event.clientY);
        }}
        className={`fw-col-row fw-row absolute right-0 left-0 flex h-6 items-center gap-2 px-2.5 text-[13px] text-primary ${
          selected && !renaming ? selectedClass : "hover:bg-hover"
        } ${dropTarget ? "fw-drop-target" : ""}`}
        style={{ top: 0, transform: `translateY(${top}px)`, opacity: entryOpacity(entry, cut) }}
      >
        <SmallEntryIcon entry={entry} />
        {renaming ? (
          <RenameInput
            entry={entry}
            onSubmit={handlers.renameSubmit}
            onCancel={handlers.renameCancel}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
        )}
        {!entry.is_dir && !renaming && <TagDots colors={tags} size={6} />}
        {entry.is_dir && !renaming && (
          <ChevronRight size={13} strokeWidth={2} className="fw-chevron shrink-0 text-secondary" />
        )}
      </div>
    );
  },
  (a, b) =>
    sameEntry(a.entry, b.entry) &&
    a.top === b.top &&
    a.selected === b.selected &&
    a.cut === b.cut &&
    a.renaming === b.renaming &&
    a.dropTarget === b.dropTarget &&
    a.windowFocused === b.windowFocused &&
    a.tags === b.tags &&
    a.handlers === b.handlers,
);

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
  /** Jak doscrollovat na výběr posunutý klávesnicí — "smooth" jen pro
   *  PgUp/PgDn. Sdílený ref; sloupec si hodnotu po použití vrátí na "auto". */
  scrollBehavior: { current: ScrollBehavior };
  /** Kam byl sloupec odscrollovaný (sdílená paměť view, klíč index/cesta).
   *  Odcházející kopie z ní převezme pozici, ať při zhasínání neskočí nahoru. */
  scrollMemory: Map<string, number>;
  memoryKey: string;
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
  scrollMemory,
  memoryKey,
  scrollBehavior,
}: ColumnPaneProps) {
  const t = useT();
  const paneRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (exiting && paneRef.current) paneRef.current.scrollTop = scrollMemory.get(memoryKey) ?? 0;
    // Jen při připojení odcházející kopie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { dropTarget, handlers: drop } = useFolderDrop(onDropInto);

  // Každý sloupec má vlastní virtualizaci — posouvá se nezávisle.
  const virtualizer = useVirtualizer({
    // Bez flushSync v obsluze scrollu: React 19 posun nových řádků slije do
    // jednoho vykreslení a hlavní vlákno nebrzdí začátek scrollovacího gesta.
    useFlushSync: false,
    count: entries.length,
    getScrollElement: () => paneRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    scrollMargin: PANE_PADDING,
  });

  const multi = column.selectedPaths;
  const isInSelection = (path: string) =>
    multi.length > 0 ? multi.includes(path) : path === column.selectedPath;

  // Gumička přes geometrii — řádky mimo obrazovku nejsou v DOM.
  const band = useRubberBand({
    onStart: (additive) => onBandStart(index, additive),
    onChange: (paths) => onBandSelect(index, paths),
    hitTest: (box) => {
      const element = paneRef.current;
      if (!element) return [];
      const rect = element.getBoundingClientRect();
      if (box.right < rect.left || box.left > rect.right) return [];
      const top = box.top - rect.top + element.scrollTop - PANE_PADDING;
      const bottom = box.bottom - rect.top + element.scrollTop - PANE_PADDING;
      const first = Math.max(0, Math.floor(top / ROW_HEIGHT));
      const last = Math.min(entries.length - 1, Math.floor(bottom / ROW_HEIGHT));
      return entries.slice(first, last + 1).map((entry) => entry.path);
    },
  });

  // Když se výběr posune klávesnicí, musí zůstat vidět — i když řádek zrovna
  // není vykreslený. Odcházející sloupec by tím přetáhl scroll, proto ne u něj.
  useEffect(() => {
    if (exiting || column.selectedPath === null) return;
    const selected = entries.findIndex((entry) => entry.path === column.selectedPath);
    const behavior = scrollBehavior.current;
    scrollBehavior.current = "auto";
    if (selected >= 0) virtualizer.scrollToIndex(selected, { align: "auto", behavior });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [column.selectedPath, exiting]);

  const select = useStableCallback((entry: FileEntry, mods?: SelectMods) => onSelect(index, entry, mods));
  const open = useStableCallback((entry: FileEntry) => onOpen(index, entry));
  const contextMenu = useStableCallback((entry: FileEntry, selected: boolean, x: number, y: number) => {
    // Pravý klik do vícenásobného výběru ho nezahazuje — menu pak míří na
    // všechny vybrané položky.
    if (!selected) onSelect(index, entry);
    onContextMenu?.(entry, x, y);
  });
  const dragItems = useStableCallback((entry: FileEntry) =>
    dragItemsFor(
      entry,
      entries.filter((item) => isInSelection(item.path)),
    ),
  );
  const renameSubmit = useStableCallback(onRenameSubmit);
  const renameCancel = useStableCallback(onRenameCancel);
  const handlers = useMemo<RowHandlers>(
    () => ({ select, open, contextMenu, dragItems, renameSubmit, renameCancel, drop }),
    [select, open, contextMenu, dragItems, renameSubmit, renameCancel, drop],
  );

  return (
    <div
      ref={paneRef}
      // Podle tohohle App pozná, ve kterém sloupci padl pravý klik do volné plochy.
      data-column-path={column.path}
      onScroll={(event) => {
        if (!exiting) scrollMemory.set(memoryKey, event.currentTarget.scrollTop);
      }}
      onMouseDown={(event) => {
        onFocus(index);
        if (!exiting) band.onMouseDown(event);
      }}
      // Klik do prázdna pod řádky zruší výběr ve sloupci, jako ve Finderu.
      onClick={(event) => {
        if (!(event.target as Element).closest("[data-path]")) onClearSelection(index);
      }}
      className={`fw-scroll flex w-[240px] shrink-0 flex-col overflow-x-hidden overflow-y-auto border-r border-line py-1 ${
        exiting ? "fw-column-out" : "fw-column-in"
      }`}
      style={{ backgroundColor: isFocused ? "var(--bg-toolbar)" : "var(--bg-main)" }}
    >
      {column.loading && (
        <div className="px-2.5 py-1 text-[13px] text-secondary">{t("common.loading")}</div>
      )}

      {column.error && (
        <div className="px-2.5 py-1 text-[12px] leading-snug text-secondary">
          {failure("op.openFolder", column.error)}
        </div>
      )}

      {band.overlay}

      {!column.loading && !column.error && entries.length === 0 && (
        <div className="px-2.5 py-1 text-[13px] text-secondary">
          {column.entries.length === 0 ? t("column.empty") : t("column.noMatches")}
        </div>
      )}

      <div className="relative shrink-0" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const entry = entries[item.index];
          return (
            <ColumnRow
              key={entry.path}
              entry={entry}
              top={item.start - PANE_PADDING}
              selected={isInSelection(entry.path)}
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

/** Typy, u kterých má smysl ptát se Windows na délku, rozměry nebo strany. */
const MEDIA_EXTENSIONS = new Set([
  "mp4", "mov", "mkv", "webm", "avi", "m4v", "wmv", "mp3", "m4a", "flac", "wav", "ogg",
  "jpg", "jpeg", "png", "gif", "webp", "heic", "bmp", "tif", "tiff", "pdf",
]);

/** Obrázky: rozměry se píšou v px, u videa je to „rozlišení“. */
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "bmp", "tif", "tiff"]);

/** 75 000 ms → 1:15, 3 725 000 ms → 1:02:05 */
function formatDuration(milliseconds: number): string {
  const total = Math.round(milliseconds / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/**
 * Poslední sloupec u vybraného souboru — náhled jako ve Finderu: velká ikona
 * nebo obrázek, pod ní název a údaje. Časy se berou z get_file_properties
 * (výpis nese jen změnu a vytvoření, ne přesné atributy). Volající ji
 * klíčuje cestou, takže se stav mezi soubory nepřenáší.
 */
function InfoPanel({ entry, onOpen, tags }: InfoPanelProps) {
  const t = useT();
  const [properties, setProperties] = useState<FileProperties | null>(null);
  // Údaje nesou cestu — po změně výběru se ani na jeden snímek neukáží cizí.
  const [media, setMedia] = useState<{ path: string; info: MediaInfo } | null>(null);

  // Délka videa, rozlišení, rozměry fotky, počet stran PDF — z property
  // systemu Windows. Co chybí, řádek se nezobrazí.
  useEffect(() => {
    if (!MEDIA_EXTENSIONS.has(entry.extension ?? "")) return;
    let active = true;
    getMediaInfo(entry.path)
      .then((info) => {
        if (active) setMedia({ path: entry.path, info });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [entry.path, entry.extension]);
  const info = media?.path === entry.path ? media.info : null;
  const isImage = IMAGE_EXTENSIONS.has(entry.extension ?? "");
  const size = info?.width && info?.height ? { width: info.width, height: info.height } : null;
  // Velký box jen pro obsah (fotka, snímek videa, strana PDF) — ikona ze
  // shellu má nejvýš 128 px a roztažená by byla rozmazaná.
  const previewSize = canThumbnail(entry) || canShellThumbnail(entry) ? 240 : 128;

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
    <div className="fw-info-panel fw-scroll flex w-[272px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-line bg-main p-4 text-[12px]">
      {/* Velký náhled — celý obrázek / snímek / strana, ne ořez na čtverec. */}
      <div className="flex justify-center pt-2">
        <EntryIcon entry={entry} size={previewSize} thumbnail contain />
      </div>

      <p className="text-center text-[13px] font-semibold break-words text-primary">{entry.name}</p>

      <div className="flex flex-col border-t border-line pt-2">
        <InfoRow label={t("info.kind")}>{kindLabel(entry)}</InfoRow>
        <InfoRow label={t("info.size")}>
          {formatSize(properties?.size ?? entry.size, entry.is_dir)}
        </InfoRow>
        <InfoRow label={t("info.created")}>{formatModified(properties?.created ?? entry.created)}</InfoRow>
        <InfoRow label={t("info.modified")}>{formatModified(properties?.modified ?? entry.modified)}</InfoRow>
        {info?.duration_ms ? <InfoRow label={t("info.duration")}>{formatDuration(info.duration_ms)}</InfoRow> : null}
        {size && !isImage ? (
          <InfoRow label={t("info.resolution")}>{t("info.resolutionValue", size)}</InfoRow>
        ) : null}
        {size && isImage ? <InfoRow label={t("info.dimensions")}>{t("info.dimensionsValue", size)}</InfoRow> : null}
        {info?.pages ? <InfoRow label={t("info.pages")}>{info.pages}</InfoRow> : null}
        <InfoRow label={t("info.tags")}>
          {colors.length > 0 && (
            <span className="inline-flex flex-wrap justify-end gap-x-2">
              {colors.map((color) => (
                <span key={color} className="inline-flex items-center gap-1">
                  <span
                    aria-hidden
                    className="inline-block rounded-full"
                    style={{ width: 8, height: 8, background: TAG_HEX[color] }}
                  />
                  {tagLabel(color)}
                </span>
              ))}
            </span>
          )}
        </InfoRow>
      </div>

      <button
        type="button"
        onClick={() => onOpen(entry)}
        className="mt-auto h-7 w-full shrink-0 rounded-[6px] bg-[color:var(--accent-fill)] text-[13px] font-medium text-[color:var(--on-accent)] fw-t-opacity hover:opacity-90"
      >
        {t("common.open")}
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
  const [exiting, setExiting] = useState<{ from: number; columns: Column[] }>({
    from: 0,
    columns: [],
  });
  const previousColumns = useRef<Column[]>(columns);
  /** Pozice scrollu sloupců (klíč index/cesta) pro odcházející kopie. */
  const paneScroll = useRef(new Map<string, number>());
  /** Šipky a type-ahead skáčou, PgUp/PgDn posouvají plynule. */
  const scrollBehavior = useRef<ScrollBehavior>("auto");
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

    // Nový kořen (navigace jinam) staré sloupce vymění rovnou — zhasínání
    // celé řady pod novou složkou by jen zdržovalo.
    if (changed === 0) {
      window.clearTimeout(exitTimer.current);
      setExiting({ from: 0, columns: [] });
      return;
    }

    setExiting({ from: changed, columns: previous.slice(changed) });

    // Časovač visí v refu, ne v cleanupu efektu. React pouští cleanup před
    // každým dalším během, a běh, který skončí na `changed < 0` (což dělá každé
    // select() — mění jen selectedPath, cesty zůstanou), by nový časovač
    // nenastavil. Odcházející sloupce by tak zůstaly navždy: fw-column-out je
    // forwards na opacity 0, takže neviditelné, ale pořád zabírají 240 px.
    window.clearTimeout(exitTimer.current);
    exitTimer.current = window.setTimeout(
      () => setExiting({ from: 0, columns: [] }),
      motionMs("--dur-fade"),
    );
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
  // V rozděleném okně jen aktivní panel — neaktivní (suspended) by fokus ukradl.
  useEffect(() => {
    if (!suspended) containerRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      behavior: smoothIfAllowed(),
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
    // Neaktivní panel, menu, přejmenování — klávesy patří jinam.
    if (suspended) return;

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
      case "PageDown":
      case "PageUp": {
        event.preventDefault();
        const height = (liveRef.current?.firstElementChild as HTMLElement | null)?.clientHeight ?? 0;
        const page = Math.max(1, Math.floor(height / ROW_HEIGHT) - 1);
        scrollBehavior.current = smoothIfAllowed();
        move(event.key === "PageDown" ? page : -page);
        break;
      }
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
      <div className="fw-scroll relative flex min-w-0 flex-1 overflow-x-auto">
        {/* Dohrávají odchod na svém původním místě, pod živými sloupci — nový
            sloupec přes ně přijede zprava. Pak zmizí. */}
        {exiting.columns.length > 0 && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 flex"
            style={{ left: exiting.from * PANE_WIDTH }}
          >
            {exiting.columns.map((column, index) => (
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
                scrollMemory={paneScroll.current}
                memoryKey={`${exiting.from + index}/${column.path}`}
                scrollBehavior={scrollBehavior}
              />
            ))}
          </div>
        )}

        <div ref={liveRef} className="relative flex shrink-0">
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
              scrollMemory={paneScroll.current}
              memoryKey={`${index}/${column.path}`}
              scrollBehavior={scrollBehavior}
            />
          ))}

          {infoEntry && lastColumn && (
            <InfoPanel key={infoEntry.path} entry={infoEntry} onOpen={onOpenFile} tags={tags} />
          )}
        </div>
      </div>
    </div>
  );
}
