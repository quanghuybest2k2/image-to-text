import { detectAll } from "tinyld";
import { LANGUAGES, type Language } from "./languages";

/**
 * Two gates doing two different jobs — measured, not guessed.
 *
 * **OCR confidence is the garbage barrier.** tinyld normalizes its candidates
 * so it always returns *a* winner at high confidence, even on nonsense:
 *
 * | input            | Tesseract conf | tinyld top        |
 * |------------------|----------------|-------------------|
 * | clean prose      | 91-95          | vi/en 1.00        |
 * | fragmentary UI   | **86**         | **vi 0.617**      |
 * | Russian as vie   | 38             | es 0.57           |
 * | Chinese as vie   | 27             | is 0.35           |
 * | Thai as vie      | 0              | **vi 1.00**       |
 *
 * The Thai row is why confidence gates everything: tinyld reports Vietnamese at
 * full confidence on pure garbage. Conversely the fragmentary row is why OCR
 * confidence *alone* is not a reason to reject a name — 86% there, and the
 * extraction was correct in both languages.
 *
 * **tinyld accuracy decides whether we may name the language.** tinyld splits
 * its evidence when text is mixed, so a valid mixed image scores 0.617 while
 * clean single-language text scores 1.00. The old 0.75 threshold therefore
 * rejected exactly the images this mode exists for. 0.50 means "the winner
 * holds a majority of the evidence" — a principled line rather than a tuned one.
 *
 * Naming a *different* language (and telling the user to abandon auto mode) is
 * a much stronger claim than naming Vietnamese or English, so it needs stronger
 * evidence: `MIN_UNSUPPORTED_ACCURACY`.
 */
export const MIN_OCR_CONFIDENCE = 50;
export const MIN_LID_ACCURACY = 0.5;
export const MIN_UNSUPPORTED_ACCURACY = 0.75;

const MIN_TEXT_LENGTH = 10;
const MIN_VIETNAMESE_CHARS = 3;
const MIN_ENGLISH_MARKERS = 3;

/** Letters only Vietnamese uses — none of them occur in English. */
const VIETNAMESE_ONLY = /[ăâđêôơưạảấầẩậắằẳặẹẻẽếềểệỉịọỏốồổộớờởợụủứừửữỳỵỷỹ]/g;

/**
 * English words that essentially never appear in Vietnamese prose, used to
 * catch "English-dominant image that still contains Vietnamese". Vietnamese
 * expresses these with its own function words (và, của, là, với, cho…), and
 * accented Vietnamese letters break naive substring matches like "the".
 * Requiring several distinct hits keeps stray loanwords from counting.
 */
const ENGLISH_MARKERS = [
  // function words
  "the",
  "and",
  "are",
  "been",
  "but",
  "for",
  "from",
  "had",
  "has",
  "have",
  "not",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "those",
  "was",
  "were",
  "which",
  "will",
  "with",
  "would",
  // content words common in UI/screenshot text
  "audio",
  "cloning",
  "code",
  "data",
  "download",
  "file",
  "image",
  "inference",
  "model",
  "page",
  "quality",
  "search",
  "settings",
  "speech",
  "system",
  "text",
  "user",
  "version",
  "video",
  "voice",
];

/**
 * Auto-detect deliberately only ever picks Vietnamese or English.
 * Every other language stays a manual choice in the dropdown, so a confident
 * guess at French or Thai counts as "not auto-supported" rather than a result.
 */
const AUTO_DETECT_CODES = new Set(["vie", "eng"]);

const BY_ISO2 = new Map<string, Language>(
  LANGUAGES.filter((l) => l.iso2 && AUTO_DETECT_CODES.has(l.code)).map((l) => [
    l.iso2 as string,
    l,
  ]),
);

export type LanguageDetection =
  | { kind: "language"; label: string }
  | { kind: "mixed"; label: string }
  | { kind: "unsupported"; label: string }
  /**
   * OCR succeeded but the text is too fragmentary to name a language. Not an
   * error: `vie+eng` is already loaded, so the result is correct either way
   * and the UI should stay quiet rather than tell the user to pick a language.
   */
  | { kind: "undetermined" };

/**
 * Report the language of already-recognized text.
 *
 * Returns `null` only when the OCR output itself is untrustworthy (confidence
 * below `MIN_OCR_CONFIDENCE`) — that is the one case worth warning the user
 * about, since a different model may genuinely read the image better.
 *
 * Because Auto-detect recognizes with `vie+eng` in a single pass, this only
 * *reports* a verdict — it never triggers a second run.
 */
export function detectLanguage(
  text: string,
  ocrConfidence: number,
): LanguageDetection | null {
  if (ocrConfidence < MIN_OCR_CONFIDENCE) return null;

  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length < MIN_TEXT_LENGTH) return { kind: "undetermined" };

  const best = detectAll(cleaned)[0];
  if (!best || best.accuracy < MIN_LID_ACCURACY) return { kind: "undetermined" };

  const language = BY_ISO2.get(best.lang);
  if (language) {
    const hasVietnamese =
      (cleaned.match(VIETNAMESE_ONLY) ?? []).length >= MIN_VIETNAMESE_CHARS;
    const hasEnglish = countEnglishMarkers(cleaned) >= MIN_ENGLISH_MARKERS;

    if (hasVietnamese && (best.lang === "en" || hasEnglish)) {
      return { kind: "mixed", label: "Vietnamese + English" };
    }
    return { kind: "language", label: language.label };
  }

  // Outside the two supported languages: only contradict auto mode on strong
  // evidence, so a weak guess can't push the user off a working result.
  if (best.accuracy >= MIN_UNSUPPORTED_ACCURACY) {
    return { kind: "unsupported", label: humanName(best.lang) };
  }
  return { kind: "undetermined" };
}

function countEnglishMarkers(text: string): number {
  let hits = 0;
  for (const word of ENGLISH_MARKERS) {
    if (new RegExp(`\\b${word}\\b`, "i").test(text)) hits += 1;
  }
  return hits;
}

/** Friendly name for a language we can't OCR with. */
function humanName(iso2: string): string {
  try {
    const locale =
      typeof navigator !== "undefined" && navigator.language ? navigator.language : "en";
    const name = new Intl.DisplayNames([locale], { type: "language" }).of(iso2);
    if (name) return name;
  } catch {
    // Intl.DisplayNames can be unavailable or reject the locale.
  }
  return iso2.toUpperCase();
}
