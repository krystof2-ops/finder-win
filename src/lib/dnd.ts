import { useSyncExternalStore } from "react";

/**
 * Sdílený stav právě probíhajícího tažení.
 *
 * HTML drag & drop schválně nepustí `dataTransfer.getData()` během `dragover` —
 * dovolí ho až v `drop`. Jenže sidebar musí *už při přeletu* vědět, jestli
 * táhne složku (přijmout) nebo soubor (odmítnout) a jestli jde o novou položku
 * nebo přerovnání. Payload se proto drží tady v modulu a `dataTransfer` nese
 * jen cestu jako text, aby tažení ven z aplikace nebylo prázdné.
 */

export type DragPayload =
  /** Řádek z hlavního panelu — kandidát na přidání do Mých oblíbených. */
  | { kind: "entry"; path: string; name: string; isDir: boolean }
  /** Existující vlastní oblíbená — přerovnání v rámci sekce. */
  | { kind: "favorite"; path: string; index: number };

/** MIME typ je jen zástupný; skutečná data jsou v modulu. */
export const DRAG_MIME = "application/x-finder-win";

let current: DragPayload | null = null;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function startDrag(payload: DragPayload, dataTransfer: DataTransfer): void {
  current = payload;
  dataTransfer.effectAllowed = "copyMove";
  dataTransfer.setData(DRAG_MIME, payload.path);
  dataTransfer.setData("text/plain", payload.path);
  emit();
}

export function endDrag(): void {
  if (current === null) return;
  current = null;
  emit();
}

export function getDrag(): DragPayload | null {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Aktuální payload jako React stav — sidebar si díky tomu odhalí prázdnou
 * sekci "Moje oblíbené" ve chvíli, kdy nad ní visí složka, a nemusí kvůli
 * tomu nikdo protahovat props přes tři views.
 */
export function useDrag(): DragPayload | null {
  return useSyncExternalStore(subscribe, getDrag, () => null);
}
