// Build oracle probes: tiny Rust programs linked against crates from the pinned
// upstream checkout, used to dump internal compiler state (token streams, tables)
// that the rustc CLI does not expose.
//
//   bun scripts/probes.ts build [name...]   build probes (default: all)
//   bun scripts/probes.ts path <name>       print the probe binary path
//
// Each probe is `tools/probes/<name>/Cargo.toml.in` (+ sources). The template's `@UPSTREAM@`,
// `@SRC@` and `@RELEASE@` are substituted, and its `[package.metadata.rust-ts]` table may set:
//   env = { KEY = "value", ... }   extra build environment (e.g. RUSTC_BOOTSTRAP / CFG_RELEASE for
//                                  probes linking rustc_* crates, which bootstrap would provide)
//   lockfile = "upstream"          copy upstream's Cargo.lock next to the manifest before every
//                                  build, so registry deps resolve to exactly upstream's versions
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO, UPSTREAM, die, ensureDir, parseArgs, requireUpstream, run } from "./lib/common.ts";

const PROBES_SRC = join(REPO, "tools", "probes");
const PROBES_OUT = join(DATA, "probes");
const TARGET = join(DATA, "target", "probes");
const EXE = process.platform === "win32" ? ".exe" : "";

/** Binary path of a probe, whether or not it is built. */
export function probeBinary(name: string): string {
  return join(TARGET, "release", name + EXE);
}

export function probePath(name: string): string {
  const p = probeBinary(name);
  if (!existsSync(p)) die(`probe '${name}' not built; run: bun scripts/probes.ts build ${name}`);
  return p;
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
  const toml = Bun.TOML.parse(manifest(name)) as { package?: { metadata?: { "rust-ts"?: Record<string, unknown> } } };
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
  return { env, lockfile: meta.lockfile as ProbeMeta["lockfile"] };
}

async function build(name: string): Promise<void> {
  requireUpstream();
  const text = manifest(name);
  const meta = probeMeta(name);
  const dir = ensureDir(join(PROBES_OUT, name));
  writeFileSync(join(dir, "Cargo.toml"), text);
  if (meta.lockfile === "upstream") copyFileSync(join(UPSTREAM, "Cargo.lock"), join(dir, "Cargo.lock"));
  const r = await run(["cargo", `+${PIN.toolchain}`, "build", "--release", "--quiet", "--manifest-path", join(dir, "Cargo.toml")], {
    env: { CARGO_TARGET_DIR: TARGET, ...meta.env },
  });
  if (r.code !== 0) die(`probe ${name} failed to build:\n${r.stderr}`);
  console.log(`built ${name}: ${probePath(name)}`);
}

/**
 * Probes the oracle unit tests (`*.test.ts` under src/ and tools/) read: every test that builds a
 * probe path does it as `join(DATA, "target", "probes", "release", "<name>" ...)` or
 * `probePath("<name>")`.
 */
export function oracleTestProbes(): string[] {
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
  for (const d of ["src", "tools"]) rec(join(REPO, d));
  return [...names].sort();
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, ...names] = args._;
  if (cmd === "build") {
    for (const n of names.length ? names : probeNames()) await build(n);
  } else if (cmd === "path" && names[0]) {
    console.log(probePath(names[0]));
  } else {
    console.log("usage: bun scripts/probes.ts build [name...] | path <name>");
  }
}
