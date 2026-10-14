// Lane hira-misc: constrained_generic_params.rs and delegation.rs.
// Unit tests of the bodies on interned types and a stubbed `TyCtxt` (the queries the fns read are replaced on an
// `Object.create(tcx)` view, as rustc_middle ty/util.test.ts and collect-b's tests do). The expectations follow
// upstream's logic (RFC 447 constrained parameters, the topological order of `setup_constraining_clauses`, the
// delegation index remapping of `create_mapping` / `create_generic_args`).
import { describe, expect, test } from "bun:test";
import "../rustc_middle/lib.ts";
import "./lib.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { type GenericClauses, type GenericParamDef, Generics } from "../rustc_middle/ty/generics.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { type Clause, Clause_upcast_from_ClauseKind, Clause_upcast_from_TraitRef } from "../rustc_middle/ty/predicate.ts";
import { DefId, DefIndex, LOCAL_CRATE, type LocalDefId } from "../rustc_span/def_id.ts";
import { DUMMY_SP, type Span } from "../rustc_span/lib.ts";
import { sym, type Symbol } from "../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import { fold_Binder } from "../rustc_type_ir/binder.ts";
import { type FnSig, FnSigKind, fold_FnSig } from "../rustc_type_ir/ty_kind.ts";
import type { TraitRef as TraitRefT } from "../rustc_type_ir/decls.ts";
import { as_interner, TraitRef } from "../rustc_type_ir/predicate.ts";
import { Const, Region } from "../rustc_type_ir/sty/mod.ts";
import type { AliasTerm } from "../rustc_type_ir/ty/alias.ts";
import { Panic, Unported } from "../std/panic.ts";
import {
  identify_constrained_generic_params,
  type Parameter,
  parameters_for,
  parameters_for_impl,
  setup_constraining_clauses,
  d_TraitRef,
  d_Ty,
  debug_Parameter,
} from "./constrained_generic_params.ts";
import { delegation_user_specified_args, inherit_clauses_for_delegation_item, inherit_sig_for_delegation_item } from "./delegation.ts";
import { PLAIN } from "../std/fmt.ts";

// ---- a stubbed TyCtxt ----------------------------------------------------------------------------------------------

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

/** A view of `tcx` whose listed methods are replaced. */
function with_methods(tcx: TyCtxt, methods: Record<string, unknown>): TyCtxt {
  return Object.assign(Object.create(tcx) as TyCtxt, methods);
}

const did = (index: number): DefId => new DefId(DefIndex.from_u32(index), LOCAL_CRATE);
const ldid = (index: number): LocalDefId => did(index).expect_local();
const ix = (d: DefId | LocalDefId): number => (d instanceof DefId ? DefIndex.as_u32(d.index) : (d as unknown as number));

const P = (n: number): Parameter => n as Parameter;
const sorted = (s: Iterable<Parameter>): number[] => [...s].map(Number).sort((a, b) => a - b);

function ty_param(tcx: TyCtxt, index: number): Ty {
  return Ty.new_param(tcx, index, sym.Abi);
}
function re_param(tcx: TyCtxt, index: number): Region {
  return Region.new_early_param(tcx, { index, name: sym.Abi });
}
function ct_param(tcx: TyCtxt, index: number): Const {
  return Const.new_param(tcx, { index, name: sym.Abi });
}
function tuple(tcx: TyCtxt, tys: Ty[]): Ty {
  return tcx.mk_ty_from_kind({ $: "Tuple", _0: tcx.mk_type_list(tys) });
}
/** `<args[0] as Trait<args[1..]>>::Assoc` (projection def `def`). */
function projection(tcx: TyCtxt, def: DefId, args: GenericArg[]): Ty {
  return tcx.mk_ty_from_kind({ $: "Alias", _0: "No", _1: { kind: { $: "Projection", def_id: def }, args: tcx.mk_args(args), _use_alias_new_instead: null } });
}
function projection_term(tcx: TyCtxt, def: DefId, args: GenericArg[]): AliasTerm {
  return { kind: { $: "ProjectionTy", def_id: def }, args: tcx.mk_args(args), _use_alias_new_instead: null };
}
const g = GenericArg;

const TR = did(1); // trait Tr<..>
const ASSOC = did(2); // Tr::Assoc
const OTHER = did(3); // trait Other

/** The trait ref of a projection: `Tr` with all of the projection's args (no GAT args here). */
function with_alias_trait_ref(tcx: TyCtxt): TyCtxt {
  return with_methods(tcx, {
    trait_ref_and_own_args_for_alias: (_def: DefId, args: readonly GenericArg[]) => [TraitRef.new_from_args(as_interner(tcx), TR, tcx.mk_args([...args])), []],
  });
}

function trait_clause(tcx: TyCtxt, trait: DefId, args: GenericArg[]): Clause {
  return Clause_upcast_from_TraitRef(TraitRef.new_from_args(as_interner(tcx), trait, tcx.mk_args(args)), tcx);
}
function projection_clause(tcx: TyCtxt, args: GenericArg[], term: Ty): Clause {
  return Clause_upcast_from_ClauseKind({ $: "Projection", _0: { projection_term: projection_term(tcx, ASSOC, args), term } }, tcx);
}

// ---- constrained_generic_params.rs ---------------------------------------------------------------------------------

describe("constrained_generic_params", () => {
  test("Parameter: From impls and derived Debug", () => {
    expect(debug_Parameter(P(3), PLAIN)).toBe("Parameter(3)");
  });

  test("parameters_for collects type, region and const params in visit order", () => {
    const tcx = mk_tcx();
    const arr = tcx.mk_ty_from_kind({ $: "Array", _0: ty_param(tcx, 4), _1: ct_param(tcx, 2) });
    const r = tcx.mk_ty_from_kind({ $: "Ref", _0: re_param(tcx, 0), _1: arr, _2: "Not" });
    const t = tuple(tcx, [ty_param(tcx, 1), r]);
    expect(parameters_for(tcx, t, false, d_Ty).map(Number)).toEqual([1, 0, 4, 2]);
    expect(parameters_for(tcx, tcx.types.u8, false, d_Ty)).toEqual([]);
  });

  test("projections constrain nothing unless include_nonconstraining", () => {
    const tcx = mk_tcx();
    const proj = projection(tcx, ASSOC, [g.from_Ty(ty_param(tcx, 0)), g.from_Ty(ty_param(tcx, 1))]);
    const t = tuple(tcx, [ty_param(tcx, 2), proj]);
    expect(parameters_for(tcx, t, false, d_Ty).map(Number)).toEqual([2]);
    expect(parameters_for(tcx, t, true, d_Ty).map(Number)).toEqual([2, 0, 1]);
  });

  test("parameters_for_impl: the trait ref when there is one, else the self type", () => {
    const tcx = mk_tcx();
    const self_ty = tuple(tcx, [ty_param(tcx, 0)]);
    expect(sorted(parameters_for_impl(tcx, self_ty, undefined))).toEqual([0]);
    const tr: TraitRefT = TraitRef.new_from_args(as_interner(tcx), TR, tcx.mk_args([g.from_Ty(self_ty), g.from_Ty(ty_param(tcx, 1)), g.from_Ty(ty_param(tcx, 1))]));
    // A set: the duplicate `T1` appears once.
    expect(sorted(parameters_for_impl(tcx, self_ty, tr))).toEqual([0, 1]);
    expect(parameters_for(tcx, tr, false, d_TraitRef).map(Number)).toEqual([0, 1, 1]);
  });

  test("setup_constraining_clauses moves ready projections first (impl<T: Debug, U: Iterator<Item = T>> Trait for U)", () => {
    const tcx = with_alias_trait_ref(mk_tcx());
    const [T, U] = [ty_param(tcx, 0), ty_param(tcx, 1)];
    const t_debug = trait_clause(tcx, OTHER, [g.from_Ty(T)]);
    const u_iter = trait_clause(tcx, TR, [g.from_Ty(U)]);
    const item = projection_clause(tcx, [g.from_Ty(U)], T);
    const clauses: [Clause, Span][] = [
      [t_debug, DUMMY_SP],
      [u_iter, DUMMY_SP],
      [item, DUMMY_SP],
    ];
    const input = new Set<Parameter>([P(1)]);
    setup_constraining_clauses(tcx, clauses, undefined, input);
    expect(clauses.map((c) => c[0])).toEqual([item, u_iter, t_debug]);
    expect(sorted(input)).toEqual([0, 1]);
  });

  test("setup_constraining_clauses follows chains and skips unready projections", () => {
    const tcx = with_alias_trait_ref(mk_tcx());
    const [S, U, W] = [ty_param(tcx, 0), ty_param(tcx, 1), ty_param(tcx, 2)];
    // 0: <W as Tr>::Assoc = S (ready only after W), 1: <U as Tr>::Assoc = W (ready: U is an input)
    const p_ws = projection_clause(tcx, [g.from_Ty(W)], S);
    const p_uw = projection_clause(tcx, [g.from_Ty(U)], W);
    const clauses: [Clause, Span][] = [
      [p_ws, DUMMY_SP],
      [p_uw, DUMMY_SP],
    ];
    const input = new Set<Parameter>([P(1)]);
    setup_constraining_clauses(tcx, clauses, undefined, input);
    expect(clauses.map((c) => c[0])).toEqual([p_uw, p_ws]);
    expect(sorted(input)).toEqual([0, 1, 2]);

    // A projection whose inputs are never constrained stays put and constrains nothing.
    const stuck = projection_clause(tcx, [g.from_Ty(ty_param(tcx, 5))], ty_param(tcx, 6));
    const input2 = new Set<Parameter>([P(1)]);
    const cl2: [Clause, Span][] = [[stuck, DUMMY_SP]];
    setup_constraining_clauses(tcx, cl2, undefined, input2);
    expect(sorted(input2)).toEqual([1]);
  });

  test("a projection out of the impl's own trait ref constrains nothing", () => {
    const tcx = with_alias_trait_ref(mk_tcx());
    const [T, U] = [ty_param(tcx, 0), ty_param(tcx, 1)];
    const impl_trait_ref = TraitRef.new_from_args(as_interner(tcx), TR, tcx.mk_args([g.from_Ty(U)]));
    const sneaky = projection_clause(tcx, [g.from_Ty(U)], T);
    const input = parameters_for_impl(tcx, U, impl_trait_ref);
    identify_constrained_generic_params(tcx, { parent: undefined, clauses: [[sneaky, DUMMY_SP]] }, impl_trait_ref, input);
    expect(sorted(input)).toEqual([1]);
    // Without the trait ref, the same clause constrains `T`.
    const input2 = new Set<Parameter>([P(1)]);
    identify_constrained_generic_params(tcx, { parent: undefined, clauses: [[sneaky, DUMMY_SP]] }, undefined, input2);
    expect(sorted(input2)).toEqual([0, 1]);
  });
});

// ---- delegation.rs ---------------------------------------------------------------------------------------------------

function param_def(name: Symbol, def_id: DefId, index: number, kind: GenericParamDef["kind"]): GenericParamDef {
  return { name, def_id, index, pure_wrt_drop: false, kind };
}
const TY = { $: "Type", has_default: false, synthetic: false } as const;
const LT = { $: "Lifetime" } as const;
function generics(parent: DefId | undefined, parent_count: number, own_params: GenericParamDef[], has_self: boolean): Generics {
  return Generics.from_decoded(parent, parent_count, own_params, new Map(own_params.map((p) => [p.def_id, p.index])), has_self, undefined);
}

function stop(f: () => unknown): string | undefined {
  try {
    f();
    return undefined;
  } catch (e) {
    if (e instanceof Panic) return e.message;
    if (e instanceof Unported) return `UNPORTED ${e.what}`;
    throw e;
  }
}

// `fn foo<'a, T: Tr>(x: T) -> T` (def 10; params defs 11, 12) and the free delegation `reuse foo;` (def 20) with its own
// generics `<'a, T>` (defs 21, 22).
const FOO = did(10);
const DELEG = ldid(20);

function delegation_tcx(user_child_args: (tcx: TyCtxt) => GenericArg[]): TyCtxt {
  const base = mk_tcx();
  const gens = new Map<number, Generics>([
    [10, generics(undefined, 0, [param_def(sym.Abi, did(11), 0, LT), param_def(sym.Abi, did(12), 1, TY)], false)],
    [20, generics(undefined, 0, [param_def(sym.Abi, did(21), 0, LT), param_def(sym.Abi, did(22), 1, TY)], false)],
  ]);
  const tcx: TyCtxt = with_methods(base, {
    def_kind: () => ({ $: "Fn" }),
    generics_of: (d: DefId | LocalDefId) => gens.get(ix(d)),
    hir_opt_delegation_sig_id: (d: LocalDefId) => (ix(d) === 20 ? FOO : undefined),
    delegation_user_specified_args: () => [[], user_child_args(tcx)],
    explicit_clauses_of: (d: DefId): GenericClauses => {
      expect(ix(d)).toBe(10);
      return { parent: undefined, clauses: [[trait_clause(tcx, TR, [g.from_Ty(ty_param(tcx, 1))]), DUMMY_SP]] };
    },
    fn_sig: (d: DefId) => {
      expect(ix(d)).toBe(10);
      const T = ty_param(tcx, 1);
      const sig: FnSig = { inputs_and_output: tcx.mk_type_list([T, T]), fn_sig_kind: FnSigKind.default_() };
      return EarlyBinder.bind(tcx, Binder.dummy(sig, fold_FnSig), fold_Binder(fold_FnSig));
    },
    is_method: () => false,
  });
  return tcx;
}

describe("delegation", () => {
  test("inherit_clauses_for_delegation_item: free-to-free, params remapped and instantiated with the delegation's args", () => {
    const tcx = delegation_tcx((t) => [g.from_Region(re_param(t, 0)), g.from_Ty(ty_param(t, 1))]);
    const gc = inherit_clauses_for_delegation_item(tcx, DELEG, FOO);
    expect(gc.parent).toBeUndefined();
    expect(gc.clauses.length).toBe(1);
    expect(gc.clauses[0]![0]).toBe(trait_clause(tcx, TR, [g.from_Ty(ty_param(tcx, 1))]));
  });

  test("inherit_clauses_for_delegation_item: user-specified args (`reuse foo::<'static, u8>`)", () => {
    const tcx = delegation_tcx((t) => [g.from_Region(t.lifetimes.re_static), g.from_Ty(t.types.u8)]);
    const gc = inherit_clauses_for_delegation_item(tcx, DELEG, FOO);
    expect(gc.clauses.map((c) => c[0])).toEqual([trait_clause(tcx, TR, [g.from_Ty(tcx.types.u8)])]);
  });

  test("delegation_user_specified_args without user-specified segments", () => {
    const tcx = with_methods(mk_tcx(), {
      hir_delegation_info: () => ({ parent_seg_id_for_sig: undefined, child_seg_id_for_sig: undefined }),
    });
    let r: [readonly unknown[], readonly unknown[]] | undefined;
    expect(stop(() => (r = delegation_user_specified_args(tcx, DELEG)))).toBeUndefined();
    expect(r).toEqual([[], []]);
  });

  test("inherit_sig_for_delegation_item: the signature over the delegation's args", () => {
    const tcx = delegation_tcx((t) => [g.from_Region(t.lifetimes.re_static), g.from_Ty(t.types.u8)]);
    const r = stop(() => {
      const sig = inherit_sig_for_delegation_item(tcx, DELEG);
      expect(sig).toEqual([tcx.types.u8, tcx.types.u8]);
    });
    expect(r).toBeUndefined();
  });
});
