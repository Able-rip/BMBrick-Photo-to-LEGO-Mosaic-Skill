import { copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MAIN_REPO = join(ROOT, "..", "BrickArt");

const files = [
  "case-preview-renderer.mjs",
  "color-science.mjs",
  "fidelity-pipeline.mjs",
  "quantize-core.mjs",
  "render-style.mjs",
];

for (const file of files) {
  const src = join(MAIN_REPO, "bmbrick-mosaic-engine", "src", "lib", file);
  const dest = join(ROOT, "dist", "lib", file);
  copyFileSync(src, dest);
  console.log(`Synced: ${file}`);
}

console.log("Done. Run 'npm run build' to obfuscate.");
