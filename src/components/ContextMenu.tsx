import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight } from "lucide-react";

import { TAG_COLORS, TAG_HEX, tagLabel } from "../lib/tags";
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
  /** Šedý popisek nahoře v menu ("3 položky") — nedá se na něj kliknout. */
  | { type: "header"; label: string }
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
  /** Prvky, které menu otevírají a zavírají samy (tlačítka toolbaru). Klik
   *  na ně menu nezavře — jinak by ho posluchač zavřel a klik hned otevřel. */
  triggerSelector?: string;
};

const MARGIN = 8;
const PALETTE_WIDTH = 152;
const SUBMENU_WIDTH = 180;

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
      <div className={`fw-menu-item ${open ? "is-highlighted" : ""}`}>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronRight size={13} strokeWidth={2} className="fw-menu-shortcut shrink-0" />
      </div>

      {open && (
        <div
          className="fw-popover absolute z-10 flex items-center gap-2 rounded-[8px] px-2.5 py-2"
          style={{
            top: -5,
            [flip ? "right" : "left"]: "100%",
            width: PALETTE_WIDTH,
          }}
        >
          {TAG_COLORS.map((color) => {
            const isActive = active.includes(color);

            return (
              <button
                key={color}
                type="button"
                data-tooltip={tagLabel(color)}
                aria-pressed={isActive}
                aria-label={`Tag ${tagLabel(color)}`}
                // Menu po kliknutí schválně zůstává — tagů jde přidat víc najednou.
                onClick={() => onToggle(color)}
                className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full fw-t-transform hover:scale-110"
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
                    boxShadow: "var(--swatch-edge)",
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


function ActionRow({
  item,
  onDone,
  onHover,
  highlighted = false,
}: {
  item: ActionItem;
  onDone: () => void;
  onHover?: () => void;
  /** Kurzor klávesnice stojí na téhle položce. */
  highlighted?: boolean;
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
      className={`fw-menu-item ${highlighted ? "is-highlighted" : ""} ${
        item.danger ? "is-danger" : ""
      } disabled:pointer-events-none`}
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
            boxShadow: "var(--swatch-edge)",
          }}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.shortcut && <span className="fw-menu-shortcut shrink-0">{item.shortcut}</span>}
    </button>
  );
}

type SubmenuRowProps = {
  label: string;
  disabled?: boolean;
  items: SubmenuEntry[];
  flip: boolean;
  open: boolean;
  highlighted?: boolean;
  onHover: () => void;
  onDone: () => void;
};

function SubmenuRow({
  label,
  disabled,
  items,
  flip,
  open,
  highlighted = false,
  onHover,
  onDone,
}: SubmenuRowProps) {
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
        className={`fw-menu-item ${!disabled && (open || highlighted) ? "is-highlighted" : ""} ${
          disabled ? "opacity-40" : ""
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronRight size={13} strokeWidth={2} className="fw-menu-shortcut shrink-0" />
      </div>

      {open && !disabled && (
        <div
          ref={panelRef}
          className="fw-popover absolute z-10 rounded-[8px] p-1"
          style={{
            top: -5 - shiftUp,
            [flip ? "right" : "left"]: "100%",
            width: SUBMENU_WIDTH,
          }}
        >
          {items.map((entry, index) =>
            entry.type === "separator" ? (
              <div key={`separator-${index}`} className="fw-menu-separator" />
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

export function ContextMenu({ x, y, items, onClose, triggerSelector }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [flip, setFlip] = useState(false);
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null);
  /** Kurzor klávesnice (index v `items`), -1 = nikde. */
  const [cursor, setCursor] = useState(-1);

  // Klávesový posluchač je jeden po celou dobu života menu — položky
  // a kurzor si čte z refů, ať se kvůli každému posunu nepřevěšuje.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  // Zavírá se okamžitě — menu, které po výběru ještě chvíli dohasíná, působí
  // líně a kurzor pod ním už míří jinam.
  const requestClose = useCallback(() => onClose(), [onClose]);

  // Pravý klik jinam, když je menu otevřené: mousedown ho zavře a rodič hned
  // pošle nové do téže instance — stav kurzoru a podmenu patří tomu starému.
  useEffect(() => {
    setOpenSubmenu(null);
    setCursor(-1);
  }, [x, y]);

  // Po vykreslení se menu posune dovnitř okna, kdyby přetékalo.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const { width, height } = menu.getBoundingClientRect();
    const left = Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN));
    const top = Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN));

    setPosition({ left, top });
    // Menu vyroste z místa kliknutí, i když se kvůli okraji okna posunulo.
    menu.style.transformOrigin = `${x - left}px ${y - top}px`;
    setFlip(left + width + Math.max(PALETTE_WIDTH, SUBMENU_WIDTH) + MARGIN > window.innerWidth);
  }, [x, y]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Element | null;
      if (menuRef.current?.contains(target)) return;
      if (triggerSelector && target?.closest?.(triggerSelector)) return;
      requestClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      const list = itemsRef.current;
      // Na co se dá kurzorem stoupnout: akce, podmenu, paleta tagů.
      const reachable = list
        .map((item, index) => ({ item, index }))
        .filter(({ item }) =>
          item.type === "tags" || ((item.type === "item" || item.type === "submenu") && !item.disabled),
        )
        .map(({ index }) => index);
      const position = reachable.indexOf(cursorRef.current);

      let handled = true;
      switch (event.key) {
        case "Escape":
          // Escape patří menu, ne tomu, co je pod ním — jinak by s menu
          // zavřel i Quick Look nebo zrušil rozepsané přejmenování.
          requestClose();
          break;
        case "ArrowDown":
          setCursor(reachable[position < 0 ? 0 : (position + 1) % reachable.length] ?? -1);
          setOpenSubmenu(null);
          break;
        case "ArrowUp":
          setCursor(
            reachable[position < 0 ? reachable.length - 1 : (position - 1 + reachable.length) % reachable.length] ?? -1,
          );
          setOpenSubmenu(null);
          break;
        case "Home":
          setCursor(reachable[0] ?? -1);
          break;
        case "End":
          setCursor(reachable[reachable.length - 1] ?? -1);
          break;
        case "Enter":
        case "ArrowRight": {
          const item = list[cursorRef.current];
          if (!item) break;
          if (item.type === "item" && event.key === "Enter") {
            item.onSelect();
            requestClose();
          } else if (item.type === "submenu" || item.type === "tags") {
            setOpenSubmenu(cursorRef.current);
          }
          break;
        }
        case "ArrowLeft":
          setOpenSubmenu(null);
          break;
        default:
          handled = false;
      }

      // Klávesy menu nesmí propadnout dolů (šipky by posouvaly výběr ve
      // výpisu, Enter by otevřel soubor).
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
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
  }, [requestClose, triggerSelector]);

  return createPortal(
    <div
      ref={menuRef}
      // Podle atributu tooltipy poznají, že je otevřené menu, a neukážou se.
      data-fw-menu=""
      role="menu"
      className="fw-popover fw-menu fixed z-[60] rounded-[8px] p-1 text-[13px]"
      style={{
        left: position.left,
        top: position.top,
        minWidth: 200,
      }}
    >
      {items.map((item, index) => {
        if (item.type === "separator") {
          return (
            <div key={`separator-${index}`} className="fw-menu-separator" />
          );
        }

        if (item.type === "header") {
          return (
            <div
              key={`header-${index}`}
              role="presentation"
              className="px-3 pt-1 pb-0.5 text-[11px] font-medium text-secondary"
            >
              {item.label}
            </div>
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
              onHover={() => {
                setOpenSubmenu(index);
                setCursor(index);
              }}
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
              highlighted={cursor === index}
              onHover={() => {
                setOpenSubmenu(index);
                setCursor(index);
              }}
              onDone={requestClose}
            />
          );
        }

        return (
          <ActionRow
            key={item.label}
            item={item}
            onDone={requestClose}
            highlighted={cursor === index}
            // Přejezd na obyčejnou položku zavře rozbalené podmenu.
            onHover={() => {
              setOpenSubmenu(null);
              setCursor(index);
            }}
          />
        );
      })}
    </div>,
    document.body,
  );
}
