import { useEffect, useRef, useState } from "react";

import { isValidFileName, stemLength } from "../fileops";
import type { FileEntry } from "../types";

type RenameInputProps = {
  entry: FileEntry;
  onSubmit: (entry: FileEntry, name: string) => void;
  onCancel: () => void;
  /** row = řádek seznamu a sloupce, icon = název pod ikonou (na střed). */
  variant?: "row" | "icon";
};

export function RenameInput({ entry, onSubmit, onCancel, variant = "row" }: RenameInputProps) {
  const centered = variant === "icon";
  const [value, setValue] = useState(entry.name);
  const inputRef = useRef<HTMLInputElement>(null);

  // ESC odpojí input a tím spustí blur — bez téhle pojistky by se hned po
  // zrušení potvrdila původní hodnota.
  const finished = useRef(false);

  const valid = isValidFileName(value);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    input.focus();
    // Jako ve Finderu: u souboru se vybere jen tělo názvu, přípona zůstane
    // mimo výběr. Složka příponu nemá — "my.folder" se vybere celé.
    input.setSelectionRange(0, entry.is_dir ? entry.name.length : stemLength(entry.name));
  }, [entry.name, entry.is_dir]);

  function submit() {
    if (finished.current) return;
    if (!valid) {
      // Neplatný název se nepotvrzuje; input zůstane v chybovém stavu.
      inputRef.current?.focus();
      return;
    }
    finished.current = true;
    onSubmit(entry, value);
  }

  function cancel() {
    if (finished.current) return;
    finished.current = true;
    onCancel();
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      spellCheck={false}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={submit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          submit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
      className={`min-w-0 rounded-sm px-1 text-[13px] text-primary outline-none ${
        centered ? "w-full text-center" : "flex-1"
      }`}
      style={{
        background: "var(--bg-main)",
        border: `1px solid ${valid ? "var(--accent)" : "var(--danger)"}`,
        userSelect: "text",
      }}
    />
  );
}
