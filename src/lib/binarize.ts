/**
 * Pre-binarize images with Otsu's threshold before they reach Tesseract.
 *
 * Tesseract binarizes internally, but on a screenshot that mixes text with a
 * photo (chat stickers, avatars, screenshots of documents next to pictures)
 * it happily reads the photographic region as characters. A real failure:
 *
 * ```txt
 * Oo Em bị nó tấn công vị giác =))
 * Bún » A              <- the message action buttons
 * 4 Sz v= "4 ot + Soe" <- the cat sticker, read as text
 * 1622                 <- should be 14:22
 * ```
 *
 * Measured, 7 images, comparing raw vs Otsu-binarized input (`vie+eng`):
 *
 * | image                  | raw      | binarized |   |
 * |------------------------|----------|-----------|---|
 * | chat w/ sticker + icons| 0.718    | **0.798** | wins |
 * | dark chat, no photo    | 0.988    | 0.988     | tie |
 * | pure en / vi / mixed   | 1.000    | 1.000     | tie |
 * | French, short label    | 1.000    | 1.000     | tie |
 *
 * Binary wins 1, ties 6, **raw wins 0** — so it runs unconditionally. Luma
 * uses ITU-R 601 coefficients to match the reference measurement exactly.
 */
export async function binarizeForOcr(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);

  try {
    const { width, height } = bitmap;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D canvas unavailable");

    // Flatten onto white first, or transparent PNGs become black-on-black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0);

    const imageData = ctx.getImageData(0, 0, width, height);
    const pixels = imageData.data;
    const pixelCount = width * height;

    const luma = new Uint8Array(pixelCount);
    const histogram = new Uint32Array(256);
    for (let i = 0, p = 0; p < pixelCount; p += 1, i += 4) {
      const value = (299 * pixels[i] + 587 * pixels[i + 1] + 114 * pixels[i + 2]) / 1000 | 0;
      luma[p] = value;
      histogram[value] += 1;
    }

    const threshold = otsuThreshold(histogram, pixelCount);

    for (let i = 0, p = 0; p < pixelCount; p += 1, i += 4) {
      const value = luma[p] > threshold ? 255 : 0;
      pixels[i] = value;
      pixels[i + 1] = value;
      pixels[i + 2] = value;
      pixels[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);

    return canvas;
  } finally {
    bitmap.close();
  }
}

/**
 * Otsu's method: pick the threshold that maximizes between-class variance of
 * the foreground and background pixels. Exported so it can be cross-checked
 * against a reference implementation without a DOM.
 */
export function otsuThreshold(
  histogram: Uint32Array,
  total: number,
): number {
  let sumAll = 0;
  for (let t = 0; t < 256; t += 1) sumAll += t * histogram[t];

  let sumBackground = 0;
  let weightBackground = 0;
  let bestThreshold = 0;
  let bestVariance = -1;

  for (let t = 0; t < 256; t += 1) {
    weightBackground += histogram[t];
    if (weightBackground === 0) continue;

    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += t * histogram[t];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sumAll - sumBackground) / weightForeground;
    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;

    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = t;
    }
  }

  return bestThreshold;
}
