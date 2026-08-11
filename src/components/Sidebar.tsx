import { sidebarIcon, sidebarIconColor } from "./icons";
import type { FavoriteSection } from "../types";

type SidebarProps = {
  sections: FavoriteSection[];
  currentPath: string | null;
  windowFocused: boolean;
  onNavigate: (path: string) => void;
};

/**
 * "iCloud" má v Finderu i v nadpisu malé úvodní i, což by `text-transform`
 * zahodilo — proto se velká písmena dělají v JS a ne v CSS.
 */
function sectionHeading(label: string): string {
  return label === "iCloud" ? "iCLOUD" : label.toUpperCase();
}

export function Sidebar({ sections, currentPath, windowFocused, onNavigate }: SidebarProps) {
  return (
    <aside
      className="surface flex w-[220px] shrink-0 flex-col overflow-y-auto bg-sidebar pt-2"
      style={{ backdropFilter: "blur(20px)" }}
    >
      {sections.map((section) => (
        <div key={section.label}>
          <div
            className="px-4 pt-1.5 pb-1 text-[11px] font-semibold text-section"
            style={{ letterSpacing: "0.5px" }}
          >
            {sectionHeading(section.label)}
          </div>

          <nav className="flex flex-col">
            {section.items.map((item) => {
              const Icon = sidebarIcon(item.icon_name);
              const isActive = item.path === currentPath;

              return (
                <button
                  key={`${section.label}/${item.path}`}
                  type="button"
                  title={item.path}
                  onClick={() => onNavigate(item.path)}
                  className={`mx-1.5 flex h-[26px] items-center gap-2 rounded-md px-3 py-1 text-left text-[13px] text-primary transition-colors duration-100 ${
                    isActive
                      ? windowFocused
                        ? "bg-selected"
                        : "bg-selected-inactive"
                      : "hover:bg-hover"
                  }`}
                >
                  <Icon
                    size={16}
                    strokeWidth={1.75}
                    className="shrink-0"
                    color={sidebarIconColor(section.label, item.label)}
                  />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      ))}
    </aside>
  );
}
