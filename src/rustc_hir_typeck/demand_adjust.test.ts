// Tests of lane typeck-demand-adjust: fn_ctxt/adjust_fulfillment_errors.rs and demand.rs through the driver, against
// the oracle.
//
// demand_adjust_test/run.ts runs the ported driver through type checking with the error-reporting placeholders of other
// wave-19 lanes replaced by test stand-ins (see its header). `<case>.expected.json` is a projection of the pinned rustc's
// `--error-format=json` output (`REGEN=1` rewrites it); the port's JSON output is projected the same way:
// - `adjust_*` (mode `adjust`): the primary span of every error. The port emits one stand-in error per fulfillment error
//   at the cause span chosen by `adjust_fulfillment_error_for_expr_obligation`.
//   - `adjust_args`: `blame_specific_arg_if_possible` (first / second argument) and the `ImplDerived` drilling of
//     `blame_specific_part_of_expr_corresponding_to_generic_param` (tuples, references, struct literals, tuple-struct and
//     variant constructors, nested).
//   - `adjust_paths`: `point_at_path_if_possible` / `point_at_generic_if_possible` (turbofish on calls, paths, methods,
//     elided lifetimes before the type params), `point_at_field_if_possible`, method-call receivers (`Self` param),
//     type-relative paths.
// - `demand_*` (mode `demand`): every error's message, spans (positions, `is_primary`, labels) and children (level,
//   message, spans, suggestions). The parts `note_type_err` (lane errrep-infer-a, a placeholder here) adds to the oracle's
//   output are removed from the oracle side: the primary span's label, `found this type parameter` labels and the
//   span-less `expected .. found ..` note; the error code is dropped (the port's stand-in has none); primary spans are
//   listed first.
//   - `demand_basic`: `annotate_expected_due_to_let_ty` (let type, parameter, local, field), a
//     `note_source_of_type_mismatch_constraint` chain, `annotate_loop_expected_due_to_inference`,
//     `annotate_mut_binding_to_immutable_binding`, `explain_self_literal` (`Self(..)` and `Self { .. }`).
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN } from "../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "demand_adjust_test");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

const CASES = [
  ["adjust_args", "adjust"],
  ["adjust_paths", "adjust"],
  ["demand_basic", "demand"],
] as const;
type Mode = (typeof CASES)[number][1];

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

function rustc_at_pin(): boolean {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 && r.stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}

const args = (sysroot: string, c: string): string[] => [
  "--target",
  "x86_64-unknown-linux-gnu",
  "--sysroot",
  sysroot,
  "--edition=2021",
  "--error-format=json",
  "--crate-type",
  "lib",
  `${c}.rs`,
];
const oracle_args = (sysroot: string, c: string): string[] => [...args(sysroot, c), "--emit=metadata", "-o", join(process.env.TMPDIR ?? "/tmp", `demand_adjust_test_${c}.rmeta`)];

type JSpan = { line_start: number; column_start: number; line_end: number; column_end: number; is_primary: boolean; label: string | null; suggested_replacement: string | null };
type JDiag = { $message_type?: string; message: string; level: string; spans: JSpan[]; children: JDiag[] };

const pos = (s: JSpan) => [s.line_start, s.column_start, s.line_end, s.column_end];

function diagnostics(stderr: string): JDiag[] {
  const out: JDiag[] = [];
  for (const line of stderr.split("\n")) {
    if (!line.startsWith("{")) continue;
    const d = JSON.parse(line) as JDiag;
    if (d.$message_type === "diagnostic" && d.level === "error" && !d.message.startsWith("aborting due to")) out.push(d);
  }
  return out;
}

// `note_type_err` (rustc_trait_selection error_reporting/infer/mod.rs) parts of an oracle diagnostic.
const NOTE_TYPE_ERR_LABELS = new Set(["found this type parameter"]);
const is_note_type_err_child = (c: JDiag) => c.level === "note" && c.spans.length === 0 && /^expected [^]*\n\s*found /.test(c.message);

function project_span(s: JSpan, drop_primary_label: boolean) {
  return { pos: pos(s), is_primary: s.is_primary, label: drop_primary_label && s.is_primary ? null : s.label, suggested_replacement: s.suggested_replacement };
}

// The oracle's primary span carries `note_type_err`'s label, which puts it first in the JSON (`MultiSpan::span_labels`:
// labels in order, then unlabeled primary spans); the port's stand-in has no primary label.
const primary_first = (spans: JSpan[]) => [...spans.filter((s) => s.is_primary), ...spans.filter((s) => !s.is_primary)];

function project(mode: Mode, stderr: string, oracle: boolean): unknown {
  const ds = diagnostics(stderr);
  if (mode === "adjust") return ds.map((d) => d.spans.filter((s) => s.is_primary).map(pos));
  return ds.map((d) => ({
    message: d.message,
    spans: primary_first(d.spans).filter((s) => !(oracle && s.label !== null && NOTE_TYPE_ERR_LABELS.has(s.label))).map((s) => project_span(s, oracle)),
    children: d.children
      .filter((c) => !(oracle && is_note_type_err_child(c)))
      .map((c) => ({ level: c.level, message: c.message, spans: c.spans.map((s) => project_span(s, false)) })),
  }));
}

function run(cmd: string[], mode?: Mode): { exit: number; stderr: string } {
  const env = mode === undefined ? ENV : { ...ENV, RUST_TS_TEST_MODE: mode };
  const r = Bun.spawnSync(cmd, { cwd: DIR, env, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stderr: r.stderr.toString() };
}

const fixture = (c: string) => join(DIR, `${c}.expected.json`);
const oracle_projection = (s: string, c: string, mode: Mode) => {
  const r = run(["rustc", `+${PIN.toolchain}`, ...oracle_args(s, c)]);
  return { exit: r.exit, diagnostics: project(mode, r.stderr, true) };
};

if (REGEN) {
  const s = sysroot();
  if (s === undefined || !rustc_at_pin()) throw new Error("ERROR: REGEN needs the pinned toolchain");
  for (const [c, mode] of CASES) writeFileSync(fixture(c), `${JSON.stringify(oracle_projection(s, c, mode), null, 1)}\n`);
}

const expected = (c: string) => JSON.parse(readFileSync(fixture(c), "utf8"));

test("demand_adjust_test fixtures are the current oracle output", () => {
  const s = sysroot();
  if (s === undefined || !rustc_at_pin()) {
    if (REQUIRE) throw new Error("ERROR: pinned toolchain missing");
    return;
  }
  for (const [c, mode] of CASES) expect({ c, ...oracle_projection(s, c, mode) }).toEqual({ c, ...expected(c) });
}, 120_000);

for (const [c, mode] of CASES) {
  test(`demand_adjust_test/${c}.rs (${mode}): the port's diagnostics equal the oracle's`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const r = run(["bun", join(DIR, "run.ts"), ...args(s, c)], mode);
    if (r.stderr.includes("rust-ts: unported:")) throw new Error(`ERROR: ${r.stderr.split("\n").find((l) => l.includes("unported"))}`);
    expect({ exit: r.exit, diagnostics: project(mode, r.stderr, false) }).toEqual(expected(c));
  }, 120_000);
}
