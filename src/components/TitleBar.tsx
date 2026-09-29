import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Plus, X, type LucideIcon } from "lucide-react";

type TrafficLightProps = {
  color: string;
  label: string;
  Icon: LucideIcon;
  onClick: () => void;
};

function TrafficLight({ color, label, Icon, onClick }: TrafficLightProps) {
  return (
    <button
      type="button"
      aria-label={label}
      data-tooltip={label}
      onClick={onClick}
      className="fw-traffic flex h-3 w-3 items-center justify-center rounded-full"
      style={{ backgroundColor: color }}
    >
      {/* Ikonka se objeví až při hoveru nad celou trojicí (skupina je na rodiči). */}
      <Icon
        size={8}
        strokeWidth={3}
        className="text-black fw-t-opacity opacity-0 group-hover:opacity-60"
      />
    </button>
  );
}

export function TitleBar() {
  const appWindow = getCurrentWindow();

  return (
    <div
      data-tauri-drag-region
      className="flex h-[38px] shrink-0 items-center gap-2 bg-window pl-[13px]"
    >
      <div className="group flex items-center gap-2">
        <TrafficLight
          color="var(--traffic-close)"
          label="Zavřít"
          Icon={X}
          onClick={() => void appWindow.close()}
        />
        <TrafficLight
          color="var(--traffic-minimize)"
          label="Minimalizovat"
          Icon={Minus}
          onClick={() => void appWindow.minimize()}
        />
        <TrafficLight
          color="var(--traffic-maximize)"
          label="Maximalizovat"
          Icon={Plus}
          onClick={() => void appWindow.toggleMaximize()}
        />
      </div>

      {/* Zbytek lišty je jedno dlouhé táhlo. */}
      <div data-tauri-drag-region className="h-full flex-1" />
    </div>
  );
}
