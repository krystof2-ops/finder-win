import { useLayoutEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

import { FolderIcon, folderDisplayName } from "./icons";
import type { Command } from "../commands";
import { useT } from "../i18n";
import { canDropInto, droppedPaths, endDrag, getDrag, isExternalFileDrag } from "../lib/dnd";
import type { DropInto } from "../lib/rowDnd";
import { breadcrumbs } from "../format";

export type TabItem = {
  id: number;
  path: string | null;
  closing: boolean;
  /** Právě otevřená — vjede animací. */
  fresh: boolean;
};

type TabBarProps = {
  tabs: TabItem[];
  activeId: number;
  windowFocused: boolean;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  /** Přetažení záložky na místo jiného ouška — `index` je pozice v poli záložek. */
  onReorder: (id: number, index: number) => void;
  /** Položky (i soubory z Průzkumníku) puštěné na záložku — přesun do její složky. */
  onDropInto: DropInto;
  /** Příkaz Nová záložka z registru — + za posledním ouškem, totéž co Ctrl+T. */
  newTab: Command;
};

/** Typ dat taženého ouška — odliší ho od tažení souborů. */
const TAB_MIME = "application/x-finder-win-tab";

/** Rozměry z index.css (.fw-tab, .fw-tab-new, .fw-tabbar) — pro zjištění, kdy se ouška nevejdou. */
const TAB_MIN_WIDTH = 120;
const TAB_GAP = 2;
/** Tlačítko + včetně mezery flexu a vlastního okraje vlevo. */
const NEW_BUTTON_WIDTH = 28 + TAB_GAP + 2;
const BAR_PADDING = 16;

/** Popisek záložky: přeložený název složky jako v záhlaví toolbaru. */
function tabTitle(path: string | null): string {
  if (path === null) return "Finder";
  const crumbs = breadcrumbs(path);
  const last = crumbs[crumbs.length - 1];
  return last ? folderDisplayName(last.path, last.label) : path;
}

/**
 * Lišta záložek pod toolbarem, vždy vidět — ouška zarovnaná doleva jako
 * v Průzkumníku, šířka podle obsahu (120–240 px). Ouška jdou přerovnat
 * tažením a dá se na ně pustit soubor (přesun do složky záložky, s Ctrl
 * kopie). Když se nevejdou, zúží se rovnoměrně.
 */
export function TabBar({ tabs, activeId, windowFocused, onSelect, onClose, onReorder, onDropInto, newTab }: TabBarProps) {
  const t = useT();
  const barRef = useRef<HTMLDivElement>(null);
  /** Ouško, které se právě táhne (přerovnání). */
  const dragging = useRef<number | null>(null);
  /** Záložka, nad kterou visí tažený soubor. */
  const [dropId, setDropId] = useState<number | null>(null);
  /** Ouška v minimální šířce by přetekla lištu — zúží se rovnoměrně. */
  const [crowded, setCrowded] = useState(false);

  const open = tabs.filter((tab) => !tab.closing).length;

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const measure = () => {
      const available = bar.clientWidth - BAR_PADDING - NEW_BUTTON_WIDTH;
      setCrowded(open * TAB_MIN_WIDTH + (open - 1) * TAB_GAP > available);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [open]);

  return (
    <div
      ref={barRef}
      className={`fw-tabbar ${open <= 1 ? "is-single" : ""} ${crowded ? "is-crowded" : ""}`}
      role="tablist"
      aria-label={t("tabs.label")}
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeId;
        const title = tabTitle(tab.path);

        const acceptsDrop = (event: React.DragEvent) =>
          tab.path !== null && (isExternalFileDrag(event) || canDropInto(tab.path, getDrag()));

        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            data-tooltip={tab.path ?? undefined}
            draggable={!tab.closing}
            className={`fw-tab ${isActive ? "is-active" : ""} ${windowFocused ? "" : "is-blurred"} ${
              tab.fresh ? "fw-tab-in" : ""
            } ${tab.closing ? "fw-tab-out" : ""} ${dropId === tab.id ? "fw-drop-target" : ""}`}
            onMouseDown={(event) => {
              // Prostřední tlačítko zavírá (a nesmí spustit automatické posouvání).
              if (event.button === 1) event.preventDefault();
            }}
            onClick={() => onSelect(tab.id)}
            onAuxClick={(event) => {
              if (event.button === 1) onClose(tab.id);
            }}
            onDragStart={(event) => {
              dragging.current = tab.id;
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(TAB_MIME, String(tab.id));
            }}
            onDragEnd={() => {
              dragging.current = null;
            }}
            onDragOver={(event) => {
              const moving = dragging.current;
              if (moving !== null) {
                // Přerovnání naživo, jako v prohlížeči: ouško uhne hned.
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (moving !== tab.id) onReorder(moving, index);
                return;
              }
              if (!acceptsDrop(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = event.ctrlKey ? "copy" : "move";
              setDropId(tab.id);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              setDropId((current) => (current === tab.id ? null : current));
            }}
            onDrop={(event) => {
              setDropId(null);
              if (dragging.current !== null || tab.path === null) {
                event.preventDefault();
                return;
              }
              const folder = tab.path;
              const copy = event.ctrlKey;
              if (isExternalFileDrag(event)) {
                event.preventDefault();
                void droppedPaths(event.dataTransfer).then((paths) => {
                  if (paths.length > 0) onDropInto(folder, paths, copy);
                });
                return;
              }
              const payload = getDrag();
              if (payload?.kind !== "entry" || !canDropInto(folder, payload)) return;
              event.preventDefault();
              endDrag();
              onDropInto(folder, payload.items.map((item) => item.path), copy);
            }}
          >
            <FolderIcon size={14} />
            <span className="min-w-0 flex-1 truncate">{title}</span>
            <button
              type="button"
              className="fw-tab-close"
              aria-label={t("tabs.close")}
              data-tooltip={t("tabs.close")}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
              }}
            >
              <X size={11} strokeWidth={2.5} />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        className="fw-tab-new"
        aria-label={t("tabs.newWithShortcut")}
        data-tooltip={t("tabs.newWithShortcut")}
        disabled={!newTab.enabled}
        // Fokus zůstává ve výpisu (šipky), jako u tlačítek toolbaru.
        onMouseDown={(event) => event.preventDefault()}
        onClick={newTab.run}
      >
        <Plus size={15} strokeWidth={1.5} />
      </button>
    </div>
  );
}
