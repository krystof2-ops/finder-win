import { Dialog } from "./Dialog";
import { useT } from "../i18n";
import iconSrc from "../assets/icon.png";
// Verze je jeden zdroj pravdy v package.json — hardcoded string by se rozešel
// hned při prvním bumpu. Vite z JSON importu vytáhne jen tenhle klíč.
import { version } from "../../package.json";

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const t = useT();

  return (
    <Dialog
      label={t("toolbar.about")}
      width={320}
      onClose={onClose}
      actions={[{ label: t("common.close"), onClick: onClose, kind: "primary", autoFocus: true }]}
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
        <p className="mt-1 text-secondary tabular-nums">{t("about.version", { version })}</p>

        <p className="mt-4 leading-relaxed">{t("about.tagline")}</p>
        <p className="mt-4 text-[11px] text-secondary">{t("about.builtWith")}</p>
      </div>
    </Dialog>
  );
}
