import { MoonIcon, SunIcon, MonitorIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./button";

type ThemeMode = "light" | "dark" | "auto";

function readStored(): ThemeMode {
  if (typeof window === "undefined") return "auto";
  const v = window.localStorage.getItem("theme");
  return v === "light" || v === "dark" || v === "auto" ? v : "auto";
}

function apply(mode: ThemeMode) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = mode === "auto" ? (prefersDark ? "dark" : "light") : mode;
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  if (mode === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
  root.style.colorScheme = resolved;
}

export function ThemeToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<ThemeMode>("auto");

  useEffect(() => {
    const initial = readStored();
    setMode(initial);
    apply(initial);
  }, []);

  useEffect(() => {
    if (mode !== "auto") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("auto");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [mode]);

  function cycle() {
    const next: ThemeMode = mode === "light" ? "dark" : mode === "dark" ? "auto" : "light";
    setMode(next);
    apply(next);
    window.localStorage.setItem("theme", next);
  }

  const Icon = mode === "light" ? SunIcon : mode === "dark" ? MoonIcon : MonitorIcon;
  const label =
    mode === "auto"
      ? "Auto theme — click for light"
      : `${mode[0].toUpperCase()}${mode.slice(1)} theme — click to cycle`;

  return (
    <Button
      variant="outline"
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={cycle}
      className={className}
    >
      <Icon />
    </Button>
  );
}
