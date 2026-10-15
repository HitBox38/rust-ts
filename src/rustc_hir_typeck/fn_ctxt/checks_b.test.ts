// Tests of lane typeck-checks-b: argument-error reporting (fn_ctxt/checks.rs:1669..: `label_fn_like`,
// `label_generic_mismatches`, `get_hir_param_info`, `FindClosureArg`, `FnParam`, `FnCallDiagCtxt` / `ArgMatchingCtxt` /
// `ArgsCtxt` / `CallCtxt`) through the ported driver (src/rust_ts/tydump.ts), against the tydump probe
// (tools/probes/tydump) run with the tydump-nocore argv.
//
// `checks_test/<case>.stderr` / `<case>.exit` are the probe's output and exit status (`REGEN=1` rewrites them).
// - MATCH cases: rust-ts's stderr and exit status equal the fixtures; with the probe, stdout equals the probe's too.
//   - `arity`: missing / extra (comma trimming) / three missing arguments, `struct` constructor, swapped arguments.
//   - `generics`: generic-parameter labels (`this parameter needs to match ..`, `.. all reference this parameter`,
//     `expected some other arguments ..`), `/* a */` placeholders, permutation, extern fns (`FnParam::Ident`), C-variadic
//     (E0060), multi-line `provide the argument` suggestion, `multiple arguments are missing`.
//   - `closures`: closure calls (E0057, `closure defined here`), `F: Fn(..)` (`callable defined here`), `impl Fn(..)`
//     (`type parameter defined here`), enum variant constructor, trailing comma.
//   - `tuples`: wrap-in-a-tuple suggestions (fn, closure parameter, second parameter) and a user `impl FnOnce`
//     (`implementation defined here`, the `SelectionContext::select` probe).
// - STOP cases: the diagnostic reaches another wave-19 lane's placeholder; rust-ts exits 70 at exactly that stop and
//   its stderr before the stop is a prefix of the oracle's. When the owning lane lands, the stop moves: re-pin it.
import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "checks_test");
const ROOT = join(import.meta.dir, "../../..");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

const MATCH = ["arity", "generics", "closures", "tuples"] as const;
const STOP: [string, string][] = [
  // `ArgMatchingCtxt::suggest_confusable` -> method/suggest.rs (lane typeck-suggest-a)
  ["stop_method", "rustc_hir_typeck::method::suggest::FnCtxt::confusable_method_name"],
  // `FnCallDiagCtxt::check_single_incompatible` -> error_reporting/infer/mod.rs (lane errrep-infer-a)
  ["stop_single", "rustc_trait_selection::error_reporting::infer::TypeErrCtxt::report_and_explain_type_error"],
  // `FnCallDiagCtxt::labels_and_suggestion_text`, `Error::Invalid` -> error_reporting/infer/mod.rs (lane errrep-infer-a)
  ["stop_note", "rustc_trait_selection::error_reporting::infer::TypeErrCtxt::note_type_err"],
];
const ALL = [...MATCH, ...STOP.map(([c]) => c)];

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

function probe(): string | undefined {
  try {
    const { probePath } = require("../../../scripts/probes.ts") as typeof import("../../../scripts/probes.ts");
    const p = probePath("tydump");
    return existsSync(p) ? p : undefined;
  } catch {
    return undefined;
  }
}

const args = (sysroot: string, c: string): string[] => [
  "--target",
  "x86_64-unknown-linux-gnu",
  "--sysroot",
  sysroot,
  "--edition=2021",
  "--crate-type",
  "lib",
  `${c}.rs`,
];

interface Out {
  exit: number;
  stderr: string;
  stdout: string;
}
function run(cmd: string[]): Out {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stderr: r.stderr.toString(), stdout: r.stdout.toString() };
}

const probe_out = new Map<string, Out>();
function oracle(p: string, s: string, c: string): Out {
  let o = probe_out.get(c);
  if (o === undefined) {
    o = run([p, ...args(s, c)]);
    probe_out.set(c, o);
  }
  return o;
}

if (REGEN) {
  const s = sysroot();
  const p = probe();
  if (s === undefined || p === undefined) throw new Error("ERROR: REGEN needs the oracle sysroot and the tydump probe");
  for (const c of ALL) {
    const o = oracle(p, s, c);
    writeFileSync(join(DIR, `${c}.stderr`), o.stderr);
    writeFileSync(join(DIR, `${c}.exit`), `${o.exit}\n`);
  }
}

const expected = (c: string) => ({
  exit: Number(readFileSync(join(DIR, `${c}.exit`), "utf8").trim()),
  stderr: readFileSync(join(DIR, `${c}.stderr`), "utf8"),
});

test("checks_test fixtures are the current tydump probe output", () => {
  const s = sysroot();
  const p = probe();
  if (s === undefined || p === undefined) {
    if (REQUIRE) throw new Error("ERROR: tydump probe missing (bun scripts/probes.ts build tydump)");
    return;
  }
  for (const c of ALL) {
    const o = oracle(p, s, c);
    expect({ c, exit: o.exit, stderr: o.stderr }).toEqual({ c, ...expected(c) });
  }
}, 240_000);

for (const c of MATCH) {
  test(`checks_test/${c}.rs: argument errors equal the oracle`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const r = run(["bun", join(ROOT, "src/rust_ts/tydump.ts"), ...args(s, c)]);
    expect({ exit: r.exit, stderr: r.stderr }).toEqual(expected(c));
    const p = probe();
    if (p !== undefined) expect(r.stdout).toBe(oracle(p, s, c).stdout);
  }, 120_000);
}

for (const [c, stop] of STOP) {
  test(`checks_test/${c}.rs: stops UNPORTED at ${stop.split("::").pop()}, after the oracle's prefix`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const r = run(["bun", join(ROOT, "src/rust_ts/tydump.ts"), ...args(s, c)]);
    const last = `rust-ts: unported: ${stop}\n`;
    expect(r.exit).toBe(70);
    expect(r.stderr.endsWith(last)).toBe(true);
    const before = r.stderr.slice(0, r.stderr.length - last.length);
    expect(expected(c).stderr.startsWith(before)).toBe(true);
    // The stop is inside the first error's reporting: everything before it is the oracle's warnings.
    expect(before.includes("error")).toBe(false);
  }, 120_000);
}
