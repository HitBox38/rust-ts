// ripgrep under real `cargo check` (plan-m7 §6, D11, D19, review F7; lane harness-m7a, after lane real-crates): both sides of the `check-rg*`
// suites, and their setup.
//
//   bun scripts/rg-check.ts setup
//   bun scripts/rg-check.ts run --label <suite> --side oracle|subject --target <tuple> [--encode-mir]
//
// `setup` puts ripgrep 15.2.0 and its `Cargo.lock`'s dependencies under $RUST_TS_DATA/ripgrep with an isolated CARGO_HOME. It is the only
// step that uses the network, and each file is checked against the crate's and the lock's pinned SHA-256.
//
// `run` is one side: the oracle's `cargo check --locked --offline --keep-going -j4 --target <tuple>`, with `RUSTC` set to scripts/rg-rustc.ts,
// whose header has the routing, and the environment of `rgCargoEnv` (`CARGO_INCREMENTAL=0`, D11; no git repository in reach of ripgrep's build.rs).
// - **Both sides build at one absolute target path,** `$RUST_TS_DATA/ripgrep/target/<label>`, one side at a time under a lock: a file `include!`d
//   from `OUT_DIR` keeps its absolute path in the metadata, so two paths give five false differences (`docs/handoff/real-crates.md`). The path
//   is the same, not normalised, so nothing real can be hidden. It is emptied before a run, and the tree is moved to
//   `kept/<label>/<side>` after it for diagnosis, with the logs in `kept/<label>/<side>-logs`.
// - **`--encode-mir`** (review F7): `-Copt-level=3 -Zalways-encode-mir` on every unit, so `optimized_mir` runs on every function and MIR is
//   encoded, which `--emit=metadata` alone never does.
// - **A bin crate's `.rmeta` is 0 bytes, so its row proves nothing:** `rg`'s section also compares its MIR. Its recorded argv and environment
//   without the JSON flags and `--emit`, plus `-Zunpretty=mir`, against that side's own `.rmeta`s. `CARGO_MAKEFLAGS` is dropped for this step,
//   as cargo's pipes are gone by then.
//
// Output, for difftest's splitter `rmetadump` (`== <key>` sections, scripts/lib/split.ts): a `check-rg` line, cargo's exit code, and a hash of
// every other file of the tree (`.d`, fingerprints, build script outputs) make the run's own case, and one `== <crate>` section per unit holds
// `exit`, `rmeta` (size and SHA-256), `stderr` (the same) and, for `rg`, `mir` and `mir stderr`. A unit that fails adds its first `unported`
// or error line, so a port stop is a DIFF of that crate and not of every crate. Cargo's own stdout and stderr hold timings: they go to the logs.
// This process exits 0 unless the setup is missing; difftest's run-level statuses would otherwise overwrite every crate's result.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA, REPO, parseArgs, die } from "./lib/common.ts";
import { withCaseLock } from "./lib/case-lock.ts";
import { sha256File } from "./lib/llvm-tools.ts";
import { oracleSysroot } from "./lib/oracle.ts";
import { crateSection, mirArgs, rgCargoEnv, sizeHash, stopLine, treeLine, unitKey, unitRmeta, type RgUnit } from "./lib/rg-check.ts";
const RG_SCRUBBED_ENV = new Set(["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER"]);

export const RG_VERSION = "15.2.0";
/** D19: the crate and its lock file, pinned. */
const RG_CRATE_SHA256 = "a30750b6d0743bfdd2656ebbaf4555aa278c43144b84bc389bcbfa399485ec71";
const RG_LOCK_SHA256 = "700162a1d3e2231f5a8b26aeea9dda305b063963473177265eb6b5ea6be17d23";
export const RG_ROOT = join(DATA, "ripgrep");
/** Relative to `RG_ROOT`. */
export const RG_SRC = `ripgrep-${RG_VERSION}`;
export const RG_INPUT_DIRS = [RG_SRC, join("cargo", "registry", "src")];
const CARGO_HOME = join(RG_ROOT, "cargo");
/** A heavy run takes the whole tree; a lock older than this has a dead owner (the port took 537 s of CPU, oracle 7 s). */
const LOCK_MAX_HOLD_MS = 6 * 3_600_000;
const WRAPPER = join(RG_ROOT, "rustc-wrap.sh");

export const rgIsSetUp = (): boolean => existsSync(join(RG_ROOT, RG_SRC, "Cargo.lock")) && existsSync(join(RG_ROOT, "setup-done"));

function setup(): void {
  const sysroot = oracleSysroot();
  mkdirSync(RG_ROOT, { recursive: true });
  const crate = join(RG_ROOT, `ripgrep-${RG_VERSION}.crate`);
  if (!existsSync(crate)) {
    const c = Bun.spawnSync(["curl", "-fsSL", "-o", crate, `https://static.crates.io/crates/ripgrep/ripgrep-${RG_VERSION}.crate`], { stderr: "pipe" });
    if (c.exitCode !== 0) die(`could not download ripgrep ${RG_VERSION}: ${c.stderr.toString().trim().split("\n")[0]}`);
  }
  if (sha256File(crate) !== RG_CRATE_SHA256) {
    rmSync(crate, { force: true });
    die(`ripgrep-${RG_VERSION}.crate does not have its pinned SHA-256; removed`);
  }
  const t = Bun.spawnSync(["tar", "-xzf", crate, "-C", RG_ROOT], { stderr: "pipe" });
  if (t.exitCode !== 0) die(`could not unpack ripgrep: ${t.stderr.toString().trim().split("\n")[0]}`);
  if (sha256File(join(RG_ROOT, RG_SRC, "Cargo.lock")) !== RG_LOCK_SHA256) die(`ripgrep ${RG_VERSION}'s Cargo.lock does not have its pinned SHA-256`);
  // Through the oracle's own cargo, never a rustup component. Every download is checked against the lock's checksums by cargo.
  const f = Bun.spawnSync([join(sysroot, "bin", "cargo"), "fetch", "--locked"], { cwd: join(RG_ROOT, RG_SRC), env: { ...process.env, CARGO_HOME }, stdout: "pipe", stderr: "pipe" });
  if (f.exitCode !== 0) die(`cargo fetch failed: ${f.stderr.toString().trim().split("\n").at(-1)}`);
  writeFileSync(join(RG_ROOT, "setup-done"), `${RG_LOCK_SHA256}\n`);
  console.log(`ripgrep ${RG_VERSION} ready in ${RG_ROOT}`);
}

function writeWrapper(): void {
  // Written only when it changes: cargo's `.rustc_info.json` keys on this file's mtime.
  const text = '#!/bin/sh\nexec "$RG_BUN" "$RG_WRAPPER_TS" "$@"\n';
  if (!existsSync(WRAPPER) || readFileSync(WRAPPER, "utf8") !== text) writeFileSync(WRAPPER, text, { mode: 0o755 });
}

async function runSide(label: string, side: "oracle" | "subject", target: string, encodeMir: boolean): Promise<number> {
  if (!rgIsSetUp()) die(`ripgrep is not set up in ${RG_ROOT}; run: bun scripts/rg-check.ts setup`);
  const sysroot = oracleSysroot();
  const rustc = join(sysroot, "bin", "rustc");
  const tree = join(RG_ROOT, "target", label);
  const kept = join(RG_ROOT, "kept", label);
  const log = join(kept, `${side}-logs`);
  const extra = encodeMir ? ["-Copt-level=3", "-Zalways-encode-mir"] : [];
  const portMain = join(REPO, "src", "rust_ts", "main.ts");
  // Comes out of the process's own environment, so RUST_TS_HOST_TUPLE and PATH reach the compilers.
  const env: Record<string, string> = {
    // Not what changes the build or which repository ripgrep's build.rs reads (review harness-m7a H6): a cached oracle did not have them.
    ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && !RG_SCRUBBED_ENV.has(e[0]))),
    ...rgCargoEnv(RG_ROOT, CARGO_HOME),
    RUSTC: WRAPPER,
    RUSTC_ICE: "0",
    RUST_BACKTRACE: "0",
    RG_SIDE: side,
    RG_LOG: log,
    RG_EXTRA: JSON.stringify(extra),
    RG_BUN: process.execPath,
    RG_WRAPPER_TS: join(REPO, "scripts", "rg-rustc.ts"),
    RG_ORACLE_RUSTC: rustc,
    RG_SYSROOT: sysroot,
    RG_PORT_MAIN: portMain,
  };
  const lines: string[] = [];
  await withCaseLock(join(RG_ROOT, `${label}.lock`), LOCK_MAX_HOLD_MS, async () => {
    writeWrapper();
    rmSync(tree, { recursive: true, force: true });
    rmSync(log, { recursive: true, force: true });
    rmSync(join(kept, side), { recursive: true, force: true });
    mkdirSync(log, { recursive: true });
    mkdirSync(dirname(tree), { recursive: true });
    const out = openSync(join(log, "cargo.log"), "w");
    const p = Bun.spawn([join(sysroot, "bin", "cargo"), "check", "--locked", "--offline", "--keep-going", "-j4", "--target", target, "--target-dir", tree], { cwd: join(RG_ROOT, RG_SRC), env, stdin: "ignore", stdout: out, stderr: out });
    const stop = () => p.kill("SIGTERM");
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    const code = await p.exited;
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    closeSync(out);
    const units = readdirSync(log)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(log, f), "utf8")) as RgUnit)
      .sort((a, b) => (unitKey(a) < unitKey(b) ? -1 : 1));
    const body: string[] = [];
    for (const u of units) {
      const file = unitRmeta(u);
      const rmeta = file !== undefined && existsSync(file) ? readFileSync(file) : undefined;
      const mir: string[] = [];
      if (u.crate === "rg" && u.code === 0) {
        // Its recorded argv and environment; only the side's compiler differs. Its `.rmeta`s are this side's, in the tree still.
        const compiler = side === "subject" ? [process.execPath, portMain, "--sysroot", sysroot] : [rustc];
        const { CARGO_MAKEFLAGS: _dropped, ...mirEnv } = u.env;
        const m = Bun.spawnSync([...compiler, ...mirArgs(u.args, extra)], { cwd: u.cwd, env: mirEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
        writeFileSync(join(log, "rg.mir"), m.stdout);
        writeFileSync(join(log, "rg.mir.stderr"), m.stderr);
        mir.push(`  mir exit ${m.exitCode}`, `  mir ${sizeHash(m.stdout)}`, `  mir stderr ${sizeHash(m.stderr)}`);
        if (m.exitCode !== 0) mir.push(`  mir stop ${stopLine(m.stderr.toString("latin1"))}`);
      }
      body.push(...crateSection(u, rmeta, readFileSync(join(log, u.stderr)), mir));
    }
    lines.push(`check-rg ripgrep ${RG_VERSION} ${target} ${encodeMir ? "encode-mir" : "plain"}`, `cargo exit ${code}`, treeLine(tree), ...body);
    renameSync(tree, join(kept, side));
  });
  const b = Buffer.from(lines.join("\n") + "\n", "latin1");
  for (let at = 0; at < b.length; ) at += writeSync(1, b, at);
  return 0;
}

if (import.meta.main) {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a._[0];
  if (cmd === "setup") setup();
  else if (cmd === "run") {
    if (typeof a.label !== "string" || (a.side !== "oracle" && a.side !== "subject") || typeof a.target !== "string") die("usage: bun scripts/rg-check.ts run --label <suite> --side oracle|subject --target <tuple> [--encode-mir]");
    process.exit(await runSide(a.label as string, a.side as "oracle" | "subject", a.target as string, a["encode-mir"] === true));
  } else console.log("usage: bun scripts/rg-check.ts setup | run --label <suite> --side oracle|subject --target <tuple> [--encode-mir]");
}
