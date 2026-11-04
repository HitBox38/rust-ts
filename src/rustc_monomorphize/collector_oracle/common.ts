// Shared by regen.ts and ../collector.oracle.test.ts (lane mono-collector; not a port).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const TARGET = "x86_64-unknown-linux-gnu";

/** Every program: ours (`programs/`) and upstream's (`upstream/`, prefixed `up-`). */
export function program_files(): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  for (const f of readdirSync(join(HERE, "programs")).sort()) out.push({ name: f.replace(/\.rs$/, ""), path: join(HERE, "programs", f) });
  for (const f of readdirSync(join(HERE, "upstream")).sort()) out.push({ name: `up-${f.replace(/\.rs$/, "")}`, path: join(HERE, "upstream", f) });
  return out;
}

/** The program's `//@ compile-flags:` and `//@ edition:` directives. */
export function flags_of(src: string): string[] {
  const flags: string[] = [];
  for (const m of src.matchAll(/^\/\/@\s*compile-flags:(.*)$/gm)) flags.push(...m[1]!.trim().split(/\s+/).filter((x) => x !== ""));
  for (const m of src.matchAll(/^\/\/@\s*edition:\s*(\S+)$/gm)) flags.push(`--edition=${m[1]}`);
  return flags;
}

/** The program's absolute path appears in diagnostics; the oracle's checkout and the test's differ. */
export function normalize_stderr(s: string, path: string): string {
  return s.replaceAll(path, "$FILE").replaceAll(dirname(path), "$DIR");
}

/** The `closure_profile_<pid>.csv` a -Zprofile-closures run left in `cwd` (the pid is in the name only), if any. */
export function read_closure_profile(cwd: string, path: string): string | undefined {
  const f = readdirSync(cwd).find((x) => /^closure_profile_\d+\.csv$/.test(x));
  return f === undefined ? undefined : normalize_stderr(readFileSync(join(cwd, f), "utf8"), path);
}

export function clean_env(): Record<string, string> {
  const env: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_BACKTRACE"].includes(k)) env[k] = v;
  }
  return env;
}

export interface OracleOutput {
  code: number;
  /** `MONO_ITEM` lines without the ` @@ cgu[linkage]` part (it needs mono-partition), in the oracle's order (sorted text). */
  items: string[];
  /** `<fingerprint> <item>`, ascending by fingerprint: the order of `collect_crate_mono_items`. */
  fingerprints: string[];
  stderr: string;
}

export function parse_oracle(text: string): OracleOutput {
  const a = text.indexOf("\n== MONO_ITEM\n");
  const b = text.indexOf("\n== FP\n");
  const c = text.indexOf("\n== stderr\n");
  const lines = (s: string): string[] => s.split("\n").filter((l) => l !== "");
  return {
    code: Number(text.slice("exit ".length, a)),
    items: lines(text.slice(a + 14, b)).map((l) => l.replace(/^MONO_ITEM /, "").replace(/ @@.*$/, "")),
    fingerprints: lines(text.slice(b + 7, c)).map((l) => l.replace(/^FP /, "")),
    stderr: text.slice(c + 11),
  };
}
