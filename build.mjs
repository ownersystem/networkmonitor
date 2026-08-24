import { build, context } from "esbuild";
import { promises as fs } from "fs";
import path from "path";

const isWatch = process.argv.includes("--watch");
const outDir = path.resolve("dist");

const entryPoints = [
  { in: "src/background/background.ts", out: "background/background" },
  { in: "src/popup/popup.ts", out: "popup/popup" },
  { in: "src/content/overlay.ts", out: "content/overlay" }
];

const staticFiles = [
  { from: "manifest.json", to: "manifest.json" },
  { from: "src/popup/popup.html", to: "popup/popup.html" },
  { from: "src/popup/popup.css", to: "popup/popup.css" },
  { from: "src/content/overlay.css", to: "content/overlay.css" },
  { from: "icons/icon16.png", to: "icons/icon16.png" },
  { from: "icons/icon48.png", to: "icons/icon48.png" },
  { from: "icons/icon128.png", to: "icons/icon128.png" }
];

async function clean() {
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
}

async function copyStatic() {
  for (const file of staticFiles) {
    const from = path.resolve(file.from);
    const to = path.join(outDir, file.to);
    await fs.mkdir(path.dirname(to), { recursive: true });
    try {
      await fs.copyFile(from, to);
    } catch (err) {
      console.warn(`[build] skip missing static file: ${file.from}`);
    }
  }
}

function optionsFor(entry, format) {
  return {
    entryPoints: [entry.in],
    outfile: path.join(outDir, `${entry.out}.js`),
    bundle: true,
    format,
    target: "chrome110",
    sourcemap: false,
    minify: false,
    logLevel: "info"
  };
}

const jobs = [
  optionsFor(entryPoints[0], "esm"),
  optionsFor(entryPoints[1], "iife"),
  optionsFor(entryPoints[2], "iife")
];

async function run() {
  await clean();
  await copyStatic();

  if (isWatch) {
    const ctxs = await Promise.all(jobs.map((opts) => context(opts)));
    await Promise.all(ctxs.map((ctx) => ctx.watch()));
    console.log("[build] watching for changes...");
  } else {
    for (const opts of jobs) {
      await build(opts);
    }
    console.log("[build] build complete -> dist/");
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
