import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";

import { FolderIcon, folderDisplayName } from "./icons";
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
  /** Přetažení záložky na místo jiné — `index` je pozice v poli záložek. */
  onReorder: (id: number, index: number) => void;
  /** Položky (i soubory z Průzkumníku) puštěné na záložku — přesun do její složky. */
  onDropInto: DropInto;
  /** + na konci lišty, jako v prohlížeči — totéž co Ctrl+T. */
  onNew: () => void;
};

/** Typ dat taženého ouška — odliší ho od tažení souborů. */
const TAB_MIME = "application/x-finder-win-tab";

/** Popisek záložky: přeložený název složky jako v záhlaví toolbaru. */
function tabTitle(path: string | null): string {
  if (path === null) return "Finder";
  const crumbs = breadcrumbs(path);
  const last = crumbs[crumbs.length - 1];
  return last ? folderDisplayName(last.path, last.label) : path;
}

/**
 * Lišta záložek pod toolbarem, jako ve Finderu — App ji ukazuje jen při dvou
 * a více záložkách. Ouška jdou přerovnat tažením a dá se na ně pustit soubor
 * (přesun do složky záložky, s Ctrl kopie).
 */
export function TabBar({ tabs, activeId, windowFocused, onSelect, onClose, onReorder, onDropInto, onNew }: TabBarProps) {
  const t = useT();
  /** Ouško, které se právě táhne (přerovnání). */
  const dragging = useRef<number | null>(null);
  /** Záložka, nad kterou visí tažený soubor. */
  const [dropId, setDropId] = useState<number | null>(null);

  return (
    <div className="fw-tabbar" role="tablist" aria-label={t("tabs.label")}>
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
        // Fokus zůstává ve výpisu (šipky), jako u tlačítek toolbaru.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onNew}
      >
        <Plus size={15} strokeWidth={1.5} />
      </button>
    </div>
  );
}
