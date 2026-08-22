import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { Music, X } from "lucide-react";

import { SmallEntryIcon, fileVisual } from "./icons";
import { formatSize, kindLabel, previewKind, type PreviewKind } from "../format";
import type { FileEntry } from "../types";

const MAX_PREVIEW_BYTES = 1_048_576;

/** Zoom z ikony. Zavření je o kus rychlejší, ať to neubíjí. */
const OPEN_MS = 320;
const CLOSE_MS = 280;
/** Když se ikona nenajde, jede se jen jemný zoom uprostřed. */
const FALLBACK_MS = 200;
const OVERLAY_IN_MS = 200;

type Origin = { x: number; y: number };

/**
 * Posun ze středu okna na střed ikony dané položky. Řádky ve všech views
 * nesou data-path, takže stačí jeden dotaz do DOMu; modal je sice portál,
 * ale zdrojový řádek je v tu chvíli pořád vykreslený.
 *
 * Vrací null, když položka není v DOMu (otevřeno klávesnicí nad odscrollovaným
 * řádkem) — volající pak spadne na zoom uprostřed okna.
 */
function originFor(path: string): Origin | null {
  const element = document.querySelector(`[data-path="${CSS.escape(path)}"]`);
  if (element === null) return null;

  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;

  return {
    x: rect.left + rect.width / 2 - window.innerWidth / 2,
    y: rect.top + rect.height / 2 - window.innerHeight / 2,
  };
}

/* ------------------------------ textový obsah ------------------------------ */

type TextState = { loading: boolean; content: string | null; error: string | null };

function useTextContent(entry: FileEntry, kind: PreviewKind): TextState {
  const [state, setState] = useState<TextState>({ loading: false, content: null, error: null });
  const needsText = kind === "text" || kind === "markdown";

  useEffect(() => {
    if (!needsText) {
      setState({ loading: false, content: null, error: null });
      return;
    }

    let cancelled = false;
    setState({ loading: true, content: null, error: null });

    invoke<string>("read_text_file", { path: entry.path, maxBytes: MAX_PREVIEW_BYTES })
      .then((content) => {
        if (!cancelled) setState({ loading: false, content, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ loading: false, content: null, error: String(err) });
      });

    return () => {
      cancelled = true;
    };
  }, [entry.path, needsText]);

  return state;
}

/* -------------------------------- náhledy --------------------------------- */

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center">
      {children}
    </div>
  );
}

/** Fallback pro typy bez náhledu i pro soubory, které se nepodařilo přečíst. */
function Unsupported({ entry, message }: { entry: FileEntry; message: string }) {
  const { Icon, tint } = fileVisual(entry);

  return (
    <Centered>
      <Icon size={128} color={tint} strokeWidth={1} />
      <p className="text-[15px] font-semibold break-all text-primary">{entry.name}</p>
      <p className="text-[12px] text-secondary">
        {formatSize(entry.size, entry.is_dir)} · {kindLabel(entry)}
      </p>
      <p className="max-w-[420px] text-[12px] text-secondary">{message}</p>
    </Centered>
  );
}

function TextPreview({ entry, state }: { entry: FileEntry; state: TextState }) {
  if (state.loading) {
    return <Centered><p className="text-[13px] text-secondary">Načítám…</p></Centered>;
  }
  if (state.error !== null || state.content === null) {
    return <Unsupported entry={entry} message="Nelze načíst obsah." />;
  }

  return (
    <pre
      className="h-full w-full overflow-auto p-5 text-primary"
      style={{
        fontFamily: 'Consolas, Monaco, "Courier New", monospace',
        fontSize: "12px",
        lineHeight: 1.5,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        userSelect: "text",
      }}
    >
      {state.content}
    </pre>
  );
}

function MarkdownPreview({ entry, state }: { entry: FileEntry; state: TextState }) {
  // Markdown ze souboru je nedůvěryhodný vstup a webview má přístup k Tauri IPC,
  // takže výstup marked musí projít sanitizací, než se vloží jako HTML.
  const html = useMemo(() => {
    if (state.content === null) return "";
    return DOMPurify.sanitize(marked.parse(state.content, { async: false }) as string);
  }, [state.content]);

  if (state.loading) {
    return <Centered><p className="text-[13px] text-secondary">Načítám…</p></Centered>;
  }
  if (state.error !== null || state.content === null) {
    return <Unsupported entry={entry} message="Nelze načíst obsah." />;
  }

  return (
    <div
      className="ql-markdown h-full w-full overflow-auto p-6 text-primary"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function PreviewBody({ entry, state }: { entry: FileEntry; state: TextState }) {
  const kind = previewKind(entry);
  const source = convertFileSrc(entry.path);

  switch (kind) {
    case "image":
      return (
        <div className="flex h-full w-full items-center justify-center p-4">
          <img
            src={source}
            alt={entry.name}
            className="max-h-full max-w-full"
            style={{ objectFit: "contain" }}
          />
        </div>
      );

    case "pdf":
      return <iframe src={source} title={entry.name} width="100%" height="100%" style={{ border: 0 }} />;

    case "video":
      return (
        <div className="flex h-full w-full items-center justify-center bg-black/90">
          <video
            src={source}
            controls
            autoPlay
            muted
            style={{ maxWidth: "100%", maxHeight: "100%" }}
          />
        </div>
      );

    case "audio":
      return (
        <Centered>
          <Music size={96} strokeWidth={1.25} style={{ color: "var(--accent)" }} />
          <p className="text-[15px] font-semibold break-all text-primary">{entry.name}</p>
          <audio src={source} controls autoPlay style={{ width: "80%" }} />
        </Centered>
      );

    case "markdown":
      return <MarkdownPreview entry={entry} state={state} />;

    case "text":
      return <TextPreview entry={entry} state={state} />;

    default:
      return (
        <Unsupported
          entry={entry}
          message="Náhled není k dispozici — klikni Otevřít nahoře pro otevření v aplikaci."
        />
      );
  }
}

/* ------------------------------- Quick Look ------------------------------- */

type QuickLookProps = {
  /** Seznam v pořadí zdrojového view; složky se přeskakují. */
  entries: FileEntry[];
  entry: FileEntry;
  onClose: () => void;
  onOpenFile: (entry: FileEntry) => void;
};

export function QuickLook({ entries, entry, onClose, onOpenFile }: QuickLookProps) {
  const files = useMemo(() => entries.filter((item) => !item.is_dir), [entries]);

  const [currentPath, setCurrentPath] = useState(entry.path);
  const [visible, setVisible] = useState(false);
  // Spočítá se jednou při otevření, ještě než modal cokoli překryje.
  const [origin, setOrigin] = useState<Origin | null>(() => originFor(entry.path));

  const cardRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);

  const index = files.findIndex((file) => file.path === currentPath);
  const current = index >= 0 ? files[index] : entry;

  const textState = useTextContent(current, previewKind(current));

  const requestClose = useCallback(() => {
    if (closeTimer.current !== null) return;

    // Šipkami se mohl soubor přepnout — zavírá se tedy do ikony toho, který je
    // vidět teď, ne toho, kterým se začínalo.
    const target = originFor(currentPath);
    if (target !== null) setOrigin(target);

    setVisible(false);
    const zooming = (target ?? origin) !== null;
    closeTimer.current = window.setTimeout(onClose, zooming ? CLOSE_MS : FALLBACK_MS);
  }, [onClose, currentPath, origin]);

  const step = useCallback(
    (delta: number) => {
      if (index < 0 || files.length === 0) return;
      const next = index + delta;
      if (next < 0 || next >= files.length) return;
      setCurrentPath(files[next].path);
    },
    [index, files],
  );

  // Fade + scale in po připojení; zavření běží zrcadlově přes requestClose.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  // Fokus přebírá karta, aby klávesy nechodily do column view pod modalem.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cardRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      switch (event.key) {
        case "Escape":
        case " ":
          event.preventDefault();
          requestClose();
          break;
        case "ArrowRight":
          event.preventDefault();
          step(1);
          break;
        case "ArrowLeft":
          event.preventDefault();
          step(-1);
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [requestClose, step]);

  // Boční tlačítka myši listují soubory stejně jako šipky. Capture fáze je
  // nutná — karta níž si v onMouseDown volá stopPropagation, což by událost
  // v bubble fázi do window nepustilo.
  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      if (event.button !== 3 && event.button !== 4) return;

      event.preventDefault();
      step(event.button === 3 ? -1 : 1);
    }

    window.addEventListener("mousedown", onMouseDown, true);
    return () => window.removeEventListener("mousedown", onMouseDown, true);
  }, [step]);

  function handleOpen() {
    onOpenFile(current);
    requestClose();
  }

  /* ---------------------------- animace karty ----------------------------- */

  // Zavřený stav = zmenšeno na střed ikony. Pořadí funkcí je podstatné:
  // scale proběhne kolem středu karty, translate ji teprve posadí na ikonu.
  // Bez známé ikony zbývá jemný zoom uprostřed okna.
  const closedTransform =
    origin === null
      ? "translate(0px, 0px) scale(0.9)"
      : `translate(${origin.x}px, ${origin.y}px) scale(0.1)`;

  const duration = visible
    ? origin === null
      ? FALLBACK_MS
      : OPEN_MS
    : origin === null
      ? FALLBACK_MS
      : CLOSE_MS;
  const closeMs = origin === null ? FALLBACK_MS : CLOSE_MS;
  const curve = visible ? "var(--ease-out)" : "var(--ease-in-out)";

  return createPortal(
    <div
      // Jen primární tlačítko zavírá. Boční tlačítka listují soubory a prostřední
      // by modal zavřelo taky, což u obojího nikdo nečeká.
      onMouseDown={(event) => {
        if (event.button === 0) requestClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(10px)",
        opacity: visible ? 1 : 0,
        // Pozadí stmívá vlastním tempem, ale při zavírání nesmí zmizet dřív
        // než karta — jinak by karta chvíli visela nad nezastřeným oknem.
        transition: `opacity ${visible ? OVERLAY_IN_MS : closeMs}ms var(--ease-in-out)`,
      }}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        className="flex flex-col overflow-hidden rounded-xl outline-none"
        style={{
          background: "var(--bg-main)",
          width: "85%",
          height: "85%",
          maxWidth: "85%",
          maxHeight: "85%",
          opacity: visible ? 1 : 0,
          transform: visible ? "translate(0px, 0px) scale(1)" : closedTransform,
          transition: `opacity ${duration}ms ${curve}, transform ${duration}ms ${curve}`,
          willChange: "transform, opacity",
          boxShadow: "0 24px 64px rgba(0,0,0,0.45)",
        }}
      >
        <header
          className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4"
          style={{ background: "var(--bg-toolbar)" }}
        >
          <SmallEntryIcon entry={current} />
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-primary">
            {current.name}
          </span>

          <button
            type="button"
            onClick={handleOpen}
            className="shrink-0 rounded-full bg-accent px-3 py-1 text-[12px] font-medium text-white transition-opacity duration-100 hover:opacity-90"
          >
            Otevřít
          </button>

          <button
            type="button"
            aria-label="Zavřít"
            onClick={requestClose}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-primary transition-colors duration-100 hover:bg-hover"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden" style={{ background: "var(--bg-main)" }}>
          {/* key vynutí remount, čímž se přehraje 100ms cross-fade při přepnutí souboru. */}
          <div key={current.path} className="ql-fade h-full w-full">
            <PreviewBody entry={current} state={textState} />
          </div>
        </div>

        <footer
          className="flex h-8 shrink-0 items-center gap-3 border-t border-line px-4 text-[11px] text-secondary"
          style={{ background: "var(--bg-toolbar)" }}
        >
          <span>
            {index >= 0 ? index + 1 : 1} z {files.length || 1}
          </span>
          <span>{formatSize(current.size, current.is_dir)}</span>
          <span className="truncate">{kindLabel(current)}</span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
