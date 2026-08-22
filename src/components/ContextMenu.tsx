import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";

import { TAG_COLORS, TAG_HEX, TAG_LABEL } from "../lib/tags";
import type { TagColor } from "../types";

export type MenuItem =
  | { type: "separator" }
  | {
      type: "item";
      label: string;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  /** Řádek s paletou barev v podmenu. Klik na barvu menu nezavírá. */
  | {
      type: "tags";
      label: string;
      active: TagColor[];
      onToggle: (color: TagColor) => void;
    };

type ContextMenuProps = {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
};

const MARGIN = 8;
const PALETTE_WIDTH = 152;
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
                title={TAG_LABEL[color]}
                aria-pressed={isActive}
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

  // Po vykreslení se menu posune dovnitř okna, kdyby přetékalo.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const { width, height } = menu.getBoundingClientRect();
    const left = Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN));
    const top = Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN));

    setPosition({ left, top });
    setFlip(left + width + PALETTE_WIDTH + MARGIN > window.innerWidth);
  }, [x, y]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) requestClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
      }
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", requestClose);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", requestClose);
    };
  }, [requestClose]);

  return createPortal(
    <div
      ref={menuRef}
      className={`fixed z-50 rounded-md p-1 text-[13px] ${closing ? "fw-menu-out" : "fw-menu"}`}
      style={{
        left: position.left,
        top: position.top,
        minWidth: 200,
        background: "var(--bg-toolbar)",
        border: "1px solid var(--border)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
        backdropFilter: "blur(20px)",
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

        return (
          <button
            key={item.label}
            type="button"
            disabled={item.disabled}
            // Přejezd na obyčejnou položku zavře rozbalenou paletu.
            onMouseEnter={() => setOpenSubmenu(null)}
            onClick={() => {
              item.onSelect();
              requestClose();
            }}
            className="flex h-[26px] w-full items-center gap-4 rounded-sm px-3 text-left transition-colors duration-100 hover:bg-hover disabled:pointer-events-none disabled:opacity-40"
            style={{ color: item.danger ? "#ff3b30" : "var(--text-primary)" }}
          >
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.shortcut && (
              <span className="shrink-0 text-[11px] text-secondary">{item.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
