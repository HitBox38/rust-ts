// Unit tests for lane typeck-method: method/mod.rs, method/confirm.rs, closure.rs and the two lint fns of
// method/prelude_edition_lints.rs.
//
// Typeck of real bodies does not reach these methods yet (other lanes' placeholders stop first), so each test calls the
// ported method on a fake `FnCtxt` receiver: a plain object carrying the members the method reads, with the other
// FnCtxt methods it calls recorded or stubbed (precedent: pat_b.test.ts).
import { expect, test } from "bun:test";
import "./lib.ts";
import * as hir from "../rustc_hir/lib.ts";
import type { DefKind, Res } from "../rustc_hir/def.ts";
import { HirId, ItemLocalId, OwnerId } from "../rustc_hir_id/lib.ts";
import { RUST_2021_PRELUDE_COLLISIONS } from "../rustc_lint_defs/builtin.gen.ts";
import type { Lint } from "../rustc_lint_defs/lib.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import type { AssocItem } from "../rustc_middle/ty/assoc.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { type CrateNum, type DefIndex, DefId, type LocalDefId } from "../rustc_span/def_id.ts";
import { BytePos, create_default_session_globals_then, ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { Ident, Symbol, sym } from "../rustc_span/symbol.ts";
import { Binder } from "../rustc_type_ir/binder.ts";
import { FnSig, FnSigKind } from "../rustc_type_ir/ty_kind.ts";
import type { Result } from "../std/result.ts";
import { Err, Ok } from "../std/result.ts";
import { FnCtxt } from "./decls.ts";
import { ConfirmContext } from "./method/confirm.gen.ts";
import type { MethodCallee, MethodError } from "./method/mod.gen.ts";
import type { Pick, PickKind, ProbeScope } from "./method/probe.gen.ts";

const test_ = (name: string, f: () => void): void => {
  test(name, () => create_default_session_globals_then(f));
};

function mk_tcx(): TyCtxt {
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
  return new TyCtxt(gcx as unknown as GlobalCtxt);
}

function call<K extends keyof FnCtxt>(name: K, self_: object, ...args: unknown[]): unknown {
  return (FnCtxt.prototype[name] as unknown as (...a: unknown[]) => unknown).apply(self_, args);
}

const sp = (lo: number, hi: number): Span => Span.with_root_ctxt(BytePos(lo), BytePos(hi));
const hid = (local: number): HirId => new HirId(new OwnerId(0 as LocalDefId), ItemLocalId.from_u32(local));
const did = (krate: number, index: number): DefId => new DefId(index as DefIndex, krate as CrateNum);
const expr = (local: number): hir.Expr => new hir.Expr(hid(local), { $: "Err", _0: ErrorGuaranteed.unchecked_error_guaranteed() } as unknown as hir.ExprKind, sp(local, local + 1));
const segment = (name: string, res: Res = { $: "Err" } as Res): hir.PathSegment =>
  new hir.PathSegment(Ident.new(Symbol.intern(name), sp(10, 13)), hid(9), res, undefined, true, false);
const fn_item = (def_id: DefId, container: AssocItem["container"] = { $: "Trait" }): AssocItem => ({
  def_id,
  kind: { $: "Fn", name: Symbol.intern("m"), has_self: true },
  container,
});

/** A `Pick` with its two (lane typeck-probe) methods stubbed. */
function mk_pick(item: AssocItem, kind: PickKind, import_ids: LocalDefId[] = [], differs = false): Pick {
  return {
    item,
    kind,
    import_ids,
    autoderefs: 0,
    autoref_or_ptr_adjustment: undefined,
    self_ty: undefined as unknown as Ty,
    unstable_candidates: [],
    receiver_steps: undefined,
    shadowed_candidates: [],
    differs_from: () => differs,
    maybe_emit_unstable_name_collision_hint: () => {},
  } as unknown as Pick;
}

test_("method/mod.rs:175 lookup_method: probe -> lint -> used trait imports -> stability -> confirm", () => {
  const tcx = mk_tcx();
  const log: string[] = [];
  const pick = mk_pick(fn_item(did(0, 5)), { $: "TraitPick", is_ambiguously_imported: false }, [7 as LocalDefId, 8 as LocalDefId]);
  const callee = { def_id: did(0, 5) } as MethodCallee;
  const scopes: ProbeScope[] = [];
  const fcx = {
    tcx: { ...tcx, check_stability: (d: DefId, id: HirId | undefined, _s: Span, ms: Span | undefined) => log.push(`stability ${d.index} ${id?.local_id} ${ms}`) },
    typeck_results: { used_trait_imports: new Set<LocalDefId>() },
    probe_for_name: (mode: string, _n: Ident, rt: Ty | undefined, sugg: { _0: boolean }, _t: Ty, id: HirId, scope: ProbeScope) => {
      scopes.push(scope);
      log.push(`probe ${mode} ${rt} ${sugg._0} ${id.local_id}`);
      return Ok(pick);
    },
    lookup_probe: FnCtxt.prototype.lookup_probe,
    lint_edition_dependent_dot_call: () => log.push("lint"),
    confirm_method: (_s: Span, se: hir.Expr, ce: hir.Expr, _t: Ty, p: Pick) => {
      log.push(`confirm ${se.hir_id.local_id} ${ce.hir_id.local_id} ${p === pick}`);
      return { callee, illegal_sized_bound: undefined };
    },
  };
  const r = call("lookup_method", fcx, tcx.types.u8, segment("m"), sp(0, 20), expr(1), expr(2), []) as Result<MethodCallee, MethodError>;
  expect(r).toEqual(Ok(callee));
  expect(log).toEqual(["probe MethodCall undefined false 1", "lint", "stability 5 1 undefined", "confirm 2 1 true"]);
  expect([...fcx.typeck_results.used_trait_imports]).toEqual([7 as LocalDefId, 8 as LocalDefId]);
  expect(scopes[0]!.$).toBe("TraitsInScope");

  // `segment.res` names a method: `ProbeScope::Single(def_id, None)`
  call("lookup_method", fcx, tcx.types.u8, segment("m", { $: "Def", _0: { $: "AssocFn" } as DefKind, _1: did(0, 5) }), sp(0, 20), expr(1), expr(2), []);
  expect(scopes[1]).toEqual({ $: "Single", _0: did(0, 5), _1: undefined });
});

test_("method/mod.rs:208 lookup_method: an illegal `Self: Sized` bound reprobes all traits and returns IllegalSizedBound", () => {
  const tcx = mk_tcx();
  const pick = mk_pick(fn_item(did(0, 5)), { $: "TraitPick", is_ambiguously_imported: false });
  const probes: string[] = [];
  const fcx = {
    tcx: { ...tcx, check_stability: () => {}, impl_trait_id: (d: DefId) => did(0, d.index + 100) },
    typeck_results: { used_trait_imports: new Set<LocalDefId>() },
    lookup_probe: (_n: Ident, _t: Ty, _e: hir.Expr, scope: ProbeScope) => {
      probes.push(`lookup_probe ${scope.$}`);
      return Ok(pick);
    },
    lookup_probe_for_diagnostic: (_n: Ident, _t: Ty, _e: hir.Expr, scope: ProbeScope) => {
      probes.push(`lookup_probe_for_diagnostic ${scope.$}`);
      return Err({ $: "Ambiguity", _0: [{ $: "Impl", _0: did(0, 1) }, { $: "Trait", _0: did(0, 2) }] });
    },
    lint_edition_dependent_dot_call: () => {},
    confirm_method: () => ({ callee: {} as MethodCallee, illegal_sized_bound: sp(3, 4) }),
  };
  const self_expr = expr(2);
  const r = call("lookup_method", fcx, tcx.types.u8, segment("m"), sp(0, 20), expr(1), self_expr, []) as Result<MethodCallee, MethodError>;
  // `u8` is not a reference: no mutability reprobe
  expect(probes).toEqual(["lookup_probe TraitsInScope", "lookup_probe_for_diagnostic AllTraits"]);
  const expected: MethodError = { $: "IllegalSizedBound", candidates: [did(0, 101)], needs_mut: false, bound_span: sp(3, 4), self_expr };
  expect(r).toEqual(Err(expected));
});

test_("method/mod.rs:497 resolve_fully_qualified_call: non-enum self type, Path-mode probe, imports, stability", () => {
  const tcx = mk_tcx();
  const log: string[] = [];
  const pick = mk_pick(fn_item(did(0, 5)), { $: "TraitPick", is_ambiguously_imported: false }, [3 as LocalDefId]);
  const fcx = {
    tcx: { ...tcx, check_stability: (d: DefId, _id: HirId | undefined, _s: Span, ms: Span | undefined) => log.push(`stability ${d.index} ${ms === undefined ? "-" : "method span"}`) },
    typeck_results: { used_trait_imports: new Set<LocalDefId>() },
    probe_for_name: (mode: string, _n: Ident, _rt: Ty | undefined, sugg: { _0: boolean }, _t: Ty, _id: HirId, scope: ProbeScope) => {
      log.push(`probe ${mode} ${sugg._0} ${scope.$}`);
      return Ok(pick);
    },
    lint_fully_qualified_call_from_2018: () => log.push("lint"),
  };
  const r = call("resolve_fully_qualified_call", fcx, sp(0, 8), Ident.new(Symbol.intern("m"), sp(5, 6)), tcx.types.u8, sp(0, 2), hid(4)) as Result<[DefKind, DefId], MethodError>;
  expect(r).toEqual(Ok([{ $: "AssocFn" } as DefKind, did(0, 5)]));
  expect(log).toEqual(["probe Path false TraitsInScope", "lint", "stability 5 method span"]);
  expect([...fcx.typeck_results.used_trait_imports]).toEqual([3 as LocalDefId]);

  // a failed probe without an enum variant to fall back to is returned as is
  const fcx2 = { ...fcx, probe_for_name: () => Err({ $: "BadReturnType" }) };
  expect(call("resolve_fully_qualified_call", fcx2, sp(0, 8), Ident.new(Symbol.intern("m"), sp(5, 6)), tcx.types.u8, sp(0, 2), hid(4))).toEqual(Err({ $: "BadReturnType" }));
});

test_("method/prelude_edition_lints.rs:156 lint_edition_dependent_dot_call: `try_into` before 2021 lints trait picks only", () => {
  const tcx = mk_tcx();
  const emitted: [Lint, number][] = [];
  const fcx = {
    tcx: { ...tcx, crate_name: () => Symbol.intern("local_crate"), emit_node_span_lint: (lint: Lint, id: HirId) => emitted.push([lint, id.local_id as unknown as number]) },
  };
  const trait_pick = mk_pick(fn_item(did(0, 5)), { $: "TraitPick", is_ambiguously_imported: false });
  const inherent_pick = mk_pick(fn_item(did(0, 5), { $: "InherentImpl" }), { $: "InherentImplPick" });
  // other method names: nothing
  call("lint_edition_dependent_dot_call", fcx, tcx.types.u8, segment("frobnicate"), sp(0, 4), expr(1), expr(2), trait_pick, []);
  // `try_into` on a trait method: the fully-qualified-call lint at the call expression
  call("lint_edition_dependent_dot_call", fcx, tcx.types.u8, segment("try_into"), sp(0, 4), expr(1), expr(2), trait_pick, []);
  // an inherent by-value method takes precedence: no lint
  call("lint_edition_dependent_dot_call", fcx, tcx.types.u8, segment("try_into"), sp(0, 4), expr(1), expr(2), inherent_pick, []);
  expect(emitted).toEqual([[RUST_2021_PRELUDE_COLLISIONS, 1]]);
  expect(Span.at_least_rust_2021(sp(0, 4))).toBe(false);
  expect(segment("try_into").ident.name).toBe(sym.try_into);
});

test_("method/prelude_edition_lints.rs:273 lint_fully_qualified_call_from_2018: `T::try_from` lints unless inherent", () => {
  const tcx = mk_tcx();
  const emitted: number[] = [];
  const fcx = { tcx: { ...tcx, crate_name: () => Symbol.intern("local_crate"), emit_node_span_lint: (_l: Lint, id: HirId) => emitted.push(id.local_id as unknown as number) } };
  const trait_pick = mk_pick(fn_item(did(0, 5)), { $: "TraitPick", is_ambiguously_imported: false });
  const inherent_pick = mk_pick(fn_item(did(0, 5), { $: "InherentImpl" }), { $: "InherentImplPick" });
  call("lint_fully_qualified_call_from_2018", fcx, sp(0, 8), Ident.new(sym.try_from, sp(5, 6)), tcx.types.u8, sp(0, 2), hid(4), trait_pick);
  call("lint_fully_qualified_call_from_2018", fcx, sp(0, 8), Ident.new(sym.try_from, sp(5, 6)), tcx.types.u8, sp(0, 2), hid(5), inherent_pick);
  call("lint_fully_qualified_call_from_2018", fcx, sp(0, 8), Ident.new(Symbol.intern("other"), sp(5, 6)), tcx.types.u8, sp(0, 2), hid(6), trait_pick);
  expect(emitted).toEqual([4]);
});

test_("method/confirm.rs:93 ConfirmContext::new + Deref<Target = FnCtxt>", () => {
  const tcx = mk_tcx();
  const fcx = Object.create(FnCtxt.prototype) as FnCtxt;
  const root = { tcx } as unknown;
  (fcx as unknown as { root_ctxt: unknown }).root_ctxt = root;
  const cx = ConfirmContext.new(fcx, sp(0, 1), expr(1), expr(2));
  expect(cx.skip_record_for_diagnostics).toBe(false);
  expect(cx.deref()).toBe(fcx);
  expect(cx.fcx).toBe(fcx);
  // the early returns of the two lints need nothing else
  const pick = mk_pick(fn_item(did(0, 5)), { $: "TraitPick", is_ambiguously_imported: false });
  cx.lint_shadowed_supertrait_items(pick, segment("m"));
  cx.lint_ambiguously_glob_imported_traits(pick, segment("m"));
});

test_("closure.rs:290 deduce_closure_signature: an expected `fn` pointer gives the signature and `Fn` for closures only", () => {
  const tcx = mk_tcx();
  const sig = tcx.mk_fn_sig([tcx.types.u8], tcx.types.bool, FnSigKind.dummy());
  const fn_ptr = Ty.new_fn_ptr(tcx, Binder.dummy(sig, { visit_with: (_s, v) => v.Result.output() }));
  const fcx = { tcx };
  const [esig, kind] = call("deduce_closure_signature", fcx, fn_ptr, hir.ClosureKind.Closure) as [{ cause_span: Span | undefined; sig: Binder<FnSig> } | undefined, string | undefined];
  expect(kind).toBe("Fn");
  expect(esig!.cause_span).toBeUndefined();
  expect([...FnSig.inputs(Binder.skip_binder(esig!.sig))]).toEqual([tcx.types.u8]);
  expect(FnSig.output(Binder.skip_binder(esig!.sig))).toBe(tcx.types.bool);
  expect(call("deduce_closure_signature", fcx, fn_ptr, { $: "Coroutine", _0: { $: "Coroutine", _0: "Movable" } })).toEqual([undefined, undefined]);
  // anything else: nothing deduced
  expect(call("deduce_closure_signature", fcx, tcx.types.u8, hir.ClosureKind.Closure)).toEqual([undefined, undefined]);
});

test_("closure.rs:1042 error_sig_of_closure: the return type is lowered before the (lazy) argument types", () => {
  const tcx = mk_tcx();
  const lowered: number[] = [];
  const lowerer = { lower_ty: (t: hir.Ty) => lowered.push(t.hir_id.local_id as unknown as number) };
  const fcx = { tcx, lowerer: () => lowerer };
  const hty = (local: number): hir.Ty => ({ hir_id: hid(local) }) as unknown as hir.Ty;
  const decl = { inputs: [hty(1), hty(2)], output: { $: "Return", _0: hty(3) }, c_variadic: () => false } as unknown as hir.FnDecl;
  const guar = ErrorGuaranteed.unchecked_error_guaranteed();
  const r = call("error_sig_of_closure", fcx, decl, guar) as Binder<FnSig>;
  expect(lowered).toEqual([3, 1, 2]);
  const s = Binder.skip_binder(r);
  expect(FnSig.inputs(s).map((t) => t.kind().$)).toEqual(["Error", "Error"]);
  expect(FnSig.output(s).kind().$).toBe("Error");
  expect(FnSig.abi(s).$).toBe("RustCall");
});

test_("closure.rs:582 sig_of_closure: dispatches on the expectation", () => {
  const log: string[] = [];
  const fcx = {
    sig_of_closure_with_expectation: () => log.push("with"),
    sig_of_closure_no_expectation: () => log.push("no"),
  };
  call("sig_of_closure", fcx, 0, {}, hir.ClosureKind.Closure, undefined);
  call("sig_of_closure", fcx, 0, {}, hir.ClosureKind.Closure, { cause_span: undefined, sig: {} });
  expect(log).toEqual(["no", "with"]);
});
