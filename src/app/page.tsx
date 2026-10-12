import OcrTool from "@/components/ocr-tool";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8 max-w-2xl">
        <p className="text-xs font-semibold tracking-widest text-indigo-600 uppercase dark:text-indigo-400">
          100% free · runs in your browser
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl dark:text-zinc-50">
          Image to Text
        </h1>
        <p className="mt-3 text-base leading-7 text-zinc-600 dark:text-zinc-400">
          Extract text from any photo or screenshot with OCR. No account, no
          upload, no API key — your image never leaves this device.
        </p>
      </header>

      <OcrTool />

      <footer className="mt-10 border-t border-zinc-200 pt-6 text-sm leading-6 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        Powered by{" "}
        <a
          className="font-medium text-zinc-700 underline underline-offset-4 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-100"
          href="https://github.com/naptha/tesseract.js"
          target="_blank"
          rel="noreferrer"
        >
          Tesseract.js
        </a>{" "}
        (Apache-2.0) running entirely client-side. The OCR engine and language
        pack are downloaded once from a CDN, then cached by your browser.
      </footer>
    </main>
  );
}
