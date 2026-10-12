"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ImageLike, Worker as TesseractWorker } from "tesseract.js";
import {
  AUTO_BASE_LANGUAGE,
  AUTO_LANGUAGE,
  LANGUAGES,
} from "@/lib/languages";

type Phase = "idle" | "working" | "done" | "error";

/** What the auto-detect pass concluded, for display above the result. */
type AutoResult =
  | { kind: "detected"; label: string }
  | { kind: "unsupported"; label: string }
  /** Text too fragmentary to name — `vie+eng` covers it either way, so say nothing. */
  | { kind: "undetermined" }
  | { kind: "failed"; confidence: number };

/**
 * Tesseract reports progress per phase and each phase restarts at 0.
 * These are every status string the worker emits (see
 * `tesseract.js/src/worker-script/index.js` and `.../browser/getCore.js`).
 */
const LOAD_PHASES = [
  "starting tesseract core",
  "loading tesseract core",
  "initializing tesseract",
  "loading language traineddata",
  "initializing api",
] as const;

const STATUS_LABELS: Record<string, string> = {
  "starting tesseract core": "Starting OCR engine…",
  "loading tesseract core": "Loading OCR engine…",
  "initializing tesseract": "Starting OCR engine…",
  "loading language traineddata": "Downloading language pack…",
  "initializing api": "Preparing…",
  "recognizing text": "Recognizing text…",
};

/** Loading is quick (and cached); recognition deserves most of the bar. */
function overallProgress(status: string, progress: number): number | null {
  const index = LOAD_PHASES.indexOf(status as (typeof LOAD_PHASES)[number]);
  if (index >= 0) return ((index + progress) / LOAD_PHASES.length) * 0.3;
  if (status === "recognizing text") return 0.3 + progress * 0.7;
  return null;
}

/**
 * `loadImage()` accepts `File`/`Blob` at runtime, but the published `ImageLike`
 * type was never updated to say so. Passing the `File` straight through avoids
 * re-encoding the whole photo as base64 just to hand it back as bytes.
 */
const asRecognizable = (file: File) => file as unknown as ImageLike;

export default function OcrTool() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [lang, setLang] = useState<string>(AUTO_LANGUAGE);
  const [text, setText] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  /** Result of the auto-detect pass, if the language dropdown is on "Auto-detect". */
  const [autoResult, setAutoResult] = useState<AutoResult | null>(null);

  const workerRef = useRef<TesseractWorker | null>(null);
  const workerLangRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  /** Object URLs are cheap but not free — drop the old preview when replacing it. */
  const setPreviewUrl = useCallback((url: string | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = url;
    setPreview(url);
  }, []);

  /** Lazily create (or re-language) the worker so it never ships in the first load. */
  const getWorker = useCallback(async (language: string) => {
    const { createWorker } = await import("tesseract.js");

    if (workerRef.current) {
      if (workerLangRef.current !== language) {
        await workerRef.current.reinitialize(language);
        workerLangRef.current = language;
      }
      return workerRef.current;
    }

    const worker = await createWorker(language, undefined, {
      logger: (message) => {
        setStatus(STATUS_LABELS[message.status] ?? message.status);
        const overall = overallProgress(message.status, message.progress);
        if (overall !== null) setProgress(Math.round(overall * 100));
      },
      errorHandler: (err) => {
        console.error("Tesseract worker error:", err);
      },
    });

    workerRef.current = worker;
    workerLangRef.current = language;
    return worker;
  }, []);

  useEffect(() => {
    return () => {
      void workerRef.current?.terminate();
      workerRef.current = null;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const acceptFile = useCallback((next: File | null | undefined) => {
    if (!next) return;
    if (!next.type.startsWith("image/")) {
      setError("That file isn't an image. Try a PNG, JPG, WebP or GIF.");
      return;
    }
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
    setText("");
    setConfidence(null);
    setError(null);
    setPhase("idle");
    setProgress(0);
    setStatus("");
    setAutoResult(null);
  }, [setPreviewUrl]);

  // Ctrl/Cmd+V anywhere on the page.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith("image/"),
      );
      const pasted = item?.getAsFile();
      if (pasted) {
        event.preventDefault();
        acceptFile(pasted);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [acceptFile]);

  const recognize = useCallback(async () => {
    if (!file) return;

    setPhase("working");
    setProgress(0);
    setStatus("Starting…");
    setError(null);
    setText("");
    setConfidence(null);
    setAutoResult(null);

    try {
      const isAuto = lang === AUTO_LANGUAGE;
      const baseLang = isAuto ? AUTO_BASE_LANGUAGE : lang;

      // Auto-detect uses `vie+eng`, so a single pass covers English, Vietnamese
      // and mixed images — there is deliberately no second run that could
      // mangle the other language's diacritics.
      const worker = await getWorker(baseLang);
      const result = await worker.recognize(asRecognizable(file));
      const output = result.data.text ?? "";

      if (isAuto) {
        // Imported on demand: tinyld is ~251 KB gz and only matters for this mode.
        const { detectLanguage } = await import("@/lib/detect-language");
        const detection = detectLanguage(output, result.data.confidence);

        setAutoResult(
          !detection
            ? { kind: "failed", confidence: Math.round(result.data.confidence) }
            : detection.kind === "undetermined"
              ? { kind: "undetermined" }
              : detection.kind === "unsupported"
                ? { kind: "unsupported", label: detection.label }
                : { kind: "detected", label: detection.label },
        );
      }

      setText(output);
      setConfidence(Math.round(result.data.confidence));
      setProgress(100);
      setPhase("done");
      setStatus("");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "OCR failed. Please try again.");
      setPhase("error");
      setStatus("");
    }
  }, [file, lang, getWorker]);

  const copy = useCallback(async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Clipboard access was blocked by the browser.");
    }
  }, [text]);

  const download = useCallback(() => {
    if (!text) return;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${file?.name.replace(/\.[^.]+$/, "") ?? "image"}-text.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [text, file]);

  const busy = phase === "working";

  return (
    <div className="flex flex-col gap-6">
      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-700 sm:w-64 dark:text-zinc-300">
          Language
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            disabled={busy}
            className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
          <option value={AUTO_LANGUAGE}>Auto-detect (Vietnamese / English)</option>
          <optgroup label="Or choose a language">
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </optgroup>
          </select>
        </label>

        <div className="flex flex-1 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={recognize}
            disabled={!file || busy}
            className="h-10 rounded-lg bg-indigo-600 px-5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Reading…" : text ? "Read again" : "Extract text"}
          </button>

          <button
            type="button"
            onClick={copy}
            disabled={!text || busy}
            className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>

          <button
            type="button"
            onClick={download}
            disabled={!text || busy}
            className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Download .txt
          </button>

          {file && !busy && (
            <button
              type="button"
              onClick={() => {
                setFile(null);
                setPreviewUrl(null);
                setText("");
                setConfidence(null);
                setError(null);
                setAutoResult(null);
                setPhase("idle");
                setProgress(0);
                setStatus("");
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              className="h-10 rounded-lg px-3 text-sm font-medium text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Progress */}
      {busy && (
        <div className="flex flex-col gap-2">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-indigo-500 transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{status}</p>
        </div>
      )}

      {/* Auto-detect verdict — hidden entirely when undetermined: both models
          are already loaded, so an unnamed language is not a problem to report. */}
      {autoResult && autoResult.kind !== "undetermined" && (
        <p
          role="status"
          className={
            autoResult.kind === "detected"
              ? "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
          }
        >
          {autoResult.kind === "detected"
            ? `Detected: ${autoResult.label}`
            : autoResult.kind === "unsupported"
              ? `Detected ${autoResult.label}, but auto-detect only covers Vietnamese and English — pick a language above.`
              : `Couldn't read this image confidently (${autoResult.confidence}%). Try a sharper, higher-contrast image — or pick a language above if it isn't Vietnamese or English.`}
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {/* Input + output */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            1 · Image
          </h2>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              acceptFile(e.dataTransfer.files?.[0]);
            }}
            className={`relative flex min-h-72 flex-1 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed p-4 transition ${
              dragging
                ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30"
                : "border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/50"
            }`}
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt="Selected image preview"
                className="max-h-[60vh] w-auto max-w-full rounded-lg object-contain"
              />
            ) : (
              <div className="flex flex-col items-center gap-3 px-6 text-center">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-10 w-10 text-zinc-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18v-1.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
                  />
                </svg>
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Drag an image here
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-white dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  or choose a file
                </button>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  You can also paste with Ctrl&nbsp;+&nbsp;V
                </p>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => acceptFile(e.target.files?.[0])}
            />
          </div>

          {file && (
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {file.name} · {(file.size / 1024).toFixed(0)} KB
            </p>
          )}
        </section>

        <section className="flex min-h-72 flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              2 · Extracted text
            </h2>
            {confidence !== null && (
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                confidence {confidence}%
              </span>
            )}
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              busy
                ? "Working…"
                : "Recognized text will appear here. Edit it freely before copying."
            }
            spellCheck={false}
            className="min-h-72 w-full flex-1 resize-y rounded-xl border border-zinc-200 bg-white p-4 font-mono text-sm leading-6 text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />

          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            {text ? `${text.trim().split(/\s+/).length} words · ${text.length} characters` : ""}
          </p>
        </section>
      </div>
    </div>
  );
}
