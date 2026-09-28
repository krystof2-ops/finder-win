import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type ConfirmRequest = {
  title: string;
  message: string;
  /** Text potvrzovacího tlačítka ("Smazat trvale", "Vymazat"). */
  confirmLabel: string;
  /** Nevratná akce — tlačítko je červené. */
  danger?: boolean;
  onConfirm: () => void;
};

type ConfirmDialogProps = ConfirmRequest & {
  onClose: () => void;
};

/**
 * Potvrzení nevratné akce. Výchozí fokus má Zrušit — Enter omylem stisknutý
 * hned po Delete nesmí nic trvale smazat.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return createPortal(
    <div
      onMouseDown={onClose}
      className="fixed inset-0 z-[65] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.4)" }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="fw-confirm-title"
        aria-describedby="fw-confirm-message"
        onMouseDown={(event) => event.stopPropagation()}
        className="flex flex-col gap-3 rounded-xl p-5"
        style={{
          width: 360,
          background: "var(--bg-main)",
          border: "1px solid var(--border)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
        }}
      >
        <p id="fw-confirm-title" className="text-[14px] font-semibold text-primary">
          {title}
        </p>
        <p id="fw-confirm-message" className="text-[12px] leading-relaxed break-words text-secondary">
          {message}
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[13px] text-primary transition-colors duration-100 hover:bg-hover"
          >
            Zrušit
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onConfirm();
            }}
            className="rounded-md px-3 py-1.5 text-[13px] font-medium text-white transition-opacity duration-100 hover:opacity-90"
            style={{ background: danger ? "#ff3b30" : "var(--accent)" }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
