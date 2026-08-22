import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Plus, X, type LucideIcon } from "lucide-react";

import iconSrc from "../assets/icon.png";

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
      title={label}
      onClick={onClick}
      className="flex h-3 w-3 items-center justify-center rounded-full"
      style={{ backgroundColor: color }}
    >
      {/* Ikonka se objeví až při hoveru nad celou trojicí (skupina je na rodiči). */}
      <Icon
        size={8}
        strokeWidth={3}
        className="text-black opacity-0 transition-opacity duration-150 group-hover:opacity-60"
      />
    </button>
  );
}

export function TitleBar() {
  const appWindow = getCurrentWindow();

  return (
    <div
      data-tauri-drag-region
      className="surface flex h-[38px] shrink-0 items-center gap-2 bg-window pl-3"
    >
      {/* Ikona musí sama nést drag-region, jinak by na ní okno nešlo chytit. */}
      <img
        data-tauri-drag-region
        src={iconSrc}
        alt=""
        width={16}
        height={16}
        draggable={false}
        className="shrink-0"
        style={{ width: 16, height: 16 }}
      />

      <div className="group flex items-center gap-2">
        <TrafficLight
          color="#ff5f57"
          label="Zavřít"
          Icon={X}
          onClick={() => void appWindow.close()}
        />
        <TrafficLight
          color="#febc2e"
          label="Minimalizovat"
          Icon={Minus}
          onClick={() => void appWindow.minimize()}
        />
        <TrafficLight
          color="#28c840"
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
