/**
 * Ovládání virtualizovaného výpisu zvenčí. Řádky mimo obrazovku nejsou
 * v DOM, takže App se nemůže ptát querySelectorem — posun na položku,
 * gumičkový výběr i rozměry pro klávesnici spočítá výpis sám z geometrie.
 */
export type ViewHandle = {
  /** Doscrolluje tak, aby položka byla vidět (nejmenší možný posun). */
  scrollToPath: (path: string, behavior?: "auto" | "smooth") => void;
  /** Cesty položek, které protíná obdélník v souřadnicích okna. Svislý
   *  rozsah smí přesahovat viditelnou plochu (odscrollované řádky). */
  hitTest: (box: { left: number; top: number; right: number; bottom: number }) => string[];
  /** Kolik položek je v jednom řádku a kolik řádků se vejde na obrazovku. */
  metrics: () => { columns: number; rowsPerPage: number };
};

export type ViewHandleRef = { current: ViewHandle | null };
