import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import iconSrc from "../assets/icon.png";
// Verze je jeden zdroj pravdy v package.json — hardcoded string by se rozešel
// hned při prvním bumpu. Vite z JSON importu vytáhne jen tenhle klíč.
import { version } from "../../package.json";

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cardRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    // Capture fáze, ať se ESC nedostane ke globálním zkratkám v App.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return createPortal(
    <div
      onMouseDown={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(6px)" }}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-label="O aplikaci Finder-Win"
        onMouseDown={(event) => event.stopPropagation()}
        className="surface relative flex flex-col items-center px-8 pt-10 pb-6 outline-none"
        style={{
          width: 340,
          height: 420,
          background: "var(--bg-main)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          boxShadow: "0 24px 64px rgba(0,0,0,0.45)",
        }}
      >
        <button
          type="button"
          aria-label="Zavřít"
          onClick={onClose}
          className="absolute top-3 right-3 flex h-6 w-6 items-center justify-center rounded-full text-primary transition-colors duration-100 hover:bg-hover"
        >
          <X size={14} strokeWidth={2} />
        </button>

        <img
          src={iconSrc}
          alt=""
          width={96}
          height={96}
          draggable={false}
          className="shrink-0"
          style={{ width: 96, height: 96 }}
        />

        <h2 className="mt-5 text-[22px] leading-tight font-semibold text-primary">Finder-Win</h2>

        <p className="mt-1 text-[13px] text-secondary">Verze {version}</p>

        <p className="mt-4 text-center text-[13px] leading-relaxed text-primary">
          Průzkumník souborů pro Windows s duší macOS Finderu.
        </p>

        <p className="mt-auto text-[11px] text-secondary">Postaveno s Tauri + React</p>
      </div>
    </div>,
    document.body,
  );
}
