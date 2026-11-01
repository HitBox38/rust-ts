// Oracle fixtures for rustc's default logger (src/rustc_log/lib.ts, src/rust_ts/tracing*.ts): root_region.rs makes
// the generalizer emit its `warn!("may incompletely handle alias type: ..")` under `-Znext-solver`. Each variant runs
// the `tydump` probe (which calls `init_rustc_env_logger` as rustc's `main` does) with a set of `RUSTC_LOG*`
// variables (`RUSTC_LOG_*` options and a few `RUSTC_LOG` filters); expected.json holds stdout, stderr, exit code and
// the `RUSTC_LOG_OUTPUT_TARGET` file, if any.
// (An unopenable `RUSTC_LOG_OUTPUT_TARGET` is left out: its `couldn't open .. {e:?}` line is host-specific.)
//   bun src/rustc_log/tracing_oracle/gen.ts      (rewrites expected.json)
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HERE = import.meta.dir;
export const CRATE = "root_region.rs";
export const ARGS = [CRATE, "-Znext-solver", "--edition=2021", "--target", "x86_64-unknown-linux-gnu"];
/** The log file name `RUSTC_LOG_OUTPUT_TARGET` variants write (relative to the run's cwd). */
const LOG_FILE = "tracing.log";

/** Variant name → the `RUSTC_LOG_*` variables it sets (everything else `RUSTC_LOG*` is removed). */
export const VARIANTS: Record<string, Record<string, string>> = {
  default: {},
  color_always: { RUSTC_LOG_COLOR: "always" },
  color_never: { RUSTC_LOG_COLOR: "never" },
  color_auto: { RUSTC_LOG_COLOR: "auto" },
  color_invalid: { RUSTC_LOG_COLOR: "bogus" },
  lines: { RUSTC_LOG_LINES: "1" },
  lines_color: { RUSTC_LOG_LINES: "1", RUSTC_LOG_COLOR: "always" },
  entry_exit: { RUSTC_LOG_ENTRY_EXIT: "1" },
  wraptree: { RUSTC_LOG_WRAPTREE: "+3" },
  wraptree_invalid: { RUSTC_LOG_WRAPTREE: "-1" },
  output_target: { RUSTC_LOG_OUTPUT_TARGET: LOG_FILE },
  backtrace_other_target: { RUSTC_LOG_BACKTRACE: "rustc_metadata" },
  // `RUSTC_LOG` filters (EnvFilter static directives): enabled by a crate prefix, disabled (no directive cares),
  // overridden by a more specific directive, and a DEBUG directive (the "disabled statically" warning).
  filter_crate: { RUSTC_LOG: "rustc_infer=warn" },
  filter_other_target: { RUSTC_LOG: "rustc_errors=warn" },
  filter_more_specific: { RUSTC_LOG: "warn,rustc_infer::infer::relate=error" },
  // (The DEBUG directive stays within a converted INFO target, `INFO_CONVERTED_TARGETS` in src/rust_ts/tracing.ts:
  // elsewhere the port stops with `unported`.)
  filter_static_max: { RUSTC_LOG: "rustc_const_eval::interpret::no_such_module=debug,rustc_infer=warn" },
};

export interface Outcome {
  stdout: string;
  stderr: string;
  exit: number;
  log: string | null;
}

export function tydump_probe(): string {
  const data = process.env.RUST_TS_DATA;
  if (data === undefined) throw new Error("ERROR: RUST_TS_DATA is not set");
  return join(data, "target", "probes", "release", "tydump");
}

/** Runs `cmd ARGS` in a fresh temp dir holding a copy of the crate, with the variant's environment. */
export function run_variant(cmd: string[], variant: string): Outcome {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("RUSTC_LOG") && k !== "RUST_BACKTRACE" && k !== "RUSTC_ICE") env[k] = v;
  }
  Object.assign(env, { RUSTC_ICE: "0", RUST_BACKTRACE: "0" }, VARIANTS[variant]);
  const dir = mkdtempSync(join(tmpdir(), "rust-ts-tracing-"));
  try {
    copyFileSync(join(HERE, CRATE), join(dir, CRATE));
    const p = Bun.spawnSync([...cmd, ...ARGS], { cwd: dir, env });
    const log = existsSync(join(dir, LOG_FILE)) ? readFileSync(join(dir, LOG_FILE), "utf8") : null;
    return { stdout: p.stdout.toString(), stderr: p.stderr.toString(), exit: p.exitCode ?? -1, log };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function run_oracle(variant: string): Outcome {
  return run_variant([tydump_probe()], variant);
}

if (import.meta.main) {
  const out: Record<string, Outcome> = {};
  for (const v of Object.keys(VARIANTS)) out[v] = run_oracle(v);
  writeFileSync(join(HERE, "expected.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${Object.keys(out).length} variants`);
}
