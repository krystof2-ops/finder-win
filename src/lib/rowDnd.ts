import { useEffect, useState } from "react";

import { canDropInto, endDrag, getDrag, useDrag } from "./dnd";
import type { FileEntry, SelectMods } from "../types";

/** Ctrl+klik přepíná položku, Shift+klik vybírá rozsah od kotvy. */
export function selectMods(event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): SelectMods {
  return { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey };
}

/** Cíl pro pouštění do složky: přesun, s Ctrl kopie. */
export type DropInto = (folder: string, paths: string[], copy: boolean) => void;

/**
 * Složky ve výpisu jako cíle přetažení. Sdílí ho Icon, List i Column View —
 * vrací props pro řádek a cestu složky, nad kterou právě visí tažení
 * (ta se zvýrazní rámečkem).
 */
export function useFolderDrop(onDropInto: DropInto) {
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const drag = useDrag();

  // Tažení skončilo jinde (Escape, pustilo se mimo) — zvýraznění pryč.
  useEffect(() => {
    if (drag === null) setDropTarget(null);
  }, [drag]);

  function dropProps(entry: FileEntry) {
    if (!entry.is_dir) return {};

    return {
      onDragOver: (event: React.DragEvent) => {
        if (!canDropInto(entry.path, getDrag())) return;
        // Bez preventDefault prohlížeč drop nepustí.
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = event.ctrlKey ? "copy" : "move";
        setDropTarget(entry.path);
      },
      onDragLeave: (event: React.DragEvent) => {
        // Přechod na vnořený prvek řádku (ikona, název) se za odchod nepočítá.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDropTarget((current) => (current === entry.path ? null : current));
      },
      onDrop: (event: React.DragEvent) => {
        const payload = getDrag();
        setDropTarget(null);
        if (payload === null || payload.kind !== "entry" || !canDropInto(entry.path, payload)) return;

        event.preventDefault();
        event.stopPropagation();
        endDrag();
        onDropInto(
          entry.path,
          payload.items.map((item) => item.path),
          event.ctrlKey,
        );
      },
    };
  }

  return { dropTarget, dropProps };
}

/** Rámeček složky, nad kterou visí tažení. */
export const DROP_TARGET_STYLE: React.CSSProperties = {
  boxShadow: "inset 0 0 0 2px var(--accent)",
  borderRadius: 6,
};
