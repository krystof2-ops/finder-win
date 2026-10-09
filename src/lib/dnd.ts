import { useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";

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

/* ------------------------- soubory zvenku (Průzkumník) ------------------------ */

/**
 * Táhnou se soubory odjinud (Průzkumník, plocha)? Interní tažení má payload
 * v modulu, zvenku přijde jen typ "Files".
 */
export function isExternalFileDrag(event: { dataTransfer: DataTransfer | null }): boolean {
  if (current !== null || event.dataTransfer === null) return false;
  if (!Array.from(event.dataTransfer.types).includes("Files")) return false;
  // Posluchač musí stát dřív, než přijde drop. Selhání řeší droppedPaths.
  ensureDropListener().catch(() => undefined);
  return true;
}

type WebView2 = {
  postMessageWithAdditionalObjects?: (message: unknown, objects: ArrayLike<unknown>) => void;
};

/** Čekající dropy: id zprávy → kdo čeká na cesty. */
const pendingDrops = new Map<number, (paths: string[]) => void>();
let nextDropId = 0;
let dropListener: Promise<unknown> | null = null;
/** Při trvalé chybě se na Rust nenapojuje při každém dragover (desítky za
 *  sekundu) — nejvýš jeden pokus za RETRY_MS. */
const RETRY_MS = 5000;
let lastFailure: { at: number; error: unknown } | null = null;

function ensureDropListener(): Promise<unknown> {
  if (dropListener === null && lastFailure !== null && Date.now() - lastFailure.at < RETRY_MS) {
    return Promise.reject(lastFailure.error);
  }
  dropListener ??= listen<{ id: number; paths: string[] }>("external-drop", ({ payload }) => {
    const resolve = pendingDrops.get(payload.id);
    pendingDrops.delete(payload.id);
    resolve?.(payload.paths);
  }).then(
    (unlisten) => {
      lastFailure = null;
      return unlisten;
    },
    (err: unknown) => {
      // Nepovedená registrace se nesmí zapamatovat — další pokus po RETRY_MS.
      dropListener = null;
      lastFailure = { at: Date.now(), error: err };
      throw err;
    },
  );
  return dropListener;
}

/** Když WebView2 neodpoví (starý runtime), drop se tiše zahodí. */
const DROP_TIMEOUT_MS = 5000;

/**
 * Cesty k souborům puštěným zvenku. File v HTML5 cestu nemá — WebView2 ale
 * soubory předá hostiteli (postMessageWithAdditionalObjects) a Rust vrátí
 * cesty událostí external-drop. Volat přímo v obsluze dropu: po jejím konci
 * prohlížeč DataTransfer vyprázdní.
 */
export async function droppedPaths(dataTransfer: DataTransfer): Promise<string[]> {
  const files = dataTransfer.files;
  const webview = (window as unknown as { chrome?: { webview?: WebView2 } }).chrome?.webview;
  if (files.length === 0 || !webview?.postMessageWithAdditionalObjects) return [];

  try {
    await ensureDropListener();
  } catch {
    // Bez posluchače by se cesty nikdy nedozvěděly — drop se zahodí.
    return [];
  }
  const id = (nextDropId += 1);
  return new Promise<string[]>((resolve) => {
    pendingDrops.set(id, resolve);
    window.setTimeout(() => {
      if (pendingDrops.delete(id)) resolve([]);
    }, DROP_TIMEOUT_MS);
    // Řetězec, ne objekt: wry čte každou zprávu jako text a u objektu vrátí chybu;
    // novější WebView2 pak další handlery (náš v external_drop.rs) už nezavolá.
    webview.postMessageWithAdditionalObjects?.(`finderWinDrop:${id}`, files);
  });
}
