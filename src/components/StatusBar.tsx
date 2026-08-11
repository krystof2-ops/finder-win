import { breadcrumbs, formatFreeSpace, formatItemCount } from "../format";

type StatusBarProps = {
  path: string | null;
  itemCount: number;
  freeSpace: number | null;
  onNavigate: (path: string) => void;
};

export function StatusBar({ path, itemCount, freeSpace, onNavigate }: StatusBarProps) {
  const crumbs = path ? breadcrumbs(path) : [];

  return (
    <footer className="surface flex h-6 shrink-0 items-center justify-between gap-4 border-t border-line bg-toolbar px-3 text-[11px] text-secondary">
      <div className="flex min-w-0 items-center">
        {crumbs.map((crumb, index) => (
          <span key={crumb.path} className="flex min-w-0 items-center">
            {index > 0 && <span className="px-1 opacity-60">›</span>}
            <button
              type="button"
              onClick={() => onNavigate(crumb.path)}
              className="truncate rounded px-0.5 transition-colors duration-100 hover:text-primary"
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </div>

      <div className="shrink-0 whitespace-nowrap">
        {path && formatItemCount(itemCount)}
        {path && freeSpace !== null && `, ${formatFreeSpace(freeSpace)}`}
      </div>
    </footer>
  );
}
