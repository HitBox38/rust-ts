// Build oracle probes: tiny Rust programs linked against crates from the pinned
// upstream checkout, used to dump internal compiler state (token streams, tables)
// that the rustc CLI does not expose.
//
//   bun scripts/probes.ts build [name...]   build probes (default: all)
//   bun scripts/probes.ts path <name>       print the probe binary path
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO, UPSTREAM, die, ensureDir, parseArgs, requireUpstream, run } from "./lib/common.ts";

const PROBES_SRC = join(REPO, "tools", "probes");
const PROBES_OUT = join(DATA, "probes");
const TARGET = join(DATA, "target", "probes");
const EXE = process.platform === "win32" ? ".exe" : "";

/**
 * Extra build env per probe. Probes linking rustc_span need what bootstrap provides:
 * RUSTC_BOOTSTRAP (rustc_macros' build script refuses to run without it) and CFG_RELEASE
 * (read by the `symbols!` macro for `sym::env_CFG_RELEASE`).
 */
const PROBE_ENV: Record<string, Record<string, string>> = {
  symdump: { RUSTC_BOOTSTRAP: "1", CFG_RELEASE: PIN.release },
};

export function probePath(name: string): string {
  const p = join(TARGET, "release", name + EXE);
  if (!existsSync(p)) die(`probe '${name}' not built; run: bun scripts/probes.ts build ${name}`);
  return p;
}

async function build(name: string): Promise<void> {
  requireUpstream();
  const src = join(PROBES_SRC, name);
  const fwd = (p: string) => p.replaceAll("\\", "/");
  const manifest = readFileSync(join(src, "Cargo.toml.in"), "utf8").replaceAll("@UPSTREAM@", fwd(UPSTREAM)).replaceAll("@SRC@", fwd(src));
  const dir = ensureDir(join(PROBES_OUT, name));
  writeFileSync(join(dir, "Cargo.toml"), manifest);
  const r = await run(["cargo", `+${PIN.toolchain}`, "build", "--release", "--quiet", "--manifest-path", join(dir, "Cargo.toml")], {
    env: { CARGO_TARGET_DIR: TARGET, ...PROBE_ENV[name] },
  });
  if (r.code !== 0) die(`probe ${name} failed to build:\n${r.stderr}`);
  console.log(`built ${name}: ${probePath(name)}`);
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, ...names] = args._;
  if (cmd === "build") {
    const all = readdirSync(PROBES_SRC);
    for (const n of names.length ? names : all) await build(n);
  } else if (cmd === "path" && names[0]) {
    console.log(probePath(names[0]));
  } else {
    console.log("usage: bun scripts/probes.ts build [name...] | path <name>");
  }
}
