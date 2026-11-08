"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Clock,
  Copy,
  Download,
  Film,
  FolderOpen,
  Moon,
  Plus,
  Search,
  Sun,
  Trash2,
  Upload,
} from "lucide-react";
import { Button, Modal, useTheme, toast } from "@/components/ui";
import { Logo } from "@/components/top-bar";
import { createProject } from "@/lib/timeline";
import { demoProject, parseProjectFile, toProjectFile, projectFileName } from "@/lib/project";
import { deleteProject, listProjects, loadProject, saveProject, type ProjectSummary } from "@/lib/storage";
import { downloadBlob, formatTime } from "@/lib/utils";

export default function DashboardPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("My video");
  const router = useRouter();
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggle);

  const refresh = async () => setProjects(await listProjects());

  useEffect(() => {
    let cancelled = false;
    void listProjects().then((list) => {
      if (!cancelled) setProjects(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const create = async () => {
    const project = createProject(name.trim() || "Untitled project");
    await saveProject(project);
    router.push("/editor");
  };

  const duplicate = async (id: string) => {
    const project = await loadProject(id);
    if (!project) return;
    await saveProject({ ...project, id: crypto.randomUUID().replace(/-/g, "").slice(0, 12), name: `${project.name} copy`, createdAt: Date.now(), updatedAt: Date.now() });
    await refresh();
    toast("Project duplicated", "success");
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this project? This cannot be undone.")) return;
    await deleteProject(id);
    await refresh();
    toast("Project deleted", "success");
  };

  const exportOne = async (id: string) => {
    const project = await loadProject(id);
    if (!project) return;
    downloadBlob(new Blob([JSON.stringify(toProjectFile(project), null, 2)], { type: "application/json" }), projectFileName(project));
  };

  const importProject = async (file: File) => {
    try {
      const project = parseProjectFile(await file.text());
      project.id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      await saveProject(project);
      await refresh();
      toast("Project imported", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not import project", "error");
    }
  };

  const openDemo = async () => {
    const demo = demoProject();
    await saveProject(demo);
    router.push("/editor");
  };

  const filtered = projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="min-h-dvh bg-surface">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border-subtle bg-surface/90 px-4 backdrop-blur">
        <Logo />
        <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand">FREE</span>
        <div className="flex-1" />
        <Link href="/editor" className="text-xs text-muted hover:text-content">
          Editor
        </Link>
        <Link href="/help" className="text-xs text-muted hover:text-content">
          Help
        </Link>
        <Button size="icon" variant="ghost" onClick={toggleTheme} aria-label="Toggle theme">
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </Button>
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          <Plus size={14} /> New project
        </Button>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 py-8">
        <section className="mb-8 overflow-hidden rounded-2xl border border-border-subtle bg-gradient-to-br from-brand/15 via-surface-2 to-surface-2 p-6">
          <h1 className="text-2xl font-bold tracking-tight">Edit video in your browser. Free, forever.</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            SafeCut is a professional multitrack editor that runs on your machine: no watermarks, no
            export limits, no subscription. Your media never leaves your device.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => setOpen(true)}>
              <Plus size={15} /> Start a new project
            </Button>
            <Button variant="secondary" onClick={() => void openDemo()}>
              <Film size={15} /> Open the demo project
            </Button>
            <label>
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importProject(f);
                  e.target.value = "";
                }}
              />
              <span className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-surface-3 px-3.5 text-sm font-medium hover:bg-surface-3/70">
                <Upload size={15} /> Import project
              </span>
            </label>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold">My projects</h2>
            <span className="text-[11px] text-muted">{projects.length}</span>
            <div className="flex-1" />
            <div className="flex items-center gap-1 rounded-lg border border-border-subtle bg-surface-2 px-2">
              <Search size={13} className="text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects"
                className="h-8 w-40 bg-transparent text-xs outline-none"
                aria-label="Search projects"
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-subtle p-10 text-center text-sm text-muted">
              <FolderOpen className="mx-auto mb-2" size={22} />
              No projects yet — create one to start editing.
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((p) => (
                <li key={p.id} className="group overflow-hidden rounded-xl border border-border-subtle bg-surface-2">
                  <Link href="/editor" onClick={() => void loadProject(p.id)} className="block">
                    <div className="sc-grid-bg flex h-28 items-center justify-center bg-surface-3">
                      <Film size={26} className="text-muted" />
                    </div>
                  </Link>
                  <div className="p-3">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
                      <Clock size={11} /> {new Date(p.updatedAt).toLocaleString()} · {formatTime(p.duration)}
                    </p>
                    <div className="mt-2 flex items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                      <Link href="/editor" onClick={() => void loadProject(p.id)}>
                        <Button size="sm" variant="primary">
                          Open <ArrowRight size={12} />
                        </Button>
                      </Link>
                      <Button size="icon" variant="ghost" onClick={() => void duplicate(p.id)} aria-label="Duplicate project">
                        <Copy size={13} />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => void exportOne(p.id)} aria-label="Export project file">
                        <Download size={13} />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => void remove(p.id)} aria-label="Delete project">
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-10 grid gap-3 sm:grid-cols-3">
          {[
            { title: "Multitrack timeline", body: "Video, overlay, text and audio tracks with snapping, split, trim and drag-and-drop." },
            { title: "Colour & effects", body: "Filters, looks, transitions, keyframes and text animations rendered on a canvas you can export." },
            { title: "Private by design", body: "Media is stored in your browser's IndexedDB. Export runs locally; nothing is uploaded." },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border border-border-subtle bg-surface-2 p-4">
              <h3 className="text-sm font-semibold">{f.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">{f.body}</p>
            </div>
          ))}
        </section>
      </main>

      <Modal open={open} onClose={() => setOpen(false)} title="New project">
        <div className="space-y-3">
          <label className="block text-xs">
            Project name
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void create();
              }}
              className="mt-1 h-9 w-full rounded-lg border border-border-subtle bg-surface px-3 text-sm outline-none focus:border-brand"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void create()}>
              Create project
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
