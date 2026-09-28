import { useCallback, useRef, useState } from "react";

import { isTypingTarget } from "./dom";

/** Pohyb pod tímhle prahem je klik, ne tažení — klik do prázdna ruší výběr. */
const DRAG_THRESHOLD = 4;
/** Jak blízko okraje kontejneru se při tažení začne posouvat obsah. */
const EDGE = 24;
const EDGE_STEP = 18;

type Rect = { left: number; top: number; width: number; height: number };

type RubberBandOptions = {
  /** Začátek tažení; `additive` = držený Ctrl / Shift (přidávat k výběru). */
  onStart?: (additive: boolean) => void;
  /** Cesty položek pod obdélníkem, průběžně při každém pohybu. */
  onChange: (paths: string[], additive: boolean) => void;
};

/**
 * Gumičkový výběr tažením v prázdné ploše. Kontejner, na který se pověsí
 * `onMouseDown`, musí obsahovat řádky s `data-path`. Souřadnice se drží
 * v obsahu kontejneru, takže výběr sedí i když se během tažení posune.
 */
export function useRubberBand({ onStart, onChange }: RubberBandOptions) {
  const [rect, setRect] = useState<Rect | null>(null);
  const callbacks = useRef({ onStart, onChange });
  callbacks.current = { onStart, onChange };

  const onMouseDown = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    // Na řádku začíná HTML drag & drop nebo klik, v poli psaní.
    if ((event.target as Element).closest("[data-path]")) return;
    if (isTypingTarget(event.target)) return;

    const container = event.currentTarget;
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    // Y v souřadnicích obsahu — přežije posun kontejneru během tažení.
    const start = { x: event.clientX, y: event.clientY + container.scrollTop };
    let started = false;

    function update(clientX: number, clientY: number) {
      const bounds = container.getBoundingClientRect();

      // U okraje posouvat, ať jde vybrat i to, co je mimo obrazovku.
      if (clientY > bounds.bottom - EDGE) container.scrollTop += EDGE_STEP;
      else if (clientY < bounds.top + EDGE) container.scrollTop -= EDGE_STEP;

      const startY = start.y - container.scrollTop;
      const left = Math.min(start.x, clientX);
      const top = Math.max(bounds.top, Math.min(startY, clientY));
      const right = Math.max(start.x, clientX);
      const bottom = Math.min(bounds.bottom, Math.max(startY, clientY));
      const box = { left, top, width: right - left, height: Math.max(0, bottom - top) };
      setRect(box);

      // Průsečík s obdélníkem, ne úplné pokrytí — jako ve Finderu.
      // Svisle se porovnává s neoříznutým rozsahem — řádky odscrollované mimo
      // obrazovku do výběru patří taky.
      const spanTop = Math.min(startY, clientY);
      const spanBottom = Math.max(startY, clientY);
      const hit: string[] = [];
      container.querySelectorAll<HTMLElement>("[data-path]").forEach((row) => {
        const r = row.getBoundingClientRect();
        if (r.right >= left && r.left <= right && r.bottom >= spanTop && r.top <= spanBottom) {
          const path = row.dataset.path;
          if (path) hit.push(path);
        }
      });
      callbacks.current.onChange(hit, additive);
    }

    function onMove(move: MouseEvent) {
      if (!started) {
        if (Math.hypot(move.clientX - start.x, move.clientY + container.scrollTop - start.y) < DRAG_THRESHOLD) {
          return;
        }
        started = true;
        callbacks.current.onStart?.(additive);
      }
      update(move.clientX, move.clientY);
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setRect(null);
      if (!started) return;

      // Po tažení přijde ještě click — ten by prázdnou plochu vzal jako "zruš
      // výběr" a gumička by přišla vniveč. Jednou se proto spolkne.
      const swallow = (click: MouseEvent) => {
        click.stopPropagation();
        window.removeEventListener("click", swallow, true);
      };
      window.addEventListener("click", swallow, true);
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const overlay =
    rect === null ? null : (
      <div
        aria-hidden
        className="pointer-events-none fixed z-30 rounded-[2px]"
        style={{
          ...rect,
          background: "color-mix(in srgb, var(--accent) 14%, transparent)",
          border: "1px solid color-mix(in srgb, var(--accent) 70%, transparent)",
        }}
      />
    );

  return { onMouseDown, overlay };
}
