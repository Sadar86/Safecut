"use client";

import type { MediaAsset, Project } from "@/types";
import { normaliseProject } from "@/lib/project";

/**
 * Persistence layer.
 *
 * Projects live in IndexedDB (structured, large, fast) while the media blobs
 * live in a separate object store so saving a project never rewrites gigabytes
 * of video data. Both fall back to localStorage/no-op when IndexedDB is
 * unavailable (private mode, SSR) so the editor never crashes on storage.
 */

const DB_NAME = "safecut";
const DB_VERSION = 1;
const PROJECTS = "projects";
const BLOBS = "blobs";
const WAVEFORMS = "waveforms";
const META_KEY = "safecut.projectList";

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  duration: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
      if (!db.objectStoreNames.contains(WAVEFORMS)) db.createObjectStore(WAVEFORMS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve, reject) => {
        if (!db) return resolve(null);
        const transaction = db.transaction(store, mode);
        const request = fn(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      }),
  );
}

/* ------------------------------- media blobs ------------------------------ */

export async function putBlob(id: string, blob: Blob) {
  try {
    await tx(BLOBS, "readwrite", (s) => s.put(blob, id));
  } catch {
    /* quota or private mode: keep the in-memory object URL only */
  }
}

export async function getBlob(id: string): Promise<Blob | null> {
  try {
    return await tx<Blob>(BLOBS, "readonly", (s) => s.get(id));
  } catch {
    return null;
  }
}

export async function deleteBlob(id: string) {
  try {
    await tx(BLOBS, "readwrite", (s) => s.delete(id));
  } catch {
    /* ignore */
  }
}

/** Re-attach runtime object URLs to the assets of a freshly loaded project. */
export async function hydrateAssets(project: Project): Promise<Project> {
  const assets: MediaAsset[] = [];
  for (const asset of project.assets) {
    const blob = await getBlob(asset.id);
    assets.push(blob ? { ...asset, url: URL.createObjectURL(blob) } : asset);
  }
  return { ...project, assets };
}

/** Store any extra blob (alpha matte, background image) by key. */
export async function putAuxBlob(key: string, blob: Blob) {
  try {
    await tx(BLOBS, "readwrite", (s) => s.put(blob, key));
  } catch {
    /* quota or private mode */
  }
}

export async function getAuxBlob(key: string): Promise<Blob | null> {
  try {
    return await tx<Blob>(BLOBS, "readonly", (s) => s.get(key));
  } catch {
    return null;
  }
}

/* ------------------------------- waveforms ------------------------------- */

export async function saveWaveform(assetId: string, data: unknown) {
  try {
    await tx(WAVEFORMS, "readwrite", (s) => s.put(data, assetId));
  } catch {
    /* ignore */
  }
}

export async function loadWaveform<T>(assetId: string): Promise<T | null> {
  try {
    return await tx<T>(WAVEFORMS, "readonly", (s) => s.get(assetId));
  } catch {
    return null;
  }
}

/** Mark the project as dirty so an unexpected close can be recovered. */
export function markDirty(dirty: boolean) {
  try {
    if (dirty) localStorage.setItem("safecut.dirty", "1");
    else localStorage.removeItem("safecut.dirty");
  } catch {
    /* ignore */
  }
}

/* -------------------------------- projects -------------------------------- */

export async function saveProject(project: Project): Promise<void> {
  const stored: Project = { ...project, assets: project.assets.map((a) => ({ ...a, url: undefined })) };
  const ok = await tx(PROJECTS, "readwrite", (s) => s.put(stored));
  if (ok === null) {
    try {
      localStorage.setItem(`safecut.project.${project.id}`, JSON.stringify(stored));
    } catch {
      /* nothing else we can do */
    }
  }
  writeSummary(stored);
  markDirty(false);
}

function readSummaries(): ProjectSummary[] {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) ?? "[]") as ProjectSummary[];
  } catch {
    return [];
  }
}

function writeSummary(project: Project) {
  const list = readSummaries().filter((p) => p.id !== project.id);
  list.unshift({
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    duration: project.duration,
  });
  try {
    localStorage.setItem(META_KEY, JSON.stringify(list.slice(0, 100)));
  } catch {
    /* ignore */
  }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const dbProjects = await tx<Project[]>(PROJECTS, "readonly", (s) => s.getAll());
  const summaries = readSummaries();
  if (!dbProjects) return summaries;
  const known = new Set(summaries.map((s) => s.id));
  const extra = dbProjects
    .filter((p) => !known.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, duration: p.duration }));
  return [...summaries, ...extra].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: string): Promise<Project | null> {
  let raw: Project | null = null;
  try {
    raw = await tx<Project>(PROJECTS, "readonly", (s) => s.get(id));
  } catch {
    raw = null;
  }
  if (!raw) {
    const text = typeof localStorage !== "undefined" ? localStorage.getItem(`safecut.project.${id}`) : null;
    raw = text ? (JSON.parse(text) as Project) : null;
  }
  if (!raw) return null;
  const project = normaliseProject(raw);
  return hydrateAssets(project);
}

export async function deleteProject(id: string) {
  await tx(PROJECTS, "readwrite", (s) => s.delete(id));
  try {
    localStorage.removeItem(`safecut.project.${id}`);
    localStorage.setItem(META_KEY, JSON.stringify(readSummaries().filter((p) => p.id !== id)));
  } catch {
    /* ignore */
  }
}
