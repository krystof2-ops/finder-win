import { useSyncExternalStore } from "react";

import { getSnapshot, subscribe, type Snapshot } from "./storage";

/**
 * Persistentní nastavení jako React stav. Snapshot je neměnný a novou identitu
 * dostane jen při zápisu, takže useSyncExternalStore nikdy nezacyklí.
 */
export function useStorage(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
