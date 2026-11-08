// The chart theme from Obsidian's CSS variables, resolved to plain colors: the
// canvas cannot read var() or calc(), so each value goes through a probe element.

import { CRITICAL, LIGHT, PALETTE, RAMP, type Theme } from "../option";

function resolve(probe: HTMLElement, variable: string, fallback: string): string {
  probe.style.color = `var(${variable})`;
  const color = getComputedStyle(probe).color;
  return color && color !== "rgba(0, 0, 0, 0)" ? color : fallback;
}

export function readTheme(): Theme {
  const body = document.body;
  const dark = body.classList.contains("theme-dark");
  const probe = body.createDiv({ attr: { "aria-hidden": "true" } });
  probe.style.display = "none";
  try {
    const font = getComputedStyle(body).getPropertyValue("--font-interface").trim();
    return {
      dark,
      text: resolve(probe, "--text-normal", LIGHT.text),
      secondary: resolve(probe, "--text-muted", LIGHT.secondary),
      muted: resolve(probe, "--text-muted", LIGHT.muted),
      grid: resolve(probe, "--background-modifier-border", LIGHT.grid),
      axis: resolve(probe, "--background-modifier-border-hover", LIGHT.axis),
      surface: resolve(probe, "--background-primary", LIGHT.surface),
      accent: resolve(probe, "--interactive-accent", LIGHT.accent),
      font: font || LIGHT.font,
      palette: dark ? PALETTE.dark : PALETTE.light,
      ramp: dark ? RAMP.dark : RAMP.light,
      critical: CRITICAL,
    };
  } finally {
    probe.remove();
  }
}
