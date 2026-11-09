/**
 * On-device AI model registry.
 *
 * All models are fetched from the Hugging Face CDN on first use and cached by the
 * browser (Cache Storage), so later runs work offline. Nothing is uploaded.
 *
 * Model sizes are the *approximate* download sizes; the first run of each feature
 * pays them once per browser profile.
 */

export type ModelTask = "asr" | "segmentation" | "tts";

export interface ModelInfo {
  id: string;
  task: ModelTask;
  label: string;
  /** Approximate download size in MB. */
  sizeMb: number;
  runtime: "transformers.js" | "web-speech" | "system";
  /** True when audio/video never leaves the device. */
  local: boolean;
  notes: string;
}

export const MODELS: Record<string, ModelInfo> = {
  "whisper-tiny.en": {
    id: "onnx-community/whisper-tiny.en",
    task: "asr",
    label: "Whisper tiny (English)",
    sizeMb: 40,
    runtime: "transformers.js",
    local: true,
    notes: "Word-level timestamps, runs on WASM. Best speed/accuracy trade-off for short clips.",
  },
  "whisper-base": {
    id: "onnx-community/whisper-base",
    task: "asr",
    label: "Whisper base (multilingual)",
    sizeMb: 80,
    runtime: "transformers.js",
    local: true,
    notes: "99 languages, slower than tiny on CPU. WebGPU strongly recommended.",
  },
  "whisper-small": {
    id: "onnx-community/whisper-small",
    task: "asr",
    label: "Whisper small (multilingual)",
    sizeMb: 250,
    runtime: "transformers.js",
    local: true,
    notes: "Highest accuracy here; needs a desktop GPU (WebGPU) to be usable.",
  },
  "web-speech": {
    id: "web-speech",
    task: "asr",
    label: "Browser speech recognition",
    sizeMb: 0,
    runtime: "web-speech",
    local: false,
    notes: "No download. Availability and processing location depend on the browser.",
  },
  "selfie-segmentation": {
    id: "Xenova/modnet",
    task: "segmentation",
    label: "MODNet portrait segmentation",
    sizeMb: 25,
    runtime: "transformers.js",
    local: true,
    notes: "Portrait/people matting. Fast on CPU for short clips; frames are processed one by one.",
  },
  "tts-system": {
    id: "speech-synthesis",
    task: "tts",
    label: "System voices (Web Speech)",
    sizeMb: 0,
    runtime: "system",
    local: true,
    notes: "Uses the OS voices. Voice list and language coverage depend on the device.",
  },
};

/** Human-readable device report for the AI panels. */
export interface DeviceCapabilities {
  webgpu: boolean;
  webgl: boolean;
  cores: number;
  deviceMemoryGb?: number;
  sampleRate: number;
  recommendedModel: string;
  tier: "low" | "medium" | "high";
  warnings: string[];
}

export async function detectCapabilities(): Promise<DeviceCapabilities> {
  const warnings: string[] = [];
  const gpu = typeof navigator !== "undefined" && "gpu" in navigator;
  let webgpu = false;
  if (gpu) {
    try {
      const adapter = await (navigator as unknown as { gpu: { requestAdapter: () => Promise<unknown> } }).gpu.requestAdapter();
      webgpu = Boolean(adapter);
    } catch {
      webgpu = false;
    }
  }
  if (!webgpu) warnings.push("WebGPU is unavailable — on-device models will run on the CPU and be slower.");

  let webgl = false;
  try {
    const canvas = document.createElement("canvas");
    webgl = Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    webgl = false;
  }

  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory;

  let tier: DeviceCapabilities["tier"] = "low";
  if (webgpu && cores >= 8) tier = "high";
  else if (cores >= 4) tier = "medium";

  if (memory !== undefined && memory < 4) warnings.push("Low device memory (<4 GB): background removal will be slow.");

  const recommendedModel =
    tier === "high" ? "whisper-base" : tier === "medium" ? "whisper-tiny.en" : "web-speech";

  return {
    webgpu,
    webgl,
    cores,
    deviceMemoryGb: memory,
    sampleRate: 16000,
    recommendedModel,
    tier,
    warnings,
  };
}

/** Approximate peak memory for a model + working buffers. */
export function estimatedMemoryMb(modelKey: string): number {
  const model = MODELS[modelKey];
  if (!model) return 0;
  return Math.round(model.sizeMb * 1.8);
}

/** Progress events emitted by the loaders (0..1). */
export type ModelProgress = (progress: { file?: string; loaded: number; total: number; ratio: number }) => void;
