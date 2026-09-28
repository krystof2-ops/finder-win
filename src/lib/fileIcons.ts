import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { FileEntry } from "../types";

/** Velikosti, které umí backend (get_file_icon). */
export type IconSize = 32 | 64 | 128;

/** Přípony s vlastní ikonou v souboru — klíčují se cestou, ne příponou.
 *  Stejná sada jako OWN_ICON_EXTENSIONS v main.rs. */
const OWN_ICON = new Set(["exe", "lnk", "ico", "url", "cpl", "msc", "scr"]);

/** Kolik ikon drží paměť. Víc než 500 různých přípon/exe v jedné relaci nebývá. */
const CACHE_LIMIT = 500;
/** Kolik požadavků na shell běží naráz — ať složka s tisíci .exe nezahltí backend. */
const MAX_IN_FLIGHT = 6;

/** "none" = shell ikonu nedal (timeout, chyba) — zůstává obecná ikona. */
type Cached = string | "none";

/** LRU přes pořadí vložení v Map: přístup položku přesune na konec. */
const cache = new Map<string, Cached>();
const pending = new Map<string, Promise<Cached>>();
const queue: (() => void)[] = [];
let inFlight = 0;

function cacheKey(entry: FileEntry, size: IconSize): string {
  const extension = entry.extension ?? "";
  return OWN_ICON.has(extension) ? `path:${entry.path.toLowerCase()}:${size}` : `ext:${extension}:${size}`;
}

function remember(key: string, value: Cached): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
}

function runQueued<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      inFlight += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          inFlight -= 1;
          queue.shift()?.();
        });
    };
    if (inFlight < MAX_IN_FLIGHT) start();
    else queue.push(start);
  });
}

function loadIcon(entry: FileEntry, size: IconSize): Promise<Cached> {
  const key = cacheKey(entry, size);
  const hit = cache.get(key);
  if (hit !== undefined) {
    remember(key, hit);
    return Promise.resolve(hit);
  }

  const running = pending.get(key);
  if (running) return running;

  const request = runQueued(() => invoke<string>("get_file_icon", { path: entry.path, size }))
    .catch((): Cached => "none")
    .then((value) => {
      remember(key, value);
      pending.delete(key);
      return value;
    });
  pending.set(key, request);
  return request;
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
    void loadIcon(entry, size).then((value) => {
      if (active) setUrl(value === "none" ? null : value);
    });
    return () => {
      active = false;
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
