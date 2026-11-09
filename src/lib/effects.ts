import type { ColorAdjustments, FilterKind, TextStyle } from "@/types";

/**
 * Build a CSS `filter` string from a clip's colour adjustments.
 * Shared by the live preview and the canvas renderer so what you see is what
 * gets exported.
 */
export function cssFilter(color: Partial<ColorAdjustments> = {}, filter: FilterKind = "none"): string {
  const c = {
    brightness: 1,
    contrast: 1,
    saturation: 1,
    blur: 0,
    temperature: 0,
    exposure: 0,
    ...color,
  };
  const parts: string[] = [];
  const brightness = c.brightness * (1 + (c.exposure ?? 0) / 200);
  if (brightness !== 1) parts.push(`brightness(${brightness.toFixed(3)})`);
  if (c.contrast !== 1) parts.push(`contrast(${c.contrast.toFixed(3)})`);
  if (c.saturation !== 1) parts.push(`saturate(${c.saturation.toFixed(3)})`);
  const sepia = FILTER_SEPIA[filter] ?? 0;
  if (sepia) parts.push(`sepia(${sepia})`);
  const grayscale = FILTER_GRAYSCALE[filter] ?? 0;
  if (grayscale) parts.push(`grayscale(${grayscale})`);
  const hue = FILTER_HUE[filter] ?? 0;
  if (hue) parts.push(`hue-rotate(${hue}deg)`);
  const localContrast = FILTER_CONTRAST[filter] ?? 1;
  if (localContrast !== 1) parts.push(`contrast(${localContrast})`);
  const localSaturation = FILTER_SATURATION[filter] ?? 1;
  if (localSaturation !== 1) parts.push(`saturate(${localSaturation})`);
  if (c.blur && c.blur > 0) parts.push(`blur(${c.blur}px)`);
  return parts.length ? parts.join(" ") : "none";
}

export const FILTER_SEPIA: Partial<Record<FilterKind, number>> = {
  vintage: 0.45,
  sepia: 0.85,
  retro: 0.3,
  cinematic: 0.15,
};

export const FILTER_GRAYSCALE: Partial<Record<FilterKind, number>> = {
  bw: 1,
  noir: 1,
};

export const FILTER_HUE: Partial<Record<FilterKind, number>> = {
  cool: 195,
  warm: 15,
};

export const FILTER_CONTRAST: Partial<Record<FilterKind, number>> = {
  cinematic: 1.15,
  vivid: 1.1,
  noir: 1.35,
  faded: 0.85,
};

export const FILTER_SATURATION: Partial<Record<FilterKind, number>> = {
  vivid: 1.35,
  faded: 0.75,
  noir: 0.6,
};

export const FILTERS: { id: FilterKind; label: string; css: string }[] = [
  { id: "none", label: "Original", css: "none" },
  { id: "vintage", label: "Vintage", css: "sepia(0.45) contrast(1.05)" },
  { id: "bw", label: "Black & White", css: "grayscale(1) contrast(1.05)" },
  { id: "sepia", label: "Sepia", css: "sepia(0.85)" },
  { id: "cinematic", label: "Cinematic", css: "contrast(1.15) saturate(1.05) sepia(0.15)" },
  { id: "retro", label: "Retro", css: "sepia(0.3) contrast(1.1) saturate(0.9)" },
  { id: "cool", label: "Cool", css: "hue-rotate(195deg) saturate(1.1)" },
  { id: "warm", label: "Warm", css: "sepia(0.25) saturate(1.2)" },
  { id: "vivid", label: "Vivid", css: "saturate(1.35) contrast(1.1)" },
  { id: "faded", label: "Faded", css: "saturate(0.75) contrast(0.85) brightness(1.05)" },
  { id: "noir", label: "Noir", css: "grayscale(1) contrast(1.35)" },
];

/** Temperature/tint overlay colour (used as a `mix-blend-mode: soft-light` layer). */
export function tintOverlay(color: Partial<ColorAdjustments> = {}): string | null {
  const temp = color.temperature ?? 0;
  const tint = color.tint ?? 0;
  if (temp === 0 && tint === 0) return null;
  const r = 128 + temp * 0.9;
  const g = 128 - Math.abs(temp) * 0.15 - tint * 0.4;
  const b = 128 - temp * 0.9 + tint * 0.4;
  const alpha = Math.min(0.55, (Math.abs(temp) + Math.abs(tint)) / 220);
  return `rgba(${clamp255(r)}, ${clamp255(g)}, ${clamp255(b)}, ${alpha.toFixed(3)})`;
}

function clamp255(v: number) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** CSS for a text clip's styling at a given frame size. */
export function textCss(text: TextStyle, frameWidth: number) {
  const scale = frameWidth / 1080;
  return {
    fontFamily: text.fontFamily,
    fontSize: `${text.fontSize * scale}px`,
    color: text.color,
    background: text.background === "transparent" ? "transparent" : text.background,
    fontWeight: text.bold ? 800 : 400,
    fontStyle: text.italic ? "italic" : "normal",
    textAlign: text.align,
    WebkitTextStroke: text.outlineWidth > 0 ? `${text.outlineWidth * scale}px ${text.outlineColor}` : undefined,
    textShadow: text.shadow ? "0 4px 18px rgba(0,0,0,0.55)" : "none",
    padding: text.background === "transparent" ? 0 : `${8 * scale}px ${16 * scale}px`,
    borderRadius: `${6 * scale}px`,
    lineHeight: 1.15,
    whiteSpace: "pre-wrap" as const,
  };
}

/** CSS transform for a clip's transform block plus animated opacity. */
export function transformCss(
  transform: { scale: number; x: number; y: number; rotation: number; flipH: boolean; flipV: boolean },
  opacity: number,
) {
  return {
    transform: `translate(${transform.x}%, ${transform.y}%) rotate(${transform.rotation}deg) scale(${
      transform.scale * (transform.flipH ? -1 : 1)
    }, ${transform.scale * (transform.flipV ? -1 : 1)})`,
    opacity,
  };
}
