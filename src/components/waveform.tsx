"use client";

import { useEffect, useMemo, useRef } from "react";
import { useAnalysis } from "@/stores/analysis";
import type { Clip } from "@/types";

/**
 * Waveform strip drawn for a clip. Peak data is computed once per asset by the
 * analysis store, then scaled to the clip's in-point / speed / zoom.
 */
export function Waveform({
  clip,
  pxPerSec,
  height,
  className,
}: {
  clip: Clip;
  pxPerSec: number;
  height: number;
  className?: string;
}) {
  const peaks = useAnalysis((s) => (clip.mediaId ? s.waveforms[clip.mediaId] : undefined));
  const ensure = useAnalysis((s) => s.ensureWaveform);
  const waveform = useAnalysis((s) => s.waveforms);

  useEffect(() => {
    if (clip.mediaId) ensure(clip.mediaId);
  }, [clip.mediaId, ensure]);

  const bars = useMemo(() => {
    if (!peaks) return [] as number[];
    const total = Math.max(8, Math.floor(clip.duration * pxPerSec / 3));
    const out: number[] = [];
    const startFrac = clip.sourceDuration > 0 ? clip.inPoint / clip.sourceDuration : 0;
    const spanFrac = clip.sourceDuration > 0 ? (clip.duration * clip.speed) / clip.sourceDuration : 1;
    for (let i = 0; i < total; i++) {
      const p = startFrac + (i / total) * spanFrac;
      const idx = Math.min(peaks.peaks.length - 1, Math.max(0, Math.floor(p * peaks.peaks.length)));
      out.push(peaks.peaks[idx] ?? 0);
    }
    return out;
  }, [peaks, clip.duration, clip.inPoint, clip.speed, clip.sourceDuration, pxPerSec]);

  void waveform;
  if (!clip.mediaId || bars.length === 0) return null;

  const mid = height / 2;
  return (
    <svg
      className={className}
      width="100%"
      height={height}
      viewBox={`0 0 ${bars.length} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {bars.map((value, i) => {
        const h = Math.max(1, value * (height - 2));
        return <rect key={i} x={i} y={mid - h / 2} width={1} height={h} fill="rgba(255,255,255,0.55)" />;
      })}
    </svg>
  );
}

/** Big waveform for the audio panel preview. */
export function WaveformPreview({ assetId }: { assetId: string }) {
  const peaks = useAnalysis((s) => s.waveforms[assetId]);
  const ensure = useAnalysis((s) => s.ensureWaveform);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    ensure(assetId);
  }, [assetId, ensure]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#22c55e";
    const step = width / peaks.peaks.length;
    peaks.peaks.forEach((value, i) => {
      const h = Math.max(1, value * height * 0.9);
      ctx.fillRect(i * step, (height - h) / 2, Math.max(1, step * 0.8), h);
    });
  }, [peaks]);

  return (
    <canvas
      ref={canvasRef}
      width={280}
      height={56}
      className="w-full rounded bg-surface"
      aria-label="Audio waveform"
    />
  );
}
