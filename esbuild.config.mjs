// Builds the plugin into dist/. With VAULT_PLUGIN_DIR set, also installs it in
// that folder of a vault (main.js, manifest.json, styles.css).
import esbuild from "esbuild";
import { packageRelease } from "./scripts/package-release.mjs";
import { copyFileSync, mkdirSync } from "fs";

const result = await esbuild.build({
  metafile: true,
  entryPoints: ["main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  target: "es2020",
  minify: true,
  logLevel: "info",
  outfile: "dist/main.js",
});

packageRelease(result.metafile);

const target = process.env.VAULT_PLUGIN_DIR;
if (target) {
  mkdirSync(target, { recursive: true });
  for (const [from, to] of [["dist/main.js", "main.js"], ["manifest.json", "manifest.json"], ["styles.css", "styles.css"]]) copyFileSync(from, `${target}/${to}`);
  console.log(`installed in ${target}`);
}
