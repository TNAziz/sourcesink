/**
 * Series colors. The palette starts from the theme's element-kind colors (CSS
 * variables, resolved at runtime) and is topped up with fixed Okabe-Ito
 * colorblind-safe hues; at most 8 distinct colors, cycled afterwards.
 */

export interface ThemeKindColors {
  stock: string;
  flow: string;
  converter: string;
  success: string;
  danger: string;
}

/** Okabe-Ito hues used to fill the palette out to 8 entries. */
const EXTRAS = ["#e69f00", "#cc79a7", "#56b4e9", "#f0e442", "#d55e00", "#0072b2"];

/** Ordered, deduplicated list of up to 8 distinct series colors. */
export function buildPalette(kinds: ThemeKindColors): string[] {
  const wanted = [
    kinds.stock,
    EXTRAS[0],
    kinds.flow,
    EXTRAS[1],
    EXTRAS[2],
    kinds.success,
    kinds.converter,
    kinds.danger,
    ...EXTRAS,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const color of wanted) {
    if (out.length === 8) break;
    const key = color.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(color);
    }
  }
  return out;
}

/** Effective dark mode: an explicit `data-theme` wins over the media query. */
export function resolveDark(dataTheme: string | null, prefersDark: boolean): boolean {
  if (dataTheme === "dark") return true;
  if (dataTheme === "light") return false;
  return prefersDark;
}

/** A stable color per series name (its index in `names`, cycling the palette). */
export function seriesColorMap(
  names: readonly string[],
  palette: readonly string[],
): Map<string, string> {
  const map = new Map<string, string>();
  names.forEach((name, i) => map.set(name, palette[i % palette.length] ?? "#808080"));
  return map;
}
