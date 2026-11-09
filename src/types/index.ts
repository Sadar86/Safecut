/**
 * SafeCut core data model.
 *
 * Everything the editor persists lives in a `Project`. The model is deliberately
 * plain-JSON so a project can be saved to IndexedDB, exported as a `.safecut`
 * file, or (later) synced to the cloud without any serialisation layer.
 */

export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:5" | "4:3" | "21:9" | "3:4";

export type MediaKind = "video" | "audio" | "image";

export interface MediaAsset {
  id: string;
  name: string;
  kind: MediaKind;
  mimeType: string;
  /** Size in bytes of the original file. */
  size: number;
  /** Duration in seconds (0 for images). */
  duration: number;
  width: number;
  height: number;
  /** Object URL of the stored blob (runtime only, never persisted). */
  url?: string;
  thumbnail?: string;
  createdAt: number;
  /** Audio-only extracted from a video asset. */
  hasAudio?: boolean;
  /** TTS script + voice used to generate this asset (for regeneration). */
  tts?: { text: string; voice: string; rate: number; pitch: number; lang: string };
  /** Set when the asset was produced by an AI feature. */
  source?: "import" | "extract" | "tts";
}

export type TrackKind = "video" | "audio" | "text" | "overlay";

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  locked: boolean;
  hidden: boolean;
  /** Vertical stacking order in the timeline (0 = top-most). */
  index?: number;
  /** 0..2 linear gain applied to every clip on the track. */
  volume: number;
}

export type TransitionKind =
  | "none"
  | "fade"
  | "dissolve"
  | "slide"
  | "zoom"
  | "wipe"
  | "spin"
  | "blur";

export type FilterKind =
  | "none"
  | "vintage"
  | "bw"
  | "sepia"
  | "cinematic"
  | "retro"
  | "cool"
  | "warm"
  | "vivid"
  | "faded"
  | "noir";

export interface ColorAdjustments {
  brightness: number; // 1 = neutral
  contrast: number; // 1 = neutral
  saturation: number; // 1 = neutral
  temperature: number; // -100..100, 0 = neutral
  tint: number; // -100..100, 0 = neutral
  exposure: number; // -100..100, 0 = neutral
  highlights: number; // -100..100
  shadows: number; // -100..100
  blur: number; // px, 0 = none
  sharpen: number; // 0..100
  vignette: number; // 0..100
  grain: number; // 0..100
  opacity: number; // 0..1
}

export interface Transform {
  scale: number; // 1 = 100%
  x: number; // percentage of frame width, 0 = centred
  y: number; // percentage of frame height, 0 = centred
  rotation: number; // degrees
  flipH: boolean;
  flipV: boolean;
}

export interface TextStyle {
  content: string;
  fontFamily: string;
  fontSize: number; // relative to a 1080-wide frame
  color: string;
  background: string; // "transparent" or a colour
  outlineColor: string;
  outlineWidth: number;
  shadow: boolean;
  align: "left" | "center" | "right";
  bold: boolean;
  italic: boolean;
  /** x/y in percent of the frame (0,0 = top-left). */
  x: number;
  y: number;
  animation: "none" | "fade" | "pop" | "slide-up" | "typewriter" | "word";
  /** Highlight colour used by the "word" (karaoke) animation. */
  highlightColor?: string;
  /** Words per line for captions (0 = no wrapping). */
  maxWordsPerLine?: number;
  /** Caption template id, for the caption panel. */
  template?: string;
}

export interface AudioSettings {
  volume: number; // 0..2
  fadeIn: number; // seconds
  fadeOut: number; // seconds
  muted: boolean;
  /** Simple 3-band equaliser, each -12..12 dB. */
  eq: { low: number; mid: number; high: number };
  /** Automatic ducking: lower this clip while a clip on `duckAgainst` plays. */
  ducking?: DuckingSettings;
  /** Denoise amount 0..1 applied when exporting audio. */
  denoise?: number;
  /** Voice-enhancement preset. */
  enhance?: "none" | "voice" | "podcast";
}

export interface DuckingSettings {
  enabled: boolean;
  /** Track kind that triggers the duck (usually the voice/video track). */
  trigger: "video" | "audio" | "text";
  /** Gain multiplier while the trigger is active (0.1..1). */
  amount: number;
  /** Seconds to ramp down and back up. */
  attack: number;
  release: number;
}

export type KeyframeProperty = "opacity" | "scale" | "x" | "y" | "rotation" | "volume";

export interface Keyframe {
  /** Seconds relative to the clip's in-point. */
  t: number;
  property: KeyframeProperty;
  value: number;
}

export interface Clip {
  id: string;
  trackId: string;
  mediaId: string | null;
  name: string;
  /** Timeline start in seconds. */
  start: number;
  /** Visible length on the timeline in seconds. */
  duration: number;
  /** Source in-point in seconds (where playback starts inside the media). */
  inPoint: number;
  /** Source media duration in seconds. */
  sourceDuration: number;
  /** Playback speed multiplier; 2 = 2x faster (half as long on screen). */
  speed: number;
  reversed: boolean;
  color: ColorAdjustments;
  filter: FilterKind;
  transform: Transform;
  audio: AudioSettings;
  transitionIn: TransitionKind;
  transitionOut: TransitionKind;
  /** Seconds; clamped to half the clip length by the helpers. */
  transitionDuration: number;
  text?: TextStyle;
  keyframes: Keyframe[];
  /** Freeze-frame clips reuse a single source frame. */
  freezeAt?: number;
  locked?: boolean;
  /** Background removal result, composited by the renderer. */
  background?: BackgroundSettings;
  /** Non-destructive voice enhancement. */
  voice?: VoiceEnhance;
}

export interface BackgroundSettings {
  enabled: boolean;
  kind: "transparent" | "color" | "image" | "blur";
  color: string;
  /** Object URL of the background image (runtime only). */
  imageUrl?: string;
  /** Object URL of the alpha matte (runtime only; stored as a blob). */
  matteUrl?: string;
  matteBlobId?: string;
  /** Seconds into the source where the matte was captured. */
  matteTime: number;
  /** 0..1 edge feather applied when compositing. */
  feather: number;
}

export interface VoiceEnhance {
  preset: string;
  intensity: number;
}

export interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
  aspectRatio: AspectRatio;
  background: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: ProjectSettings;
  assets: MediaAsset[];
  tracks: Track[];
  clips: Clip[];
  /** Seconds. */
  duration: number;
  /** Speech-to-text / imported captions attached to the project. */
  captions?: SubtitleCue[];
  /** Which asset the captions belong to. */
  captionSourceId?: string | null;
}

export interface SubtitleCue {
  id: string;
  start: number;
  end: number;
  text: string;
}

export const DEFAULT_COLOR: ColorAdjustments = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  tint: 0,
  exposure: 0,
  highlights: 0,
  shadows: 0,
  blur: 0,
  sharpen: 0,
  vignette: 0,
  grain: 0,
  opacity: 1,
};

export const DEFAULT_TRANSFORM: Transform = {
  scale: 1,
  x: 0,
  y: 0,
  rotation: 0,
  flipH: false,
  flipV: false,
};

export const DEFAULT_AUDIO: AudioSettings = {
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
  muted: false,
  eq: { low: 0, mid: 0, high: 0 },
};

export const DEFAULT_TEXT: TextStyle = {
  content: "Your text here",
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: 72,
  color: "#ffffff",
  background: "transparent",
  outlineColor: "#000000",
  outlineWidth: 0,
  shadow: true,
  align: "center",
  bold: true,
  italic: false,
  x: 50,
  y: 50,
  animation: "fade",
};

export const ASPECT_PRESETS: Record<AspectRatio, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "4:3": { width: 1440, height: 1080 },
  "21:9": { width: 2560, height: 1080 },
  "3:4": { width: 1080, height: 1440 },
};
