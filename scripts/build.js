#!/usr/bin/env node
// scripts/build.js
// Builds browser-specific extension packages for Chrome and Firefox.
//
// Usage:
//   node scripts/build.js                # build both (zip)
//   node scripts/build.js chrome         # build Chrome only (zip)
//   node scripts/build.js firefox        # build Firefox only (zip)
//   node scripts/build.js firefox --dev  # Firefox dev: symlinks source files
//   node scripts/build.js chrome --dev   # Chrome dev: symlinks source files
//
// With --dev, source files are symlinked so changes are reflected instantly
// without rebuilding. Load dist/<browser>/ as an unpacked/temporary extension.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const isDev = process.argv.includes("--dev");

// Files and directories to include in the extension package
const SOURCES = [
  "background.js",
  "config.js",
  "content.js",
  "model.js",
  "audio.js",
  "ui.js",
  "geo.js",
  "inference-worker.js",
  "onnx",
  "model_zoo",
  "language",
  "styles",
  "icons"
];

function clean(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function linkOrCopy(destDir) {
  for (const item of SOURCES) {
    const src = path.join(ROOT, item);
    const dest = path.join(destDir, item);
    if (!fs.existsSync(src)) {
      console.warn(`  warning: ${item} not found, skipping`);
      continue;
    }
    copyRecursive(src, dest);
  }
}

function writeManifest(dir, manifest) {
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
}

function buildChrome() {
  const dir = path.join(DIST, "chrome");
  clean(dir);
  console.log(`Building Chrome extension${isDev ? " (dev)" : ""}...`);

  linkOrCopy(dir);

  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, "manifest.json"), "utf-8")
  );
  writeManifest(dir, manifest);

  if (!isDev) {
    const zipPath = path.join(DIST, "inat-sound-classifier-chrome.zip");
    execSync(`cd "${dir}" && zip -r "${zipPath}" .`, { stdio: "pipe" });
    console.log(`  -> ${path.relative(ROOT, zipPath)}`);
  } else {
    console.log(`  -> Load ${path.relative(ROOT, dir)} as unpacked extension`);
  }
}

function buildFirefox() {
  const dir = path.join(DIST, "firefox");
  clean(dir);
  console.log(`Building Firefox extension${isDev ? " (dev)" : ""}...`);

  linkOrCopy(dir);

  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, "manifest.json"), "utf-8")
  );

  // Replace service_worker with scripts for Firefox background page
  manifest.background = { scripts: ["background.js"] };

  // Add Firefox-required gecko ID
  manifest.browser_specific_settings = {
    gecko: {
      id: "inat-sound-classifier@biodiversica",
      strict_min_version: "128.0",
    },
  };

  writeManifest(dir, manifest);

  if (!isDev) {
    const zipPath = path.join(DIST, "inat-sound-classifier-firefox.zip");
    execSync(`cd "${dir}" && zip -r "${zipPath}" .`, { stdio: "pipe" });
    console.log(`  -> ${path.relative(ROOT, zipPath)}`);
  } else {
    console.log(`  -> Load ${path.relative(ROOT, dir)} as temporary add-on`);
  }
}

// --- Main ---
const args = process.argv.filter((a) => !a.startsWith("--"));
const target = args[2];

clean(DIST);

if (!target || target === "chrome") buildChrome();
if (!target || target === "firefox") buildFirefox();

console.log("Done.");
