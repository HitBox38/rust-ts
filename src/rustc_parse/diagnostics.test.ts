// rust-ts scenario tests for the generated `#[derive(Diagnostic)]` / `#[derive(Subdiagnostic)]` impls of
// compiler/rustc_parse/src/diagnostics.rs (no upstream `#[cfg(test)]` tests exist for it).
//
// Each case builds the diagnostic the parser would build for a tiny input, sends it through the
// generated `<T>_into_diag` and a recording emitter, and checks message, error code, primary spans,
// labels, children (in order) and suggestions. Expectations are the oracle's: `rustc +nightly
// --edition 2024 -Zparse-crate-root-only --error-format=json <file>` at the pin, with byte offsets
// taken from its `spans` (inputs quoted per case).
import { expect, test } from "bun:test";
import { format_diag_message } from "../rustc_errors/formatting.ts";
import { DiagCtxt, DiagCtxtFlags_default, type DiagInner, type Emitter, display_ErrCode, Level } from "../rustc_errors/lib.ts";
import { BytePos, create_default_session_globals_then, Span } from "../rustc_span/lib.ts";
import {
  AmbiguousPlus_into_diag,
  BadTypePlus_into_diag,
  IncorrectSemicolon_into_diag,
  InvalidComparisonOperator_into_diag,
  UnknownPrefix_diagnostic,
} from "./diagnostics.ts";

type SpanT = [number, number];
interface Recorded {
  level: string;
  msg: string;
  code: string | undefined;
  primary: SpanT[];
  labels: [SpanT, string][];
  children: [string, string, SpanT[]][];
  suggestions: { msg: string; parts: [SpanT, string][]; applicability: string; style: string }[];
  args: string[];
}

const lohi = (s: Span): SpanT => [Span.lo(s) as number, Span.hi(s) as number];

class RecordingEmitter implements Emitter {
  readonly out: Recorded[] = [];
  emit_diagnostic(diag: DiagInner): void {
    const fmt = (m: Parameters<typeof format_diag_message>[0]) => format_diag_message(m, diag.args);
    this.out.push({
      level: Level.to_str(diag.level),
      msg: diag.messages.map(([m]) => fmt(m)).join(""),
      code: diag.code === undefined ? undefined : display_ErrCode(diag.code),
      primary: diag.span.primary_spans.map(lohi),
      labels: diag.span.span_labels.map(([s, m]): [SpanT, string] => [lohi(s), fmt(m)]),
      children: diag.children.map((c): [string, string, SpanT[]] => [c.level, c.messages.map(([m]) => fmt(m)).join(""), c.span.primary_spans.map(lohi)]),
      suggestions:
        diag.suggestions.$ === "Disabled"
          ? []
          : diag.suggestions._0.map((s) => ({
              msg: fmt(s.msg),
              parts: s.substitutions.flatMap((sub) => sub.parts.map((p): [SpanT, string] => [lohi(p.span), p.snippet])),
              applicability: s.applicability,
              style: s.style,
            })),
      args: [...diag.args.keys()],
    });
  }
  emit_artifact_notification(): void {}
  emit_timing_section(): void {}
  emit_future_breakage_report(): void {}
  emit_unused_externs(): void {}
  should_show_explain(): boolean {
    return true;
  }
  supports_color(): boolean {
    return false;
  }
  source_map(): undefined {
    return undefined;
  }
}

const sp = (lo: number, hi: number): Span => Span.with_root_ctxt(BytePos(lo), BytePos(hi));

function run(f: (dcx: ReturnType<DiagCtxt["handle"]>) => void): Recorded {
  let rec: Recorded | undefined;
  create_default_session_globals_then(() => {
    const em = new RecordingEmitter();
    const dcx = DiagCtxt.new(em).with_flags({ ...DiagCtxtFlags_default(), can_emit_warnings: true });
    f(dcx.handle());
    expect(em.out.length).toBe(1);
    rec = em.out[0];
  });
  return rec!;
}

test("IncorrectSemicolon: arg used by a field message, verbose suggestion, bool help (`struct A {};`)", () => {
  // parser/diagnostics.rs:1642 `IncorrectSemicolon { span: self.token.span, name, show_help: true }`
  const r = run((dcx) => IncorrectSemicolon_into_diag({ span: sp(11, 12), show_help: true, name: "braced struct" }, dcx, Level.Error).emit());
  expect(r).toEqual({
    level: "error",
    msg: "expected item, found `;`",
    code: undefined,
    primary: [[11, 12]],
    labels: [],
    children: [["Help", "braced struct declarations are not followed by a semicolon", []]],
    suggestions: [{ msg: "remove this semicolon", parts: [[[11, 12], ""]], applicability: "MachineApplicable", style: "ShowAlways" }],
    // body(): `arg` calls for fields used in a message (`name`), never for attributed fields
    args: ["name"],
  });
});

test("AmbiguousPlus: #[subdiagnostic] multipart suggestion (`fn f() -> &dyn Send + Sync { loop {} }`)", () => {
  const r = run((dcx) =>
    AmbiguousPlus_into_diag({ span: sp(11, 26), suggestion: { lo: sp(11, 11), hi: sp(26, 26) } }, dcx, Level.Error).emit(),
  );
  expect(r).toEqual({
    level: "error",
    msg: "ambiguous `+` in a type",
    code: undefined,
    primary: [[11, 26]],
    labels: [],
    children: [],
    suggestions: [
      {
        msg: "try adding parentheses",
        parts: [
          [[11, 11], "("],
          [[26, 26], ")"],
        ],
        applicability: "MachineApplicable",
        style: "ShowCode",
      },
    ],
    args: [],
  });
});

test("BadTypePlus: error code, subdiagnostic enum variant with a nested #[subdiagnostic] (`fn f(x: &u8 + Send) {}`)", () => {
  const r = run((dcx) =>
    BadTypePlus_into_diag(
      { span: sp(8, 11), sub: { $: "AddParen", suggestion: { lo: sp(9, 9), hi: sp(18, 18) } } },
      dcx,
      Level.Error,
    ).emit(),
  );
  expect(r.code).toBe("E0178");
  expect(r.msg).toBe("expected a path on the left-hand side of `+`");
  expect(r.primary).toEqual([[8, 11]]);
  expect(r.suggestions).toEqual([
    {
      msg: "try adding parentheses",
      parts: [
        [[9, 9], "("],
        [[18, 18], ")"],
      ],
      applicability: "MachineApplicable",
      style: "ShowCode",
    },
  ]);
});

test("InvalidComparisonOperator: subdiagnostic message and code formatted from its own fields (`1 === 2`)", () => {
  // parser/expr.rs: `InvalidComparisonOperatorSub::Correctable { span, invalid: "===", correct: "==" }`
  const r = run((dcx) =>
    InvalidComparisonOperator_into_diag(
      { span: sp(26, 29), invalid: "===", sub: { $: "Correctable", span: sp(26, 29), invalid: "===", correct: "==" } },
      dcx,
      Level.Error,
    ).emit(),
  );
  expect(r.msg).toBe("invalid comparison operator `===`");
  expect(r.suggestions).toEqual([
    { msg: "`===` is not a valid comparison operator, use `==`", parts: [[[26, 29], "=="]], applicability: "MachineApplicable", style: "ShowAlways" },
  ]);
  // the subdiagnostic's args are eager (`sub_args`), they never reach the main diagnostic
  expect(r.args).toEqual(["invalid"]);
});

test("UnknownPrefix: label on the primary span, struct note, Option<subdiagnostic> (`foo\"bar\"`, via the Diagnostic trait object)", () => {
  const r = run((dcx) => {
    dcx.emit_err(UnknownPrefix_diagnostic({ span: sp(25, 28), prefix: "foo", sugg: { $: "Whitespace", _0: sp(28, 28) } }));
  });
  expect(r).toEqual({
    level: "error",
    msg: "prefix `foo` is unknown",
    code: undefined,
    primary: [[25, 28]],
    labels: [[[25, 28], "unknown prefix"]],
    children: [["Note", "prefixed identifiers and literals are reserved since Rust 2021", []]],
    suggestions: [{ msg: "consider inserting whitespace here", parts: [[[28, 28], " "]], applicability: "MaybeIncorrect", style: "ShowAlways" }],
    args: ["prefix"],
  });
});
