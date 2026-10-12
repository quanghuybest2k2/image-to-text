# Image to Text

A 100% free image-to-text (OCR) web app. Text extraction runs **entirely in the
browser** — no server, no API key, no account, no usage limits, and images never
leave the user's device.

## Tech stack

| Layer      | Choice                                        | Why                                            |
| ---------- | --------------------------------------------- | ---------------------------------------------- |
| Framework  | Next.js 16 (App Router, TypeScript, Turbopack) | Static output, zero runtime server cost         |
| OCR        | [Tesseract.js](https://github.com/naptha/tesseract.js) v7 | Pure WASM OCR in the browser              |
| Language ID| [tinyld](https://github.com/Perfectundi/tinyld) | Pure-JS language identification            |
| Styling    | Tailwind CSS 4                                | Built into `create-next-app`                    |
| Hosting    | Vercel / Cloudflare Pages / GitHub Pages      | Free static hosting                             |
| Cost       | **$0**                                        | No backend, no per-request charges              |

The OCR engine (~WASM core) and the language pack are fetched once from the
jsDelivr CDN, then cached by the browser, so repeat visits work offline.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000.

```bash
npm run build   # production build
npm run start   # serve the production build
npm run lint    # eslint
```

## How it works

- `src/app/page.tsx` — Server Component: page shell and metadata.
- `src/components/ocr-tool.tsx` — Client Component with all the interactivity.
  Tesseract.js is loaded with a dynamic `import()` on the first **Extract text**
  click, so it is code-split out of the initial page load.
- `src/lib/languages.ts` — curated language list. Auto-detect is the default
  option, and `AUTO_BASE_LANGUAGE` (`"vie+eng"`) is what it runs with.
- `src/lib/detect-language.ts` — auto-detect verdict. Lazily imported, so
  `tinyld` (~251 KB gz) only ships when the user actually picks Auto-detect.
- `src/lib/binarize.ts` — Otsu pre-binarization, applied to every image before
  it reaches Tesseract.

A single Tesseract worker is reused across runs and re-initialized with
`worker.reinitialize(lang)` when the language changes, so the engine core is only
downloaded once. The worker is terminated on unmount.

### Features

- Drag-and-drop, file picker, and `Ctrl/Cmd+V` paste
- Auto-detect (Vietnamese / English) on by default
- 38 selectable languages
- Live progress bar with per-phase status
- Editable result, confidence score, word/character count
- Copy to clipboard and download as `.txt`
- Light and dark mode

### Auto-detect

Auto-detect deliberately covers **only Vietnamese and English**, including images
that mix both. Every other language stays a manual choice in the dropdown.

1. Tesseract recognizes **once** with `vie+eng`, so both models are loaded
   together and one pass covers English, Vietnamese, and mixed images.
2. `tinyld` identifies the result purely to *report* it. It never triggers a
   second run.

**Why no "re-run in the detected language".** Loading both models is what makes
mixed images work. Measured on the same images:

| engine   | English       | Vietnamese                     | Mixed                          |
| -------- | ------------- | ------------------------------ | ------------------------------ |
| `vie`    | 90            | 95                             | 93                             |
| `eng`    | 95            | **86 — `Nhéan dién chr cdi`**  | **90 — garbled Vietnamese**    |
| `vie+eng`| **95**        | **95**                         | **93**                         |

`eng`-only destroys Vietnamese diacritics, so a "re-run in the detected
language" would be a coin flip that mangles half the text on a mixed image.
Loading both models costs **+4%** (229 → 238 ms/run) and removes the second
pass entirely.

Sample mixed output, one pass, both halves correct:

```txt
Vietnamese TTS with instant voice cloning On-device - Real-time CPU inference
24kHz audio quality Chuyển văn bản thành giọng nói tiếng Việt
Text to speech tiếng Việt - TTS tiếng Việt
```

**Detecting "mixed".** tinyld only reports a dominant language, so a mixed badge
needs its own signal: Vietnamese-specific letters (`ă â đ ê ô ơ ư …`) plus a
count of English words that never occur in Vietnamese prose. It reports:

| verdict                                | when                                                 |
| -------------------------------------- | ---------------------------------------------------- |
| `Detected: English` / `Vietnamese`     | dominant language, no signal of the other            |
| `Detected: Vietnamese + English`       | Vietnamese letters **and** ≥ 3 distinct English words |
| `Detected {other}… pick a language`    | confident guess outside the two supported languages   |
| *(nothing shown)*                      | text too fragmentary to name — see below              |
| `Couldn't read this image confidently` | OCR confidence below 50                               |

**Why a failed *name* is silent.** Auto mode already loaded both models, so not
being able to label the result costs the user nothing — the extraction is
correct either way. Showing a warning there would be false: a real screenshot
(86% confidence, 241 characters, both languages perfect) once reported
`Couldn't auto-detect Vietnamese or English` purely because fragmentary UI text
split tinyld's evidence. A warning is only warranted when the OCR itself is
untrustworthy.

Measured verdicts — **10/10**, using the real OCR path:

| input                                | conf | verdict                  |
| ------------------------------------ | ---- | ------------------------ |
| fragmentary en + vi UI screenshot    | 86   | `Vietnamese + English`   |
| clean English / Vietnamese           | 95   | `English` / `Vietnamese` |
| 50/50 mixed                          | 95   | `Vietnamese + English`   |
| French                               | 91   | `French` (unsupported)   |
| single short English label           | 92   | silent                   |
| noise / Russian / Thai               | 9 / 38 / 0 | warn               |

**Two gates, doing two different jobs.** They are not interchangeable:

- **OCR confidence ≥ 50 — the garbage barrier.** Real text scored 86–95; noise,
  Russian and Thai scored 9 / 38 / 0. tinyld alone is useless here: on the Thai
  image it reported `vi` at **1.00 accuracy** on pure garbage.
- **tinyld accuracy ≥ 0.50 — permission to name a language.** tinyld normalizes
  its candidates, so evidence *splits* when text is mixed: clean prose scores
  1.00 but the fragmentary mixed screenshot scored **0.617**. The first version
  of this app used 0.75 and therefore rejected exactly the images auto mode
  exists for. 0.50 means "the winner holds a majority of the evidence".
- **tinyld accuracy ≥ 0.75 — permission to say "that's *not* Vietnamese or
  English".** Telling the user to abandon auto mode is a stronger claim than
  naming their text, so it demands stronger evidence; a weak `fr 0.11` on a
  short label stays silent instead of nudging them off a working result.

Tesseract's own Orientation & Script Detection could extend this to any script,
but it needs a legacy core + `osd` data (**+7.6 MB**) and still only reports the
*script* (`Latin`), not the language — so it was deliberately left out.

### Preprocessing

Every image is binarized with **Otsu's threshold** before OCR (`src/lib/binarize.ts`).

Tesseract binarizes internally, but on a screenshot mixing text with a photo it
happily reads the photo as characters. A real dark-mode chat screenshot:

```txt
Oo Em bị nó tấn công vị giác =))    <- hallucinated prefix
Bún » A                            <- the message action buttons
4 Sz v= "4 ot + Soe"               <- the cat sticker, read as text
1622                               <- should be 14:22
```

Dark mode itself turned out **not** to be the cause — a synthetic dark chat at
20px scored 0.988 similarity raw, with inverting, 2×/3× upscaling and
autocontrast all scoring identically. The photo and the UI chrome were.

Raw vs Otsu-binarized, `vie+eng`, similarity to ground truth:

| image                    | raw   | binarized |        |
| ------------------------ | ----- | --------- | ------ |
| chat w/ sticker + icons  | 0.718 | **0.798** | wins   |
| dark chat, no photo      | 0.988 | 0.988     | tie    |
| pure en / vi / mixed     | 1.000 | 1.000     | tie    |
| French, short label      | 1.000 | 1.000     | tie    |

Binary wins 1, ties 6, **raw wins 0** — so it runs unconditionally, for manual
languages too. If the browser can't provide a canvas the original file is used
instead, so preprocessing can never be the reason an OCR run fails.

`otsuThreshold()` is exported and was cross-checked against a Python reference
on five real images: **5/5 identical thresholds** (89–136). Luma uses ITU-R 601
coefficients to match that reference exactly.

## Why this is free forever

Everything runs client-side. There is no API to pay for and no infrastructure
that scales with traffic — hosting a static bundle is free on every major
provider, and the user's browser does the OCR work.

## Roadmap ideas

- Batch/multi-image queue
- Text-region cropping before recognition
- Searchable PDF export (`worker.recognize(..., { pdf: true })`)
- Persist history in `localStorage`
- PWA for offline use
