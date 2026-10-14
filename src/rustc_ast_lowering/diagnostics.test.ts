// rust-ts scenario tests for the generated `#[derive(Diagnostic)]` / `#[derive(Subdiagnostic)]` impls of
// compiler/rustc_ast_lowering/src/diagnostics.rs and its manual `impl IntoDiagArg for ResolvingRestrictionKind`
// (no upstream `#[cfg(test)]` tests exist for it).
//
// Each case builds the diagnostic lowering would build for a tiny input, sends it through the generated
// `<T>_into_diag` and a recording emitter, and checks message, error code, primary spans, labels, children (in
// order) and suggestions. Expectations are the oracle's: `rustc +nightly --edition 2024 --crate-type lib
// --error-format=json <file>` at the pin (aarch64-apple-darwin host for the asm case), with byte offsets taken
// from its `spans` (inputs quoted per case). The cases cover the type-map / diag_args entries this lane added:
// `DiagArgFromDisplay`, `DiagSymbolList<char>` (char `Display`), `ResolvingRestrictionKind` (Fluent select).
import { expect, test } from "bun:test";
import { DiagArgFromDisplay } from "../rustc_error_messages/diagnostic_impls.ts";
import { Emitter } from "../rustc_errors/emitter.ts";
import { format_diag_message } from "../rustc_errors/formatting.ts";
import { DiagSymbolList_from } from "../rustc_errors/diagnostic_impls.ts";
import { DiagCtxt, DiagCtxtFlags_default, type DiagInner, display_ErrCode, Level } from "../rustc_errors/lib.ts";
import { BytePos, create_default_session_globals_then, Span } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { ch } from "../std/char.ts";
import {
  GenericTypeWithParentheses_into_diag,
  InvalidAbi_into_diag,
  InvalidAsmTemplateModifierRegClass_into_diag,
  MisplacedImplTrait_into_diag,
  ResolvingRestrictionKind_into_diag_arg,
  RestrictionAncestorOnly_diagnostic,
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

class RecordingEmitter extends Emitter {
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

test("GenericTypeWithParentheses: code, label, #[subdiagnostic] multipart suggestion (`fn f(_: Option(u8)) {}`)", () => {
  // path.rs `GenericTypeWithParentheses { span, sub }` with `UseAngleBrackets { open_param, close_param }`
  const r = run((dcx) =>
    GenericTypeWithParentheses_into_diag({ span: sp(8, 18), sub: { open_param: sp(14, 15), close_param: sp(17, 18) } }, dcx, Level.Error).emit(),
  );
  expect(r).toEqual({
    level: "error",
    msg: "parenthesized type parameters may only be used with a `Fn` trait",
    code: "E0214",
    primary: [[8, 18]],
    labels: [[[8, 18], "only `Fn` traits may use parentheses"]],
    children: [],
    suggestions: [
      {
        msg: "use angle brackets instead",
        parts: [
          [[14, 15], "<"],
          [[17, 18], ">"],
        ],
        applicability: "MaybeIncorrect",
        style: "ShowCode",
      },
    ],
    args: [],
  });
});

test("InvalidAbi: code, struct-level note with a String arg, no suggestion (`extern \"Rust-intrinsic\" fn f() {}`)", () => {
  const r = run((dcx) =>
    InvalidAbi_into_diag(
      { span: sp(7, 23), abi: Symbol.intern("Rust-intrinsic"), command: "rustc --print=calling-conventions", suggestion: undefined },
      dcx,
      Level.Error,
    ).emit(),
  );
  expect(r).toEqual({
    level: "error",
    msg: "invalid ABI: found `Rust-intrinsic`",
    code: "E0703",
    primary: [[7, 23]],
    labels: [[[7, 23], "invalid ABI"]],
    children: [["Note", "invoke `rustc --print=calling-conventions` for a full list of supported calling conventions", []]],
    suggestions: [],
    args: ["abi", "command"],
  });
});

test("MisplacedImplTrait: a DiagArgFromDisplay arg (`fn f() { let _: impl Copy = 0u8; }`)", () => {
  // lib.rs lower_ty_direct: `position: DiagArgFromDisplay(&position)` (Display of ImplTraitPosition::Variable).
  // The oracle's further notes (feature `impl_trait_in_bindings`) are added by the caller, not by the derive.
  const r = run((dcx) =>
    MisplacedImplTrait_into_diag({ span: sp(16, 25), position: new DiagArgFromDisplay(() => "the type of variable bindings") }, dcx, Level.Error).emit(),
  );
  expect(r).toEqual({
    level: "error",
    msg: "`impl Trait` is not allowed in the type of variable bindings",
    code: "E0562",
    primary: [[16, 25]],
    labels: [],
    children: [["Note", "`impl Trait` is only allowed in arguments and return types of functions and methods", []]],
    suggestions: [],
    args: ["position"],
  });
});

test("InvalidAsmTemplateModifierRegClass: two labels, subdiagnostic enum with a DiagSymbolList<char> arg", () => {
  // `pub fn f() { unsafe { core::arch::asm!("mov {0:z}, x0", in(reg) 0u64) } }` (aarch64): asm.rs
  const r = run((dcx) =>
    InvalidAsmTemplateModifierRegClass_into_diag(
      {
        placeholder_span: sp(44, 49),
        op_span: sp(56, 68),
        modifier: "z",
        sub: { $: "SupportModifier", class_name: Symbol.intern("reg"), modifiers: DiagSymbolList_from([ch("w"), ch("x")]) },
      },
      dcx,
      Level.Error,
    ).emit(),
  );
  expect(r).toEqual({
    level: "error",
    msg: "invalid asm template modifier `z` for this register class",
    code: undefined,
    primary: [[44, 49]],
    labels: [
      [[44, 49], "template modifier"],
      [[56, 68], "argument"],
    ],
    children: [["Note", "the `reg` register class supports the following template modifiers: `w` and `x`", []]],
    suggestions: [],
    args: ["modifier"],
  });
});

test("RestrictionAncestorOnly: Fluent select on the manual IntoDiagArg of ResolvingRestrictionKind", () => {
  // `#![feature(impl_restriction)]\nmod m {}\npub impl(in crate::m) trait T {}`: item.rs lower_restriction_kind
  const r = run((dcx) => RestrictionAncestorOnly_diagnostic({ span: sp(51, 59), kind: "Impl" }).into_diag(dcx, Level.Error).emit());
  expect(r).toEqual({
    level: "error",
    msg: "trait implementation can only be restricted to ancestor modules",
    code: undefined,
    primary: [[51, 59]],
    labels: [],
    children: [],
    suggestions: [],
    args: ["kind"],
  });
  // `*[mut]` is the default arm: `Mut` selects it by value.
  const m = run((dcx) => RestrictionAncestorOnly_diagnostic({ span: sp(1, 2), kind: "Mut" }).into_diag(dcx, Level.Error).emit());
  expect(m.msg).toBe("field mutation can only be restricted to ancestor modules");
});

test("ResolvingRestrictionKind into_diag_arg (diagnostics.rs:600)", () => {
  const path = { value: undefined };
  expect(ResolvingRestrictionKind_into_diag_arg("Impl", path)).toEqual({ $: "Str", _0: "impl" });
  expect(ResolvingRestrictionKind_into_diag_arg("Mut", path)).toEqual({ $: "Str", _0: "mut" });
});
