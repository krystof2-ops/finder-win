import { useState } from "react";

import { Dialog } from "./Dialog";
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
    <div className="flex items-center gap-2 rounded-md bg-hover px-2 py-1.5">
      <SmallEntryIcon entry={entry} />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-secondary">{label}</p>
        <p className="truncate text-[12px] tabular-nums">
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
 * Přeskočit, s údaji o obou položkách. U složky je Nahradit sloučení obsahu.
 * Primární (Enter) je Ponechat obě — jediná volba, která nic nepřepíše.
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

  // Složka za soubor (ani naopak) nahradit nejde — backend by to odmítl.
  const typesDiffer = source.is_dir !== existing.is_dir;
  const folder = targetDir.split("\\").filter(Boolean).pop() ?? targetDir;
  const answer = (choice: ConflictChoice) => onAnswer({ choice, applyToAll });

  return (
    <Dialog
      role="alertdialog"
      labelledBy="fw-conflict-title"
      width={400}
      closeOnOverlay={false}
      onClose={onCancel}
      leftAction={{ label: "Zastavit", onClick: onCancel }}
      actions={[
        { label: "Přeskočit", onClick: () => answer("skip") },
        {
          label: source.is_dir ? "Sloučit" : "Nahradit",
          onClick: () => answer("replace"),
          disabled: typesDiffer,
        },
        { label: "Ponechat obě", onClick: () => answer("rename"), kind: "primary", autoFocus: true },
      ]}
    >
      <p id="fw-conflict-title" className="text-[14px] font-semibold break-words">
        {source.is_dir ? "Složka" : "Soubor"} „{source.name}“ už ve složce „{folder}“ je.
      </p>
      <p className="text-secondary">
        {mode === "copy" ? "Kopírovanou" : "Přesouvanou"} položku můžete nahradit, ponechat obě
        (nová dostane „(kopie)“), nebo ji přeskočit.
        {source.is_dir && !typesDiffer && " Sloučení složek ponechá i soubory, které jsou jen v cíli."}
      </p>

      <div className="flex flex-col gap-1.5">
        <Details label={mode === "copy" ? "Kopírovaná" : "Přesouvaná"} entry={source} />
        <Details label="Stávající" entry={existing} />
      </div>

      {typesDiffer && (
        <p className="text-secondary">
          Nahradit nejde — {existing.is_dir ? "složku" : "soubor"} nelze nahradit{" "}
          {source.is_dir ? "složkou" : "souborem"}.
        </p>
      )}

      {remaining > 0 && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={applyToAll}
            onChange={(event) => setApplyToAll(event.target.checked)}
          />
          Použít pro všechny (ještě {remaining})
        </label>
      )}
    </Dialog>
  );
}
