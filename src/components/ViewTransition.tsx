import { useLayoutEffect, useRef } from "react";

import type { NavDirection } from "../navigation";

type ViewTransitionProps = {
  /** Identita obsahu (cesta složky). Změna = nový obsah přijede podle směru. */
  id: string | null;
  /** null = beze změny obsahu (přenačtení, přepnutí view) — nic se nehýbe. */
  direction: NavDirection | null;
  /** Kam obsah po výměně odscrollovat (návrat zpět drží původní místo). */
  scrollTop: number;
  /** Starý obsah čekající na výměnu — vidět je, ale nereaguje. */
  inert?: boolean;
  children: React.ReactNode;
};

/**
 * Jeden obal pro přechody obsahu při navigaci. Samotný pohyb je jen CSS
 * třída (fw-nav-back / -forward / -into / -up / -jump); komponenta se stará
 * o to, aby se přehrál právě jednou při výměně obsahu a aby zoom vycházel ze
 * středu viditelné plochy — obal je vysoký jako celý virtualizovaný výpis,
 * takže výchozí 50 % 50 % by u dlouhé složky posunulo obraz o stovky pixelů.
 */
export function ViewTransition({ id, direction, scrollTop, inert = false, children }: ViewTransitionProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Layout efekt: scroll i počátek transformace musí sedět před prvním
  // vykreslením nového obsahu, jinak by jeden snímek ukázal starou pozici.
  useLayoutEffect(() => {
    const element = ref.current;
    const scroller = element?.parentElement;
    if (!element || !scroller) return;
    scroller.scrollTop = scrollTop;
    element.style.transformOrigin = `50% ${scroller.scrollTop + scroller.clientHeight / 2}px`;
    // Jen při výměně obsahu; scrollTop se čte jednorázově.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div
      // key přemountuje obal, čímž se animace přehraje znovu.
      key={id ?? ""}
      ref={ref}
      inert={inert}
      className={direction ? `fw-nav-${direction}` : undefined}
    >
      {children}
    </div>
  );
}

/** Kostra výpisu, když načítání trvá přes 400 ms — místo prázdné plochy. */
export function Skeleton({ view }: { view: "icon" | "list" }) {
  if (view === "list") {
    return (
      <div className="fw-skeleton flex flex-col pt-6" aria-hidden>
        {Array.from({ length: 14 }, (_, index) => (
          <div key={index} className="flex h-6 items-center gap-3 px-3">
            <span className="w-6" />
            <span className="fw-skeleton-bar h-3.5 w-4" />
            <span className="fw-skeleton-bar h-2.5" style={{ width: `${28 + ((index * 37) % 30)}%` }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="fw-skeleton fw-icon-grid" aria-hidden>
      {Array.from({ length: 18 }, (_, index) => (
        <div key={index} className="flex h-[118px] w-24 flex-col items-center gap-2 pt-1">
          <span className="fw-skeleton-bar h-14 w-14 rounded-[10px]" />
          <span className="fw-skeleton-bar h-2.5" style={{ width: `${50 + ((index * 23) % 40)}%` }} />
        </div>
      ))}
    </div>
  );
}
