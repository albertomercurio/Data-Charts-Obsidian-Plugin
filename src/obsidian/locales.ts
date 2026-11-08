// Month and day names of the time axis in the language of Obsidian.

import { registerLocale } from "echarts/core";
import DE from "echarts/lib/i18n/langDE.js";
import ES from "echarts/lib/i18n/langES.js";
import FR from "echarts/lib/i18n/langFR.js";
import IT from "echarts/lib/i18n/langIT.js";
import JA from "echarts/lib/i18n/langJA.js";
import NL from "echarts/lib/i18n/langNL.js";
import PL from "echarts/lib/i18n/langPL.js";
import PT from "echarts/lib/i18n/langPT-br.js";
import RU from "echarts/lib/i18n/langRU.js";
import ZH from "echarts/lib/i18n/langZH.js";

const LOCALES: Record<string, object> = { DE, ES, FR, IT, JA, NL, PL, "PT-br": PT, RU, ZH };

export function registerLocales(): void {
  for (const [code, locale] of Object.entries(LOCALES)) registerLocale(code, locale as Parameters<typeof registerLocale>[1]);
}

/** The ECharts locale for a language code of Obsidian ("it", "pt-br", "zh-cn"); English otherwise. */
export function chartLocale(language: string): string {
  const code = language.toLowerCase();
  if (code.startsWith("pt")) return "PT-br";
  const base = code.split("-")[0].toUpperCase();
  return base in LOCALES ? base : "EN";
}
