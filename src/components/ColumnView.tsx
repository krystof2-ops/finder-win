import { Columns3 } from "lucide-react";

/** Zástupný obsah — sloupcové zobrazení zatím není implementované. */
export function ColumnView() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-secondary">
      <Columns3 size={28} strokeWidth={1.5} />
      <p className="text-[13px]">Column view — brzy</p>
    </div>
  );
}
