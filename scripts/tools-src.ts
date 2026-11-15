// M8's tool sources outside the rust checkout (plan-m8 D3; lane tools-prep-m8). clippy's and rustfmt's own sources are in the checkout
// (UPSTREAM.json `sparse`, `bun scripts/upstream.ts fetch`); this fetches the rest.
//
//   bun scripts/tools-src.ts setup [cargo|tools-deps]   both when none is named
//   bun scripts/tools-src.ts status
//
// `setup` is the only step that uses the network, as `bun scripts/rg-check.ts setup` (plan-m7 D19), and it goes through the oracle's own
// cargo, never a rustup component:
// - **cargo** (`$RUST_TS_DATA/cargo-src`): GitHub's tarball of UPSTREAM.json `cargo.commit`, the commit the pin's `src/tools/cargo`
//   gitlink records, checked against `cargo.sha256` and unpacked to `cargo-<commit>/`; then `cargo fetch --locked` of its own
//   `Cargo.lock` into the isolated CARGO_HOME `cargo-src/cargo-home` (cargo checks every download against the lock's checksums).
// - **tools-deps** (`$RUST_TS_DATA/tools-deps`, re-check2 P7a): a scratch workspace of `clippy_config` and rustfmt (and the path
//   dependencies their manifests name), each with its upstream `Cargo.toml` copied byte for byte and its `src` and `build.rs`
//   symlinked into the checkout, with the rust checkout's root `Cargo.lock`. `cargo fetch` into its own CARGO_HOME `tools-deps/cargo-home`
//   prunes the lock to what these packages reach; the setup then refuses any package the root lock does not have with the same
//   version, source and checksum, so every crate is the pin's. The codegen batches (D5, D6) run the oracle's `-Zunpretty=expanded`
//   on it offline. `--locked` cannot be used here: the pruning itself is a change to the lock.
// Each prints the size it added. Nothing here builds anything.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, REPO, UPSTREAM, die, parseArgs, requireUpstream } from "./lib/common.ts";
import { sha256File } from "./lib/llvm-tools.ts";
import { oracleSysroot } from "./lib/oracle.ts";
import { LINKED, TOOLS_DEPS_PACKAGES, type CargoPin, cargoPinOf, cargoSrcDir, cargoTarballUrl, lockSubsetErrors, mib, toolsDepsManifest } from "./lib/tools-src.ts";

export const CARGO_SRC_ROOT = join(DATA, "cargo-src");
export const CARGO_SRC_HOME = join(CARGO_SRC_ROOT, "cargo-home");
export const TOOLS_DEPS_ROOT = join(DATA, "tools-deps");
export const TOOLS_DEPS_HOME = join(TOOLS_DEPS_ROOT, "cargo-home");

function cargoPin(): CargoPin {
  const p = cargoPinOf(JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")));
  if (typeof p === "string") die(p);
  return p;
}

/** Bytes under `dir` (`du -sk`), 0 if it does not exist. */
function diskBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  const r = Bun.spawnSync(["du", "-sk", dir], { stdout: "pipe", stderr: "pipe" });
  return Number(r.stdout.toString().split("\t")[0] ?? 0) * 1024;
}

/** The oracle's cargo, with `home` as CARGO_HOME, run in `cwd`; dies with cargo's last stderr line on failure. */
function oracleCargo(args: string[], cwd: string, home: string): void {
  const sysroot = oracleSysroot();
  const env = { ...process.env, CARGO_HOME: home, RUSTC: join(sysroot, "bin", "rustc") };
  const r = Bun.spawnSync([join(sysroot, "bin", "cargo"), ...args], { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) die(`cargo ${args.join(" ")} in ${cwd} failed: ${r.stderr.toString().trim().split("\n").at(-1)}`);
}

export const cargoSrcIsSetUp = (): boolean => existsSync(join(CARGO_SRC_ROOT, "setup-done")) && existsSync(join(cargoSrcDir(CARGO_SRC_ROOT, cargoPin()), "Cargo.lock"));
export const toolsDepsIsSetUp = (): boolean => existsSync(join(TOOLS_DEPS_ROOT, "setup-done"));

function setupCargo(): void {
  const pin = cargoPin();
  const before = diskBytes(CARGO_SRC_ROOT);
  mkdirSync(CARGO_SRC_ROOT, { recursive: true });
  const tarball = join(CARGO_SRC_ROOT, `cargo-${pin.commit}.tar.gz`);
  if (!existsSync(tarball)) {
    const c = Bun.spawnSync(["curl", "-fsSL", "-o", tarball, cargoTarballUrl(pin)], { stderr: "pipe" });
    if (c.exitCode !== 0) die(`could not download cargo ${pin.commit}: ${c.stderr.toString().trim().split("\n")[0]}`);
  }
  if (sha256File(tarball) !== pin.sha256) {
    rmSync(tarball, { force: true });
    die(`cargo-${pin.commit}.tar.gz does not have its pinned SHA-256 (UPSTREAM.json cargo.sha256); removed`);
  }
  const src = cargoSrcDir(CARGO_SRC_ROOT, pin);
  rmSync(src, { recursive: true, force: true });
  const t = Bun.spawnSync(["tar", "-xzf", tarball, "-C", CARGO_SRC_ROOT], { stderr: "pipe" });
  if (t.exitCode !== 0) die(`could not unpack cargo: ${t.stderr.toString().trim().split("\n")[0]}`);
  if (!existsSync(join(src, "Cargo.lock"))) die(`the cargo tarball did not unpack to ${src}`);
  const unpacked = diskBytes(src);
  oracleCargo(["fetch", "--locked"], src, CARGO_SRC_HOME);
  writeFileSync(join(CARGO_SRC_ROOT, "setup-done"), `${pin.commit} ${pin.sha256}\n`);
  console.log(`cargo ${pin.commit.slice(0, 12)} ready in ${src}: tarball ${mib(diskBytes(tarball))}, source ${mib(unpacked)}, CARGO_HOME ${mib(diskBytes(CARGO_SRC_HOME))}; added ${mib(diskBytes(CARGO_SRC_ROOT) - before)}`);
}

function setupToolsDeps(): void {
  requireUpstream();
  const rootLock = join(UPSTREAM, "Cargo.lock");
  for (const p of TOOLS_DEPS_PACKAGES) if (!existsSync(join(UPSTREAM, p, "Cargo.toml"))) die(`${p} is not in the upstream checkout; run: bun scripts/upstream.ts fetch`);
  const before = diskBytes(TOOLS_DEPS_ROOT);
  // Everything but the CARGO_HOME is rewritten, so a stale package or lock cannot survive.
  for (const p of ["Cargo.toml", "Cargo.lock", "src", "target", "setup-done"]) rmSync(join(TOOLS_DEPS_ROOT, p), { recursive: true, force: true });
  mkdirSync(TOOLS_DEPS_ROOT, { recursive: true });
  writeFileSync(join(TOOLS_DEPS_ROOT, "Cargo.toml"), toolsDepsManifest());
  for (const p of TOOLS_DEPS_PACKAGES) {
    const to = join(TOOLS_DEPS_ROOT, p);
    mkdirSync(to, { recursive: true });
    copyFileSync(join(UPSTREAM, p, "Cargo.toml"), join(to, "Cargo.toml"));
    for (const l of LINKED) if (existsSync(join(UPSTREAM, p, l))) symlinkSync(join(UPSTREAM, p, l), join(to, l));
  }
  copyFileSync(rootLock, join(TOOLS_DEPS_ROOT, "Cargo.lock"));
  oracleCargo(["fetch"], TOOLS_DEPS_ROOT, TOOLS_DEPS_HOME);
  const errs = lockSubsetErrors(readFileSync(join(TOOLS_DEPS_ROOT, "Cargo.lock"), "utf8"), readFileSync(rootLock, "utf8"));
  if (errs.length) die(`tools-deps resolved ${errs.length} package(s) away from the root lock: ${errs.slice(0, 3).join("; ")}`);
  writeFileSync(join(TOOLS_DEPS_ROOT, "setup-done"), `${sha256File(rootLock)}\n`);
  console.log(`tools-deps ready in ${TOOLS_DEPS_ROOT}: CARGO_HOME ${mib(diskBytes(TOOLS_DEPS_HOME))}; added ${mib(diskBytes(TOOLS_DEPS_ROOT) - before)}`);
}

function status(): void {
  const pin = cargoPin();
  const line = (ok: boolean, what: string, fix: string) => console.log(`${ok ? "ok   " : "ERROR:"} ${what}${ok ? "" : `  (run: bun scripts/tools-src.ts setup ${fix})`}`);
  const done = existsSync(join(CARGO_SRC_ROOT, "setup-done")) ? readFileSync(join(CARGO_SRC_ROOT, "setup-done"), "utf8").trim() : "";
  line(cargoSrcIsSetUp() && done === `${pin.commit} ${pin.sha256}`, `cargo-src ${pin.commit.slice(0, 12)} (${cargoSrcDir(CARGO_SRC_ROOT, pin)})`, "cargo");
  const rootLock = join(UPSTREAM, "Cargo.lock");
  const lockDone = existsSync(join(TOOLS_DEPS_ROOT, "setup-done")) ? readFileSync(join(TOOLS_DEPS_ROOT, "setup-done"), "utf8").trim() : "";
  line(toolsDepsIsSetUp() && existsSync(rootLock) && lockDone === sha256File(rootLock), `tools-deps at the root Cargo.lock (${TOOLS_DEPS_ROOT})`, "tools-deps");
}

if (import.meta.main) {
  const a = parseArgs(process.argv.slice(2));
  const [cmd, what] = a._;
  if (cmd === "setup" && (what === undefined || what === "cargo" || what === "tools-deps")) {
    if (what !== "tools-deps") setupCargo();
    if (what !== "cargo") setupToolsDeps();
  } else if (cmd === "status") status();
  else console.log("usage: bun scripts/tools-src.ts setup [cargo|tools-deps] | status");
}
