import { LargeEntryIcon } from "./icons";
import type { FileEntry } from "../types";

type IconViewProps = {
  entries: FileEntry[];
  selectedPath: string | null;
  windowFocused: boolean;
  onSelect: (entry: FileEntry) => void;
  onOpen: (entry: FileEntry) => void;
};

export function IconView({
  entries,
  selectedPath,
  windowFocused,
  onSelect,
  onOpen,
}: IconViewProps) {
  return (
    <div
      className="grid gap-5 p-6"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))" }}
    >
      {entries.map((entry) => {
        const isSelected = entry.path === selectedPath;
        const selectedBg = windowFocused
          ? "var(--row-selected)"
          : "var(--row-selected-inactive)";

        return (
          <div
            key={entry.path}
            role="button"
            tabIndex={0}
            title={entry.name}
            onClick={() => onSelect(entry)}
            onDoubleClick={() => onOpen(entry)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onOpen(entry);
            }}
            className="flex h-[100px] w-full flex-col items-center gap-1 outline-none"
          >
            <div
              className="rounded-md p-0.5 transition-colors duration-100"
              style={{ backgroundColor: isSelected ? selectedBg : "transparent" }}
            >
              <LargeEntryIcon entry={entry} />
            </div>

            <span
              className="line-clamp-2 rounded px-1 text-center text-[12px] leading-tight text-primary transition-colors duration-100"
              style={{
                backgroundColor: isSelected ? "var(--accent-bg)" : "transparent",
                overflowWrap: "anywhere",
              }}
            >
              {entry.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
