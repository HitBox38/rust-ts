// Debug of hand-built rustc_ast values vs. span-free subtrees of the oracle's
// `rustc +nightly -Zunpretty=ast-tree[,expanded]` output (lane ast-types; not an upstream test file).
import { expect, test } from "bun:test";
import { create_default_session_globals_then } from "../rustc_span/lib.ts";
import { DUMMY_SP } from "../rustc_span/span_encoding.ts";
import { debug_Ident, Ident, Symbol } from "../rustc_span/symbol.ts";
import { type Fmt, PLAIN, PRETTY } from "../std/fmt.ts";
import { Unported } from "../std/panic.ts";
import { CRATE_NODE_ID, debug_NodeId, NodeId } from "./node_id.ts";

// PORT: the generated modules import `debug_Span` (span_encoding.ts) and `debug_AttrId` (lib.ts),
// which lane span-wire adds. Until then the modules cannot be linked and these tests are skipped.
let A: typeof import("./ast.ts") | undefined;
let T: typeof import("./token.ts") | undefined;
let TS: typeof import("./tokenstream.ts") | undefined;
let F: typeof import("./format.ts") | undefined;
let IR: typeof import("../rustc_ast_ir/lib.ts") | undefined;
try {
  A = await import("./ast.ts");
  T = await import("./token.ts");
  TS = await import("./tokenstream.ts");
  F = await import("./format.ts");
  IR = await import("../rustc_ast_ir/lib.ts");
} catch (e) {
  if (!(e instanceof SyntaxError && /Export named 'debug_(Span|AttrId)'/.test(String(e)))) throw e;
}
const t = A ? test : test.skip;
// PORT: tests interning symbols need session globals; skipped while rustc_span leaves them unported.
const globals_ok = (() => {
  try {
    create_default_session_globals_then(() => {});
    return true;
  } catch (e) {
    if (e instanceof Unported) return false;
    throw e;
  }
})();
const tg = A && globals_ok ? test : test.skip;
// `Ident` Debug needs `Span::ctxt` (rustc_span lanes).
const ctxt_ok =
  globals_ok &&
  (() => {
    try {
      create_default_session_globals_then(() => debug_Ident(Ident.from_str("x"), PLAIN));
      return true;
    } catch (e) {
      if (e instanceof Unported) return false;
      throw e;
    }
  })();
const tc = A && ctxt_ok ? test : test.skip;

/** Strip the common indentation of an oracle excerpt. */
function dedent(s: string): string {
  const lines = s.replace(/^\n/, "").replace(/\n\s*$/, "").split("\n");
  const ind = Math.min(...lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
  return lines.map((l) => l.slice(ind)).join("\n");
}
const run = <R>(f: () => R): R => create_default_session_globals_then(f);

t("FnHeader (fn f<'a>(..))", () => {
  const { FnHeader, Const, Safety, Extern, debug_FnHeader } = A!;
  const h = new FnHeader(Const.No, undefined, Safety.Default, Extern.None);
  expect(debug_FnHeader(h, PRETTY)).toBe(
    dedent(`
                        header: FnHeader {
                            constness: No,
                            coroutine_marker: None,
                            safety: Default,
                            ext: None,
                        },`).replace(/^header: /, "").replace(/,$/, ""),
  );
  expect(debug_FnHeader(h, PLAIN)).toBe("FnHeader { constness: No, coroutine_marker: None, safety: Default, ext: None }");
});

t("BindingMode(No, Not)", () => {
  const { BindingMode, ByRef, debug_BindingMode } = A!;
  const m = new BindingMode(ByRef.No, "Not");
  expect(debug_BindingMode(m, PRETTY)).toBe("BindingMode(\n    No,\n    Not,\n)");
});

t("VisibilityKind: Inherited, Public", () => {
  const { VisibilityKind, debug_VisibilityKind } = A!;
  expect(debug_VisibilityKind(VisibilityKind.Inherited, PRETTY)).toBe("Inherited");
  expect(debug_VisibilityKind(VisibilityKind.Public, PRETTY)).toBe("Public");
});

tg("manual Debug: Lifetime (inline even under {:#?})", () =>
  run(() => {
    const lt = { id: NodeId.MAX, ident: Ident.new(Symbol.intern("'a"), DUMMY_SP) };
    expect(A!.debug_Lifetime(lt, PRETTY)).toBe("lifetime(4294967040: 'a)");
  }));

tc("manual Debug: Label (inline even under {:#?})", () =>
  run(() => {
    expect(A!.debug_Label({ ident: Ident.new(Symbol.intern("'outer"), DUMMY_SP) }, PRETTY)).toBe("label('outer#0)");
  }));

t("manual Debug: ImplPolarity", () => {
  const { ImplPolarity, debug_ImplPolarity } = A!;
  expect(debug_ImplPolarity(ImplPolarity.Positive, PRETTY)).toBe('"positive"');
  expect(debug_ImplPolarity({ $: "Negative", _0: DUMMY_SP }, PRETTY)).toBe('"negative"');
});

t("bitflags!: InlineAsmOptions", () => {
  const { InlineAsmOptions: O, debug_InlineAsmOptions } = A!;
  // asm!("nop", options(nomem, nostack)) / asm!("nop")  (ast-tree,expanded)
  expect(debug_InlineAsmOptions(O.union(O.NOMEM, O.NOSTACK), PRETTY)).toBe("NOMEM | NOSTACK");
  expect(debug_InlineAsmOptions(O.empty(), PRETTY)).toBe("");
  // bitflags::parser::to_writer: unknown bits as `0x..` after the names
  expect(debug_InlineAsmOptions(O.from_bits_retain(0x8001), PLAIN)).toBe("PURE | 0x8000");
  expect(O.contains(O.all(), O.MAY_UNWIND)).toBe(true);
  expect(O.bits(O.all())).toBe(0x1ff);
});

test("newtype_index!: NodeId", () => {
  expect(debug_NodeId(NodeId.MAX, PRETTY)).toBe("NodeId(4294967040)");
  expect(debug_NodeId(CRATE_NODE_ID, PLAIN)).toBe("NodeId(0)");
});

t("rustc_ast_ir: IntTy/UintTy/FloatTy Debug = name_str", () => {
  expect(IR!.debug_IntTy("I64", PRETTY)).toBe("i64");
  expect(IR!.debug_UintTy("U8", PRETTY)).toBe("u8");
  expect(IR!.debug_FloatTy("F32", PRETTY)).toBe("f32");
  expect(IR!.IntTy.Isize).toBe("Isize");
});

tg("token::Lit and TokenKind::Ident", () =>
  run(() => {
    const { Lit, LitKind, debug_Lit, debug_TokenKind } = T!;
    const lit = new Lit(LitKind.Integer, Symbol.intern("1"), Symbol.intern("u8"));
    expect(debug_Lit(lit, PRETTY)).toBe(
      dedent(`
                                            Lit {
                                                kind: Integer,
                                                symbol: "1",
                                                suffix: Some(
                                                    "u8",
                                                ),
                                            }`),
    );
    expect(debug_Lit(lit, PLAIN)).toBe('Lit { kind: Integer, symbol: "1", suffix: Some("u8") }');
    expect(debug_TokenKind({ $: "Ident", _0: Symbol.intern("foo"), _1: "Normal" }, PLAIN)).toBe('Ident("foo", Normal)');
    expect(debug_TokenKind({ $: "Literal", _0: lit }, PLAIN)).toBe('Literal(Lit { kind: Integer, symbol: "1", suffix: Some("u8") })');
  }));

t("tokenstream::DelimSpacing", () => {
  const { DelimSpacing, debug_DelimSpacing } = TS!;
  expect(debug_DelimSpacing(new DelimSpacing("JointHidden", "Alone"), PLAIN)).toBe("DelimSpacing { open: JointHidden, close: Alone }");
});

tg("format::FormatArguments.names (FxHashMap)", () =>
  run(() => {
    const { FormatArguments, debug_FormatArguments } = F!;
    const one = new FormatArguments([], 0, 1, new Map([[Symbol.intern("a"), 0]]));
    const f: Fmt = PRETTY;
    expect(debug_FormatArguments(one, f)).toBe(
      'FormatArguments {\n    arguments: [],\n    num_unnamed_args: 0,\n    num_explicit_args: 1,\n    names: {\n        "a": 0,\n    },\n}',
    );
    // more than one entry: rustc prints hashbrown order (oracle: `"b": 1, "a": 0`), unported
    const two = new FormatArguments([], 0, 2, new Map([[Symbol.intern("a"), 0], [Symbol.intern("b"), 1]]));
    expect(() => debug_FormatArguments(two, f)).toThrow(Unported);
  }));
