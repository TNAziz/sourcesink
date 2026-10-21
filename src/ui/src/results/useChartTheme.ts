/**
 * Live theme colors for the chart. Reads the design tokens from the CSS
 * custom properties on <html> and re-reads them whenever the theme changes:
 * either via the `data-theme` attribute or the prefers-color-scheme query.
 */
import { useEffect, useMemo, useState } from "react";
import { buildPalette, resolveDark, type ThemeKindColors } from "./palette";

export interface ChartTheme {
  dark: boolean;
  /** Up to 8 distinct series colors, first entries from the kind colors. */
  palette: string[];
  text: string;
  muted: string;
  border: string;
  surface: string;
}

function mediaPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function currentSignature(): string {
  const attr = document.documentElement.getAttribute("data-theme");
  return `${attr ?? "auto"}|${mediaPrefersDark() ? "dark" : "light"}`;
}

function readTheme(): ChartTheme {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string): string => {
    const value = style.getPropertyValue(name).trim();
    return value === "" ? fallback : value;
  };
  const kinds: ThemeKindColors = {
    stock: token("--stock", "#3b6ef5"),
    flow: token("--flow", "#0f9d8a"),
    converter: token("--converter", "#9a5cf0"),
    success: token("--success", "#1f9d6b"),
    danger: token("--danger", "#d6455d"),
  };
  return {
    dark: resolveDark(document.documentElement.getAttribute("data-theme"), mediaPrefersDark()),
    palette: buildPalette(kinds),
    text: token("--text", "#1b1f24"),
    muted: token("--text-muted", "#5f6b7a"),
    border: token("--border", "#e2e5ea"),
    surface: token("--surface", "#ffffff"),
  };
}

export function useChartTheme(): ChartTheme {
  const [signature, setSignature] = useState(currentSignature);

  useEffect(() => {
    const html = document.documentElement;
    const observer = new MutationObserver(() => setSignature(currentSignature()));
    observer.observe(html, { attributes: true, attributeFilter: ["data-theme"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onMedia = (): void => setSignature(currentSignature());
    media.addEventListener("change", onMedia);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", onMedia);
    };
  }, []);

  // When the signature changes the custom properties have already changed, so
  // a fresh read picks up the new palette.
  return useMemo(() => readTheme(), [signature]);
}
