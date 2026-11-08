"use client";

import { useEffect } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { create } from "zustand";

/* --------------------------------- theme --------------------------------- */

type Theme = "dark" | "light";

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: "dark",
  setTheme: (theme) => {
    set({ theme });
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", theme === "dark");
      try {
        localStorage.setItem("safecut.theme", theme);
      } catch {
        /* ignore */
      }
    }
  },
  toggle: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
}));

export function ThemeBootstrap() {
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem("safecut.theme");
    } catch {
      stored = null;
    }
    const initial: Theme =
      stored === "light" || stored === "dark"
        ? stored
        : window.matchMedia?.("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark";
    useTheme.getState().setTheme(initial);
  }, []);
  return null;
}

/* -------------------------------- button --------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-white hover:brightness-110 active:brightness-95 shadow-sm disabled:opacity-50",
  secondary: "bg-surface-3 text-content hover:bg-surface-3/70 disabled:opacity-50",
  ghost: "bg-transparent text-content hover:bg-surface-3/70 disabled:opacity-50",
  danger: "bg-red-500 text-white hover:bg-red-600 disabled:opacity-50",
  outline:
    "border border-border-subtle bg-transparent text-content hover:bg-surface-3/60 disabled:opacity-50",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5 rounded-md",
  md: "h-9 px-3.5 text-sm gap-2 rounded-lg",
  lg: "h-11 px-5 text-base gap-2 rounded-xl",
  icon: "h-8 w-8 rounded-md justify-center",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  active?: boolean;
}

export function Button({
  className,
  variant = "secondary",
  size = "md",
  active,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex select-none items-center font-medium transition-colors disabled:pointer-events-none",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        active && "ring-2 ring-brand/60 bg-brand/15 text-brand",
        className,
      )}
      {...props}
    />
  );
}

/* --------------------------------- panel --------------------------------- */

export function Panel({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("bg-surface-2 border-border-subtle", className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
      <span>{children}</span>
      {right}
    </div>
  );
}

/* --------------------------------- slider -------------------------------- */

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  onReset?: () => void;
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  onReset,
  className,
  ...rest
}: SliderProps) {
  return (
    <label className={cn("block", className)}>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <button
          type="button"
          onDoubleClick={onReset}
          className="font-mono text-[11px] text-content/80 tabular-nums"
          title={onReset ? "Double-click to reset" : undefined}
        >
          {format ? format(value) : value}
        </button>
      </div>
      <input
        type="range"
        className="w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        {...rest}
      />
    </label>
  );
}

/* -------------------------------- switch --------------------------------- */

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors",
        checked ? "bg-brand" : "bg-surface-3",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/* --------------------------------- modal --------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "sc-fade-in relative w-full overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-2xl",
          width,
        )}
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close dialog">
            ✕
          </Button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

/* --------------------------------- toast --------------------------------- */

interface Toast {
  id: number;
  message: string;
  tone: "info" | "error" | "success";
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, tone?: Toast["tone"]) => void;
  dismiss: (id: number) => void;
}

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (message, tone = "info") => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function toast(message: string, tone: Toast["tone"] = "info") {
  useToasts.getState().push(message, tone);
}

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={cn(
            "sc-fade-in pointer-events-auto rounded-lg border px-4 py-2 text-sm shadow-lg",
            t.tone === "error"
              ? "border-red-500/40 bg-red-500/15 text-red-300"
              : t.tone === "success"
                ? "border-brand/40 bg-brand/15 text-brand"
                : "border-border-subtle bg-surface-3 text-content",
          )}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
