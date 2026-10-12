// Tests for state.ts (compiler/rustc_ast_pretty/src/pprust/state.rs) against the real rustc.
//
// Expectations: `state.oracle.json`, produced by the scratch program `state.oracle.rs.txt`
// (a copy of $RUST_TS_DATA/tmp/pprust-state/oracle/main.rs), built and run with
//   rustc +nightly-2026-10-11 --edition 2024 main.rs -o oracle
//   DYLD_LIBRARY_PATH=$(rustc +nightly-2026-10-11 --print sysroot)/lib ./oracle > state.oracle.json
// using the toolchain's rustc-dev component (`rustc_parse::source_str_to_stream`, `parse_ty`,
// `parse_crate_mod`, then `pprust::{tts_to_string, tt_to_string, token_to_string, ty_to_string,
// attribute_to_string}`), session edition 2021. The oracle records the lexed token trees / parsed
// AST structurally; this test rebuilds the same values by hand (with `DUMMY_SP` spans, which carry
// the same root-context edition) and prints them through the ported `State`.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ast, attr, token as tk } from "../../rustc_ast/lib.ts";
import { DelimSpacing, DelimSpan, Spacing, TokenStream, type TokenTree } from "../../rustc_ast/tokenstream.ts";
import { Edition } from "../../rustc_span/edition.ts";
import { AttrId, DUMMY_SP, create_session_globals_then } from "../../rustc_span/lib.ts";
import { Ident, Symbol, kw } from "../../rustc_span/symbol.ts";
import { Str } from "../../std/str.ts";
import { attribute_to_string, token_to_string, tt_to_string, tts_to_string, ty_to_string } from "./mod.ts";
import { PpAnn, State, print_crate } from "./state.ts";
import { FixupContext, debug_FixupContext } from "./state/fixup.ts";
import { PLAIN } from "../../std/fmt.ts";
import { SourceMap, FilePathMapping } from "../../rustc_span/source_map.ts";

type KindJ =
  | { $: "Ident" | "Lifetime"; sym: string; kind: tk.IdentKind }
  | { $: "Literal"; kind: string; n: number; sym: string; suffix: string | null }
  | { $: "DocComment"; comment_kind: tk.CommentKind; style: ast.AttrStyle; sym: string }
  | { $: string };
type TtJ =
  | { $: "Token"; kind: KindJ; spacing: Spacing }
  | { $: "Delimited"; open: Spacing; close: Spacing; delim: "Parenthesis" | "Brace" | "Bracket"; tts: TtJ[] };
type PathJ = { name: string; args: ArgJ[] | null }[];
type ArgJ = { $: "Type"; ty: TyJ } | { $: "Lifetime"; name: string };
type BoundJ = { $: "Trait"; path: PathJ; polarity: "Positive" | "Negative" | "Maybe"; parens: boolean } | { $: "Outlives"; name: string };
type TyJ =
  | { $: "Path"; path: PathJ }
  | { $: "Ref"; lifetime: string | null; mutbl: ast.Mutability; ty: TyJ }
  | { $: "Ptr"; mutbl: ast.Mutability; ty: TyJ }
  | { $: "Slice" | "Paren"; ty: TyJ }
  | { $: "Tup"; tys: TyJ[] }
  | { $: "Never" | "Infer" }
  | { $: "TraitObject"; dyn: boolean; bounds: BoundJ[] }
  | { $: "ImplTrait"; bounds: BoundJ[] };
type AttrJ =
  | {
      $: "Normal";
      style: ast.AttrStyle;
      unsafe: boolean;
      path: PathJ;
      args: { $: "Empty" } | { $: "Delimited"; delim: "Parenthesis" | "Brace" | "Bracket"; tts: TtJ[] };
    }
  | { $: "DocComment"; style: ast.AttrStyle; comment_kind: tk.CommentKind; sym: string };

interface Oracle {
  tts: { src: string; tts: TtJ[]; expected: string; tt_strings: string[]; tokens: [KindJ, string][] }[];
  tys: { src: string; ty: TyJ; expected: string }[];
  attrs: { attr: AttrJ; expected: string }[];
  print_crate_comments: { src: string; expected: string }[];
}

const ORACLE: Oracle = JSON.parse(readFileSync(join(import.meta.dir, "state.oracle.json"), "utf8"));

function with_globals<R>(f: () => R): R {
  return create_session_globals_then(Edition.Edition2021, [], undefined, f);
}

function lit_kind(kind: string, n: number): tk.LitKind {
  switch (kind) {
    case "StrRaw":
    case "ByteStrRaw":
    case "CStrRaw":
      return { $: kind, _0: n };
    default:
      return (tk.LitKind as unknown as Record<string, tk.LitKind>)[kind]!;
  }
}

function token_kind(k: KindJ): tk.TokenKind {
  if ("sym" in k && (k.$ === "Ident" || k.$ === "Lifetime")) {
    const kk = k as { $: "Ident" | "Lifetime"; sym: string; kind: tk.IdentKind };
    return { $: kk.$, _0: Symbol.intern(kk.sym), _1: kk.kind };
  }
  if (k.$ === "Literal") {
    const l = k as { kind: string; n: number; sym: string; suffix: string | null };
    return {
      $: "Literal",
      _0: new tk.Lit(lit_kind(l.kind, l.n), Symbol.intern(l.sym), l.suffix === null ? undefined : Symbol.intern(l.suffix)),
    };
  }
  if (k.$ === "DocComment") {
    const d = k as { comment_kind: tk.CommentKind; style: ast.AttrStyle; sym: string };
    return { $: "DocComment", _0: d.comment_kind, _1: d.style, _2: Symbol.intern(d.sym) };
  }
  const unit = (tk.TokenKind as unknown as Record<string, tk.TokenKind>)[k.$];
  if (unit === undefined) throw new Error(`unknown token kind ${k.$}`);
  return unit;
}

function delimiter(d: "Parenthesis" | "Brace" | "Bracket"): tk.Delimiter {
  return tk.Delimiter[d];
}

function tree(t: TtJ): TokenTree {
  if (t.$ === "Token") return { $: "Token", _0: new tk.Token(token_kind(t.kind), DUMMY_SP), _1: t.spacing };
  return {
    $: "Delimited",
    _0: new DelimSpan(DUMMY_SP, DUMMY_SP),
    _1: new DelimSpacing(t.open, t.close),
    _2: delimiter(t.delim),
    _3: stream(t.tts),
  };
}

function stream(tts: TtJ[]): TokenStream {
  return TokenStream.new(tts.map(tree));
}

function path(p: PathJ): ast.Path {
  return new ast.Path(
    DUMMY_SP,
    p.map((s) => {
      const args: ast.GenericArgs | undefined =
        s.args === null
          ? undefined
          : {
              $: "AngleBracketed",
              _0: {
                span: DUMMY_SP,
                args: s.args.map((a): ast.AngleBracketedArg => {
                  if (a.$ === "Type") return { $: "Arg", _0: { $: "Type", _0: ty(a.ty) } };
                  return { $: "Arg", _0: { $: "Lifetime", _0: lifetime(a.name) } };
                }),
              },
            };
      return new ast.PathSegment(Ident.with_dummy_span(Symbol.intern(s.name)), ast.DUMMY_NODE_ID, args);
    }),
  );
}

function lifetime(name: string): ast.Lifetime {
  return { id: ast.DUMMY_NODE_ID, ident: Ident.with_dummy_span(Symbol.intern(name)) };
}

function bounds(bs: BoundJ[]): ast.GenericBound[] {
  return bs.map((b): ast.GenericBound => {
    if (b.$ === "Outlives") return { $: "Outlives", _0: lifetime(b.name) };
    const polarity: ast.BoundPolarity = b.polarity === "Positive" ? ast.BoundPolarity.Positive : { $: b.polarity, _0: DUMMY_SP };
    return {
      $: "Trait",
      _0: new ast.PolyTraitRef(
        [],
        { constness: ast.BoundConstness.Never, asyncness: ast.BoundAsyncness.Normal, polarity },
        { path: path(b.path), ref_id: ast.DUMMY_NODE_ID },
        DUMMY_SP,
        b.parens ? "Yes" : "No",
      ),
    };
  });
}

function ty(t: TyJ): ast.Ty {
  let kind: ast.TyKind;
  switch (t.$) {
    case "Path":
      kind = { $: "Path", _0: undefined, _1: path(t.path) };
      break;
    case "Ref":
      kind = { $: "Ref", _0: t.lifetime === null ? undefined : lifetime(t.lifetime), _1: ty(t.ty), _2: t.mutbl };
      break;
    case "Ptr":
      kind = { $: "Ptr", _0: ty(t.ty), _1: t.mutbl };
      break;
    case "Slice":
    case "Paren":
      kind = { $: t.$, _0: ty(t.ty) };
      break;
    case "Tup":
      kind = { $: "Tup", _0: t.tys.map(ty) };
      break;
    case "Never":
    case "Infer":
      kind = ast.TyKind[t.$];
      break;
    case "TraitObject":
      kind = { $: "TraitObject", _0: bounds(t.bounds), _1: t.dyn ? "Dyn" : "None" };
      break;
    case "ImplTrait":
      kind = { $: "ImplTrait", _0: ast.DUMMY_NODE_ID, _1: bounds(t.bounds) };
      break;
  }
  return new ast.Ty(ast.DUMMY_NODE_ID, kind, DUMMY_SP);
}

function attribute(a: AttrJ): ast.Attribute {
  let kind: ast.AttrKind;
  if (a.$ === "DocComment") {
    kind = { $: "DocComment", _0: a.comment_kind, _1: Symbol.intern(a.sym) };
  } else {
    const args: ast.AttrArgs =
      a.args.$ === "Empty"
        ? ast.AttrArgs.Empty
        : {
            $: "Delimited",
            _0: new ast.DelimArgs(new DelimSpan(DUMMY_SP, DUMMY_SP), delimiter(a.args.delim), stream(a.args.tts)),
          };
    const unsafety: ast.Safety = a.unsafe ? { $: "Unsafe", _0: DUMMY_SP } : ast.Safety.Default;
    kind = { $: "Normal", _0: new ast.NormalAttr(new ast.AttrItem(unsafety, path(a.path), args, DUMMY_SP), undefined) };
  }
  return new ast.Attribute(kind, AttrId.from_u32(0), a.style, DUMMY_SP);
}

test("pprust::tts_to_string matches rustc", () => {
  with_globals(() => {
    for (const c of ORACLE.tts) {
      const ts = stream(c.tts);
      expect([c.src, tts_to_string(ts)]).toEqual([c.src, c.expected]);
      expect([c.src, ts._0.map((tt) => tt_to_string(tt))]).toEqual([c.src, c.tt_strings]);
    }
  });
});

test("pprust::token_to_string matches rustc", () => {
  with_globals(() => {
    let n = 0;
    for (const c of ORACLE.tts) {
      for (const [k, expected] of c.tokens) {
        expect(token_to_string(new tk.Token(token_kind(k), DUMMY_SP))).toBe(expected);
        n++;
      }
    }
    expect(n).toBeGreaterThan(100);
  });
});

test("pprust::ty_to_string matches rustc", () => {
  with_globals(() => {
    for (const c of ORACLE.tys) {
      expect([c.src, ty_to_string(ty(c.ty))]).toEqual([c.src, c.expected]);
    }
  });
});

test("pprust::attribute_to_string matches rustc", () => {
  with_globals(() => {
    for (const c of ORACLE.attrs) {
      expect(attribute_to_string(attribute(c.attr))).toBe(c.expected);
    }
  });
});

test("PathRoot segment is interned as kw::PathRoot", () => {
  with_globals(() => {
    expect(Symbol.intern("{{root}}")).toBe(kw.PathRoot);
  });
});

// `print_crate` on comment-only sources (empty crate): exercises `gather_comments`, `Comments`,
// `maybe_print_shebang`, `print_remaining_comments` and `print_comment`.
test("pprust::print_crate (comments only) matches rustc", () => {
  with_globals(() => {
    for (const [i, c] of ORACLE.print_crate_comments.entries()) {
      const sm = SourceMap.new(FilePathMapping.empty());
      const krate: ast.Crate = {
        id: ast.DUMMY_NODE_ID,
        attrs: [],
        items: [],
        spans: { inner_span: DUMMY_SP, inject_use_span: DUMMY_SP },
        is_placeholder: false,
      };
      const out = print_crate(sm, krate, { $: "Custom", _0: `c${i}` }, Str.from(c.src), new PpAnn(), false, Edition.Edition2021, attr.AttrIdGenerator.new());
      expect([c.src, out]).toEqual([c.src, c.expected]);
    }
  });
});

test("FixupContext transforms", () => {
  const f = FixupContext.new_stmt().leftmost_subexpression();
  expect(debug_FixupContext(f, PLAIN)).toBe(
    "FixupContext { stmt: false, leftmost_subexpression_in_stmt: true, match_arm: false, leftmost_subexpression_in_match_arm: false, parenthesize_exterior_struct_lit: false, next_operator_can_begin_expr: false, next_operator_can_continue_expr: true }",
  );
  expect(FixupContext.new_match_arm().leftmost_subexpression_with_dot().match_arm).toBe(true);
  expect(FixupContext.new_cond().rightmost_subexpression().parenthesize_exterior_struct_lit).toBe(true);
  expect(FixupContext.default().leftmost_subexpression_with_operator(true).next_operator_can_begin_expr).toBe(true);
});

test("State::new prints through the Printer", () => {
  with_globals(() => {
    const s = State.new();
    // Expected `str::escape_debug` output checked with rustc +nightly-2026-10-11:
    // `print!("{}", "a\"b\n'\u{301}x\u{301}".escape_debug())` prints `a\"b\n\'\u{301}x\u{301}`.
    s.print_string("a\"b\n'\u{301}x\u{301}", ast.StrStyle.Cooked);
    s.s.space();
    s.print_string("x", { $: "Raw", _0: 2 });
    expect(s.s.eof()).toBe(String.raw`"a\"b\n\'\u{301}x\u{301}" r##"x"##`);
  });
});
