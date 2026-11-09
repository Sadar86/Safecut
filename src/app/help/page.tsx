import Link from "next/link";
import { Logo } from "@/components/top-bar";

export const metadata = { title: "Help — SafeCut" };

const SECTIONS: { title: string; items: { q: string; a: string }[] }[] = [
  {
    title: "Getting started",
    items: [
      {
        q: "How do I import media?",
        a: "Open the Media tab in the left panel and use Import media, or drag files straight onto the panel. Then drag a clip from the library onto a timeline track.",
      },
      {
        q: "How do I split a clip?",
        a: "Select the clip, move the playhead where you want the cut and press S (or the scissors button). You can also drag the edges of a clip to trim it.",
      },
      {
        q: "Where are my projects saved?",
        a: "Projects and media are saved in your browser (IndexedDB) automatically. Use Project file to export a .safecut.json backup you can re-import anywhere.",
      },
    ],
  },
  {
    title: "Editing",
    items: [
      {
        q: "How do I animate a property?",
        a: "Select a clip, open Keyframes in Properties and add a keyframe at the playhead. Move the playhead, change opacity, scale or position, and add another keyframe — SafeCut interpolates between them.",
      },
      {
        q: "Can I change speed or reverse a clip?",
        a: "Yes: the Speed tab has presets, a slider, reverse playback and freeze frame.",
      },
      {
        q: "How do I add captions?",
        a: "Add a text clip from the Text tab, or import an SRT/VTT file (Subtitle panel, planned for Phase 3).",
      },
    ],
  },
  {
    title: "Export",
    items: [
      {
        q: "Is there a watermark or a paywall?",
        a: "No. Exports are watermark-free and unlimited; SafeCut has no paid tiers for core editing.",
      },
      {
        q: "Why does 4K export take longer?",
        a: "Rendering happens on your device. Bigger frames mean more pixels per frame, so export time scales with resolution, frame rate and your hardware.",
      },
      {
        q: "Which format should I choose?",
        a: "WebM (VP9) is supported by every modern browser. MP4 is offered when your browser's MediaRecorder supports it; otherwise SafeCut falls back to WebM.",
      },
    ],
  },
];

export default function HelpPage() {
  return (
    <div className="min-h-dvh bg-surface">
      <header className="flex h-14 items-center gap-3 border-b border-border-subtle px-4">
        <Link href="/">
          <Logo />
        </Link>
        <div className="flex-1" />
        <Link href="/editor" className="text-xs text-muted hover:text-content">
          Open editor
        </Link>
      </header>
      <main id="main" className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold">Help center</h1>
        <p className="mt-1 text-sm text-muted">Everything you need to know about editing with SafeCut.</p>
        <div className="mt-6 space-y-6">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">{s.title}</h2>
              <div className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle">
                {s.items.map((i) => (
                  <details key={i.q} className="group bg-surface-2 px-4 py-3">
                    <summary className="cursor-pointer text-sm font-medium">{i.q}</summary>
                    <p className="mt-2 text-xs leading-relaxed text-muted">{i.a}</p>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
