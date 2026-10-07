import { useEffect, useMemo, useRef, useState } from "react";

import { canDropInto, droppedPaths, endDrag, getDrag, isExternalFileDrag, useDrag } from "./dnd";
import type { FileEntry, SelectMods } from "../types";

/** Ctrl+klik přepíná položku, Shift+klik vybírá rozsah od kotvy. */
export function selectMods(event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): SelectMods {
  return { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey };
}

/** Cíl pro pouštění do složky: přesun, s Ctrl kopie. */
export type DropInto = (folder: string, paths: string[], copy: boolean) => void;

/** Handlery přetažení pro řádek složky. Stabilní identita — řádky jsou
 *  memoizované a nové funkce při každém renderu by memo rozbily. */
export type FolderDropHandlers = {
  over: (entry: FileEntry, event: React.DragEvent) => void;
  leave: (entry: FileEntry, event: React.DragEvent) => void;
  drop: (entry: FileEntry, event: React.DragEvent) => void;
};

/**
 * Složky ve výpisu jako cíle přetažení. Sdílí ho Icon, List i Column View —
 * vrací stabilní handlery a cestu složky, nad kterou právě visí tažení
 * (ta dostane rámeček a lehké zvětšení).
 */
export function useFolderDrop(onDropInto: DropInto) {
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const drag = useDrag();
  const onDropRef = useRef(onDropInto);
  onDropRef.current = onDropInto;

  // Tažení skončilo jinde (Escape, pustilo se mimo) — zvýraznění pryč.
  useEffect(() => {
    if (drag === null) setDropTarget(null);
  }, [drag]);

  const handlers = useMemo<FolderDropHandlers>(
    () => ({
      over: (entry, event) => {
        if (!entry.is_dir) return;
        // Soubory z Průzkumníku smí do kterékoli složky.
        if (!isExternalFileDrag(event) && !canDropInto(entry.path, getDrag())) {
          // Složka sama do sebe nebo do svého potomka: výslovně "nelze" (kurzor
          // not-allowed), ať se to nepřebije cílem někde nad řádkem.
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "none";
          return;
        }
        // Bez preventDefault prohlížeč drop nepustí (a ukáže kurzor "nelze").
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = event.ctrlKey ? "copy" : "move";
        setDropTarget(entry.path);
      },
      leave: (entry, event) => {
        // Přechod na vnořený prvek řádku (ikona, název) se za odchod nepočítá.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDropTarget((current) => (current === entry.path ? null : current));
      },
      drop: (entry, event) => {
        const payload = getDrag();
        setDropTarget(null);
        if (!entry.is_dir) return;

        if (isExternalFileDrag(event)) {
          event.preventDefault();
          event.stopPropagation();
          const copy = event.ctrlKey;
          void droppedPaths(event.dataTransfer).then((paths) => {
            if (paths.length > 0) onDropRef.current(entry.path, paths, copy);
          });
          return;
        }

        if (payload === null || payload.kind !== "entry") return;
        if (!canDropInto(entry.path, payload)) return;

        event.preventDefault();
        event.stopPropagation();
        endDrag();
        onDropRef.current(
          entry.path,
          payload.items.map((item) => item.path),
          event.ctrlKey,
        );
      },
    }),
    [],
  );

  return { dropTarget, handlers };
}

/** Props pro řádek složky jako cíl přetažení; u souboru nic. */
export function dropPropsFor(entry: FileEntry, handlers: FolderDropHandlers) {
  if (!entry.is_dir) return {};
  return {
    onDragOver: (event: React.DragEvent) => handlers.over(entry, event),
    onDragLeave: (event: React.DragEvent) => handlers.leave(entry, event),
    onDrop: (event: React.DragEvent) => handlers.drop(entry, event),
  };
}

/**
 * Stabilní obal kolem callbacku z rodiče. Řádky dostávají pořád tutéž funkci,
 * ale ta volá vždy tu nejnovější — jinak by memoizovaný řádek držel starou
 * verzi (třeba Ctrl+klik se zastaralým výběrem).
 */
export function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const ref = useRef(callback);
  ref.current = callback;
  return useMemo(() => (...args: Args) => ref.current(...args), []);
}
