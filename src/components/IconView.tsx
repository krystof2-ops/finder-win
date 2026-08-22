import { LargeEntryIcon } from "./icons";
import { RenameInput } from "./RenameInput";
import { TagDots } from "./TagDots";
import { endDrag, startDrag } from "../lib/dnd";
import type { FileEntry, TagMap } from "../types";

type IconViewProps = {
  entries: FileEntry[];
  selectedPaths: Set<string>;
  cutPaths: Set<string>;
  windowFocused: boolean;
  renamingPath: string | null;
  onRenameSubmit: (entry: FileEntry, name: string) => void;
  onRenameCancel: () => void;
  onSelect: (entry: FileEntry) => void;
  onOpen: (entry: FileEntry) => void;
  onContextMenu?: (entry: FileEntry, x: number, y: number) => void;
  tags: TagMap;
};

export function IconView({
  entries,
  selectedPaths,
  cutPaths,
  windowFocused,
  renamingPath,
  onRenameSubmit,
  onRenameCancel,
  onSelect,
  onOpen,
  onContextMenu,
  tags,
}: IconViewProps) {
  return (
    <div
      className="grid gap-5 p-6"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))" }}
    >
      {entries.map((entry) => {
        const isSelected = selectedPaths.has(entry.path);
        const isRenaming = entry.path === renamingPath;
        const selectedBg = windowFocused
          ? "var(--row-selected)"
          : "var(--row-selected-inactive)";

        return (
          <div
            key={entry.path}
            data-path={entry.path}
            role="button"
            tabIndex={0}
            title={entry.name}
            // Přejmenovaný řádek se netahá — jinak by drag ukradl výběr v inputu.
            draggable={!isRenaming}
            onDragStart={(event) =>
              startDrag(
                { kind: "entry", path: entry.path, name: entry.name, isDir: entry.is_dir },
                event.dataTransfer,
              )
            }
            onDragEnd={endDrag}
            onClick={() => onSelect(entry)}
            onDoubleClick={() => onOpen(entry)}
            onContextMenu={(event) => {
              event.preventDefault();
              onSelect(entry);
              onContextMenu?.(entry, event.clientX, event.clientY);
            }}
            className="flex h-[112px] w-full flex-col items-center gap-1 outline-none"
            style={{ opacity: cutPaths.has(entry.path) ? 0.5 : 1 }}
          >
            <div
              className="rounded-md p-0.5 transition-colors duration-100"
              style={{ backgroundColor: isSelected && !isRenaming ? selectedBg : "transparent" }}
            >
              <LargeEntryIcon entry={entry} />
            </div>

            {isRenaming ? (
              <div className="w-full px-0.5">
                <RenameInput
                  entry={entry}
                  onSubmit={onRenameSubmit}
                  onCancel={onRenameCancel}
                  centered
                />
              </div>
            ) : (
              <span
                className="line-clamp-2 rounded px-1 text-center text-[12px] leading-tight text-primary transition-colors duration-100"
                style={{
                  backgroundColor: isSelected ? "var(--accent-bg)" : "transparent",
                  overflowWrap: "anywhere",
                }}
              >
                {entry.name}
              </span>
            )}

            {!isRenaming && <TagDots colors={tags[entry.path] ?? []} size={8} />}
          </div>
        );
      })}
    </div>
  );
}
