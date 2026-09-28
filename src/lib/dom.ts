/**
 * Cíl události je textové pole. Používá se na dvou místech se stejným
 * důvodem: zkratky se nesmí spouštět, když uživatel píše, a pravý klik
 * musí v poli nechat projít menu webview — je to jediná cesta, jak se
 * myší dostat k vložení ze schránky.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (element === null) return false;
  return (
    element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable
  );
}
