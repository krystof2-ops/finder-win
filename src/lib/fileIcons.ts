import { useCallback, useEffect, useState } from "react";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { invoke } from "../fileops";

import type { FileEntry } from "../types";

/** Velikosti, které umí backend (get_file_icon). */
export type IconSize = 32 | 64 | 128;

/** Přípony s vlastní ikonou v souboru — klíčují se cestou, ne příponou.
 *  Stejná sada jako OWN_ICON_EXTENSIONS v main.rs. */
const OWN_ICON = new Set(["exe", "lnk", "ico", "url", "cpl", "msc", "scr"]);

/** Kolik ikon drží paměť. Víc než 500 různých přípon/exe v jedné relaci nebývá. */
const CACHE_LIMIT = 500;
/** Strop paměti pro data URL dohromady — náhled 256 px má i 150 kB, ikona
 *  pár kB; bez stropu by mřížka s 200 videi vytěsnila levné ikony a držela
 *  desítky MB. Vyřazuje se od nejstaršího, dokud se součet nevejde. */
const CACHE_BYTES = 16 * 1024 * 1024;
/** Kolik požadavků na shell běží naráz — ať složka s tisíci .exe nezahltí backend. */
const MAX_IN_FLIGHT = 6;

/** "none" = shell ikonu nedal (timeout, chyba) — zůstává obecná ikona. */
type Cached = string | "none";

/** LRU přes pořadí vložení v Map: přístup položku přesune na konec. */
const cache = new Map<string, Cached>();
/** Součet délek řetězců v cache (data URL je base64, délka ≈ bajty). */
let cacheBytes = 0;
const queue: (() => void)[] = [];
let inFlight = 0;

/** Rozjetý požadavek na jednu ikonu. Sdílí ho všechny řádky se stejným klíčem;
 *  když všichni odejdou dřív, než se dostal na řadu, z fronty se vyřadí. */
type Pending = {
  promise: Promise<Cached | null>;
  subscribers: number;
  /** Vyřadí požadavek z fronty; false = už běží (dojede a uloží se). */
  cancel: () => boolean;
};
const pending = new Map<string, Pending>();

function cacheKey(entry: FileEntry, size: IconSize): string {
  const extension = entry.extension ?? "";
  return OWN_ICON.has(extension) ? `path:${entry.path.toLowerCase()}:${size}` : `ext:${extension}:${size}`;
}

function forget(key: string): void {
  const value = cache.get(key);
  if (value === undefined) return;
  cacheBytes -= value.length;
  cache.delete(key);
}

function remember(key: string, value: Cached): void {
  forget(key);
  cache.set(key, value);
  cacheBytes += value.length;
  while (cache.size > CACHE_LIMIT || (cacheBytes > CACHE_BYTES && cache.size > 1)) {
    forget(cache.keys().next().value as string);
  }
}

/** Chyba z backendu s klíčem `error.iconTimeout` — shell to nestihl, příště znovu. */
function isTimeout(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { key?: unknown }).key === "error.iconTimeout";
}

/** Úloha ve frontě s omezeným souběhem. `null` = zrušeno dřív, než začala. */
function runQueued<T>(task: () => Promise<T>): { promise: Promise<T | null>; cancel: () => boolean } {
  let start: (() => void) | null = null;
  let settle: (value: T | null) => void = () => {};
  const promise = new Promise<T | null>((resolve, reject) => {
    settle = resolve;
    start = () => {
      start = null;
      inFlight += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          inFlight -= 1;
          queue.shift()?.();
        });
    };
  });
  const run = start as unknown as () => void;
  if (inFlight < MAX_IN_FLIGHT) run();
  else queue.push(run);

  return {
    promise,
    cancel: () => {
      const index = queue.indexOf(run);
      if (index < 0) return false;
      queue.splice(index, 1);
      settle(null);
      return true;
    },
  };
}

/** Ikona pro řádek. `release` řekne, že ji řádek už nechce (odjel z obrazovky). */
function loadIcon(entry: FileEntry, size: IconSize): { promise: Promise<Cached | null>; release: () => void } {
  return loadShellImage(cacheKey(entry, size), () => invoke<string>("get_file_icon", { path: entry.path, size }));
}

/**
 * Obrázek ze shellu (ikona nebo náhled) přes sdílenou frontu s omezeným
 * souběhem a pamětí. Požadavky se stejným klíčem se slijí do jednoho.
 * Timeout shellu se nepamatuje (vrátí null jako zrušení) — příští zobrazení
 * to zkusí znovu; trvalá chyba se uloží jako "none".
 */
function loadShellImage(
  key: string,
  fetch: () => Promise<string>,
): { promise: Promise<Cached | null>; release: () => void } {
  const hit = cache.get(key);
  if (hit !== undefined) {
    remember(key, hit);
    return { promise: Promise.resolve(hit), release: () => {} };
  }

  let request = pending.get(key);
  if (!request) {
    const queued = runQueued(fetch);
    const created: Pending = {
      subscribers: 0,
      cancel: queued.cancel,
      promise: queued.promise
        .catch((err: unknown): Cached | null => (isTimeout(err) ? null : "none"))
        .then((value) => {
          if (pending.get(key) === created) pending.delete(key);
          if (value !== null) remember(key, value);
          return value;
        }),
    };
    request = created;
    pending.set(key, request);
  }

  const shared = request;
  shared.subscribers += 1;
  let released = false;
  return {
    promise: shared.promise,
    release: () => {
      if (released) return;
      released = true;
      shared.subscribers -= 1;
      if (shared.subscribers === 0 && shared.cancel() && pending.get(key) === shared) pending.delete(key);
    },
  };
}

/* ----------------------------- viditelnost -------------------------------- */

// Jeden sdílený observer pro všechny řádky — tisíc observerů by stálo víc
// než samotné ikony. Okraj 200 px načte i to, co se chystá doscrollovat.
const callbacks = new Map<Element, () => void>();
let observer: IntersectionObserver | null = null;

function observe(element: Element, onVisible: () => void): () => void {
  observer ??= new IntersectionObserver(
    (records) => {
      for (const record of records) {
        if (!record.isIntersecting) continue;
        callbacks.get(record.target)?.();
        callbacks.delete(record.target);
        observer?.unobserve(record.target);
      }
    },
    { rootMargin: "200px" },
  );

  callbacks.set(element, onVisible);
  observer.observe(element);
  return () => {
    callbacks.delete(element);
    observer?.unobserve(element);
  };
}

/**
 * Callback ref, který řekne, až bude prvek poprvé vidět (nebo blízko).
 * Potom už se neodpojuje — jednou načtená ikona zůstává.
 */
export function useVisible(): [(element: Element | null) => void, boolean] {
  const [element, setElement] = useState<Element | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (element === null || visible) return;
    return observe(element, () => setVisible(true));
  }, [element, visible]);

  const ref = useCallback((node: Element | null) => setElement(node), []);
  return [ref, visible];
}

/**
 * Ikona souboru ze shellu, načtená líně až ve chvíli, kdy je řádek vidět.
 * Dokud není (nebo když ji shell nedá), vrací null a volající kreslí obecnou
 * ikonu podle přípony ve stejně velkém boxu — layout neposkočí.
 */
export function useFileIcon(entry: FileEntry, size: IconSize, enabled = true) {
  const [ref, visible] = useVisible();
  const key = cacheKey(entry, size);
  const [url, setUrl] = useState<string | null>(() => {
    const hit = cache.get(key);
    return hit && hit !== "none" ? hit : null;
  });

  useEffect(() => {
    if (!enabled || !visible) return;
    let active = true;
    const request = loadIcon(entry, size);
    void request.promise.then((value) => {
      if (active && value !== null) setUrl(value === "none" ? null : value);
    });
    // Řádek odjel z obrazovky (virtualizace ho odmountovala) — požadavek,
    // který ještě čeká ve frontě, se zruší, ať fronta patří viditelným.
    return () => {
      active = false;
      request.release();
    };
    // entry.path + extension jsou v klíči; celý objekt by efekt pouštěl při každém výpisu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, visible]);

  return { ref, url };
}

/** Kolik pixelů ikony chtít od shellu pro box `css` px — na HiDPI dvojnásob. */
export function iconRequestSize(css: number): IconSize {
  const needed = css * (window.devicePixelRatio || 1);
  return needed <= 32 ? 32 : needed <= 64 ? 64 : 128;
}

/* ------------------------------ náhledy obsahu ------------------------------ */

/** Velikosti náhledů, které umí backend (get_file_thumbnail). */
export type ThumbnailSize = 64 | 128 | 256;

/** Videa a PDF — náhled od Windows thumbnail handleru (snímek, první strana). */
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "mkv", "webm", "avi", "m4v", "wmv"]);
const SHELL_THUMBNAIL_EXTENSIONS = new Set([...VIDEO_EXTENSIONS, "pdf"]);

export function isVideo(entry: FileEntry): boolean {
  return !entry.is_dir && VIDEO_EXTENSIONS.has(entry.extension ?? "");
}

export function canShellThumbnail(entry: FileEntry): boolean {
  return !entry.is_dir && SHELL_THUMBNAIL_EXTENSIONS.has(entry.extension ?? "");
}

/** Nejvýš tolik náhledů ze shellu na složku — zbytek dostane ikonu. */
export const SHELL_THUMBNAIL_LIMIT = 200;

/**
 * Náhled obsahu ze shellu, líně až když je vidět a zrušený, když řádek
 * odjede dřív, než přišel na řadu. Klíč nese čas změny — upravené video
 * dostane nový snímek. `url` null = ještě nedorazil, nebo ho systém nemá.
 * `arrived` = přišel až za běhu (ne z paměti) — volající ho rozsvítí.
 *
 * Výsledek je svázaný s klíčem: když komponenta zůstane a dostane jiný
 * soubor (náhledový sloupec po změně výběru), starý náhled se neukáže.
 */
export function useFileThumbnail(entry: FileEntry, size: ThumbnailSize, enabled = true) {
  const [ref, visible] = useVisible();
  const key = `thumb:${entry.path.toLowerCase()}:${entry.modified}:${size}`;
  const [loaded, setLoaded] = useState<{ key: string; value: Cached } | null>(null);
  const arrived = loaded?.key === key;
  const value: Cached | undefined = arrived ? loaded.value : cache.get(key);

  useEffect(() => {
    if (!enabled || !visible) return;
    // Z paměti se bere přímo při renderu — jen oživit v LRU.
    const hit = cache.get(key);
    if (hit !== undefined) {
      remember(key, hit);
      return;
    }
    let active = true;
    // Surový invoke: chyba musí dorazit s klíčem (timeout se nepamatuje).
    const request = loadShellImage(key, () =>
      tauriInvoke<string>("get_file_thumbnail", { path: entry.path, size }),
    );
    void request.promise.then((result) => {
      if (active && result !== null) setLoaded({ key, value: result });
    });
    return () => {
      active = false;
      request.release();
    };
    // entry.path a modified jsou v klíči.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, visible]);

  return { ref, url: value && value !== "none" ? value : null, failed: value === "none", arrived };
}

/** Kolik pixelů náhledu chtít pro box `css` px (HiDPI dvojnásob). */
export function thumbnailRequestSize(css: number): ThumbnailSize {
  const needed = css * (window.devicePixelRatio || 1);
  return needed <= 64 ? 64 : needed <= 128 ? 128 : 256;
}
