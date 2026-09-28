import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { SmallEntryIcon } from "./icons";
import { formatModified, formatSize } from "../format";
import type { FileEntry } from "../types";

export type ConflictChoice = "replace" | "rename" | "skip";

export type ConflictAnswer = { choice: ConflictChoice; applyToAll: boolean };

export type ConflictRequest = {
  /** Položka, která se kopíruje / přesouvá. */
  source: FileEntry;
  /** Položka stejného jména, která už v cíli je. */
  existing: FileEntry;
  /** Cílová složka — jen pro text dialogu. */
  targetDir: string;
  /** Kolik dalších kolizí čeká po téhle (checkbox Použít pro všechny). */
  remaining: number;
  mode: "copy" | "cut";
};

type ConflictDialogProps = ConflictRequest & {
  onAnswer: (answer: ConflictAnswer) => void;
  /** Zastavit celou operaci — zbytek položek se nezpracuje. */
  onCancel: () => void;
};

function Details({ label, entry }: { label: string; entry: FileEntry }) {
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5" style={{ background: "var(--hover)" }}>
      <SmallEntryIcon entry={entry} />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-secondary">{label}</p>
        <p className="truncate text-[12px] text-primary">
          {[entry.is_dir ? "Složka" : formatSize(entry.size, false), formatModified(entry.modified)]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </div>
  );
}

/**
 * Kolize při vložení nebo přetažení — jako Finder: Nahradit / Ponechat obě /
 * Přeskočit, s údaji o obou položkách. U složky je Nahradit sloučení obsahu
 * (stejně jako v Průzkumníku), nic se nemaže celé.
 */
export function ConflictDialog({
  source,
  existing,
  targetDir,
  remaining,
  mode,
  onAnswer,
  onCancel,
}: ConflictDialogProps) {
  const [applyToAll, setApplyToAll] = useState(false);
  const keepBothRef = useRef<HTMLButtonElement>(null);

  // Složka za soubor (ani naopak) nahradit nejde — backend by to odmítl.
  const typesDiffer = source.is_dir !== existing.is_dir;
  const folder = targetDir.split("\\").filter(Boolean).pop() ?? targetDir;

  // Výchozí fokus na "Ponechat obě" — nejbezpečnější volba pro Enter.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    keepBothRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  const answer = (choice: ConflictChoice) => onAnswer({ choice, applyToAll });

  return createPortal(
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.4)" }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="fw-conflict-title"
        className="flex flex-col gap-3 rounded-xl p-5"
        style={{
          width: 400,
          background: "var(--bg-main)",
          border: "1px solid var(--border)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
        }}
      >
        <p id="fw-conflict-title" className="text-[14px] font-semibold break-words text-primary">
          {source.is_dir ? "Složka" : "Soubor"} „{source.name}“ už ve složce „{folder}“ je.
        </p>
        <p className="text-[12px] text-secondary">
          {mode === "copy" ? "Kopírovanou" : "Přesouvanou"} položku můžete nahradit, ponechat
          obě (nová dostane „(kopie)“), nebo ji přeskočit.
          {source.is_dir && !typesDiffer && " Nahrazení složky sloučí obsah — soubory jen v cíli zůstanou."}
        </p>

        <div className="flex flex-col gap-1.5">
          <Details label={mode === "copy" ? "Kopírovaná" : "Přesouvaná"} entry={source} />
          <Details label="Stávající" entry={existing} />
        </div>

        {typesDiffer && (
          <p className="text-[12px] text-secondary">
            Nahradit nejde — {existing.is_dir ? "složku" : "soubor"} nelze nahradit{" "}
            {source.is_dir ? "složkou" : "souborem"}.
          </p>
        )}

        {remaining > 0 && (
          <label className="flex items-center gap-2 text-[12px] text-primary">
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={(event) => setApplyToAll(event.target.checked)}
            />
            Použít pro všechny (ještě {remaining})
          </label>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="mr-auto rounded-md px-3 py-1.5 text-[13px] text-secondary transition-colors duration-100 hover:bg-hover hover:text-primary"
          >
            Zastavit
          </button>
          <button
            type="button"
            onClick={() => answer("skip")}
            className="rounded-md px-3 py-1.5 text-[13px] text-primary transition-colors duration-100 hover:bg-hover"
          >
            Přeskočit
          </button>
          <button
            ref={keepBothRef}
            type="button"
            onClick={() => answer("rename")}
            className="rounded-md px-3 py-1.5 text-[13px] text-primary transition-colors duration-100 hover:bg-hover"
          >
            Ponechat obě
          </button>
          <button
            type="button"
            disabled={typesDiffer}
            onClick={() => answer("replace")}
            className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-opacity duration-100 hover:opacity-90 disabled:opacity-40"
          >
            {source.is_dir ? "Sloučit" : "Nahradit"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
