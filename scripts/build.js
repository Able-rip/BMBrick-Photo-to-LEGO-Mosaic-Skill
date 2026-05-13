import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const targets = [
  { input: "dist/engine.js", output: "dist/engine.js" },
  { input: "dist/mcp-server.js", output: "dist/mcp-server.js" },
];

for (const { input, output } of targets) {
  const inputPath = join(ROOT, input);
  const outputPath = join(ROOT, output);

  const cmd = [
    "npx javascript-obfuscator",
    `"${inputPath}"`,
    `-o "${outputPath}"`,
    "--compact true",
    "--control-flow-flattening true",
    "--control-flow-flattening-threshold 0.75",
    "--dead-code-injection true",
    "--dead-code-injection-threshold 0.4",
    "--identifier-names-generator hexadecimal",
    "--string-array true",
    "--string-array-encoding base64",
    "--string-array-threshold 0.75",
    "--transform-object-keys true",
  ].join(" ");

  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
  console.log(`Built: ${output}`);
}

console.log("Done.");
