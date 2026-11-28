// Photos uploaded through the admin are stored at up to 2000px wide, with
// smaller copies beside them named {hash}-{width}.jpg. These helpers let pages
// offer those copies so a thumbnail doesn't download the full photo.
//
// The widths must match VARIANT_WIDTHS in the admin backend's src/uploads.ts.

const VARIANT_WIDTHS = [400, 800, 1200] as const;
type VariantWidth = (typeof VARIANT_WIDTHS)[number];

/** Longest edge the uploader stores; the full photo is at most this wide. */
const FULL_WIDTH = 2000;

// Names our uploader gives photos: {original}/{display}.jpg (e.g.
// a2BcF19x/Q7mZp2.jpg), or a 20-hex-digit name from before originals were
// kept. Anything else (a hand-entered URL, a file in public/) has no copies,
// so it's used as-is.
const UPLOADED = /\/(?:[0-9A-Za-z]{8}\/[0-9A-Za-z]{6}|[0-9a-f]{20})\.jpg$/;

const hasVariants = (url: string) => UPLOADED.test(url);

/** URL of the copy at `width`, or the original if it has no copies. */
export function imageVariant(url: string, width: VariantWidth): string {
  return hasVariants(url) ? url.replace(/\.jpg$/, `-${width}.jpg`) : url;
}

/**
 * Attributes for an <img> that shows `url` at the size described by `sizes`
 * (a CSS `sizes` value, e.g. "(max-width: 768px) 100vw, 600px").
 *
 *   <img {...responsiveImage(url, "300px")} alt="…" />
 */
export function responsiveImage(
  url: string,
  sizes: string,
): { src: string; srcset?: string; sizes?: string } {
  if (!hasVariants(url)) return { src: url };
  const srcset = [
    ...VARIANT_WIDTHS.map((w) => `${imageVariant(url, w)} ${w}w`),
    `${url} ${FULL_WIDTH}w`,
  ].join(", ");
  return { src: url, srcset, sizes };
}
