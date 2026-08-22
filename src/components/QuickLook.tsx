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
const CLOSE_ANIMATION_MS = 150;

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

  const cardRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);

  const index = files.findIndex((file) => file.path === currentPath);
  const current = index >= 0 ? files[index] : entry;

  const textState = useTextContent(current, previewKind(current));

  const requestClose = useCallback(() => {
    if (closeTimer.current !== null) return;
    setVisible(false);
    closeTimer.current = window.setTimeout(onClose, CLOSE_ANIMATION_MS);
  }, [onClose]);

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
        transition: `opacity ${CLOSE_ANIMATION_MS}ms ease`,
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
          transform: visible ? "scale(1)" : "scale(0.95)",
          transition: `opacity ${CLOSE_ANIMATION_MS}ms ease, transform ${CLOSE_ANIMATION_MS}ms ease`,
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
