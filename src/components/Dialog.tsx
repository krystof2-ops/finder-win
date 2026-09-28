import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type DialogAction = {
  label: string;
  onClick: () => void;
  /** primary = akcent a Enter; danger = červené, Enter ho NIKDY nespustí. */
  kind?: "primary" | "danger" | "secondary";
  disabled?: boolean;
  /** Tlačítko s fokusem po otevření (jinak dostane fokus celý dialog). */
  autoFocus?: boolean;
};

type DialogProps = {
  /** Přístupný název dialogu, když nemá viditelný nadpis s id. */
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  /** alertdialog = potvrzení / varování, dialog = informace. */
  role?: "dialog" | "alertdialog";
  width?: number;
  onClose: () => void;
  /** Tlačítka vpravo, v pořadí zleva doprava. */
  actions: DialogAction[];
  /** Tlačítko vlevo (Zastavit u kolize). */
  leftAction?: DialogAction;
  /** Klik na podklad zavře (u rozhodovacích dialogů ne). */
  closeOnOverlay?: boolean;
  children: React.ReactNode;
};

function actionClass(kind: DialogAction["kind"]): string {
  if (kind === "primary") return "fw-button is-primary";
  if (kind === "danger") return "fw-button is-danger";
  return "fw-button";
}

/**
 * Jeden vzhled a jedno chování pro všechny dialogy (Vlastnosti, O aplikaci,
 * Kolize, Potvrzení): 13px text, tlačítka 28 px, Enter = primární akce,
 * Escape = zavřít, podklad s rozmazáním, nástup scale .96 → 1 za 160 ms.
 */
export function Dialog({
  label,
  labelledBy,
  describedBy,
  role = "dialog",
  width = 360,
  onClose,
  actions,
  leftAction,
  closeOnOverlay = true,
  children,
}: DialogProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // Fokus dovnitř a po zavření zpátky, odkud přišel.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const auto = cardRef.current?.querySelector<HTMLElement>("[data-autofocus]");
    (auto ?? cardRef.current)?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key === "Enter") {
        // Na tlačítku Enter kliká na to tlačítko (nativně) — nepřebíjet.
        if (event.target instanceof HTMLButtonElement) return;
        const primary = actionsRef.current.find((action) => action.kind === "primary");
        if (primary && !primary.disabled) {
          event.preventDefault();
          event.stopPropagation();
          primary.onClick();
        }
      }
    }
    // Capture fáze — klávesy patří dialogu, ne globálním zkratkám pod ním.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const renderAction = (action: DialogAction) => (
    <button
      key={action.label}
      type="button"
      disabled={action.disabled}
      data-autofocus={action.autoFocus || undefined}
      onClick={action.onClick}
      className={actionClass(action.kind)}
    >
      {action.label}
    </button>
  );

  return createPortal(
    <div
      onMouseDown={closeOnOverlay ? onClose : undefined}
      className="fw-dialog-overlay fixed inset-0 z-[65] flex items-center justify-center"
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        role={role}
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onMouseDown={(event) => event.stopPropagation()}
        className="fw-dialog flex flex-col gap-3 p-5 text-primary outline-none"
        style={{ width }}
      >
        {children}

        {(actions.length > 0 || leftAction) && (
          <div className="flex items-center justify-end gap-2 pt-1">
            {leftAction && <div className="mr-auto">{renderAction(leftAction)}</div>}
            {actions.map(renderAction)}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
