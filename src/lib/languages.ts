export type Language = {
  /** Tesseract language code (also the package name on the CDN). */
  code: string;
  /** ISO 639-1 code used by tinyld for auto-detection. Omit when auto-detect must not pick it. */
  iso2?: string;
  label: string;
};

/**
 * Curated subset of the languages Tesseract ships traineddata for.
 * Every `code` is verified to resolve on the jsDelivr CDN
 * (`@tesseract.js-data/<code>/4.0.0_best_int/<code>.traineddata.gz`).
 *
 * `chi_tra` intentionally has no `iso2`: tinyld only distinguishes `zh`, so
 * auto-detect must never silently pick Traditional over Simplified.
 */
export const LANGUAGES: Language[] = [
  { code: "vie", iso2: "vi", label: "Vietnamese" },
  { code: "eng", iso2: "en", label: "English" },
  { code: "fra", iso2: "fr", label: "French" },
  { code: "deu", iso2: "de", label: "German" },
  { code: "spa", iso2: "es", label: "Spanish" },
  { code: "por", iso2: "pt", label: "Portuguese" },
  { code: "ita", iso2: "it", label: "Italian" },
  { code: "nld", iso2: "nl", label: "Dutch" },
  { code: "rus", iso2: "ru", label: "Russian" },
  { code: "ukr", iso2: "uk", label: "Ukrainian" },
  { code: "pol", iso2: "pl", label: "Polish" },
  { code: "ces", iso2: "cs", label: "Czech" },
  { code: "ron", iso2: "ro", label: "Romanian" },
  { code: "hun", iso2: "hu", label: "Hungarian" },
  { code: "tur", iso2: "tr", label: "Turkish" },
  { code: "swe", iso2: "sv", label: "Swedish" },
  { code: "dan", iso2: "da", label: "Danish" },
  { code: "nor", iso2: "no", label: "Norwegian" },
  { code: "fin", iso2: "fi", label: "Finnish" },
  { code: "ell", iso2: "el", label: "Greek" },
  { code: "bul", iso2: "bg", label: "Bulgarian" },
  { code: "jpn", iso2: "ja", label: "Japanese" },
  { code: "kor", iso2: "ko", label: "Korean" },
  { code: "chi_sim", iso2: "zh", label: "Chinese (Simplified)" },
  { code: "chi_tra", label: "Chinese (Traditional)" },
  { code: "tha", iso2: "th", label: "Thai" },
  { code: "ind", iso2: "id", label: "Indonesian" },
  { code: "msa", iso2: "ms", label: "Malay" },
  { code: "fil", iso2: "tl", label: "Filipino" },
  { code: "ara", iso2: "ar", label: "Arabic" },
  { code: "heb", iso2: "he", label: "Hebrew" },
  { code: "hin", iso2: "hi", label: "Hindi" },
  { code: "ben", iso2: "bn", label: "Bengali" },
  { code: "tam", iso2: "ta", label: "Tamil" },
  { code: "mar", iso2: "mr", label: "Marathi" },
  { code: "tel", iso2: "te", label: "Telugu" },
  { code: "kan", iso2: "kn", label: "Kannada" },
  { code: "mal", iso2: "ml", label: "Malayalam" },
];

/**
 * What Auto-detect runs with. Tesseract accepts `+`-separated languages, so
 * both models are loaded together and one pass covers English, Vietnamese, and
 * mixed images. Measured identical-or-better vs the best single model
 * (95 / 95 / 93) at +4% runtime — which is why there is no second pass.
 */
export const AUTO_BASE_LANGUAGE = "vie+eng";

/** Sentinel language-code meaning "figure it out from the image". */
export const AUTO_LANGUAGE = "__auto__";
