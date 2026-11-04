// Build oracle probes: tiny Rust programs linked against crates from the pinned
// upstream checkout, used to dump internal compiler state (token streams, tables)
// that the rustc CLI does not expose.
//
//   bun scripts/probes.ts build [name...]   build probes (default: all)
//   bun scripts/probes.ts path <name>       print the probe binary path
//   bun scripts/probes.ts fixture [name...] rewrite the committed oracle fixtures of `PROBE_FIXTURES` (default: all that
//                                           hold on this host) from their (built) probes' stdout
//
// `build` records a hash of what it built from (`probeStamp`), so tools/probes/fixtures.test.ts can tell a binary from an
// older source (review harness-w38 L3): nothing else notices, since the gate only checks that the binary exists.
//
// Each probe is `tools/probes/<name>/Cargo.toml.in` (+ sources). The template's `@UPSTREAM@`,
// `@SRC@` and `@RELEASE@` are substituted, and its `[package.metadata.rust-ts]` table may set:
//   env = { KEY = "value", ... }   extra build environment (e.g. RUSTC_BOOTSTRAP / CFG_RELEASE for
//                                  probes linking rustc_* crates, which bootstrap would provide)
//   lockfile = "upstream"          copy upstream's Cargo.lock next to the manifest before every
//                                  build, so registry deps resolve to exactly upstream's versions
//   rustc_dev = true               a rustc-dev probe: links the oracle toolchain's own compiler
//                                  crates (`#![feature(rustc_private)]` + `extern crate rustc_*`,
//                                  from the rustc-dev component in the sysroot). Its manifest is
//                                  allowlisted (RUSTC_DEV_MANIFEST): only `[package]` (name,
//                                  version, edition, publish, metadata), `[[bin]]` (name, path)
//                                  and an empty `[workspace]`, so no dependencies (a path dep
//                                  would link a second copy of the rustc_* crates), no build
//                                  script, `cargo-features`, `[profile]` (profile rustflags),
//                                  `[patch]`, `[replace]`, `[target]`, ...; its `env` may only set
//                                  RUSTC_DEV_ALLOWED_ENV (none today). The component must be
//                                  installed, and it is built with RUSTC_BOOTSTRAP=1 plus, on
//                                  unix, an rpath to `<sysroot>/lib` (librustc_driver, libLLVM).
//                                  Its oracle cache key also covers the sysroot (difftest:
//                                  rustcDriverHash).
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { DATA, PIN, REPO, UPSTREAM, die, ensureDir, hash, parseArgs, requireUpstream, run } from "./lib/common.ts";
import { caseEnv, mergeEnv } from "./lib/env.ts";
import { MIRI_CASE_ENV, MIRI_SYSROOT, miriBinary, miriPin, verifyMiriOracle } from "./lib/miri.ts";
import { oracleHost, oracleSysroot, verifyOracleToolchain } from "./lib/oracle.ts";

const PROBES_SRC = join(REPO, "tools", "probes");
const PROBES_OUT = join(DATA, "probes");
const TARGET = join(DATA, "target", "probes");
const EXE = process.platform === "win32" ? ".exe" : "";

/**
 * Probes whose whole stdout is a committed oracle fixture (lane harness-w36): probe name -> repo-relative fixture. The
 * probe's output is deterministic, so `bun scripts/probes.ts fixture <name>` regenerates the fixture and
 * tools/probes/fixtures.test.ts checks that the committed file equals the probe's output.
 *   `args`: the probe's command-line arguments (default none).
 *   `host`: the fixture holds only on this host tuple (the probe prints host results, e.g. the host libm's; lane
 *           harness-w37). On another host (`oracleHost()`) the fixture test is skipped with the reason printed and
 *           `fixture` refuses to rewrite it (that would replace the recorded host's results with this host's).
 *   `miri`: not a cargo build: `tools/probes/<name>/main.rs` is a program for the isolated Miri oracle (it needs the
 *           Linux target Miri interprets for; lane harness-w38), which runs it from source. It has no `Cargo.toml.in`, so
 *           `build` does not see it; it needs `bun scripts/miri.ts setup` instead.
 */
export interface ProbeFixture {
  fixture: string;
  args?: string[];
  host?: string;
  miri?: boolean;
}

export const PROBE_FIXTURES: Record<string, ProbeFixture> = {
  randstream: { fixture: "src/vendor/rand/stdrng.oracle.txt" },
  miriaddr: { fixture: "src/miri/alloc_addresses/addresses.oracle.txt" },
  mirisched: { fixture: "src/miri/concurrency/scheduler.oracle.txt" },
  mirimath: { fixture: "src/miri/math.oracle.txt", args: ["aarch64-apple-darwin"], host: "aarch64-apple-darwin" },
  miripaths: { fixture: "tools/probes/miripaths/paths.oracle.txt" },
  miriepoll: { fixture: "tools/probes/miriepoll/epoll.oracle.txt", miri: true },
};

/**
 * What prints a `PROBE_FIXTURES` entry's fixture: the built probe, or the Miri oracle on the probe's source. `env` is an
 * overlay for `run()` / `mergeEnv`, whose `null`s remove variables: merged here, `run()` would overlay the result on
 * `process.env` and bring the removed ones back (review harness-w38 L1).
 */
export function probeFixtureCmd(name: string, f: ProbeFixture): { cmd: string[]; env: Record<string, string | null> } {
  if (!f.miri) return { cmd: [probeBinary(name), ...(f.args ?? [])], env: {} };
  const cmd = [miriBinary(), join(PROBES_SRC, name, "main.rs"), "--edition=2021", "--sysroot", MIRI_SYSROOT, "--target", miriPin().target, ...(f.args ?? [])];
  return { cmd, env: caseEnv(MIRI_CASE_ENV) };
}

/**
 * Which fixtures `fixture` rewrites. Named ones are all required: an unknown name or a fixture of another host is an
 * error. With no names, a fixture of another host is left alone and reported (lane harness-w38): it is not this host's
 * to rewrite, which is no reason to fail the others.
 */
export function fixtureSelection(names: readonly string[], host: () => string): { run: string[]; skipped: string[]; errors: string[] } {
  const out = { run: [] as string[], skipped: [] as string[], errors: [] as string[] };
  for (const n of names.length ? names : Object.keys(PROBE_FIXTURES)) {
    const f = PROBE_FIXTURES[n];
    if (f === undefined) out.errors.push(`probe ${n} has no fixture (PROBE_FIXTURES: ${Object.keys(PROBE_FIXTURES).join(", ")})`);
    else if (f.host !== undefined && f.host !== host()) {
      const why = `probe ${n}: ${f.fixture} holds the results of host ${f.host}, this host is ${host()}; not rewritten`;
      (names.length ? out.errors : out.skipped).push(why);
    } else out.run.push(n);
  }
  return out;
}

/** Binary path of a probe, whether or not it is built. */
export function probeBinary(name: string): string {
  return join(TARGET, "release", name + EXE);
}

export function probePath(name: string): string {
  const p = probeBinary(name);
  if (!existsSync(p)) die(probeNotBuildable(name) ?? `probe '${name}' not built; run: bun scripts/probes.ts build ${name}`);
  return p;
}

/** Why `build <name>` cannot work: a program for the Miri oracle, or no such probe. */
export function probeNotBuildable(name: string): string | undefined {
  if (PROBE_FIXTURES[name]?.miri) return `probe '${name}' has no cargo build: the Miri oracle runs its source; run: bun scripts/miri.ts setup, then bun scripts/probes.ts fixture ${name}`;
  if (!existsSync(join(PROBES_SRC, name, "Cargo.toml.in"))) return `no probe '${name}' (no tools/probes/${name}/Cargo.toml.in)`;
  return undefined;
}

/**
 * Hash of what a cargo probe is built from: its template and `.rs` files, and the `.rs` files they `#[path]` from another
 * probe's directory (names relative to tools/probes, so every worktree gets the same hash).
 */
export function probeSourceHash(name: string): string {
  const files = new Set<string>();
  const add = (f: string) => {
    if (files.has(f)) return;
    files.add(f);
    if (!f.endsWith(".rs")) return;
    for (const m of readFileSync(f, "utf8").matchAll(/#\[path = "(\.\.\/[^"]+)"\]/g)) add(resolve(dirname(f), m[1]!));
  };
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "target") walk(p);
      } else if (e.name === "Cargo.toml.in" || e.name.endsWith(".rs")) add(p);
    }
  };
  walk(join(PROBES_SRC, name));
  return hash(JSON.stringify([...files].sort().map((f) => [relative(PROBES_SRC, f).replaceAll("\\", "/"), hash(readFileSync(f))])));
}

/** Where `build` records `probeSourceHash` of the binary it built. */
const probeStamp = (name: string): string => join(PROBES_OUT, name, "source.hash");

/**
 * Whether a built probe still matches the source here. `stale`: it was built from something else. `unknown`: built before
 * stamps existed, so nothing can be said until the next build.
 */
export function probeStaleness(name: string): { state: "current" | "unknown" } | { state: "stale"; why: string } {
  const stamp = probeStamp(name);
  if (!existsSync(stamp)) return { state: "unknown" };
  if (readFileSync(stamp, "utf8").trim() === probeSourceHash(name)) return { state: "current" };
  return { state: "stale", why: `probe '${name}' was built from other sources than tools/probes/${name} here; run: bun scripts/probes.ts build ${name}` };
}

/** Every probe under tools/probes (a directory with a Cargo.toml.in). */
export function probeNames(): string[] {
  return readdirSync(PROBES_SRC, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(PROBES_SRC, e.name, "Cargo.toml.in")))
    .map((e) => e.name)
    .sort();
}

interface ProbeMeta {
  env: Record<string, string>;
  lockfile?: "upstream";
  /** Links the oracle toolchain's rustc-dev crates (see the header). */
  rustcDev: boolean;
}

/**
 * The only manifest keys a rustc-dev probe may have: everything else is refused (dependencies of any
 * kind, a build script, `cargo-features`, `[profile]`, `[patch]`, `[replace]`, `[target]`, `[lib]`,
 * `[features]`, `[lints]`, ...), since each can change how the probe is compiled or linked and the
 * probe needs none of them. `[workspace]` must be empty (it only stops cargo from looking for an
 * enclosing workspace).
 */
const RUSTC_DEV_MANIFEST = {
  top: ["package", "bin", "workspace"],
  package: ["name", "version", "edition", "publish", "metadata"],
  bin: ["name", "path"],
  metadata: ["rust-ts"],
  rustTs: ["rustc_dev", "env"],
};
/**
 * Build variables a rustc-dev probe's `env` may set (compared case-insensitively, as Windows does).
 * None: rustcDevEnv provides everything such a probe needs (RUSTC_BOOTSTRAP, the rpath).
 */
const RUSTC_DEV_ALLOWED_ENV: string[] = [];

/** Every manifest key a rustc-dev probe has outside RUSTC_DEV_MANIFEST, as dotted paths (exported for review). */
export function rustcDevManifestViolations(toml: Record<string, unknown>): string[] {
  const bad: string[] = [];
  const table = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  const only = (path: string, v: unknown, allowed: string[]) => {
    if (!table(v)) return void bad.push(`${path} (not a table)`);
    for (const k of Object.keys(v)) if (!allowed.includes(k)) bad.push(path ? `${path}.${k}` : k);
  };
  only("", toml, RUSTC_DEV_MANIFEST.top);
  only("package", toml.package ?? {}, RUSTC_DEV_MANIFEST.package);
  const pkg = table(toml.package) ? toml.package : {};
  if (pkg.metadata !== undefined) {
    only("package.metadata", pkg.metadata, RUSTC_DEV_MANIFEST.metadata);
    if (table(pkg.metadata)) only("package.metadata.rust-ts", pkg.metadata["rust-ts"] ?? {}, RUSTC_DEV_MANIFEST.rustTs);
  }
  if (toml.bin !== undefined) {
    if (!Array.isArray(toml.bin)) bad.push("bin (not an array of tables)");
    else toml.bin.forEach((b, i) => only(`bin[${i}]`, b, RUSTC_DEV_MANIFEST.bin));
  }
  if (toml.workspace !== undefined) only("workspace", toml.workspace, []);
  return bad;
}

/** The substituted manifest of a probe. */
function manifest(name: string): string {
  const src = join(PROBES_SRC, name);
  const fwd = (p: string) => p.replaceAll("\\", "/");
  return readFileSync(join(src, "Cargo.toml.in"), "utf8")
    .replaceAll("@UPSTREAM@", fwd(UPSTREAM))
    .replaceAll("@SRC@", fwd(src))
    .replaceAll("@RELEASE@", PIN.release);
}

/** `[package.metadata.rust-ts]` build settings of a probe (exported for tests/review). */
export function probeMeta(name: string): ProbeMeta {
  const toml = Bun.TOML.parse(manifest(name)) as {
    package?: { metadata?: { "rust-ts"?: Record<string, unknown> } };
    target?: Record<string, Record<string, unknown>>;
    [table: string]: unknown;
  };
  const meta = toml.package?.metadata?.["rust-ts"] ?? {};
  const env: Record<string, string> = {};
  if (meta.env !== undefined) {
    if (typeof meta.env !== "object" || meta.env === null) die(`probe ${name}: metadata env must be a table`);
    for (const [k, v] of Object.entries(meta.env)) {
      if (typeof v !== "string") die(`probe ${name}: metadata env.${k} must be a string`);
      env[k] = v;
    }
  }
  if (meta.lockfile !== undefined && meta.lockfile !== "upstream") die(`probe ${name}: metadata lockfile must be "upstream"`);
  if (meta.rustc_dev !== undefined && typeof meta.rustc_dev !== "boolean") die(`probe ${name}: metadata rustc_dev must be a boolean`);
  const rustcDev = meta.rustc_dev === true;
  if (rustcDev) {
    const bad = rustcDevManifestViolations(toml);
    if (bad.length) die(`probe ${name}: a rustc_dev probe's manifest may not have ${bad.join(", ")} (allowed: see RUSTC_DEV_MANIFEST in scripts/probes.ts)`);
    const allowed = new Set(RUSTC_DEV_ALLOWED_ENV.map((k) => k.toUpperCase()));
    const notAllowed = Object.keys(env).filter((k) => !allowed.has(k.toUpperCase()));
    if (notAllowed.length) die(`probe ${name}: a rustc_dev probe's env may not set ${notAllowed.join(", ")} (allowed: ${RUSTC_DEV_ALLOWED_ENV.join(", ") || "none"})`);
  }
  return { env, lockfile: meta.lockfile as ProbeMeta["lockfile"], rustcDev };
}

/** Is a probe a rustc-dev probe (`rustc_dev = true`)? `false` for unknown names. */
export function isRustcDevProbe(name: string): boolean {
  return existsSync(join(PROBES_SRC, name, "Cargo.toml.in")) && probeMeta(name).rustcDev;
}

/**
 * Build environment of a rustc-dev probe. The crates come from the oracle sysroot: rustc finds
 * them in `<sysroot>/lib/rustlib/<host>/lib`, its default search path, once the rustc-dev
 * component is installed; check that first so a missing component is one clear ERROR.
 */
function rustcDevEnv(name: string): Record<string, string> {
  const sysroot = oracleSysroot();
  const rustlib = join(sysroot, "lib", "rustlib", oracleHost(), "lib");
  let names: string[] = [];
  try {
    names = readdirSync(rustlib);
  } catch {}
  if (!names.some((n) => /^librustc_driver-[0-9a-f]+\.(rlib|rmeta)$/.test(n))) {
    die(`probe ${name} needs the rustc-dev component (no rustc_driver .rmeta/.rlib in ${rustlib}); run: rustup component add rustc-dev llvm-tools --toolchain ${PIN.toolchain}`);
  }
  const env: Record<string, string> = { RUSTC_BOOTSTRAP: "1" };
  // librustc_driver and libLLVM are dylibs in <sysroot>/lib; without an rpath the probe would only
  // run with DYLD_LIBRARY_PATH / LD_LIBRARY_PATH set. (Windows has no rpath: <sysroot>/bin must be
  // on PATH when the probe runs.)
  // CARGO_ENCODED_RUSTFLAGS (\x1f-separated) so a sysroot path with spaces stays one argument; it
  // also takes precedence over any RUSTFLAGS in the outer environment.
  if (process.platform !== "win32") env.CARGO_ENCODED_RUSTFLAGS = ["-C", `link-arg=-Wl,-rpath,${join(sysroot, "lib")}`].join("\x1f");
  return env;
}

async function build(name: string): Promise<void> {
  const notBuildable = probeNotBuildable(name);
  if (notBuildable !== undefined) die(notBuildable);
  requireUpstream();
  // Probes are built with the oracle toolchain: check it has exactly the pinned components first (review harness-w35
  // N5; lane harness-w36), as every other oracle build does.
  verifyOracleToolchain();
  // Hashed before cargo reads the sources: a file edited during the build then reads as stale, not as current.
  const source = probeSourceHash(name);
  const text = manifest(name);
  const meta = probeMeta(name);
  const dir = ensureDir(join(PROBES_OUT, name));
  writeFileSync(join(dir, "Cargo.toml"), text);
  if (meta.lockfile === "upstream") copyFileSync(join(UPSTREAM, "Cargo.lock"), join(dir, "Cargo.lock"));
  const r = await run(["cargo", `+${PIN.toolchain}`, "build", "--release", "--quiet", "--manifest-path", join(dir, "Cargo.toml")], {
    env: { CARGO_TARGET_DIR: TARGET, ...meta.env, ...(meta.rustcDev ? rustcDevEnv(name) : {}) },
  });
  if (r.code !== 0) die(`probe ${name} failed to build:\n${r.stderr}`);
  writeFileSync(probeStamp(name), `${source}\n`);
  console.log(`built ${name}: ${probePath(name)}`);
}

/**
 * Probes the unit tests (`*.test.ts` under `roots`, default src/ and tools/) read: every test that
 * builds a probe path does it as `join(DATA, "target", "probes", "release", "<name>" ...)` or
 * `probePath("<name>")` / `probeBinary("<name>")`.
 */
export function oracleTestProbes(roots: string[] = ["src", "tools"]): string[] {
  const names = new Set<string>();
  const re = /"probes",\s*"release",\s*"([\w-]+)"|probe(?:Path|Binary)\("([\w-]+)"\)/g;
  const rec = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") rec(p);
      } else if (e.name.endsWith(".test.ts")) {
        for (const m of readFileSync(p, "utf8").matchAll(re)) names.add((m[1] ?? m[2])!);
      }
    }
  };
  for (const d of roots) rec(join(REPO, d));
  return [...names].sort();
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, ...names] = args._;
  if (cmd === "build") {
    for (const n of names.length ? names : probeNames()) await build(n);
  } else if (cmd === "path" && names[0]) {
    console.log(probePath(names[0]));
  } else if (cmd === "fixture") {
    let hostMemo: string | undefined;
    const sel = fixtureSelection(names, () => (hostMemo ??= oracleHost()));
    if (sel.errors.length) die(sel.errors.join("; "));
    for (const why of sel.skipped) console.log(`note: ${why}`);
    for (const n of sel.run) {
      const f = PROBE_FIXTURES[n]!;
      const out = f.fixture;
      if (f.miri) verifyMiriOracle();
      else probePath(n);
      const { cmd, env } = probeFixtureCmd(n, f);
      const r = await run(cmd, { timeoutMs: 120_000, env });
      if (r.code !== 0 || r.timedOut) die(`probe ${n} failed (exit ${r.code}${r.timedOut ? ", timed out" : ""}): ${r.stderr.trim().slice(0, 300)}`);
      const before = existsSync(join(REPO, out)) ? readFileSync(join(REPO, out), "utf8") : undefined;
      writeFileSync(join(REPO, out), r.stdout);
      console.log(`${n}: ${out} ${before === r.stdout ? "unchanged" : "rewritten"} (${r.stdout.split("\n").length - 1} lines)`);
    }
  } else {
    console.log("usage: bun scripts/probes.ts build [name...] | path <name> | fixture [name...]");
  }
}
