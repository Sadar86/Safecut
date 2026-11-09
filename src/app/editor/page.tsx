import type { Metadata } from "next";
import { EditorShell } from "@/components/editor-shell";

export const metadata: Metadata = {
  title: "Editor — SafeCut",
};

export default function EditorPage() {
  return <EditorShell />;
}
