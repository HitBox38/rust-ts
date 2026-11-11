// The `target-specs` report suite (lane harness-w51; owner's approval 2026-11-11, docs/state: other targets' specs may be ported,
// verified by a report suite that prints `--print target-spec-json` for each built-in target). Report only: no baseline, so
// `gate.ts run` leaves it out by default (as `cli`); `--suites target-specs` runs it. One process per case and side: the oracle is
// the pinned rustc, the subject src/rust_ts/main.ts (binary mode applies), each with the case's argv, from the upstream checkout,
// env `CLI_ENV`. stdout, stderr and exit are compared. No codegen, no LLVM: the spec's JSON only.
//
// The cases, read from the pinned upstream sources, never typed in:
// - one per built-in target, in the order of rustc_target's `supported_targets!` list (compiler/rustc_target/src/spec/mod.rs:
//   its `("<tuple>", <module>),` entries, which make `TARGETS`; 334 at the pin, the set `rustc --print target-list` of the pinned
//   toolchain prints, sorted): `--print target-spec-json --target <tuple> --sysroot <oracle sysroot>`, plus
//   `-Zunstable-options` when print_request.rs says the kind is unstable (`PrintKind::is_stable`; it is, at the pin). The
//   sysroot as the `cli` suite's print cases: the port has no default sysroot (`filesearch::default_sysroot`), and the
//   path is in the argv, so in the oracle cache key. Case id: `target-spec-json <tuple>`.
import { CLI_ENV, printKinds } from "./cli.ts";
import type { Case, Suite } from "./suites.ts";

export const TARGET_SPEC_MOD_RS = "compiler/rustc_target/src/spec/mod.rs";
/** The print request every case makes. */
export const TARGET_SPEC_PRINT = "target-spec-json";

/**
 * The built-in targets of rustc_target's spec/mod.rs (`src`): the tuples of its `supported_targets! { ... }` invocation (not the
 * `macro_rules!` that defines it), in order. Throws (`ERROR:`) on a line of the list that is no `("<tuple>", <module>),` entry,
 * a comment or blank, and on a tuple listed twice.
 */
export function supportedTargets(src: string): string[] {
  const start = src.search(/^supported_targets! \{$/m);
  if (start < 0) throw new Error(`ERROR: no \`supported_targets! {\` invocation in ${TARGET_SPEC_MOD_RS}`);
  const body = src.slice(src.indexOf("\n", start) + 1);
  const end = body.search(/^\}$/m);
  if (end < 0) throw new Error(`ERROR: the \`supported_targets!\` invocation of ${TARGET_SPEC_MOD_RS} does not end`);
  const out: string[] = [];
  for (const line of body.slice(0, end).split("\n")) {
    const t = line.trim();
    if (t === "" || t.startsWith("//")) continue;
    const m = /^\("([^"\s]+)", [a-z0-9_]+\),$/.exec(t);
    if (m === null) throw new Error(`ERROR: ${TARGET_SPEC_MOD_RS}: unexpected line in \`supported_targets!\`: ${t.slice(0, 100)}`);
    if (out.includes(m[1]!)) throw new Error(`ERROR: ${TARGET_SPEC_MOD_RS}: target ${m[1]} is listed twice`);
    out.push(m[1]!);
  }
  if (out.length === 0) throw new Error(`ERROR: the \`supported_targets!\` invocation of ${TARGET_SPEC_MOD_RS} lists no target`);
  return out;
}

/** Everything `targetSpecCases` makes the cases from. */
export interface TargetSpecInputs {
  /** spec/mod.rs's text (`supportedTargets`). */
  specModRs: string;
  /** print_request.rs's text (`printKinds`: whether `target-spec-json` needs `-Zunstable-options`). */
  printRequest: string;
  /** The oracle sysroot, passed to every case. */
  sysroot: string;
}

/** The cases of the `target-specs` suite (see the header), ids unique. */
export function targetSpecCases(i: TargetSpecInputs): Case[] {
  const kind = printKinds(i.printRequest).find((k) => k.name === TARGET_SPEC_PRINT);
  if (kind === undefined) throw new Error(`ERROR: no print kind ${TARGET_SPEC_PRINT} in print_request.rs`);
  const unstable = kind.stable ? [] : ["-Zunstable-options"];
  return supportedTargets(i.specModRs).map((t) => ({ id: `${TARGET_SPEC_PRINT} ${t}`, file: "", args: ["--print", TARGET_SPEC_PRINT, "--target", t, ...unstable, "--sysroot", i.sysroot], env: CLI_ENV }));
}

/** What the suite takes from harness/suites.ts (which loads scripts/lib/common.ts, so this module does not). */
export interface TargetSpecSuiteDeps {
  /** The two files `targetSpecCases` reads (`TARGET_SPEC_MOD_RS`, cli.ts `PRINT_REQUEST_RS`), read from the upstream checkout. */
  specModRs: () => string;
  printRequest: () => string;
  sysroot: () => string;
  /** The oracle command of an argv (`oracleRustcCmd`). */
  oracle: (args: string[]) => string[];
  /** The subject command of an argv. */
  subject: (args: string[]) => string[];
}

/** The `target-specs` suite (see the header). */
export function targetSpecSuite(d: TargetSpecSuiteDeps): Suite {
  let memo: Case[] | undefined;
  return {
    name: "target-specs",
    milestone: "M7",
    description:
      "report only: --print target-spec-json --target <t> -Zunstable-options for every built-in target (rustc_target's supported_targets!, harness/target-specs.ts), the oracle sysroot: stdout + stderr + exit",
    mode: "single",
    timeoutMs: 60_000,
    oracleTimeoutMs: 60_000,
    cases: () => (memo ??= targetSpecCases({ specModRs: d.specModRs(), printRequest: d.printRequest(), sysroot: d.sysroot() })),
    oracle: ([c]) => d.oracle(c!.args),
    subject: ([c]) => d.subject(c!.args),
  };
}
