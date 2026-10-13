// Oracle fixture generator for lane expand-pm-types (not a port).
//
//   bun src/rustc_expand/proc_macro_oracle/gen.ts        (needs `rustc +nightly`, the pinned oracle)
//
// Builds the proc-macro crate `pm_probe.rs` into $RUST_TS_DATA/tmp/expand-pm-types/, then for each
// `cases/<name>/t.rs` runs, in that directory:
//   rustc +nightly --edition 2021 --crate-type lib -Zui-testing -Zunpretty=expanded [ARGS] --extern pm_probe=<lib> t.rs
// (`cases/<name>/ARGS`: extra flags; only `-Zspan-debug` is used, mirrored by the test as `ecfg.span_debug`)
// and records stderr and the exit code in expected.json. The probe's macros print what they observe through
// the bridge as `@@ ` lines on stderr, interleaved with the diagnostics the server emits; the TS test
// (proc_macro_server.test.ts) replays every invocation against the TS `Rustc` server into one buffer.
// An ICE is recorded as `panic` (its message line) with `stderr` cut before rustc's panic report (and the
// empty line the driver's ICE hook prints first).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../scripts/lib/common.ts";

const HERE = import.meta.dir;
const CASES = join(HERE, "cases");

/** Extra rustc flags of a case (`cases/<name>/ARGS`, whitespace-separated). */
export function case_args(name: string): string[] {
  const f = join(CASES, name, "ARGS");
  return existsSync(f) ? readFileSync(f, "utf8").split(/\s+/).filter((s) => s !== "") : [];
}

export interface Expected {
  stderr: string;
  exit: number;
  panic: string | null;
}

if (import.meta.main) {
  const tmp = join(DATA, "tmp", "expand-pm-types");
  mkdirSync(tmp, { recursive: true });
  const ext = process.platform === "darwin" ? "dylib" : process.platform === "win32" ? "dll" : "so";
  const lib = join(tmp, `libpm_probe.${ext}`);
  const b = Bun.spawnSync(
    ["rustc", `+${PIN.toolchain}`, "--edition", "2024", "--crate-type", "proc-macro", "--crate-name", "pm_probe", join(HERE, "pm_probe.rs"), "-o", lib],
    { stderr: "pipe" },
  );
  if (b.exitCode !== 0) {
    console.log(`ERROR: building pm_probe failed: ${b.stderr.toString().split("\n")[0]}`);
    process.exit(1);
  }
  const out: Record<string, Expected> = {};
  for (const name of readdirSync(CASES).sort()) {
    const p = Bun.spawnSync(
      ["rustc", `+${PIN.toolchain}`, "--edition", "2021", "--crate-type", "lib", "-Zui-testing", "-Zunpretty=expanded", ...case_args(name), "--extern", `pm_probe=${lib}`, "t.rs"],
      { cwd: join(CASES, name), env: { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" } },
    );
    let stderr = p.stderr.toString();
    let panic: string | null = null;
    const m = /^thread 'rustc' .* panicked at [^\n]*:\n([^\n]*)\n/m.exec(stderr);
    if (m) {
      panic = m[1]!;
      // rustc's ICE hook writes an empty line (`eprintln!()`) before the panic report.
      stderr = stderr.slice(0, m.index > 0 && stderr[m.index - 1] === "\n" ? m.index - 1 : m.index);
    }
    out[name] = { stderr, exit: p.exitCode ?? -1, panic };
  }
  writeFileSync(join(HERE, "expected.json"), JSON.stringify(out, null, 1) + "\n");
  console.log(`wrote ${Object.keys(out).length} cases`);
}
