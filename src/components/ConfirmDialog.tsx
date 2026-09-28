import { Dialog } from "./Dialog";

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
 * Potvrzení nevratné akce. U nebezpečné akce má fokus Zrušit a Enter ji
 * nespustí — Enter omylem stisknutý hned po Delete nesmí nic trvale smazat.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const confirm = () => {
    onClose();
    onConfirm();
  };

  return (
    <Dialog
      role="alertdialog"
      labelledBy="fw-confirm-title"
      describedBy="fw-confirm-message"
      onClose={onClose}
      actions={[
        { label: "Zrušit", onClick: onClose, autoFocus: danger },
        danger
          ? { label: confirmLabel, onClick: confirm, kind: "danger" }
          : { label: confirmLabel, onClick: confirm, kind: "primary", autoFocus: true },
      ]}
    >
      <p id="fw-confirm-title" className="text-[14px] font-semibold">
        {title}
      </p>
      <p id="fw-confirm-message" className="leading-relaxed break-words text-secondary">
        {message}
      </p>
    </Dialog>
  );
}
