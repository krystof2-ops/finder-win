import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { LargeEntryIcon } from "./icons";
import { getFileProperties, parentPath } from "../fileops";
import { formatModified, formatSize, kindLabel } from "../format";
import type { FileEntry, FileProperties } from "../types";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-secondary">{label}</span>
      <span className="min-w-0 text-right break-words text-primary">{value || "—"}</span>
    </div>
  );
}

type PropertiesDialogProps = {
  entry: FileEntry;
  onClose: () => void;
};

export function PropertiesDialog({ entry, onClose }: PropertiesDialogProps) {
  const [properties, setProperties] = useState<FileProperties | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getFileProperties(entry.path)
      .then((result) => {
        if (!cancelled) setProperties(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [entry.path]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const attributes = properties
    ? [properties.is_readonly ? "jen pro čtení" : null, properties.is_hidden ? "skrytý" : null]
        .filter(Boolean)
        .join(", ") || "žádné"
    : "";

  return createPortal(
    <div
      onMouseDown={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.4)" }}
    >
      <div
        onMouseDown={(event) => event.stopPropagation()}
        className="flex flex-col gap-3 rounded-xl p-5"
        style={{
          width: 340,
          background: "var(--bg-main)",
          border: "1px solid var(--border)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
        }}
      >
        <div className="flex justify-center">
          <LargeEntryIcon entry={entry} />
        </div>

        <p className="text-center text-[14px] font-semibold break-words text-primary">
          {entry.name}
        </p>

        <div className="flex flex-col border-t border-line pt-2 text-[12px]">
          {error !== null ? (
            <p className="py-2 text-center text-secondary">Vlastnosti se nepodařilo načíst.</p>
          ) : properties === null ? (
            <p className="py-2 text-center text-secondary">Načítám…</p>
          ) : (
            <>
              <Row label="Typ" value={kindLabel(entry)} />
              <Row label="Velikost" value={formatSize(properties.size, properties.is_dir)} />
              <Row label="Vytvořeno" value={formatModified(properties.created)} />
              <Row label="Změněno" value={formatModified(properties.modified)} />
              <Row label="Otevřeno" value={formatModified(properties.accessed)} />
              <Row label="Kde" value={parentPath(entry.path) ?? entry.path} />
              <Row label="Atributy" value={attributes} />
            </>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-md bg-accent py-1.5 text-[13px] font-medium text-white transition-opacity duration-100 hover:opacity-90"
        >
          Zavřít
        </button>
      </div>
    </div>,
    document.body,
  );
}
