import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Stejná prodleva jako u macOS — rychlejší tooltip ruší při přejíždění myší. */
const SHOW_DELAY_MS = 600;
const MARGIN = 8;
/** Odsazení pod kurzorem, ať bublina nezakrývá to, na co uživatel míří. */
const CURSOR_OFFSET = 18;

type Tip = { text: string; x: number; y: number };

/**
 * Jediná vrstva tooltipů pro celou aplikaci. Prvky si o tooltip řeknou
 * atributem `data-tooltip` místo `title`.
 *
 * Nativní `title` kreslí Windows po svém: nedá se odložit, nedá se schovat
 * a vyskočí i přes otevřené kontextové menu (cesta z tooltipu pak leží přes
 * položky menu). Tahle vrstva se neukáže, dokud je v DOMu `[data-fw-menu]`.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: number | null = null;
    let owner: Element | null = null;
    let cursor = { x: 0, y: 0 };

    const cancel = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };

    const hide = () => {
      cancel();
      owner = null;
      setTip(null);
    };

    function onMouseOver(event: MouseEvent) {
      const target = (event.target as Element | null)?.closest?.("[data-tooltip]") ?? null;
      if (target === owner) return;

      hide();
      if (target === null) return;

      const text = target.getAttribute("data-tooltip");
      if (!text) return;

      owner = target;
      timer = window.setTimeout(() => {
        timer = null;
        if (owner !== target) return;
        // Otevřené menu tooltipy pod sebou umlčí. Uvnitř menu (názvy barev
        // v paletě tagů) je naopak nechá — nic nepřekrývají.
        const menu = document.querySelector("[data-fw-menu]");
        if (menu !== null && !menu.contains(target)) return;
        setTip({ text, x: cursor.x, y: cursor.y });
      }, SHOW_DELAY_MS);
    }

    function onMouseMove(event: MouseEvent) {
      cursor = { x: event.clientX, y: event.clientY };
    }

    function onMouseLeaveWindow(event: MouseEvent) {
      if (event.relatedTarget === null) hide();
    }

    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mouseout", onMouseLeaveWindow, true);
    // Každá interakce bublinu shodí — tooltip patří jen ke klidnému najetí.
    const hideEvents = ["mousedown", "contextmenu", "wheel", "scroll", "keydown", "dragstart"];
    for (const name of hideEvents) window.addEventListener(name, hide, true);
    window.addEventListener("blur", hide);

    return () => {
      cancel();
      document.removeEventListener("mouseover", onMouseOver, true);
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("mouseout", onMouseLeaveWindow, true);
      for (const name of hideEvents) window.removeEventListener(name, hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // Bublina se změří až po vykreslení a posune se dovnitř okna.
  useLayoutEffect(() => {
    if (tip === null || !bubbleRef.current) {
      setPosition(null);
      return;
    }

    const { width, height } = bubbleRef.current.getBoundingClientRect();
    let top = tip.y + CURSOR_OFFSET;
    if (top + height > window.innerHeight - MARGIN) top = tip.y - height - MARGIN;

    setPosition({
      left: Math.max(MARGIN, Math.min(tip.x, window.innerWidth - width - MARGIN)),
      top: Math.max(MARGIN, top),
    });
  }, [tip]);

  if (tip === null) return null;

  return createPortal(
    <div
      ref={bubbleRef}
      role="tooltip"
      className="fw-tooltip pointer-events-none fixed z-[70] max-w-[420px] rounded-md px-2 py-1 text-[11px] break-all text-primary"
      style={{
        left: position?.left ?? tip.x,
        top: position?.top ?? tip.y + CURSOR_OFFSET,
        // Do změření se nekreslí, jinak by bublina na okamžik skočila.
        visibility: position === null ? "hidden" : "visible",
        background: "var(--bg-toolbar)",
        border: "1px solid var(--border)",
        boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
        backdropFilter: "blur(20px)",
      }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
