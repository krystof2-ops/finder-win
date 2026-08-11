import {
  ChevronLeft,
  ChevronRight,
  Columns3,
  LayoutGrid,
  List,
  Moon,
  MoreHorizontal,
  Search,
  Share,
  SlidersHorizontal,
  Sun,
  Tag,
  type LucideIcon,
} from "lucide-react";

import type { Theme, ViewMode } from "../types";

type IconButtonProps = {
  Icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};

function IconButton({ Icon, label, active = false, disabled = false, onClick }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-primary transition-colors duration-100 ${
        active ? "bg-selected" : "hover:bg-hover"
      } disabled:pointer-events-none disabled:opacity-35`}
    >
      <Icon size={16} strokeWidth={1.75} />
    </button>
  );
}

type ToolbarProps = {
  folderName: string;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  theme: Theme;
  onToggleTheme: () => void;
  query: string;
  onQueryChange: (query: string) => void;
};

export function Toolbar({
  folderName,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  viewMode,
  onViewModeChange,
  theme,
  onToggleTheme,
  query,
  onQueryChange,
}: ToolbarProps) {
  return (
    <header
      className="surface flex h-[52px] shrink-0 items-center gap-2 border-b border-line bg-toolbar px-3"
      style={{ backdropFilter: "blur(20px)" }}
    >
      <div className="flex shrink-0 items-center gap-1">
        <IconButton Icon={ChevronLeft} label="Zpět" disabled={!canGoBack} onClick={onBack} />
        <IconButton
          Icon={ChevronRight}
          label="Vpřed"
          disabled={!canGoForward}
          onClick={onForward}
        />
      </div>

      <h1 className="ml-3 truncate text-[15px] font-semibold text-primary">{folderName}</h1>

      <div className="flex-1" />

      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton
          Icon={LayoutGrid}
          label="Zobrazit jako ikony"
          active={viewMode === "icon"}
          onClick={() => onViewModeChange("icon")}
        />
        <IconButton
          Icon={List}
          label="Zobrazit jako seznam"
          active={viewMode === "list"}
          onClick={() => onViewModeChange("list")}
        />
        <IconButton
          Icon={Columns3}
          label="Zobrazit jako sloupce"
          active={viewMode === "column"}
          onClick={() => onViewModeChange("column")}
        />
      </div>

      {/* Zatím jen vizuální prvky toolbaru — chování k nim zadání neurčuje. */}
      <IconButton Icon={SlidersHorizontal} label="Seřadit" />
      <IconButton Icon={Share} label="Sdílet" />
      <IconButton Icon={Tag} label="Štítky" />
      <IconButton Icon={MoreHorizontal} label="Více" />

      <IconButton
        Icon={theme === "dark" ? Sun : Moon}
        label={theme === "dark" ? "Světlý režim" : "Tmavý režim"}
        onClick={onToggleTheme}
      />

      <div className="group flex h-7 w-[180px] shrink-0 items-center gap-1.5 rounded-md bg-hover px-2.5 py-1 transition-[width] duration-150 focus-within:w-[240px]">
        <Search size={14} strokeWidth={2} className="shrink-0 text-secondary" />
        <input
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Hledat"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-primary outline-none placeholder:text-secondary"
        />
      </div>
    </header>
  );
}
