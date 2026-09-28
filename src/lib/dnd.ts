import { useSyncExternalStore } from "react";

import { pathKey } from "./storage";

/**
 * Sdílený stav právě probíhajícího tažení.
 *
 * HTML drag & drop schválně nepustí `dataTransfer.getData()` během `dragover` —
 * dovolí ho až v `drop`. Jenže cíle musí *už při přeletu* vědět, co se táhne
 * (sidebar: nová oblíbená nebo přerovnání; složka: nesmí se pustit do sebe
 * sama). Payload se proto drží tady v modulu a `dataTransfer` nese jen cesty
 * jako text, aby tažení ven z aplikace nebylo prázdné.
 */

export type DragItem = { path: string; name: string; isDir: boolean };

export type DragPayload =
  /** Položky z hlavního panelu — celý výběr, když se táhne za vybraný řádek. */
  | { kind: "entry"; items: DragItem[] }
  /** Existující vlastní oblíbená — přerovnání v rámci sekce. */
  | { kind: "favorite"; path: string; index: number };

/** MIME typ je jen zástupný; skutečná data jsou v modulu. */
export const DRAG_MIME = "application/x-finder-win";

let current: DragPayload | null = null;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function payloadText(payload: DragPayload): string {
  return payload.kind === "entry"
    ? payload.items.map((item) => item.path).join("\r\n")
    : payload.path;
}

export function startDrag(payload: DragPayload, dataTransfer: DataTransfer): void {
  current = payload;
  dataTransfer.effectAllowed = "copyMove";
  dataTransfer.setData(DRAG_MIME, payloadText(payload));
  dataTransfer.setData("text/plain", payloadText(payload));
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

/**
 * Co se táhne za řádek `entry`: je-li ve výběru, celý výběr (v pořadí
 * výpisu), jinak jen on — stejně jako Finder i Průzkumník.
 */
export function dragItemsFor(
  entry: { path: string; name: string; is_dir: boolean },
  selected: { path: string; name: string; is_dir: boolean }[],
): DragItem[] {
  const source = selected.some((item) => item.path === entry.path) ? selected : [entry];
  return source.map((item) => ({ path: item.path, name: item.name, isDir: item.is_dir }));
}

/**
 * Smí se táhnuté položky pustit do složky `folder`? Ne do sebe sama a ne do
 * vlastního potomka. Pustit je tam, kde už leží, smí — backend to vezme jako
 * přesun, který nic nedělá.
 */
export function canDropInto(folder: string, payload: DragPayload | null): boolean {
  if (payload === null || payload.kind !== "entry") return false;

  const target = pathKey(folder);
  return payload.items.every((item) => {
    const source = pathKey(item.path);
    return target !== source && !target.startsWith(`${source}\\`);
  });
}
