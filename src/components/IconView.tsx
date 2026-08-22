import { LargeEntryIcon } from "./icons";
import { RenameInput } from "./RenameInput";
import { TagDots } from "./TagDots";
import { endDrag, startDrag } from "../lib/dnd";

/**
 * Restartuje "pop" animaci. Pouhé přidání třídy nestačí — když už na prvku
 * visí, prohlížeč animaci nepřehraje znovu, dokud si nevynutíme reflow.
 */
function playPop(host: HTMLElement): void {
  const inner = host.querySelector<HTMLElement>(".fw-card-inner");
  if (inner === null) return;

  inner.classList.remove("fw-pop");
  void inner.offsetWidth;
  inner.classList.add("fw-pop");
}
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
        // Během přejmenování výběr nekreslíme — podbarvení pod inputem ruší.
        const showSelection = isSelected && !isRenaming;
        // Jedno místo pro odstín výběru: ikona i jméno musí vyjít stejně.
        const selectionBg = showSelection
          ? windowFocused
            ? "var(--icon-selection)"
            : "var(--row-selected-inactive)"
          : "transparent";

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
            onClick={(event) => {
              playPop(event.currentTarget);
              onSelect(entry);
            }}
            onDoubleClick={() => onOpen(entry)}
            onContextMenu={(event) => {
              event.preventDefault();
              onSelect(entry);
              onContextMenu?.(entry, event.clientX, event.clientY);
            }}
            className="fw-card flex h-[118px] w-full flex-col items-center gap-1 outline-none"
            style={{ opacity: cutPaths.has(entry.path) ? 0.5 : 1 }}
          >
            {/* Dlaždice pod ikonou. Stejný odstín jako pilulka se jménem níž —
                obojí bere selectionBg, takže se to nemůže rozejít. */}
            <div
              className="fw-card-inner rounded-[10px] p-1"
              style={{ backgroundColor: selectionBg }}
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
                className="line-clamp-2 rounded-[5px] px-1.5 text-center text-[12px] text-primary leading-tight transition-colors duration-100"
                style={{
                  backgroundColor: selectionBg,
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
