// Unit tests for lane typeck-fnsugg-a: fn_ctxt/suggestions.rs:1..2025 and method/prelude_edition_lints.rs (the three
// `impl Diagnostic`s, `trait_path_or_bare_name`, `trait_path`, `adjust_expr`).
//
// Typeck of real bodies does not reach these suggestions yet (other lanes' placeholders stop first), so each test
// calls the ported method on a fake `FnCtxt` receiver (precedent: typeck_impl.test.ts): a plain object carrying the
// members the method reads (a fresh-interner `TyCtxt` for types, a real `SourceMap` for snippets, a real `DiagCtxt`
// whose emitter records messages and suggestions), with the other FnCtxt / TyCtxt methods it calls faked.
import { expect, test } from "bun:test";
import "./lib.ts";
import { DiagCtxt, DiagCtxtFlags_default, type Diag, type DiagInner } from "../rustc_errors/lib.ts";
import { Emitter } from "../rustc_errors/emitter.ts";
import { format_diag_message } from "../rustc_errors/formatting.ts";
import * as hir from "../rustc_hir/lib.ts";
import { HirId, ItemLocalId, OwnerId } from "../rustc_hir_id/lib.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import { enter_context, ImplicitCtxt } from "../rustc_middle/ty/context/tls.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { DefId, type LocalDefId } from "../rustc_span/def_id.ts";
import { BytePos, create_default_session_globals_then, type FileName, Span } from "../rustc_span/lib.ts";
import { FilePathMapping, SourceMap } from "../rustc_span/source_map.ts";
import { Ident, Symbol } from "../rustc_span/symbol.ts";
import { Str } from "../std/str.ts";
import { FnCtxt } from "./decls.ts";
import { AmbiguousTraitMethodCall_into_diag } from "./method/prelude_edition_lints.ts";
import type { AmbiguousTraitMethodCall } from "./method/prelude_edition_lints.gen.ts";
import type { AutorefOrPtrAdjustment, Pick } from "./method/probe.gen.ts";

let TCX: TyCtxt | undefined;
function mk_tcx(): TyCtxt {
  const interners = CtxtInterners.new(undefined);
  let types: CommonTypes | undefined;
  let lifetimes: CommonLifetimes | undefined;
  const gcx = {
    interners,
    sess: {
      opts: { trimmed_def_paths: false, unstable_opts: { trim_diagnostic_paths: true } },
      verbose_internals: () => false,
    },
    get types() {
      return (types ??= CommonTypes.new(interners));
    },
    get lifetimes() {
      return (lifetimes ??= CommonLifetimes.new(interners));
    },
  };
  TCX = new TyCtxt(gcx as unknown as GlobalCtxt);
  return TCX;
}

const test_ = (name: string, f: () => void): void => {
  test(name, () =>
    create_default_session_globals_then(() => {
      const tcx = mk_tcx();
      enter_context(new ImplicitCtxt(tcx, undefined, 0), () => f());
    }),
  );
};

interface Recorded {
  msg: string;
  /** One entry per suggestion: its message and, per substitution, the `(span, snippet)` parts. */
  suggestions: { msg: string; subs: [Span, string][][] }[];
  children: string[];
}
class RecordingEmitter extends Emitter {
  readonly out: Recorded[] = [];
  emit_diagnostic(diag: DiagInner): void {
    const fmt = (m: Parameters<typeof format_diag_message>[0]) => format_diag_message(m, diag.args);
    this.out.push({
      msg: diag.messages.map(([m]) => fmt(m)).join(""),
      suggestions:
        diag.suggestions.$ === "Disabled"
          ? []
          : diag.suggestions._0.map((s) => ({ msg: fmt(s.msg), subs: s.substitutions.map((sub) => sub.parts.map((p): [Span, string] => [p.span, p.snippet])) })),
      children: diag.children.map((c) => c.messages.map(([m]) => fmt(m)).join("")),
    });
  }
  source_map(): undefined {
    return undefined;
  }
}

/** A fresh error `Diag`, and a function emitting it and returning what the emitter saw. */
function mk_err(): { err: Diag; emit: () => Recorded } {
  const em = new RecordingEmitter();
  const dcx = DiagCtxt.new(em).with_flags({ ...DiagCtxtFlags_default(), can_emit_warnings: true });
  const err = dcx.handle().struct_err("test");
  return {
    err,
    emit: () => {
      err.emit();
      return em.out[0]!;
    },
  };
}

/** A `SourceMap` holding `src`, and the span of the first occurrence of `needle` (at or after `from`). */
function mk_sm(src: string): { sm: SourceMap; span: (needle: string, from?: number) => Span } {
  const sm = SourceMap.new(FilePathMapping.empty());
  const name: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), "test.rs") };
  const sf = sm.new_source_file(name, Str.from(src));
  return {
    sm,
    span: (needle, from = 0) => {
      const at = src.indexOf(needle, from);
      if (at < 0) throw new Error(`no ${needle}`);
      return Span.with_root_ctxt(BytePos(sf.start_pos + at), BytePos(sf.start_pos + at + needle.length));
    },
  };
}

const OWNER = new OwnerId(0 as LocalDefId);
const hid = (local: number): HirId => new HirId(OWNER, ItemLocalId.from_u32(local));
const lo = (s: Span): number => Span.lo(s) as number;
const hi = (s: Span): number => Span.hi(s) as number;
/** `[lo, hi, snippet]` per part of each substitution. */
const parts = (subs: [Span, string][][]): [number, number, string][][] => subs.map((sub) => sub.map(([s, t]) => [lo(s), hi(s), t]));

/** `FnCtxt.prototype.<name>` called on a fake receiver. */
function call<K extends keyof FnCtxt>(name: K, self_: object, ...args: unknown[]): unknown {
  return (FnCtxt.prototype[name] as unknown as (...a: unknown[]) => unknown).apply(self_, args);
}

test_("suggestions.rs:51 suggest_semicolon_at_end", () => {
  const { span } = mk_sm("fn f() { g() }");
  const { err, emit } = mk_err();
  call("suggest_semicolon_at_end", {}, span("g()"), err);
  const d = emit();
  expect(d.suggestions.map((s) => s.msg)).toEqual(["consider using a semicolon here"]);
  expect(parts(d.suggestions[0]!.subs)).toEqual([[[hi(span("g()")), hi(span("g()")), ";"]]]);
});

test_("suggestions.rs:943 is_next_stmt_expr_continuation", () => {
  const { span } = mk_sm("{ if a { b } else { c } &d; }");
  const e = (local: number, kind: hir.ExprKind): hir.Expr => new hir.Expr(hid(local), kind, span("d"));
  const stmt = (local: number, kind: hir.StmtKind): hir.Stmt => ({ hir_id: hid(local), kind, span: span("d") });
  const if_stmt = stmt(1, { $: "Expr", _0: e(2, { $: "Tup", _0: [] }) });
  const addr_of = e(4, { $: "AddrOf", _0: "Ref", _1: "Not", _2: e(5, { $: "Tup", _0: [] }) } as hir.ExprKind);
  const call_ = e(6, { $: "Tup", _0: [] });
  const run = (stmts: hir.Stmt[], tail: hir.Expr | undefined, id: HirId): unknown => {
    const block = new hir.Block(stmts, tail, hid(99), hir.BlockCheckMode.DefaultBlock, span("d"), false);
    const fcx = { tcx: { parent_hir_node: (_: HirId) => ({ $: "Block", _0: block }) } };
    return call("is_next_stmt_expr_continuation", fcx, id);
  };
  // `if .. {} else {} &d;`: the next statement is `&d` (a binop lookalike).
  expect(run([if_stmt, stmt(3, { $: "Semi", _0: addr_of })], undefined, hid(1))).toBe(true);
  // ... or the block's tail expression.
  expect(run([if_stmt], addr_of, hid(1))).toBe(true);
  // A following `()` is not a continuation; neither is a missing statement.
  expect(run([if_stmt, stmt(3, { $: "Semi", _0: call_ })], undefined, hid(1))).toBe(false);
  expect(run([if_stmt], undefined, hid(1))).toBe(false);
  // The passed statement is not in the block.
  expect(run([if_stmt], addr_of, hid(7))).toBe(false);
});

test_("suggestions.rs:1827 suggest_floating_point_literal: hex literal ending in f32 / f64", () => {
  const tcx = TCX!;
  const { sm, span } = mk_sm("let x: f32 = 0x1f32; let y: f64 = 0xABf64; let z: f32 = 1f32; let w: f32 = 0xf32;");
  const fcx = { tcx: { sess: { source_map: () => sm } } };
  const lit = (text: string, value: bigint): hir.Expr => {
    const s = span(text);
    return new hir.Expr(hid(1), { $: "Lit", _0: { node: { $: "Int", _0: value, _1: { $: "Unsuffixed" } }, span: s } } as hir.ExprKind, s);
  };

  let { err, emit } = mk_err();
  expect(call("suggest_floating_point_literal", fcx, err, lit("0x1f32", 0x1f32n), tcx.types.f32)).toBe(true);
  let d = emit();
  expect(d.suggestions.map((s) => s.msg)).toEqual(["rewrite this as a decimal floating point literal, or use `as` to turn a hex literal into a float"]);
  expect(d.suggestions[0]!.subs.map((sub) => sub.map(([, t]) => t))).toEqual([["0x1 as f32"], ["1_f32"]]);

  ({ err, emit } = mk_err());
  expect(call("suggest_floating_point_literal", fcx, err, lit("0xABf64", 0xabf64n), tcx.types.f64)).toBe(true);
  d = emit();
  expect(d.suggestions[0]!.subs.map((sub) => sub.map(([, t]) => t))).toEqual([["0xAB as f64"], ["171_f64"]]);

  // Not hex; too short (`snippet.len() <= 5`); expected type not a float.
  ({ err } = mk_err());
  expect(call("suggest_floating_point_literal", fcx, err, lit("1f32", 0x1f32n), tcx.types.f32)).toBe(false);
  expect(call("suggest_floating_point_literal", fcx, err, lit("0xf32", 0xf32n), tcx.types.f32)).toBe(false);
  expect(call("suggest_floating_point_literal", fcx, err, lit("0x1f32", 0x1f32n), tcx.types.u32)).toBe(false);
});

test_("suggestions.rs:1909 suggest_null_ptr_for_literal_zero_given_to_ptr_arg", () => {
  const tcx = TCX!;
  const { span } = mk_sm("f(0); f(1);");
  const null_mut = new DefId(5 as never, 1 as never);
  const asked: string[] = [];
  const fcx = {
    tcx: {
      get_diagnostic_item: (s: Symbol) => (asked.push(Symbol.as_str(s)), null_mut),
      def_path_str: (d: DefId) => (d === null_mut ? "core::ptr::null_mut" : "?"),
    },
  };
  const lit = (text: string, value: bigint): hir.Expr => {
    const s = span(text);
    return new hir.Expr(hid(1), { $: "Lit", _0: { node: { $: "Int", _0: value, _1: { $: "Unsuffixed" } }, span: s } } as hir.ExprKind, s);
  };

  const { err, emit } = mk_err();
  expect(call("suggest_null_ptr_for_literal_zero_given_to_ptr_arg", fcx, err, lit("0", 0n), Ty.new_mut_ptr(tcx, tcx.types.u8))).toBe(true);
  expect(asked).toEqual(["ptr_null_mut"]);
  const d = emit();
  expect(d.suggestions.map((s) => s.msg)).toEqual(["if you meant to create a null pointer, use `core::ptr::null_mut()`"]);
  expect(parts(d.suggestions[0]!.subs)).toEqual([[[lo(span("0")), hi(span("0")), "core::ptr::null_mut()"]]]);

  // A literal other than `0`, or a non-pointer expected type.
  expect(call("suggest_null_ptr_for_literal_zero_given_to_ptr_arg", fcx, err, lit("1", 1n), Ty.new_mut_ptr(tcx, tcx.types.u8))).toBe(false);
  expect(call("suggest_null_ptr_for_literal_zero_given_to_ptr_arg", fcx, err, lit("0", 0n), tcx.types.u8)).toBe(false);
  expect(asked).toEqual(["ptr_null_mut"]);
});

test_("suggestions.rs:1484/1788 suggest_block_to_brackets_peeling_refs: `&{ 1 }` where `&[i32]` is expected", () => {
  const tcx = TCX!;
  const { sm, span } = mk_sm("let a: &[i32] = &{ 1 };");
  const coerced: [Ty, Ty][] = [];
  const fcx = {
    tcx: { sess: { source_map: () => sm } },
    may_coerce: (a: Ty, b: Ty) => (coerced.push([a, b]), true),
    suggest_block_to_brackets: FnCtxt.prototype.suggest_block_to_brackets,
  };
  const blk = new hir.Block([], new hir.Expr(hid(3), { $: "Tup", _0: [] }, span("1")), hid(2), hir.BlockCheckMode.DefaultBlock, span("{ 1 }"), false);
  const block_expr = new hir.Expr(hid(1), { $: "Block", _0: blk, _1: undefined }, span("{ 1 }"));
  const addr_of = new hir.Expr(hid(0), { $: "AddrOf", _0: "Ref", _1: "Not", _2: block_expr } as hir.ExprKind, span("&{ 1 }"));
  const re = tcx.lifetimes.re_erased;
  const { err, emit } = mk_err();
  const found = Ty.new_imm_ref(tcx, re, tcx.types.i32);
  const expected = Ty.new_imm_ref(tcx, re, Ty.new_slice(tcx, tcx.types.i32));
  expect(call("suggest_block_to_brackets_peeling_refs", fcx, err, addr_of, found, expected)).toBe(true);
  // The refs are peeled: the block's type is coerced to the slice's element type.
  expect(coerced).toEqual([[tcx.types.i32, tcx.types.i32]]);
  const d = emit();
  expect(d.suggestions.map((s) => s.msg)).toEqual(["to create an array, use square brackets instead of curly braces"]);
  const b = span("{ 1 }");
  expect(parts(d.suggestions[0]!.subs)).toEqual([
    [
      [lo(b), lo(b) + 1, "["],
      [hi(b) - 1, hi(b), "]"],
    ],
  ]);
  // Not a block under the refs: nothing.
  const { err: err2 } = mk_err();
  expect(call("suggest_block_to_brackets_peeling_refs", fcx, err2, blk.expr, tcx.types.i32, expected)).toBe(false);
});

// ---- method/prelude_edition_lints.rs ----

function mk_pick(autoderefs: number, adj: AutorefOrPtrAdjustment | undefined): Pick {
  return { autoderefs, autoref_or_ptr_adjustment: adj } as unknown as Pick;
}

test_("prelude_edition_lints.rs:470 adjust_expr: autoref / ToConstPtr / ReborrowPin, imprecise outside `outer`", () => {
  const { sm, span } = mk_sm("x.try_into(); y");
  const fcx = { sess: () => ({ source_map: () => sm }) };
  const outer = span("x.try_into()");
  const x = new hir.Expr(hid(1), { $: "Tup", _0: [] }, span("x"));
  const cases: [Pick, [string, boolean]][] = [
    [mk_pick(1, { $: "Autoref", mutbl: "Mut", unsize: false }), ["&mut *x", true]],
    [mk_pick(0, { $: "Autoref", mutbl: "Not", unsize: false }), ["&x", true]],
    [mk_pick(2, undefined), ["**x", true]],
    [mk_pick(1, { $: "ToConstPtr" }), ["*x as *const _", true]],
    [mk_pick(0, { $: "ReborrowPin", _0: "Mut" }), ["Pin<&mut x>", true]],
    [mk_pick(0, { $: "ReborrowPin", _0: "Not" }), ["Pin<&x>", true]],
  ];
  for (const [pick, want] of cases) expect(call("adjust_expr", fcx, pick, x, outer)).toEqual(want);
  // `y` is not inside `outer`: `(..)`, imprecise.
  const y = new hir.Expr(hid(2), { $: "Tup", _0: [] }, span("y", 13));
  expect(call("adjust_expr", fcx, mk_pick(0, { $: "Autoref", mutbl: "Not", unsize: false }), y, outer)).toEqual(["&(..)", false]);
});

test_("prelude_edition_lints.rs:416/428 trait_path_or_bare_name / trait_path", () => {
  const trait_def_id = new DefId(7 as never, 1 as never);
  const other = new DefId(8 as never, 1 as never);
  const ident = (s: string): Ident => Ident.new(Symbol.intern(s), Span.with_root_ctxt(BytePos(0), BytePos(0)));
  const use_item = (kind: hir.UseKind, prefix: string[]): hir.Item =>
    ({
      expect_use: () => ({ kind }),
      kind: { $: "Use", _0: { prefix: { segments: prefix.map((p) => ({ ident: ident(p) })) } } },
    }) as unknown as hir.Item;
  const run = (traits: { def_id: DefId; import_ids: number[] }[] | undefined, items: hir.Item[]): unknown => {
    const fcx = {
      tcx: {
        in_scope_traits: (_: HirId) => traits,
        hir_expect_item: (id: number) => items[id]!,
        def_key: (_: DefId) => ({ disambiguated_data: { data: { $: "TypeNs", _0: Symbol.intern("Bare") } } }),
      },
      trait_path: FnCtxt.prototype.trait_path,
    };
    return call("trait_path_or_bare_name", fcx, Span.with_root_ctxt(BytePos(0), BytePos(0)), hid(1), trait_def_id);
  };
  // No traits in scope / not found / declared in the module (no imports): the def-path name.
  expect(run(undefined, [])).toBe("Bare");
  expect(run([{ def_id: other, import_ids: [0] }], [])).toBe("Bare");
  expect(run([{ def_id: trait_def_id, import_ids: [] }], [])).toBe("Bare");
  // `use a::Tr as _; use b::Tr2;`: the first non-`_` name.
  const items = [use_item({ $: "Single", _0: ident("_") }, ["a", "Tr"]), use_item({ $: "Single", _0: ident("Tr2") }, ["b", "Tr2"])];
  expect(run([{ def_id: trait_def_id, import_ids: [0, 1] }], items)).toBe("Tr2");
  // Only `_` imports: the first import's full path.
  expect(run([{ def_id: trait_def_id, import_ids: [0] }], items)).toBe("a::Tr");
  // A glob import: just the name.
  expect(run([{ def_id: trait_def_id, import_ids: [0] }], [use_item({ $: "Glob" }, ["a"])])).toBe("Bare");
});

test_("prelude_edition_lints.rs:28 AmbiguousTraitMethodCall: message, suggestion and the snippet-less help", () => {
  const { sm, span } = mk_sm("x.try_into()");
  const tcx = { sess: { source_map: () => sm } };
  const into = (self_expr_span: Span, adj: AutorefOrPtrAdjustment | undefined): Recorded => {
    const em = new RecordingEmitter();
    const dcx = DiagCtxt.new(em).with_flags({ ...DiagCtxtFlags_default(), can_emit_warnings: true });
    const lint: AmbiguousTraitMethodCall = {
      segment_name: Symbol.intern("try_into"),
      self_expr_span,
      pick: mk_pick(1, adj),
      tcx: tcx as unknown as TyCtxt,
      edition: "2021",
    };
    AmbiguousTraitMethodCall_into_diag(lint, dcx.handle(), "Warning" as never).emit();
    return em.out[0]!;
  };
  let d = into(span("x"), { $: "Autoref", mutbl: "Not", unsize: false });
  expect(d.msg).toBe("trait method `try_into` will become ambiguous in Rust 2021");
  expect(d.suggestions.map((s) => [s.msg, s.subs.map((sub) => sub.map(([, t]) => t))])).toEqual([["disambiguate the method call", [["(&*x)"]]]]);
  d = into(span("x"), { $: "ReborrowPin", _0: "Mut" });
  expect(d.suggestions[0]!.subs[0]![0]![1]).toBe("(Pin<&mut *x>)");
  // A span with no snippet (a different, unknown file position): help instead of a suggestion.
  d = into(Span.with_root_ctxt(BytePos(100000), BytePos(100001)), { $: "ToConstPtr" });
  expect(d.suggestions).toEqual([]);
  expect(d.children).toEqual(["disambiguate the method call with `(*(...) as *const _)`"]);
});
