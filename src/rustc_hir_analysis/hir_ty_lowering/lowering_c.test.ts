// Tests of lane hir-ty-lowering-c: hir_ty_lowering/{generics,bounds,dyn_trait}.rs, driven through the contract
// (`HirTyLowerer` trait object over a test vtable; methods of other lanes are shadowed per object where a test needs them).
//
// The diagnostic texts are the real output of the pinned nightly rustc (the oracle), byte for byte, for these programs
// (scratch dir; `rustc +nightly-2026-10-11 -Zui-testing --edition 2021 --emit=metadata --out-dir out <file>`):
//   e0747.rs   `struct S<const N: usize>;\ntype A = S<u8>;\n\nfn main() {}\n`
//   e0747c.rs  `struct T<X>(X);\nfn f(_: T<3>) {}\n\nfn main() {}\n`
//   order.rs   `struct S<'a, T>(&'a T);\nfn f(_: S<u8, 'static>) {}\n\nfn main() {}\n`
//   argument_order.rs   tests/ui/const-generics/argument_order.rs (its .stderr, the E0747 block)
//   e0794.rs   `fn f<'a>(_: &'a ()) {}\n\nfn main() {\n    f::<'static>(&());\n}\n`
//   relax.rs   `fn f<T: ?Send>() {}\n\nfn main() {}\n`
// The whole pipeline does not reach these paths yet (collect / typeck queries are unported), so each test rebuilds the HIR
// and `ty::Generics` rustc has at that point and calls the ported fn the way its caller does.
import { describe, expect, test } from "bun:test";
import "../lib.ts";
import { AnnotateSnippetEmitter } from "../../rustc_errors/annotate_snippet_emitter_writer.ts";
import { DiagCtxt, DiagCtxtFlags_default, type DiagCtxtHandle } from "../../rustc_errors/lib.ts";
import * as hir from "../../rustc_hir/lib.ts";
import type { Res } from "../../rustc_hir/def.ts";
import { HirId_make_owner } from "../../rustc_hir_id/lib.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { type GenericParamDef, Generics } from "../../rustc_middle/ty/generics.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import type { Clause } from "../../rustc_middle/ty/predicate.ts";
import { DefId, DefIndex, LOCAL_CRATE, LocalDefId } from "../../rustc_span/def_id.ts";
import { BytePos, create_default_session_globals_then, DUMMY_SP, type FileName, Span } from "../../rustc_span/lib.ts";
import { FilePathMapping, type SourceMap } from "../../rustc_span/source_map.ts";
import { SourceMap as SourceMapC } from "../../rustc_span/source_map.ts";
import { Ident, kw, Symbol } from "../../rustc_span/symbol.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import { ControlFlow } from "../../rustc_ast_ir/visit.ts";
import { INNERMOST } from "../../rustc_type_ir/lib.ts";
import { Unported } from "../../std/panic.ts";
import { Str } from "../../std/str.ts";
import { AutoStream, ColorChoice } from "../../vendor/anstream/lib.ts";
import { dyn_write, VecU8 } from "../../vendor/anstream/stream.ts";
import { HirTyLowerer, type GenericArgsLowerer, type HirTyLowererImpl } from "../decls.ts";
import { add_trait_bound, collect_bounds, collect_sizedness_bounds, CollectedBound, CollectedSizednessBounds, GenericParamAndBoundVarCollector, search_bounds_for } from "./bounds.ts";
import { replace_dummy_self_with_error } from "./dyn_trait.ts";
import { check_generic_arg_count, check_generic_arg_count_for_value_path, lower_generic_args, prohibit_explicit_late_bound_lifetimes } from "./generics.ts";
import type { GenericArgCountResult, ImpliedBoundsContext } from "./mod.gen.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { DefIdSet } from "../../rustc_span/def_id.ts";

const test_ = (name: string, f: () => void): void => {
  test(name, () => create_default_session_globals_then(f));
};

// ---- fixtures ----

/** A source file in a fresh `SourceMap`, an `AnnotateSnippetEmitter` (`-Zui-testing`) writing into a buffer, its `DiagCtxt`. */
function setup(path: string, src: string) {
  const sm: SourceMap = SourceMapC.new(FilePathMapping.empty());
  const name: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), path) };
  const sf = sm.new_source_file(name, Str.from(src));
  const buf = new VecU8();
  let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
  em = AnnotateSnippetEmitter.sm(em, sm);
  em = AnnotateSnippetEmitter.ui_testing(em, true);
  const dcx_ = DiagCtxt.new(em).with_flags({ ...DiagCtxtFlags_default(), can_emit_warnings: true });
  const dcx: DiagCtxtHandle = dcx_.handle();
  /** Span of the `nth` occurrence of `needle`. */
  const sp = (needle: string, nth = 0): Span => {
    let at = -1;
    for (let i = 0; i <= nth; i++) {
      at = src.indexOf(needle, at + 1);
      if (at < 0) throw new Error(`no ${needle}`);
    }
    return Span.with_root_ctxt(BytePos(sf.start_pos + at), BytePos(sf.start_pos + at + Buffer.byteLength(needle)));
  };
  const out = (): string => new TextDecoder().decode(buf.bytes());
  return { sm, dcx, sp, out };
}

const did = (i: number): DefId => new DefId(DefIndex.from_u32(i), LOCAL_CRATE);
let next_hir_id = 100;
const hid = (): hir.HirId => HirId_make_owner(LocalDefId.new(next_hir_id++));

function param(name: string, index: number, kind: GenericParamDef["kind"]): GenericParamDef {
  return { name: Symbol.intern(name), def_id: did(1000 + index), index, pure_wrt_drop: false, kind };
}
const LT: GenericParamDef["kind"] = { $: "Lifetime" };
const TY: GenericParamDef["kind"] = { $: "Type", has_default: false, synthetic: false };
const CT: GenericParamDef["kind"] = { $: "Const", has_default: false };

function generics(own_params: GenericParamDef[], has_late_bound_regions: Span | undefined = undefined): Generics {
  return new Generics(undefined, 0, own_params, new Map(), false, has_late_bound_regions);
}

/** A trait object over a test vtable: `tcx()` / `dcx()` answer, every other trait method stops. */
function lowerer(tcx: TyCtxt, dcx: DiagCtxtHandle): HirTyLowerer {
  const stop = (name: string) => () => {
    throw new Error(`test vtable: ${name}`);
  };
  const vtable = new Proxy({ tcx: () => tcx, dcx: () => dcx, item_def_id: () => LocalDefId.new(1) } as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : stop(k)),
  }) as unknown as HirTyLowererImpl<unknown>;
  return new HirTyLowerer(null, vtable);
}

/** The surface of `TyCtxt` the generic-args fns read in these tests. */
function fake_tcx(sm: SourceMap, defs: Generics, extra: Record<string, unknown> = {}): TyCtxt {
  return {
    sess: { source_map: () => sm },
    generics_of: () => defs,
    mk_args: (a: readonly GenericArg[]) => a,
    ...extra,
  } as unknown as TyCtxt;
}

/** A `GenericArgsLowerer` recording which params were provided / inferred (the "arg" is a tag string). */
function recording_ctx(args: hir.GenericArgs | undefined, infer_args = false, for_def: DefId | undefined = undefined): GenericArgsLowerer {
  return {
    args_for_def_id: (d) => [for_def === undefined || d.index === for_def.index ? args : undefined, infer_args],
    provided_kind: (_pre, param, arg) => `provided ${Symbol.as_str(param.name)}=${hir.GenericArg.descr(arg)}` as unknown as GenericArg,
    inferred_kind: (_pre, param) => `inferred ${Symbol.as_str(param.name)}` as unknown as GenericArg,
  };
}

const OK_COUNT: GenericArgCountResult = { explicit_late_bound: "No", correct: { $: "Ok", _0: null } };

function path_ty(span: Span, res: Res): hir.Ty<never> {
  return new hir.Ty(hid(), span, { $: "Path", _0: { $: "Resolved", _0: undefined, _1: new hir.Path<Res>(span, res, []) } }) as unknown as hir.Ty<never>;
}
function lifetime_arg(span: Span, name: Symbol): hir.GenericArg {
  return { $: "Lifetime", _0: new hir.Lifetime(hid(), new Ident(name, span), { $: "Static" } as never, { $: "Path" } as never, "ExplicitBound") };
}
function const_lit_arg(span: Span): hir.GenericArg {
  return { $: "Const", _0: new hir.ConstArg(hid(), { $: "Literal", lit: { $: "Int" } as never, negated: false }, span) };
}
function gen_args(args: hir.GenericArg[]): hir.GenericArgs {
  return new hir.GenericArgs(args, [], "No", DUMMY_SP);
}

// ---- generics.rs ----

describe("generics.rs", () => {
  test_("lower_generic_args: E0747 type provided when a constant was expected (oracle e0747.rs)", () => {
    const src = "struct S<const N: usize>;\ntype A = S<u8>;\n\nfn main() {}\n";
    const { sm, dcx, sp, out } = setup("e0747.rs", src);
    const defs = generics([param("N", 0, CT)]);
    const cx = lowerer(fake_tcx(sm, defs), dcx);
    const u8_ = path_ty(sp("u8"), { $: "PrimTy", _0: { $: "Uint", _0: "U8" } as never });
    const args = lower_generic_args(cx, did(1), [], false, undefined, OK_COUNT, recording_ctx(gen_args([{ $: "Type", _0: u8_ }])));
    // The mismatched arg is dropped and the param inferred.
    expect(args as unknown as string[]).toEqual(["inferred N"]);
    dcx.print_error_count();
    expect(out()).toBe(
      "error[E0747]: type provided when a constant was expected\n" +
        "  --> e0747.rs:2:12\n" +
        "   |\n" +
        "LL | type A = S<u8>;\n" +
        "   |            ^^\n" +
        "   |\n" +
        "help: if this generic argument was intended as a const parameter, surround it with braces\n" +
        "   |\n" +
        "LL | type A = S<{ u8 }>;\n" +
        "   |            +    +\n" +
        "\n" +
        "error: aborting due to 1 previous error\n" +
        "\n" +
        "For more information about this error, try `rustc --explain E0747`.\n",
    );
  });

  test_("lower_generic_args: E0747 constant provided when a type was expected (oracle e0747c.rs)", () => {
    const src = "struct T<X>(X);\nfn f(_: T<3>) {}\n\nfn main() {}\n";
    const { sm, dcx, sp, out } = setup("e0747c.rs", src);
    const defs = generics([param("X", 0, TY)]);
    const cx = lowerer(fake_tcx(sm, defs), dcx);
    const args = lower_generic_args(cx, did(1), [], false, undefined, OK_COUNT, recording_ctx(gen_args([const_lit_arg(sp("3"))])));
    expect(args as unknown as string[]).toEqual(["inferred X"]);
    dcx.print_error_count();
    expect(out()).toBe(
      "error[E0747]: constant provided when a type was expected\n" +
        "  --> e0747c.rs:2:11\n" +
        "   |\n" +
        "LL | fn f(_: T<3>) {}\n" +
        "   |           ^\n" +
        "\n" +
        "error: aborting due to 1 previous error\n" +
        "\n" +
        "For more information about this error, try `rustc --explain E0747`.\n",
    );
  });

  test_("lower_generic_args: inferred lifetime then a late lifetime arg (oracle order.rs)", () => {
    const src = "struct S<'a, T>(&'a T);\nfn f(_: S<u8, 'static>) {}\n\nfn main() {}\n";
    const { sm, dcx, sp, out } = setup("order.rs", src);
    const defs = generics([param("'a", 0, LT), param("T", 1, TY)]);
    const cx = lowerer(fake_tcx(sm, defs), dcx);
    const u8_ = path_ty(sp("u8"), { $: "PrimTy", _0: { $: "Uint", _0: "U8" } as never });
    const args = lower_generic_args(
      cx,
      did(1),
      [],
      false,
      undefined,
      OK_COUNT,
      recording_ctx(gen_args([{ $: "Type", _0: u8_ }, lifetime_arg(sp("'static"), kw.StaticLifetime)])),
    );
    expect(args as unknown as string[]).toEqual(["inferred 'a", "provided T=type"]);
    dcx.print_error_count();
    expect(out()).toBe(
      "error[E0747]: type provided when a lifetime was expected\n" +
        "  --> order.rs:2:11\n" +
        "   |\n" +
        "LL | fn f(_: S<u8, 'static>) {}\n" +
        "   |           ^^\n" +
        "\n" +
        "error: aborting due to 1 previous error\n" +
        "\n" +
        "For more information about this error, try `rustc --explain E0747`.\n",
    );
  });

  test_("lower_generic_args: reorder note + help (oracle tests/ui/const-generics/argument_order.stderr)", () => {
    const src =
      "//@ reference: items.generics.decl-order\n\nstruct Good<const N: usize, T> {\n    arr: [u8; { N }],\n    another: T,\n}\n\n" +
      "struct Bad<const N: usize, 'a, T, 'b, const M: usize, U> {\n    //~^ ERROR lifetime parameters must be declared prior\n" +
      "    a: &'a T,\n    b: &'b U,\n}\n\nfn main() {\n    let _: Bad<7, 'static, u32, 'static, 17, u16>;\n" +
      "    //~^ ERROR lifetime provided when a type was expected\n }\n";
    const { sm, dcx, sp, out } = setup("argument_order.rs", src);
    // `generics_of(Bad)`: early-bound lifetimes first, then the rest in declaration order.
    const defs = generics([param("'a", 0, LT), param("'b", 1, LT), param("N", 2, CT), param("T", 3, TY), param("M", 4, CT), param("U", 5, TY)]);
    const cx = lowerer(fake_tcx(sm, defs), dcx);
    const ty = (s: string) => ({ $: "Type", _0: path_ty(sp(s), { $: "PrimTy", _0: { $: "Uint", _0: "U32" } as never }) }) as hir.GenericArg;
    const hargs = [
      const_lit_arg(sp("7, 'static")),
      lifetime_arg(sp("'static", 0), kw.StaticLifetime),
      ty("u32"),
      lifetime_arg(sp("'static", 1), kw.StaticLifetime),
      const_lit_arg(sp("17")),
      ty("u16"),
    ];
    const args = lower_generic_args(cx, did(1), [], false, undefined, OK_COUNT, recording_ctx(gen_args(hargs)));
    expect(args as unknown as string[]).toEqual(["inferred 'a", "inferred 'b", "provided N=constant", "inferred T", "inferred M", "inferred U"]);
    expect(out()).toBe(
      "error[E0747]: lifetime provided when a type was expected\n" +
        "  --> argument_order.rs:15:19\n" +
        "   |\n" +
        "LL |     let _: Bad<7, 'static, u32, 'static, 17, u16>;\n" +
        "   |                   ^^^^^^^\n" +
        "   |\n" +
        "   = note: lifetime arguments must be provided before type arguments\n" +
        "   = help: reorder the arguments: lifetimes, then type and consts: `<'a, 'b, N, T, M, U>`\n" +
        "\n",
    );
  });

  test_("lower_generic_args: parent args, Self and inference", () => {
    const { sm, dcx } = setup("x.rs", "\n");
    const parent = new Generics(undefined, 0, [param("Self", 0, TY), param("P", 1, TY)], new Map(), true, undefined);
    const child = new Generics(did(1), 2, [param("'c", 2, LT), param("C", 3, TY)], new Map(), false, undefined);
    const tcx = fake_tcx(sm, child, { generics_of: (d: DefId) => (d.index === did(1).index ? parent : child) });
    const cx = lowerer(tcx, dcx);
    // parent args cover `Self` and `P`; `'c` is inferred (no lifetime given), `C` provided.
    const u8_ = path_ty(DUMMY_SP, { $: "Err" });
    const pargs = ["self", "p"] as unknown as GenericArg[];
    const args = lower_generic_args(cx, did(2), pargs, false, undefined, OK_COUNT, recording_ctx(gen_args([{ $: "Type", _0: u8_ }]), false, did(2)));
    expect(args as unknown as string[]).toEqual(["self", "p", "inferred 'c", "provided C=type"]);
    // `has_self` with an explicit self type and no parent args.
    const tcx2 = fake_tcx(sm, parent);
    const args2 = lower_generic_args(lowerer(tcx2, dcx), did(1), [], true, "SELF" as unknown as Ty, OK_COUNT, recording_ctx(undefined));
    expect(args2 as unknown as string[]).toEqual(["SELF", "inferred P"]);
    // `has_self` without a self type infers it.
    const args3 = lower_generic_args(lowerer(tcx2, dcx), did(1), [], true, undefined, OK_COUNT, recording_ctx(undefined));
    expect(args3 as unknown as string[]).toEqual(["inferred Self", "inferred P"]);
  });

  test_("lower_generic_args: explicit late-bound lifetimes are skipped", () => {
    const { sm, dcx } = setup("x.rs", "\n");
    const defs = generics([param("T", 0, TY)]);
    const cx = lowerer(fake_tcx(sm, defs), dcx);
    const u8_ = path_ty(DUMMY_SP, { $: "Err" });
    const count: GenericArgCountResult = { explicit_late_bound: "Yes", correct: { $: "Ok", _0: null } };
    const args = lower_generic_args(cx, did(1), [], false, undefined, count, recording_ctx(gen_args([lifetime_arg(DUMMY_SP, kw.StaticLifetime), { $: "Type", _0: u8_ }])));
    expect(args as unknown as string[]).toEqual(["provided T=type"]);
  });

  test_("check_generic_arg_count_for_value_path: E0794 (oracle e0794.rs)", () => {
    const src = "fn f<'a>(_: &'a ()) {}\n\nfn main() {\n    f::<'static>(&());\n}\n";
    const { sm, dcx, sp, out } = setup("e0794.rs", src);
    // `'a` is late-bound: not an own param; `has_late_bound_regions` is its span.
    const defs = generics([], sp("'a"));
    const cx = lowerer(fake_tcx(sm, defs), dcx);
    const seg = new hir.PathSegment(new Ident(Symbol.intern("f"), sp("f::")), hid(), { $: "Err" }, gen_args([lifetime_arg(sp("'static"), kw.StaticLifetime)]), false, false);
    const r = check_generic_arg_count_for_value_path(cx, did(1), defs, seg, "No");
    expect(r.explicit_late_bound).toBe("Yes");
    expect(r.correct.$).toBe("Ok");
    dcx.print_error_count();
    expect(out()).toBe(
      "error[E0794]: cannot specify lifetime arguments explicitly if late bound lifetime parameters are present\n" +
        "  --> e0794.rs:4:9\n" +
        "   |\n" +
        "LL |     f::<'static>(&());\n" +
        "   |         ^^^^^^^\n" +
        "   |\n" +
        "note: the late bound lifetime parameter is introduced here\n" +
        "  --> e0794.rs:1:6\n" +
        "   |\n" +
        "LL | fn f<'a>(_: &'a ()) {}\n" +
        "   |      ^^\n" +
        "\n" +
        "error: aborting due to 1 previous error\n" +
        "\n" +
        "For more information about this error, try `rustc --explain E0794`.\n",
    );
  });

  test_("prohibit_explicit_late_bound_lifetimes: method call position emits LATE_BOUND_LIFETIME_ARGUMENTS", () => {
    const { sm, dcx } = setup("x.rs", "\n");
    const lints: [string, string][] = [];
    const late = Span.with_root_ctxt(BytePos(0), BytePos(1));
    const defs = generics([], late);
    const tcx = fake_tcx(sm, defs, {
      emit_node_span_lint: (lint: { name: string }, _hir_id: unknown, _span: unknown, decorator: { into_diag(d: DiagCtxtHandle, l: unknown): { messages: unknown } }) => {
        const d = decorator.into_diag(dcx, { $: "Warning" });
        lints.push([lint.name, JSON.stringify((d as unknown as { deref(): { messages: [{ _0: unknown }, unknown][] } }).deref().messages[0]![0]._0)]);
        (d as unknown as { cancel(): void }).cancel();
      },
    });
    const cx = lowerer(tcx, dcx);
    const r = prohibit_explicit_late_bound_lifetimes(cx, defs, gen_args([lifetime_arg(DUMMY_SP, kw.StaticLifetime)]), { $: "Value", _0: "Yes" });
    expect(r).toBe("Yes");
    expect(lints.length).toBe(1);
    expect(lints[0]![0]).toBe("LATE_BOUND_LIFETIME_ARGUMENTS");
    expect(lints[0]![1]).toContain("cannot specify lifetime arguments explicitly if late bound lifetime parameters are present");
    // No late-bound regions: nothing to prohibit.
    expect(prohibit_explicit_late_bound_lifetimes(cx, generics([]), gen_args([lifetime_arg(DUMMY_SP, kw.StaticLifetime)]), { $: "Type" })).toBe("No");
  });

  test_("check_generic_arg_count: correct counts; wrong counts stop at WrongNumberOfGenericArgs (unported)", () => {
    const { sm, dcx } = setup("x.rs", "\n");
    const defs = generics([param("'a", 0, LT), param("T", 1, TY), param("N", 2, CT)]);
    const cx = lowerer(fake_tcx(sm, defs, { hir_parent_owner_iter: () => ({ next: () => undefined }) }), dcx);
    const ty_arg: hir.GenericArg = { $: "Type", _0: path_ty(DUMMY_SP, { $: "Err" }) };
    const seg = (args: hir.GenericArg[], infer_args = false) => new hir.PathSegment(new Ident(Symbol.intern("S"), DUMMY_SP), hid(), { $: "Err" }, gen_args(args), infer_args, false);
    const ok = check_generic_arg_count(cx, did(1), seg([lifetime_arg(DUMMY_SP, kw.StaticLifetime), ty_arg, const_lit_arg(DUMMY_SP)]), defs, { $: "Type" }, false);
    expect(ok).toEqual({ explicit_late_bound: "No", correct: { $: "Ok", _0: null } });
    // Too few type/const args in a type position.
    expect(() => check_generic_arg_count(cx, did(1), seg([lifetime_arg(DUMMY_SP, kw.StaticLifetime), ty_arg]), defs, { $: "Type" }, false)).toThrow(
      new Unported("rustc_hir_analysis::diagnostics::wrong_number_of_generic_args::WrongNumberOfGenericArgs::new (E0107, types/consts)"),
    );
    // A missing lifetime in a type position (no inference there).
    expect(() => check_generic_arg_count(cx, did(1), seg([ty_arg, const_lit_arg(DUMMY_SP)]), defs, { $: "Type" }, false)).toThrow(
      new Unported("rustc_hir_analysis::diagnostics::wrong_number_of_generic_args::WrongNumberOfGenericArgs::new (E0107, lifetimes)"),
    );
    // `infer_args` lets the lifetime and type/const args be elided.
    expect(check_generic_arg_count(cx, did(1), seg([], true), defs, { $: "Type" }, false).correct.$).toBe("Ok");
  });
});

// ---- bounds.rs ----

/** `T: Trait` / `?Trait` / `!Trait` for the trait `did`. */
function trait_bound(trait_did: DefId, polarity: "Positive" | "Maybe" | "Negative", span: Span): hir.GenericBound {
  const path = new hir.Path<Res>(span, { $: "Def", _0: { $: "Trait" }, _1: trait_did }, []);
  const pol = polarity === "Positive" ? { $: "Positive" } : { $: polarity, _0: span };
  const ptr: hir.PolyTraitRef = {
    bound_generic_params: [],
    modifiers: { constness: { $: "Never" }, polarity: pol } as never,
    trait_ref: new hir.TraitRef(path, hid()),
    span,
  };
  return { $: "Trait", _0: ptr };
}

const SIZED = did(1);
const META_SIZED = did(2);
const POINTEE_SIZED = did(3);
const sp_n = (n: number): Span => Span.with_root_ctxt(BytePos(n), BytePos(n + 1));

/** A `TyCtxt` over fresh interners (as ty/sty.test.ts) with the lang items / attrs these tests read overridden. */
function interning_tcx(overrides: Record<string, unknown> = {}): TyCtxt {
  const interners = CtxtInterners.new(undefined);
  let types: CommonTypes | undefined;
  let lifetimes: CommonLifetimes | undefined;
  const gcx = {
    interners,
    get types() {
      return (types ??= CommonTypes.new(interners));
    },
    get lifetimes() {
      return (lifetimes ??= CommonLifetimes.new(interners));
    },
  };
  const tcx = new TyCtxt(gcx as unknown as GlobalCtxt);
  const lang: Record<string, DefId> = { Sized: SIZED, MetaSized: META_SIZED, PointeeSized: POINTEE_SIZED };
  return Object.assign(Object.create(tcx) as TyCtxt, {
    require_lang_item: (item: string) => lang[item]!,
    hir_krate_attrs: () => [],
    trait_is_auto: () => false,
    default_traits: () => [],
    ...overrides,
  });
}

/** `(trait def_id index, span lo)` of each trait clause in `bounds`. */
function trait_bounds(bounds: [Clause, Span][]): [number, number][] {
  return bounds.map(([c, s]) => {
    const k = Binder.skip_binder(c.kind());
    if (k.$ !== "Trait") throw new Error("not a trait clause");
    return [k._0.trait_ref.def_id.index as number, Span.lo(s) as number];
  });
}

describe("bounds.rs", () => {
  test_("CollectedBound::any / CollectedSizednessBounds::any", () => {
    expect(new CollectedBound(undefined, undefined, undefined).any()).toBe(false);
    expect(new CollectedBound(undefined, DUMMY_SP, undefined).any()).toBe(true);
    const none = () => new CollectedBound(undefined, undefined, undefined);
    expect(new CollectedSizednessBounds(none(), none(), none()).any()).toBe(false);
    expect(new CollectedSizednessBounds(none(), none(), new CollectedBound(undefined, undefined, DUMMY_SP)).any()).toBe(true);
  });

  test_("search_bounds_for / collect_bounds: inline bounds and the param's where-clause bounds", () => {
    const param_def = LocalDefId.new(7);
    const other = LocalDefId.new(8);
    const bounded = (p: LocalDefId): hir.Ty<never> => {
      const res: Res = { $: "Def", _0: { $: "TyParam" }, _1: LocalDefId.to_def_id(p) };
      const seg = new hir.PathSegment(new Ident(Symbol.intern("T"), DUMMY_SP), hid(), res, undefined, true, false);
      return new hir.Ty(hid(), DUMMY_SP, { $: "Path", _0: { $: "Resolved", _0: undefined, _1: new hir.Path<Res>(DUMMY_SP, res, [seg]) } }) as unknown as hir.Ty<never>;
    };
    const where_pred = (p: LocalDefId, bounds: hir.GenericBound[]): hir.WherePredicate => ({
      hir_id: hid(),
      span: DUMMY_SP,
      kind: { $: "BoundPredicate", _0: new hir.WhereBoundPredicate("WhereClause" as never, [], bounded(p), bounds) },
    });
    const inline = [trait_bound(SIZED, "Maybe", sp_n(1)), { $: "Outlives", _0: undefined as never } as hir.GenericBound];
    const ctx: ImpliedBoundsContext = {
      $: "TyParam",
      _0: param_def,
      _1: [where_pred(param_def, [trait_bound(META_SIZED, "Positive", sp_n(2))]), where_pred(other, [trait_bound(SIZED, "Positive", sp_n(3))])],
    };
    const seen: number[] = [];
    search_bounds_for(inline, ctx, (ptr) => seen.push(Span.lo(ptr.span) as number));
    expect(seen).toEqual([1, 2]);
    const c = collect_bounds(inline, ctx, SIZED);
    expect([c.positive, c.maybe, c.negative]).toEqual([undefined, sp_n(1), undefined]);
    const tcx = { require_lang_item: (i: string) => ({ Sized: SIZED, MetaSized: META_SIZED, PointeeSized: POINTEE_SIZED })[i] } as unknown as TyCtxt;
    const s = collect_sizedness_bounds(tcx, inline, ctx, DUMMY_SP);
    expect(s.sized.maybe).toBe(sp_n(1));
    expect(s.meta_sized.positive).toBe(sp_n(2));
    expect(s.pointee_sized.any()).toBe(false);
    // Outside a type param, where clauses are not searched.
    expect(collect_bounds(inline, { $: "AssociatedTypeOrImplTrait" }, META_SIZED).any()).toBe(false);
  });

  test_("add_trait_bound puts the bound first", () => {
    const tcx = interning_tcx();
    const bounds: [Clause, Span][] = [];
    add_trait_bound(tcx, bounds, tcx.types.i32, SIZED, sp_n(5));
    add_trait_bound(tcx, bounds, tcx.types.i32, META_SIZED, sp_n(6));
    expect(trait_bounds(bounds)).toEqual([
      [META_SIZED.index as number, 6],
      [SIZED.index as number, 5],
    ]);
  });

  test_("add_implicit_sizedness_bounds", () => {
    const run = (ctx: ImpliedBoundsContext, hir_bounds: hir.GenericBound[], overrides: Record<string, unknown> = {}) => {
      const tcx = interning_tcx(overrides);
      const cx = lowerer(tcx, undefined as never);
      const bounds: [Clause, Span][] = [];
      cx.add_implicit_sizedness_bounds(bounds, tcx.types.i32, hir_bounds, ctx, sp_n(9));
      return trait_bounds(bounds);
    };
    const ty_param: ImpliedBoundsContext = { $: "TyParam", _0: LocalDefId.new(7), _1: [] };
    // No sizedness bound on a param: default `Sized`.
    expect(run(ty_param, [])).toEqual([[SIZED.index as number, 9]]);
    // `?Sized`: `MetaSized` at the `?Sized` span.
    expect(run(ty_param, [trait_bound(SIZED, "Maybe", sp_n(4))])).toEqual([[META_SIZED.index as number, 4]]);
    // An explicit sizedness bound: nothing added.
    expect(run(ty_param, [trait_bound(POINTEE_SIZED, "Positive", sp_n(4))])).toEqual([]);
    // `?Sized + MetaSized`: nothing added.
    expect(run(ty_param, [trait_bound(SIZED, "Maybe", sp_n(4)), trait_bound(META_SIZED, "Positive", sp_n(5))])).toEqual([]);
    // A trait definition: default `MetaSized` supertrait, except on `PointeeSized` itself and on auto traits.
    expect(run({ $: "TraitDef", _0: LocalDefId.new(20) }, [])).toEqual([[META_SIZED.index as number, 9]]);
    expect(run({ $: "TraitDef", _0: LocalDefId.of(POINTEE_SIZED.index) }, [])).toEqual([]);
    expect(run({ $: "TraitDef", _0: LocalDefId.new(20) }, [], { trait_is_auto: () => true })).toEqual([]);
    // `#![rustc_no_implicit_bounds]`.
    const attr = { $: "Parsed", _0: { $: "RustcNoImplicitBounds" } };
    expect(run(ty_param, [], { hir_krate_attrs: () => [attr] })).toEqual([]);
  });

  test_("add_default_traits / should_add_default_traits", () => {
    const DEFAULT = did(40);
    const tcx = interning_tcx({
      default_traits: () => ["DefaultTrait1"],
      lang_items: () => ({ get: (i: string) => (i === "DefaultTrait1" ? DEFAULT : undefined) }),
    });
    const cx = lowerer(tcx, undefined as never);
    const bounds: [Clause, Span][] = [];
    cx.add_default_traits(bounds, tcx.types.i32, [], { $: "AssociatedTypeOrImplTrait" }, sp_n(3));
    expect(trait_bounds(bounds)).toEqual([[DEFAULT.index as number, 3]]);
    // `?DefaultTrait1` written: not added.
    const bounds2: [Clause, Span][] = [];
    cx.add_default_traits(bounds2, tcx.types.i32, [trait_bound(DEFAULT, "Maybe", sp_n(1))], { $: "AssociatedTypeOrImplTrait" }, sp_n(3));
    expect(bounds2).toEqual([]);
    expect(cx.should_add_default_traits(DEFAULT, [], { $: "AssociatedTypeOrImplTrait" })).toBe(true);
  });

  test_("require_bound_to_relax_default_trait (oracle relax.rs)", () => {
    const src = "fn f<T: ?Send>() {}\n\nfn main() {}\n";
    const { dcx, sp, out } = setup("relax.rs", src);
    const tcx = {
      is_lang_item: (d: DefId, item: string) => item === "Sized" && d.index === SIZED.index,
      is_default_trait: () => false,
      sess: { opts: { unstable_opts: { experimental_default_bounds: false } } },
      features: () => ({ more_maybe_bounds: () => false }),
    } as unknown as TyCtxt;
    const cx = lowerer(tcx, dcx);
    const tr = (d: DefId) => new hir.TraitRef(new hir.Path<Res>(DUMMY_SP, { $: "Def", _0: { $: "Trait" }, _1: d }, []), hid());
    cx.require_bound_to_relax_default_trait(tr(SIZED), sp("?Send"));
    expect(out()).toBe("");
    cx.require_bound_to_relax_default_trait(tr(did(50)), sp("?Send"));
    dcx.print_error_count();
    expect(out()).toBe(
      "error: bound modifier `?` can only be applied to `Sized`\n" +
        "  --> relax.rs:1:9\n" +
        "   |\n" +
        "LL | fn f<T: ?Send>() {}\n" +
        "   |         ^^^^^\n" +
        "\n" +
        "error: aborting due to 1 previous error\n" +
        "\n",
    );
  });

  test_("lower_bounds dispatches on the bound kind and the filter", () => {
    const tcx = interning_tcx({ trait_may_define_assoc_item: (d: DefId) => d.index === SIZED.index });
    const cx = lowerer(tcx, undefined as never);
    const calls: string[] = [];
    Object.assign(cx, {
      lower_poly_trait_ref: (ptr: hir.PolyTraitRef) => {
        calls.push(`trait ${Span.lo(ptr.span)}`);
        return OK_COUNT;
      },
      lower_lifetime: () => tcx.lifetimes.re_static,
    });
    const lt = new hir.Lifetime(hid(), new Ident(kw.StaticLifetime, sp_n(8)), { $: "Static" } as never, { $: "Path" } as never, "ExplicitBound");
    const hb: hir.GenericBound[] = [trait_bound(SIZED, "Positive", sp_n(1)), trait_bound(META_SIZED, "Positive", sp_n(2)), { $: "Outlives", _0: lt }, { $: "Use", _0: [], _1: DUMMY_SP }];
    const bounds: [Clause, Span][] = [];
    cx.lower_bounds(tcx.types.i32, hb, bounds, tcx.mk_bound_variable_kinds([]), { $: "All" }, "Allowed");
    expect(calls).toEqual(["trait 1", "trait 2"]);
    expect(bounds.length).toBe(1);
    const k = Binder.skip_binder(bounds[0]![0].kind());
    expect(k.$).toBe("TypeOutlives");
    expect(Span.lo(bounds[0]![1])).toBe(BytePos(8));
    // `SelfTraitThatDefines`: only traits that may define the assoc item (and no outlives bounds).
    calls.length = 0;
    const bounds2: [Clause, Span][] = [];
    cx.lower_bounds(tcx.types.i32, hb, bounds2, tcx.mk_bound_variable_kinds([]), { $: "SelfTraitThatDefines", _0: new Ident(Symbol.intern("A"), DUMMY_SP) }, "Allowed");
    expect(calls).toEqual(["trait 1"]);
    expect(bounds2.length).toBe(0);
    // `ConstIfConst` skips outlives bounds.
    const bounds3: [Clause, Span][] = [];
    cx.lower_bounds(tcx.types.i32, hb, bounds3, tcx.mk_bound_variable_kinds([]), { $: "ConstIfConst" }, "Allowed");
    expect(bounds3.length).toBe(0);
  });

  test_("GenericParamAndBoundVarCollector collects params; check_assoc_const_binding_type passes param-free types", () => {
    const tcx = interning_tcx();
    const cx = lowerer(tcx, undefined as never);
    const c = new GenericParamAndBoundVarCollector(cx, new Set(), new DefIdSet(), INNERMOST);
    const t = Ty.new_tup(tcx, [Ty.new_param(tcx, 3, Symbol.intern("T")), tcx.types.u8]);
    expect(fold_Ty.visit_with(t, c)).toEqual(ControlFlow.CONTINUE);
    expect([...c.params]).toEqual([3]);
    expect(c.vars.size).toBe(0);
  });
});

// ---- dyn_trait.rs ----

describe("dyn_trait.rs", () => {
  test_("replace_dummy_self_with_error", () => {
    const tcx = interning_tcx();
    const dummy = tcx.types.trait_object_dummy_self;
    const guar = { __guar: true } as never;
    const t = Ty.new_tup(tcx, [dummy, tcx.types.u8]);
    const r = replace_dummy_self_with_error(tcx, t, guar, fold_Ty);
    const k = r.kind();
    if (k.$ !== "Tuple") throw new Error("not a tuple");
    expect(k._0[0]!.kind().$).toBe("Error");
    expect(k._0[1]).toBe(tcx.types.u8);
  });

  test_("lower_trait_object_ty: lowers each bound, adds default traits, stops at expand_trait_aliases (unported)", () => {
    const tcx = interning_tcx();
    const cx = lowerer(tcx, undefined as never);
    const calls: string[] = [];
    Object.assign(cx, {
      lower_poly_trait_ref: (_p: unknown, self_ty: Ty, _b: unknown, filter: { $: string }, overlap: string) => {
        calls.push(`${self_ty === tcx.types.trait_object_dummy_self} ${filter.$} ${overlap}`);
        return OK_COUNT;
      },
    });
    const b = trait_bound(did(60), "Positive", sp_n(1));
    if (b.$ !== "Trait") throw new Error();
    const lt = new hir.Lifetime(hid(), new Ident(kw.UnderscoreLifetime, DUMMY_SP), { $: "ImplicitObjectLifetimeDefault" }, { $: "Other" } as never, "Implicit");
    expect(() => cx.lower_trait_object_ty(DUMMY_SP, hid(), [b._0], lt, "Dyn")).toThrow(new Unported("rustc_trait_selection::traits::util::expand_trait_aliases"));
    expect(calls).toEqual(["true SelfOnly Forbidden"]);
  });

  test_("prohibit_or_lint_bare_trait_object_ty: no bounds, nothing to do", () => {
    const cx = lowerer({} as TyCtxt, undefined as never);
    expect(cx.prohibit_or_lint_bare_trait_object_ty(DUMMY_SP, hid(), [])).toBeUndefined();
  });

  test_("lower_trait_object_lifetime: explicit lifetime / elided default", () => {
    const tcx = interning_tcx();
    const cx = lowerer(tcx, undefined as never);
    const reasons: string[] = [];
    Object.assign(cx, {
      lower_lifetime: (_l: unknown, reason: { $: string }) => {
        reasons.push(reason.$);
        return tcx.lifetimes.re_static;
      },
    });
    const lt = (kind: hir.Lifetime["kind"]) => new hir.Lifetime(hid(), new Ident(kw.StaticLifetime, DUMMY_SP), kind, { $: "Other" } as never, "ExplicitBound");
    // `compute_object_lifetime_bound` stops before it reads the predicates.
    const preds = [] as never;
    expect(cx.lower_trait_object_lifetime(lt({ $: "Static" }), preds, DUMMY_SP)).toBe(tcx.lifetimes.re_static);
    expect(reasons).toEqual(["ExplicitObjectLifetime"]);
    // An elided object lifetime asks `object_region_bounds` first (rustc_trait_selection, unported).
    expect(() => cx.lower_trait_object_lifetime(lt({ $: "ImplicitObjectLifetimeDefault" }), preds, DUMMY_SP)).toThrow(
      new Unported("rustc_trait_selection::traits::wf::object_region_bounds"),
    );
  });
});
