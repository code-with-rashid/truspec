#!/usr/bin/env node
import { chmodSync, cpSync, createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

/**
 * Stages everything `tauri dev`/`tauri build` needs but can't check into git: a portable Node
 * binary (renamed to the target-triple suffix Tauri's `externalBin` sidecar convention requires)
 * and the built web sidecar bundle + client assets (shipped as `bundle.resources`, not
 * `externalBin` — see `tauri.conf.json`). Re-run whenever `@truspec/web`'s build output changes;
 * safe to re-run otherwise (the Node download is skipped once already staged).
 */
const NODE_VERSION = process.env.TRUSPEC_SIDECAR_NODE_VERSION ?? "22.13.0";
const FORCE = process.argv.includes("--force");

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const tauriDir = join(desktopRoot, "src-tauri");
const binariesDir = join(tauriDir, "binaries");
const resourcesDir = join(tauriDir, "resources");
const webDistDir = resolve(desktopRoot, "..", "web", "dist");

/** Tauri builds per-runner (no cross-compilation in v1) — target the machine we're running on. */
function currentTarget() {
  const { platform, arch } = process;
  if (platform === "win32" && arch === "x64") {
    return { triple: "x86_64-pc-windows-msvc", nodePlatform: "win-x64", exeExt: ".exe", archived: false };
  }
  if (platform === "darwin" && arch === "x64") {
    return { triple: "x86_64-apple-darwin", nodePlatform: "darwin-x64", exeExt: "", archived: true };
  }
  if (platform === "darwin" && arch === "arm64") {
    return { triple: "aarch64-apple-darwin", nodePlatform: "darwin-arm64", exeExt: "", archived: true };
  }
  if (platform === "linux" && arch === "x64") {
    return { triple: "x86_64-unknown-linux-gnu", nodePlatform: "linux-x64", exeExt: "", archived: true };
  }
  throw new Error(`Unsupported platform for the desktop sidecar: ${platform}/${arch}`);
}

async function download(url, destFile) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  mkdirSync(dirname(destFile), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destFile));
}

/** Download (or reuse) a portable Node runtime, named per Tauri's `externalBin` target-triple convention. */
async function stageNodeBinary(target) {
  const dest = join(binariesDir, `node-${target.triple}${target.exeExt}`);
  if (existsSync(dest) && !FORCE) {
    console.log(`  node binary already staged -> ${dest}`);
    return dest;
  }
  mkdirSync(binariesDir, { recursive: true });

  if (!target.archived) {
    // Windows ships a standalone node.exe directly — nothing to extract.
    await download(`https://nodejs.org/dist/v${NODE_VERSION}/${target.nodePlatform}/node.exe`, dest);
  } else {
    const archiveName = `node-v${NODE_VERSION}-${target.nodePlatform}.tar.gz`;
    const archivePath = join(tmpdir(), archiveName);
    await download(`https://nodejs.org/dist/v${NODE_VERSION}/${archiveName}`, archivePath);
    const extractDir = join(tmpdir(), `truspec-node-extract-${target.triple}`);
    rmSync(extractDir, { recursive: true, force: true });
    mkdirSync(extractDir, { recursive: true });
    // macOS/Linux always have a system `tar`; avoids adding a tar-extraction npm dependency.
    execFileSync("tar", ["-xzf", archivePath, "-C", extractDir]);
    cpSync(join(extractDir, `node-v${NODE_VERSION}-${target.nodePlatform}`, "bin", "node"), dest);
    rmSync(archivePath, { force: true });
    rmSync(extractDir, { recursive: true, force: true });
    chmodSync(dest, 0o755);
  }
  console.log(`  node binary -> ${dest}`);
  return dest;
}

/** Copy the sidecar's own resources (the web bundle + static client) in as `bundle.resources`. */
function stageResources() {
  const sidecarSrc = join(webDistDir, "sidecar", "cli-entry.cjs");
  const clientSrc = join(webDistDir, "client");
  if (!existsSync(sidecarSrc) || !existsSync(clientSrc)) {
    throw new Error(`Missing ${sidecarSrc} or ${clientSrc} — run "pnpm --filter @truspec/web build" first.`);
  }
  rmSync(resourcesDir, { recursive: true, force: true });
  const resServerDir = join(resourcesDir, "server");
  mkdirSync(resServerDir, { recursive: true });
  cpSync(sidecarSrc, join(resServerDir, "cli-entry.cjs"));
  cpSync(clientSrc, join(resourcesDir, "client"), { recursive: true });
  console.log(`  resources staged -> ${resourcesDir}`);
}

const target = currentTarget();
console.log(`Preparing desktop sidecar for ${target.triple} (Node v${NODE_VERSION})...`);
await stageNodeBinary(target);
stageResources();
console.log("Done.");
