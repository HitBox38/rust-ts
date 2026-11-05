// Shared by regen.ts and ../partitioning.oracle.test.ts (lane mono-partition; not a port).
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA, PIN, UPSTREAM } from "../../../scripts/lib/common.ts";

export const HERE = dirname(fileURLToPath(import.meta.url));
/** In the oracle toolchain's pinned `rust-std` on every host (as lane mono-collector). */
export const TARGET = "x86_64-unknown-linux-gnu";
export const RUSTC = ["rustc", `+${PIN.toolchain}`];
export const WORK = join(DATA, "tmp", "mono-partition-oracle", process.env.RUST_TS_AGENT ?? "default");

export interface Case {
  /** The file name under oracle/, without `.txt`. */
  name: string;
  file: string;
  crate_name: string;
  flags: string[];
  /** `-C incremental=<dir>` on the oracle; `RUST_TS_PARTITION_INCREMENTAL=1` on the driver. */
  incremental: boolean;
  /** Aux crates (file paths), built by the oracle. */
  aux: string[];
  target: string;
  /** The driver's `--target`, where it differs: its `RUST_TS_PARTITION_ACYCLIC=1` stands for the target JSON's field. */
  port_target?: string;
  /** `-Zdump-mono-stats` output file to compare, relative to the dump directory. */
  dump?: string;
}

const HUMAN = "-Zhuman-readable-cgu-names";

/** The program's `//@ compile-flags:` directives. */
function flags_of(src: string): string[] {
  const flags: string[] = [];
  for (const m of src.matchAll(/^\/\/@\s*compile-flags:(.*)$/gm)) flags.push(...m[1]!.trim().split(/\s+/).filter((x) => x !== ""));
  return flags;
}

function crate_name_of(file: string): string {
  return basename(file).replace(/\.rs$/, "").replaceAll("-", "_");
}

function upstream_cases(): Case[] {
  const out: Case[] = [];
  const dir = join(HERE, "upstream");
  const mangled_too = new Set(["regular-modules", "incremental-merging", "local-generic"]);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".rs")).sort()) {
    const file = join(dir, f);
    const src = readFileSync(file, "utf8");
    const flags = flags_of(src);
    const aux = [...src.matchAll(/^\/\/@\s*aux-build:\s*(\S+)$/gm)].map((m) => join(dir, "auxiliary", m[1]!));
    const stem = f.replace(/\.rs$/, "");
    const base = { file, crate_name: crate_name_of(f), aux, target: TARGET };
    // compiletest's shape: incremental, human-readable names.
    out.push({ ...base, name: stem, flags: [...flags, HUMAN], incremental: true });
    // No `-C incremental`: `cgu.N` names, the two-pass merge and `LocalCopy` for what is not inlined across crates.
    out.push({ ...base, name: `${stem}-nonincr`, flags, incremental: false });
    if (mangled_too.has(stem)) out.push({ ...base, name: `${stem}-mangled`, flags, incremental: true });
  }
  return out;
}

function program_cases(): Case[] {
  const dir = join(HERE, "programs");
  const p = (stem: string): Pick<Case, "file" | "crate_name" | "aux" | "target"> => ({ file: join(dir, `${stem}.rs`), crate_name: stem, aux: [], target: TARGET });
  const out: Case[] = [];
  // Merge order, tie-breaks and renaming at each CGU count, in both modes.
  for (const n of [1, 2, 3, 5, 16]) {
    out.push({ ...p("merge_many"), name: `merge_many-incr-${n}`, flags: ["-Copt-level=0", `-Ccodegen-units=${n}`, HUMAN], incremental: true });
    out.push({ ...p("merge_many"), name: `merge_many-nonincr-${n}`, flags: ["-Copt-level=0", `-Ccodegen-units=${n}`], incremental: false });
  }
  out.push({ ...p("merge_many"), name: "merge_many-incr-3-mangled", flags: ["-Copt-level=0", "-Ccodegen-units=3"], incremental: true });
  out.push({ ...p("merge_many"), name: "merge_many-nonincr-default", flags: ["-Copt-level=0"], incremental: false });
  out.push({ ...p("merge_many"), name: "merge_many-opt3-3", flags: ["-Copt-level=3", "-Ccodegen-units=3"], incremental: false });
  out.push({ ...p("merge_many"), name: "merge_many-opt2-incr", flags: ["-Copt-level=2", HUMAN], incremental: true });
  out.push({ ...p("merge_many"), name: "merge_many-opt1-3", flags: ["-Copt-level=1", "-Ccodegen-units=3"], incremental: false });
  // The order `Vec::swap_remove` leaves.
  out.push({ ...p("swap_order"), name: "swap_order-incr", flags: ["-Copt-level=0", "-Ccodegen-units=2", HUMAN], incremental: true });
  out.push({ ...p("swap_order"), name: "swap_order-nonincr", flags: ["-Copt-level=0", "-Ccodegen-units=2"], incremental: false });
  // `NON_INCR_MIN_CGU_SIZE` and the `cgu.NN` suffix.
  out.push({ ...p("large_cgus"), name: "large_cgus-default", flags: ["-Copt-level=0"], incremental: false });
  out.push({ ...p("large_cgus"), name: "large_cgus-16", flags: ["-Copt-level=0", "-Ccodegen-units=16"], incremental: false });
  out.push({ ...p("large_cgus"), name: "large_cgus-4", flags: ["-Copt-level=0", "-Ccodegen-units=4"], incremental: false });
  // `shorten_name` and `mangle_name` on long names, alone and merged.
  out.push({ ...p("long_names"), name: "long_names-human", flags: ["-Copt-level=0", HUMAN], incremental: true });
  out.push({ ...p("long_names"), name: "long_names-mangled", flags: ["-Copt-level=0"], incremental: true });
  out.push({ ...p("long_names"), name: "long_names-merged-human", flags: ["-Copt-level=0", "-Ccodegen-units=1", HUMAN], incremental: true });
  out.push({ ...p("long_names"), name: "long_names-merged-mangled", flags: ["-Copt-level=0", "-Ccodegen-units=1"], incremental: true });
  // A binary through std.
  out.push({ ...p("hello"), name: "hello-incr", flags: ["-Copt-level=0", HUMAN], incremental: true });
  out.push({ ...p("hello"), name: "hello-nonincr", flags: ["-Copt-level=0"], incremental: false });
  out.push({ ...p("hello"), name: "hello-opt2", flags: ["-Copt-level=2"], incremental: false });
  // `opt_incr_drop_glue_mode`: optimized and incremental.
  out.push({ ...p("hello"), name: "hello-opt2-incr", flags: ["-Copt-level=2", HUMAN], incremental: true });
  // The Eager strategy.
  out.push({ ...p("dead_code"), name: "dead_code-incr", flags: ["-Copt-level=0", "-Clink-dead-code", HUMAN], incremental: true });
  out.push({ ...p("dead_code"), name: "dead_code-nonincr", flags: ["-Copt-level=0", "-Clink-dead-code"], incremental: false });
  // `dump_mono_items_stats`.
  out.push({ ...p("stats"), name: "stats-json", flags: ["-Copt-level=0", "-Zdump-mono-stats=$DUMP", "-Zdump-mono-stats-format=json"], incremental: false, dump: "stats.mono_items.json" });
  out.push({ ...p("stats"), name: "stats-markdown", flags: ["-Copt-level=0", "-Zdump-mono-stats=$DUMP"], incremental: false, dump: "stats.mono_items.md" });
  // `assert_symbols_are_distinct`.
  out.push({ ...p("symbol_clash"), name: "symbol_clash", flags: ["-Copt-level=0"], incremental: false });
  // `check_static_initializers_are_acyclic` (tests/ui/static/static-initializer-acyclic-issue-146787.rs). Upstream's
  // target is nvptx64-nvidia-cuda, which the port has no spec or ABI for, and the port has no `--target <file>.json`. The
  // oracle takes a target JSON, x86_64-unknown-linux-gnu with `static-initializer-must-be-acyclic`; the driver takes
  // x86_64-unknown-linux-gnu and sets that one field (`RUST_TS_PARTITION_ACYCLIC=1`).
  const acyclic = join(dir, "x86_64-acyclic-statics.json");
  out.push({
    ...p("static_cycle"),
    name: "static_cycle",
    flags: ["-Zunstable-options", "-Cpanic=abort"],
    incremental: false,
    target: acyclic,
    port_target: TARGET,
    aux: [join(UPSTREAM, "tests/auxiliary/minicore.rs")],
  });
  return out;
}

export function all_cases(): Case[] {
  return [...upstream_cases(), ...program_cases()];
}

/** The program's absolute path appears in diagnostics and in closures' names; the oracle's checkout and the test's differ. */
export function normalize(s: string, c: Case): string {
  return s.replaceAll(c.file, "$FILE").replaceAll(dirname(c.file), "$DIR").replaceAll(WORK, "$WORK");
}

export function clean_env(): Record<string, string> {
  const env: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_BACKTRACE", "RUST_TS_PARTITION_INCREMENTAL", "RUST_TS_PARTITION_ACYCLIC"].includes(k)) env[k] = v;
  }
  return env;
}

export function aux_dir(target: string): string {
  return join(WORK, "aux", basename(target));
}

/** Every aux crate of `cases`, built once by the oracle, for each target: the port reads the oracle's metadata. */
export function build_aux(cases: readonly Case[]): void {
  const done = new Set<string>();
  for (const c of cases) {
    for (const file of c.aux) {
      for (const target of [c.target, c.port_target ?? c.target]) {
        const key = `${target} ${file}`;
        if (done.has(key)) continue;
        done.add(key);
        const out = aux_dir(target);
        mkdirSync(out, { recursive: true });
        // Only the flags that change what a dependency must agree with; the aux's own come from its directives.
        const inherited = c.flags.filter((f) => f === "-Zunstable-options" || f === "-Cpanic=abort");
        const r = Bun.spawnSync([...RUSTC, `--target=${target}`, ...inherited, ...flags_of(readFileSync(file, "utf8")), "--crate-type=rlib", file, "--crate-name", basename(file).replace(/\.rs$/, ""), "--emit=metadata,link", "--out-dir", out, "-A", "warnings"], {
          env: clean_env(),
          stdout: "pipe",
          stderr: "pipe",
        });
        if (r.exitCode !== 0) throw new Error(`ERROR: aux build ${file} failed:\n${r.stderr.toString()}`);
      }
    }
  }
}

/** The arguments of one side; `out` is the output directory of this run. */
export function common_args(c: Case, out: string, side: "oracle" | "port"): string[] {
  const dump = join(out, "dump");
  const target = side === "port" ? (c.port_target ?? c.target) : c.target;
  return [
    `--target=${target}`,
    ...c.flags.map((f) => f.replace("$DUMP", dump)),
    c.file,
    "--crate-name",
    c.crate_name,
    "-Zprint-mono-items=yes",
    "--out-dir",
    out,
    ...(c.aux.length > 0 ? ["-L", aux_dir(target)] : []),
  ];
}

/** The driver's environment for this case. */
export function port_env(c: Case): Record<string, string> {
  const env = clean_env();
  if (c.incremental) env.RUST_TS_PARTITION_INCREMENTAL = "1";
  if (c.port_target !== undefined) env.RUST_TS_PARTITION_ACYCLIC = "1";
  return env;
}

export function fresh_dir(name: string): string {
  const d = join(WORK, "runs", name);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  return d;
}

export interface Output {
  code: number;
  stdout: string;
  stderr: string;
  dump: string | undefined;
}

export function render(o: Output): string {
  return `exit ${o.code}\n== stdout\n${o.stdout}\n== stderr\n${o.stderr}\n== dump\n${o.dump ?? "<none>"}\n`;
}

export function parse(text: string): Output {
  const a = text.indexOf("\n== stdout\n");
  const b = text.indexOf("\n== stderr\n");
  const c = text.lastIndexOf("\n== dump\n");
  const dump = text.slice(c + 9, -1);
  return { code: Number(text.slice("exit ".length, a)), stdout: text.slice(a + 11, b), stderr: text.slice(b + 11, c), dump: dump === "<none>" ? undefined : dump };
}
