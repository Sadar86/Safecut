/**
 * Voice enhancement analysis (non-destructive).
 *
 * The exported mix is rendered with `OfflineAudioContext` from the project, so
 * these parameters describe what the enhancement graph should do; the preview
 * uses the same numbers on live media elements.
 */

import { rms, toDb } from "@/lib/audio-math";

export interface VoicePreset {
  id: string;
  name: string;
  description: string;
  /** High-pass cutoff (Hz) to remove rumble. */
  highpass: number;
  /** Low-pass cutoff (Hz) to tame hiss. */
  lowpass: number;
  /** Presence lift in dB around 3 kHz. */
  presenceDb: number;
  /** Compression threshold in dB. */
  thresholdDb: number;
  /** Compression ratio. */
  ratio: number;
  /** Make-up gain in dB. */
  makeupDb: number;
  /** Gate threshold in dB for noise below speech level. */
  gateDb: number;
}

export const VOICE_PRESETS: VoicePreset[] = [
  {
    id: "none",
    name: "Off",
    description: "Original audio, untouched.",
    highpass: 0,
    lowpass: 20000,
    presenceDb: 0,
    thresholdDb: 0,
    ratio: 1,
    makeupDb: 0,
    gateDb: -80,
  },
  {
    id: "clean",
    name: "Clean voice",
    description: "Gentle rumble and hiss removal, light levelling.",
    highpass: 90,
    lowpass: 12000,
    presenceDb: 1.5,
    thresholdDb: -24,
    ratio: 2,
    makeupDb: 1,
    gateDb: -55,
  },
  {
    id: "podcast",
    name: "Podcast",
    description: "Tighter low end, strong presence, firm compression.",
    highpass: 110,
    lowpass: 14000,
    presenceDb: 3,
    thresholdDb: -20,
    ratio: 3.5,
    makeupDb: 2,
    gateDb: -50,
  },
  {
    id: "noisy",
    name: "Noisy room",
    description: "Aggressive gate and high-pass for rooms with hum or fans.",
    highpass: 140,
    lowpass: 9000,
    presenceDb: 2,
    thresholdDb: -22,
    ratio: 3,
    makeupDb: 2.5,
    gateDb: -42,
  },
];

export function presetById(id: string): VoicePreset {
  return VOICE_PRESETS.find((p) => p.id === id) ?? VOICE_PRESETS[0];
}

/** Interpolate between "off" and a preset by an intensity 0..1. */
export function scalePreset(preset: VoicePreset, intensity: number): VoicePreset {
  const k = Math.max(0, Math.min(1, intensity));
  return {
    ...preset,
    highpass: preset.highpass * k,
    lowpass: 20000 - (20000 - preset.lowpass) * k,
    presenceDb: preset.presenceDb * k,
    thresholdDb: preset.thresholdDb * k,
    ratio: 1 + (preset.ratio - 1) * k,
    makeupDb: preset.makeupDb * k,
    gateDb: preset.gateDb === -80 ? -80 : -80 + (preset.gateDb + 80) * k,
  };
}

export interface VoiceAnalysis {
  rmsDb: number;
  /** Estimated noise floor in dB (10th percentile of window RMS). */
  noiseFloorDb: number;
  /** Estimated speech level in dB (90th percentile). */
  speechDb: number;
  /** Signal-to-noise estimate in dB. */
  snrDb: number;
  clippedRatio: number;
  /** Recommended preset for this material. */
  recommendation: string;
}

/** Analyse a mono channel and recommend a preset. */
export function analyseVoice(channel: Float32Array, sampleRate: number): VoiceAnalysis {
  const windowSize = Math.max(64, Math.floor(sampleRate * 0.05));
  const levels: number[] = [];
  let clipped = 0;
  for (let i = 0; i < channel.length; i += windowSize) {
    const slice = channel.subarray(i, Math.min(channel.length, i + windowSize));
    levels.push(toDb(rms(slice)));
    for (let j = 0; j < slice.length; j += 4) {
      if (Math.abs(slice[j]) > 0.99) clipped++;
    }
  }
  // Digital silence reports -Infinity; clamp it so percentiles stay usable.
  const FLOOR = -100;
  const finite = levels.map((l) => (Number.isFinite(l) ? l : FLOOR)).sort((a, b) => a - b);
  const pick = (p: number) => (finite.length ? finite[Math.min(finite.length - 1, Math.floor(p * finite.length))] : FLOOR);
  const noiseFloorDb = pick(0.1);
  const speechDb = pick(0.9);
  const snrDb = speechDb - noiseFloorDb;
  const rmsDb = toDb(rms(channel));
  const clippedRatio = channel.length ? clipped / (channel.length / 4) : 0;

  let recommendation = "clean";
  if (snrDb < 12) recommendation = "noisy";
  else if (snrDb > 30 && rmsDb > -20) recommendation = "podcast";

  return {
    rmsDb: Number.isFinite(rmsDb) ? rmsDb : -100,
    noiseFloorDb,
    speechDb,
    snrDb: Number.isFinite(snrDb) ? snrDb : 0,
    clippedRatio,
    recommendation,
  };
}

/** The plan for a voice chain, independent of any AudioContext. */
export interface VoiceChainPlan {
  highpass: number | null;
  lowpass: number | null;
  presenceDb: number;
  compressor: { threshold: number; ratio: number; knee: number; attack: number; release: number } | null;
  makeupGain: number;
}

/** Turn a preset + intensity into a concrete chain description. */
export function planVoiceChain(preset: VoicePreset, intensity = 1): VoiceChainPlan {
  const scaled = scalePreset(preset, intensity);
  return {
    highpass: scaled.highpass > 0 ? scaled.highpass : null,
    lowpass: scaled.lowpass < 19900 ? scaled.lowpass : null,
    presenceDb: scaled.presenceDb,
    compressor:
      scaled.ratio > 1
        ? { threshold: scaled.thresholdDb, ratio: scaled.ratio, knee: 12, attack: 0.004, release: 0.18 }
        : null,
    makeupGain: Math.pow(10, scaled.makeupDb / 20),
  };
}

/**
 * Build the Web Audio nodes for a voice chain on any AudioContext.
 * Returns the input node so callers can connect a source to it.
 */
export function buildVoiceChain(
  ctx: BaseAudioContext,
  preset: VoicePreset,
  intensity = 1,
): { input: AudioNode; output: AudioNode } {
  const plan = planVoiceChain(preset, intensity);
  const input = new GainNode(ctx, { gain: 1 });
  let node: AudioNode = input;

  if (plan.highpass) {
    const hp = new BiquadFilterNode(ctx, { type: "highpass", frequency: plan.highpass, Q: 0.7 });
    node.connect(hp);
    node = hp;
  }
  if (plan.lowpass) {
    const lp = new BiquadFilterNode(ctx, { type: "lowpass", frequency: plan.lowpass, Q: 0.7 });
    node.connect(lp);
    node = lp;
  }
  if (plan.presenceDb > 0) {
    const presence = new BiquadFilterNode(ctx, { type: "peaking", frequency: 3000, Q: 1.1, gain: plan.presenceDb });
    node.connect(presence);
    node = presence;
  }
  if (plan.compressor) {
    const comp = new DynamicsCompressorNode(ctx, plan.compressor);
    node.connect(comp);
    node = comp;
    const makeup = new GainNode(ctx, { gain: plan.makeupGain });
    node.connect(makeup);
    node = makeup;
  }
  return { input, output: node };
}
