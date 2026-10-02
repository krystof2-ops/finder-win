import { useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import { LargeEntryIcon } from "./icons";
import { cancelFolderStats, folderStats, getFileProperties, parentPath } from "../fileops";
import { formatItemCount, formatModified, formatSize, kindLabel } from "../format";
import { t as translate, useT } from "../i18n";
import { tagsOf } from "../lib/storage";
import { TAG_HEX, tagLabel } from "../lib/tags";
import { useStorage } from "../lib/useStorage";
import type { FileEntry, FileProperties, FolderStats } from "../types";

/** Identita výpočtu velikosti — napříč dialogy, proto modulová. */
let nextStatsId = 1;

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-secondary">{label}</span>
      <span className="min-w-0 text-right break-words text-primary">{value || "—"}</span>
    </div>
  );
}

/** "12,4 MB · 1 234 položek", během výpočtu s "…", nad stropem "více než". */
function folderSummary(stats: FolderStats): string {
  const count = stats.files + stats.folders;
  const atLeast = (value: string) =>
    stats.truncated ? translate("props.moreThan", { value }) : value;
  const suffix = stats.done ? "" : " …";
  return `${atLeast(formatSize(stats.bytes, false))} · ${atLeast(formatItemCount(count))}${suffix}`;
}

type PropertiesDialogProps = {
  entry: FileEntry;
  onClose: () => void;
};

export function PropertiesDialog({ entry, onClose }: PropertiesDialogProps) {
  const t = useT();
  const { tags } = useStorage();
  const [properties, setProperties] = useState<FileProperties | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<FolderStats | null>(null);

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

  // Velikost složky se počítá na pozadí a naskakuje průběžně. Zavření
  // dialogu výpočet zastaví — jinak by na C:\Windows běžel dál naprázdno.
  useEffect(() => {
    if (!entry.is_dir) return;

    const requestId = nextStatsId++;
    let active = true;
    setStats(null);

    folderStats(entry.path, requestId, (progress) => {
      if (active) setStats(progress);
    })
      .then((result) => {
        if (active) setStats(result);
      })
      .catch(() => undefined);

    return () => {
      active = false;
      void cancelFolderStats(requestId).catch(() => undefined);
    };
  }, [entry.path, entry.is_dir]);

  const attributes = properties
    ? [properties.is_readonly ? t("props.readOnly") : null, properties.is_hidden ? t("props.hidden") : null]
        .filter(Boolean)
        .join(", ") || t("props.none")
    : "";

  const colors = tagsOf(tags, entry.path);

  const size = entry.is_dir
    ? stats === null
      ? t("props.calculating")
      : folderSummary(stats)
    : properties
      ? formatSize(properties.size, false)
      : "";

  return (
    <Dialog
      label={t("props.title", { name: entry.name })}
      width={340}
      onClose={onClose}
      actions={[{ label: t("common.close"), onClick: onClose, kind: "primary", autoFocus: true }]}
    >
      <div className="flex justify-center">
        <LargeEntryIcon entry={entry} />
      </div>

      <p className="text-center text-[14px] font-semibold break-words text-primary">
        {entry.name}
      </p>

      <div className="flex flex-col border-t border-line pt-2 text-[12px]">
        {error !== null ? (
          <p className="py-2 text-center text-secondary">{t("props.loadFailed")}</p>
        ) : properties === null ? (
          <p className="py-2 text-center text-secondary">{t("common.loading")}</p>
        ) : (
          <>
            <Row label={t("props.type")} value={kindLabel(entry)} />
            <Row label={t("props.size")} value={size} />
            <Row label={t("props.created")} value={formatModified(properties.created)} />
            <Row label={t("props.modified")} value={formatModified(properties.modified)} />
            <Row label={t("props.accessed")} value={formatModified(properties.accessed)} />
            <Row label={t("props.where")} value={parentPath(entry.path) ?? entry.path} />
            <Row label={t("props.attributes")} value={attributes} />
            <Row
              label={t("props.tags")}
              value={
                colors.length === 0 ? (
                  t("props.none")
                ) : (
                  <span className="inline-flex flex-wrap justify-end gap-x-2 gap-y-0.5">
                    {colors.map((color) => (
                      <span key={color} className="inline-flex items-center gap-1">
                        <span
                          aria-hidden
                          className="inline-block rounded-full"
                          style={{ width: 8, height: 8, background: TAG_HEX[color] }}
                        />
                        {tagLabel(color)}
                      </span>
                    ))}
                  </span>
                )
              }
            />
          </>
        )}
      </div>
    </Dialog>
  );
}
