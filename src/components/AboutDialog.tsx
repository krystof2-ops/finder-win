import { Dialog } from "./Dialog";
import iconSrc from "../assets/icon.png";
// Verze je jeden zdroj pravdy v package.json — hardcoded string by se rozešel
// hned při prvním bumpu. Vite z JSON importu vytáhne jen tenhle klíč.
import { version } from "../../package.json";

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      label="O aplikaci Finder-Win"
      width={320}
      onClose={onClose}
      actions={[{ label: "Zavřít", onClick: onClose, kind: "primary", autoFocus: true }]}
    >
      <div className="flex flex-col items-center pt-4 text-center">
        <img
          src={iconSrc}
          alt=""
          width={96}
          height={96}
          draggable={false}
          className="shrink-0"
          style={{ width: 96, height: 96 }}
        />

        <h2 className="mt-4 text-[20px] leading-tight font-semibold">Finder-Win</h2>
        <p className="mt-1 text-secondary tabular-nums">Verze {version}</p>

        <p className="mt-4 leading-relaxed">Průzkumník souborů pro Windows s duší macOS Finderu.</p>
        <p className="mt-4 text-[11px] text-secondary">Postaveno s Tauri + React</p>
      </div>
    </Dialog>
  );
}
