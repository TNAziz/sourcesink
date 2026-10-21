// Build the desktop shell: bundle main + preload (CommonJS, as Electron's
// sandboxed preload requires), build the UI with relative asset paths, and
// copy it next to the shell for packaging.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const common = { bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], sourcemap: true, logLevel: "warning" };

await build({ ...common, entryPoints: [join(here, "src/main.ts")], outfile: join(here, "dist/main.cjs") });
await build({ ...common, entryPoints: [join(here, "src/preload.ts")], outfile: join(here, "dist/preload.cjs") });

if (!process.argv.includes("--shell-only")) {
  const ui = join(here, "../ui");
  // npx is a .cmd shim on Windows, which needs a shell to run.
  execFileSync("npx", ["vite", "build", "--configLoader", "runner", "--base", "./"], {
    cwd: ui,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  rmSync(join(here, "ui"), { recursive: true, force: true });
  cpSync(join(ui, "dist"), join(here, "ui"), { recursive: true });
}
console.log("desktop shell built");
