import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type MenuItem =
  | { type: "separator" }
  | {
      type: "item";
      label: string;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    };

type ContextMenuProps = {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
};

const MARGIN = 8;

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Po vykreslení se menu posune dovnitř okna, kdyby přetékalo.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const { width, height } = menu.getBoundingClientRect();
    const left = Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN));
    const top = Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN));

    setPosition({ left, top });
  }, [x, y]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 rounded-md p-1 text-[13px]"
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
      {items.map((item, index) =>
        item.type === "separator" ? (
          <div
            key={`separator-${index}`}
            style={{ height: 1, margin: "4px 0", background: "var(--border)" }}
          />
        ) : (
          <button
            key={item.label}
            type="button"
            disabled={item.disabled}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
            className="flex h-[26px] w-full items-center gap-4 rounded-sm px-3 text-left transition-colors duration-100 hover:bg-hover disabled:pointer-events-none disabled:opacity-40"
            style={{ color: item.danger ? "#ff3b30" : "var(--text-primary)" }}
          >
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.shortcut && (
              <span className="shrink-0 text-[11px] text-secondary">{item.shortcut}</span>
            )}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
