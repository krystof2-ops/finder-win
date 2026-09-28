import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight } from "lucide-react";

import { TAG_COLORS, TAG_HEX, TAG_LABEL } from "../lib/tags";
import type { TagColor } from "../types";

type ActionItem = {
  type: "item";
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Přepínač (režim zobrazení, řazení). undefined = obyčejná položka bez háčku. */
  checked?: boolean;
  /** Barevný puntík před názvem (menu Štítky). */
  dot?: string;
  onSelect: () => void;
};

type SubmenuEntry = { type: "separator" } | ActionItem;

export type MenuItem =
  | { type: "separator" }
  | ActionItem
  /** Řádek s paletou barev v podmenu. Klik na barvu menu nezavírá. */
  | {
      type: "tags";
      label: string;
      active: TagColor[];
      onToggle: (color: TagColor) => void;
    }
  /** Řádek, který po najetí rozbalí další seznam (Zobrazit ▸, Seřadit podle ▸). */
  | { type: "submenu"; label: string; disabled?: boolean; items: SubmenuEntry[] };

type ContextMenuProps = {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
};

const MARGIN = 8;
const PALETTE_WIDTH = 152;
const SUBMENU_WIDTH = 180;
/** Musí sedět s délkou fw-menu-out v CSS. */
const CLOSE_MS = 140;

/* ------------------------------ paleta tagů ------------------------------- */

type TagRowProps = {
  label: string;
  active: TagColor[];
  onToggle: (color: TagColor) => void;
  /** Podmenu se u pravého okraje musí vyklopit doleva. */
  flip: boolean;
  open: boolean;
  onHover: () => void;
};

function TagRow({ label, active, onToggle, flip, open, onHover }: TagRowProps) {
  return (
    <div className="relative" onMouseEnter={onHover}>
      <div
        className="flex h-[26px] w-full items-center gap-4 rounded-sm px-3 text-left transition-colors duration-100"
        style={{
          color: "var(--text-primary)",
          background: open ? "var(--hover)" : "transparent",
        }}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronRight size={13} strokeWidth={2} className="shrink-0 text-secondary" />
      </div>

      {open && (
        <div
          className="absolute z-10 flex items-center gap-2 rounded-md px-2.5 py-2"
          style={{
            top: -5,
            [flip ? "right" : "left"]: "100%",
            width: PALETTE_WIDTH,
            background: "var(--bg-toolbar)",
            border: "1px solid var(--border)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
            backdropFilter: "blur(20px)",
          }}
        >
          {TAG_COLORS.map((color) => {
            const isActive = active.includes(color);

            return (
              <button
                key={color}
                type="button"
                data-tooltip={TAG_LABEL[color]}
                aria-pressed={isActive}
                aria-label={`Tag ${TAG_LABEL[color]}`}
                // Menu po kliknutí schválně zůstává — tagů jde přidat víc najednou.
                onClick={() => onToggle(color)}
                className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full transition-transform duration-100 hover:scale-110"
                style={{
                  border: isActive ? "2px solid var(--text-primary)" : "2px solid transparent",
                }}
              >
                <span
                  className="rounded-full"
                  style={{
                    width: 14,
                    height: 14,
                    backgroundColor: TAG_HEX[color],
                    boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.15)",
                  }}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- položky ---------------------------------- */

const ROW_CLASS =
  "flex h-[26px] w-full items-center gap-4 rounded-sm px-3 text-left transition-colors duration-100";

const PANEL_STYLE: React.CSSProperties = {
  background: "var(--bg-toolbar)",
  border: "1px solid var(--border)",
  boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
  backdropFilter: "blur(20px)",
};

function ActionRow({
  item,
  onDone,
  onHover,
}: {
  item: ActionItem;
  onDone: () => void;
  onHover?: () => void;
}) {
  return (
    <button
      type="button"
      role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={item.checked}
      disabled={item.disabled}
      onMouseEnter={onHover}
      onClick={() => {
        item.onSelect();
        onDone();
      }}
      className={`${ROW_CLASS} hover:bg-hover disabled:pointer-events-none disabled:opacity-40`}
      style={{ color: item.danger ? "#ff3b30" : "var(--text-primary)" }}
    >
      {item.checked !== undefined && (
        <span className="-ml-1 -mr-2 flex w-3.5 shrink-0 justify-center">
          {item.checked && <Check size={13} strokeWidth={2.5} />}
        </span>
      )}
      {item.dot && (
        <span
          aria-hidden
          className="-mr-2 shrink-0 rounded-full"
          style={{
            width: 10,
            height: 10,
            background: item.dot,
            boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.15)",
          }}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.shortcut && <span className="shrink-0 text-[11px] text-secondary">{item.shortcut}</span>}
    </button>
  );
}

type SubmenuRowProps = {
  label: string;
  disabled?: boolean;
  items: SubmenuEntry[];
  flip: boolean;
  open: boolean;
  onHover: () => void;
  onDone: () => void;
};

function SubmenuRow({ label, disabled, items, flip, open, onHover, onDone }: SubmenuRowProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [shiftUp, setShiftUp] = useState(0);

  // U spodního okraje okna by podmenu přeteklo — posune se nahoru dovnitř.
  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    const overflow = rect.bottom + shiftUp - (window.innerHeight - MARGIN);
    setShiftUp(overflow > 0 ? overflow : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="relative" onMouseEnter={disabled ? undefined : onHover}>
      <div
        className={`${ROW_CLASS} ${disabled ? "opacity-40" : ""}`}
        style={{
          color: "var(--text-primary)",
          background: open ? "var(--hover)" : "transparent",
        }}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronRight size={13} strokeWidth={2} className="shrink-0 text-secondary" />
      </div>

      {open && !disabled && (
        <div
          ref={panelRef}
          className="absolute z-10 rounded-md p-1"
          style={{
            ...PANEL_STYLE,
            top: -5 - shiftUp,
            [flip ? "right" : "left"]: "100%",
            width: SUBMENU_WIDTH,
          }}
        >
          {items.map((entry, index) =>
            entry.type === "separator" ? (
              <div
                key={`separator-${index}`}
                style={{ height: 1, margin: "4px 0", background: "var(--border)" }}
              />
            ) : (
              <ActionRow key={entry.label} item={entry} onDone={onDone} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------- menu ------------------------------------ */

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [flip, setFlip] = useState(false);
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);

  // Menu si odchod dohraje samo a teprve pak řekne rodiči, ať ho odmountuje.
  // Volající tak dál píše jen {menu && <ContextMenu onClose={...} />}.
  const closeTimer = useRef<number | null>(null);

  const requestClose = useCallback(() => {
    if (closeTimer.current !== null) return;
    setClosing(true);
    closeTimer.current = window.setTimeout(onClose, CLOSE_MS);
  }, [onClose]);

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  // Pravý klik jinam, když je menu otevřené: mousedown spustí zavírání, hned
  // nato rodič pošle nové menu do téže instance. Bez zrušení by dobíhající
  // časovač zavřel i to nové — druhý pravý klik po sobě by nic neukázal.
  useEffect(() => {
    if (closeTimer.current === null) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setClosing(false);
    setOpenSubmenu(null);
  }, [x, y, items]);

  // Po vykreslení se menu posune dovnitř okna, kdyby přetékalo.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const { width, height } = menu.getBoundingClientRect();
    const left = Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN));
    const top = Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN));

    setPosition({ left, top });
    setFlip(left + width + Math.max(PALETTE_WIDTH, SUBMENU_WIDTH) + MARGIN > window.innerWidth);
  }, [x, y]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) requestClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        // Escape patří menu, ne tomu, co je pod ním — jinak by s menu zavřel
        // i Quick Look nebo zrušil rozepsané přejmenování.
        event.stopPropagation();
        requestClose();
      }
    }
    function onScroll(event: Event) {
      if (!menuRef.current?.contains(event.target as Node)) requestClose();
    }

    // Vše v capture fázi: Quick Look i řádky volají stopPropagation, takže
    // v bubble fázi by klik mimo menu do window vůbec nedorazil. Scroll
    // nebublá, zachytit se dá jen tak.
    window.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", requestClose);
    window.addEventListener("blur", requestClose);
    return () => {
      window.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", requestClose);
      window.removeEventListener("blur", requestClose);
    };
  }, [requestClose]);

  return createPortal(
    <div
      ref={menuRef}
      // Podle atributu tooltipy poznají, že je otevřené menu, a neukážou se.
      data-fw-menu=""
      role="menu"
      className={`fixed z-[60] rounded-md p-1 text-[13px] ${closing ? "fw-menu-out" : "fw-menu"}`}
      style={{
        ...PANEL_STYLE,
        left: position.left,
        top: position.top,
        minWidth: 200,
      }}
    >
      {items.map((item, index) => {
        if (item.type === "separator") {
          return (
            <div
              key={`separator-${index}`}
              style={{ height: 1, margin: "4px 0", background: "var(--border)" }}
            />
          );
        }

        if (item.type === "tags") {
          return (
            <TagRow
              key={item.label}
              label={item.label}
              active={item.active}
              onToggle={item.onToggle}
              flip={flip}
              open={openSubmenu === index}
              onHover={() => setOpenSubmenu(index)}
            />
          );
        }

        if (item.type === "submenu") {
          return (
            <SubmenuRow
              key={item.label}
              label={item.label}
              disabled={item.disabled}
              items={item.items}
              flip={flip}
              open={openSubmenu === index}
              onHover={() => setOpenSubmenu(index)}
              onDone={requestClose}
            />
          );
        }

        return (
          <ActionRow
            key={item.label}
            item={item}
            onDone={requestClose}
            // Přejezd na obyčejnou položku zavře rozbalené podmenu.
            onHover={() => setOpenSubmenu(null)}
          />
        );
      })}
    </div>,
    document.body,
  );
}
