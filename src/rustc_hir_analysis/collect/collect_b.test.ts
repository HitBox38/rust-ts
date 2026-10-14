// Lane collect-b: collect/clauses_of.rs, collect/item_bounds.rs, collect/dump.rs.
// - Unit tests of the bodies on interned types and a stubbed `TyCtxt` (the queries the fns read are replaced on an
//   `Object.create(tcx)` view, as rustc_middle ty/util.test.ts does).
// - Driver tests on small no_core crates (collect_b_oracle/run.ts):
//   - `def_parents.rs`: `#[rustc_dump_def_parents]` (dump.rs:118) prints exactly the pinned rustc's stderr (the crate is
//     otherwise clean, so the dumps that `check_crate` runs last are rustc's whole stderr);
//   - `queries.rs`: `clauses_of` / `explicit_item_bounds` / `item_bounds` for every DefId: each value equals the tydump
//     probe's line for that DefId (when the probe prints one), and each stop is one of `PENDING` (other lanes' stubs).
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import "../../rustc_middle/lib.ts";
import "../lib.ts";
import { PIN } from "../../../scripts/lib/common.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../../rustc_middle/ty/context.ts";
import { GenericArg, type GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { type GenericClauses, type GenericParamDef, Generics } from "../../rustc_middle/ty/generics.ts";
import { type Clauses, RawList } from "../../rustc_middle/ty/list.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import { type Clause, Clause_upcast_from_Binder_ClauseKind, Clause_upcast_from_ClauseKind, Clause_upcast_from_TraitRef } from "../../rustc_middle/ty/predicate.ts";
import { DefId, DefIndex, LOCAL_CRATE, LocalDefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, type Span } from "../../rustc_span/lib.ts";
import { kw, sym, type Symbol } from "../../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { BoundVariableKind, TraitRef as TraitRefT } from "../../rustc_type_ir/decls.ts";
import { BoundVar, INNERMOST } from "../../rustc_type_ir/lib.ts";
import { as_interner, TraitRef } from "../../rustc_type_ir/predicate.ts";
import type { ClauseKind } from "../../rustc_type_ir/predicate_kind.ts";
import { Region } from "../../rustc_type_ir/sty/mod.ts";
import { IsRigid } from "../../rustc_type_ir/ty_kind.ts";
import { Panic, Unported } from "../../std/panic.ts";
import { PredicateFilter } from "../hir_ty_lowering/mod.gen.ts";
import * as ClausesOf from "./clauses_of.ts";
import * as ItemBounds from "./item_bounds.ts";

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
/** The `DefIndex` of a query key (`DefId` or `LocalDefId`). */
const ix = (d: DefId | LocalDefId): number => (d instanceof DefId ? DefIndex.as_u32(d.index) : (d as unknown as number));

function param(name: Symbol, def_id: DefId, index: number, kind: GenericParamDef["kind"]): GenericParamDef {
  return { name, def_id, index, pure_wrt_drop: false, kind };
}
const TY = { $: "Type", has_default: false, synthetic: false } as const;
const LT = { $: "Lifetime" } as const;

function generics(parent: DefId | undefined, parent_count: number, own_params: GenericParamDef[], has_self: boolean): Generics {
  return Generics.from_decoded(parent, parent_count, own_params, new Map(own_params.map((p) => [p.def_id, p.index])), has_self, undefined);
}

/** `catch_unwind` of `f`: the panic / unported text, or `undefined` if it returned. */
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

// A trait `Tr` (def 1) with `Self` (index 0), an associated type `A` (def 2), a GAT `G<'x, 'y>` (def 3; params defs 4, 5),
// a second trait `Bound<'z>` (def 6; `'z` def 7).
const TR = did(1);
const A = did(2);
const G = did(3);
const BOUND = did(6);
function world(): { tcx: TyCtxt; self_ty: Ty; outlives: (r: Region) => Clause } {
  const base = mk_tcx();
  const gens = new Map<number, Generics>([
    [1, generics(undefined, 0, [param(kw.SelfUpper, TR, 0, TY)], true)],
    [2, generics(TR, 1, [], true)],
    [3, generics(TR, 1, [param(sym.Abi, did(4), 1, LT), param(sym.Abi, did(5), 2, LT)], true)],
    [6, generics(undefined, 0, [param(kw.SelfUpper, BOUND, 0, TY), param(sym.Abi, did(7), 1, LT)], true)],
  ]);
  const parents = new Map<number, DefId>([
    [2, TR],
    [3, TR],
  ]);
  const tcx: TyCtxt = with_methods(base, {
    generics_of: (d: DefId | LocalDefId) => gens.get(ix(d)),
    parent: (d: DefId) => parents.get(ix(d)),
    is_impl_trait_in_trait: () => false,
    // Test stand-in: rustc_middle impl_interner.ts's `trait_ref_and_own_args_for_alias` (impl_interner.rs:223) still stops
    // at `TraitRef::from_assoc`, which rustc_type_ir predicate.ts now ports; this is upstream's body over it.
    trait_ref_and_own_args_for_alias: (def_id: DefId, args: GenericArgs): [TraitRefT, readonly GenericArg[]] => {
      const trait_ref = TraitRef.from_assoc(as_interner(tcx), tcx.parent(def_id), args);
      return [trait_ref, args.slice(trait_ref.args.length)];
    },
  });
  const self_ty = tcx.types.self_param;
  const outlives = (r: Region): Clause => Clause_upcast_from_ClauseKind({ $: "TypeOutlives", _0: { _0: self_ty, _1: r } }, tcx);
  return { tcx, self_ty, outlives };
}

const bound_re = (tcx: TyCtxt, var_: number): Region => Region.new_bound(tcx, INNERMOST, { var: BoundVar.from_u32(var_), kind: { $: "Anon" } });
const anon_re: BoundVariableKind = { $: "Region", _0: { $: "Anon" } };

/** `<Self as Tr>::G<'a, 'b>`. */
function gat(tcx: TyCtxt, self_ty: Ty, a: Region, b: Region): Ty {
  return Ty.new_projection_from_args(tcx, IsRigid.No, G, tcx.mk_args([self_ty, a, b]));
}

/** `for<bound_vars> <ty as Bound<'r>>` as a clause. */
function bound_clause(tcx: TyCtxt, ty: Ty, r: Region, bound_vars: BoundVariableKind[]): Clause {
  const trait_ref = TraitRef.new_from_args(as_interner(tcx), BOUND, tcx.mk_args([ty, r]));
  const kind: ClauseKind = { $: "Trait", _0: { trait_ref, polarity: "Positive" } };
  return Clause_upcast_from_Binder_ClauseKind(Binder.bind_with_vars(kind, tcx.mk_bound_variable_kinds(bound_vars)), tcx);
}

// ---- clauses_of.rs --------------------------------------------------------------------------------------------------

describe("clauses_of", () => {
  test("appends the inferred outlives clauses, then `Self: Trait` (DUMMY_SP) for a trait", () => {
    const { tcx: t, outlives } = world();
    const c1 = outlives(t.lifetimes.re_static);
    const c2 = outlives(t.lifetimes.re_erased);
    const explicit: GenericClauses = { parent: undefined, clauses: [[c1, DUMMY_SP]] };
    const tcx = with_methods(t, { explicit_clauses_of: () => explicit, inferred_outlives_of: () => [[c2, DUMMY_SP]], is_trait: () => true });
    const r = ClausesOf.clauses_of(tcx, TR);
    const self_tr = Clause_upcast_from_TraitRef(TraitRef.identity(tcx, TR), tcx);
    expect(r.parent).toBeUndefined();
    expect(r.clauses.map(([c]) => c)).toEqual([c1, c2, self_tr]);
    expect(r.clauses.every(([, s]) => s === DUMMY_SP)).toBe(true);
  });

  test("leaves the explicit clauses alone without inferred outlives on a non-trait", () => {
    const { tcx: t, outlives } = world();
    const explicit: GenericClauses = { parent: TR, clauses: [[outlives(t.lifetimes.re_static), DUMMY_SP]] };
    const tcx = with_methods(t, { explicit_clauses_of: () => explicit, inferred_outlives_of: () => [], is_trait: () => false });
    expect(ClausesOf.clauses_of(tcx, A)).toBe(explicit);
  });

  test("an inferred-only result replaces the empty explicit list", () => {
    const { tcx: t, outlives } = world();
    const c = outlives(t.lifetimes.re_static);
    const tcx = with_methods(t, { explicit_clauses_of: () => ({ parent: TR, clauses: [] }), inferred_outlives_of: () => [[c, DUMMY_SP]], is_trait: () => false });
    const r = ClausesOf.clauses_of(tcx, A);
    expect(r.parent).toBe(TR);
    expect(r.clauses.map(([c]) => c)).toEqual([c]);
  });
});

describe("explicit_clauses_of", () => {
  test("on a trait, drops the bounds on its own associated types (they are `explicit_item_bounds`)", () => {
    const { tcx: t, self_ty, outlives } = world();
    const identity = RawList.identity_for_item(t, TR);
    const proj = Ty.new_projection_from_args(t, IsRigid.No, A, identity);
    const on_assoc = Clause_upcast_from_ClauseKind({ $: "TypeOutlives", _0: { _0: proj, _1: t.lifetimes.re_static } }, t);
    const on_self = outlives(t.lifetimes.re_static);
    const trait_on_assoc = bound_clause(t, proj, t.lifetimes.re_static, []);
    const all: GenericClauses = { parent: undefined, clauses: [[on_assoc, DUMMY_SP], [on_self, DUMMY_SP], [trait_on_assoc, DUMMY_SP]] };
    const tcx = with_methods(t, { def_kind: () => ({ $: "Trait" }), trait_explicit_clauses_and_bounds: () => all });
    const r = ClausesOf.explicit_clauses_of(tcx, TR.expect_local());
    expect(r.clauses.map(([c]) => c)).toEqual([on_self]);
    void self_ty;

    // nothing to drop: the query value itself
    const only_self: GenericClauses = { parent: undefined, clauses: [[on_self, DUMMY_SP]] };
    const tcx2 = with_methods(t, { def_kind: () => ({ $: "Trait" }), trait_explicit_clauses_and_bounds: () => only_self });
    expect(ClausesOf.explicit_clauses_of(tcx2, TR.expect_local())).toBe(only_self);
  });

  test("keeps a bound on another trait's associated type", () => {
    const { tcx: t } = world();
    const proj = Ty.new_projection_from_args(t, IsRigid.No, A, RawList.identity_for_item(t, TR));
    const c = Clause_upcast_from_ClauseKind({ $: "TypeOutlives", _0: { _0: proj, _1: t.lifetimes.re_static } }, t);
    const all: GenericClauses = { parent: undefined, clauses: [[c, DUMMY_SP]] };
    // `A`'s parent is not the trait being lowered (def 6 here)
    const tcx = with_methods(t, { def_kind: () => ({ $: "Trait" }), trait_explicit_clauses_and_bounds: () => all });
    expect(ClausesOf.explicit_clauses_of(tcx, BOUND.expect_local()).clauses.length).toBe(1);
  });
});

describe("implied_clauses_with_filter", () => {
  test("an extern trait forwards to `explicit_super_clauses_of` for SelfTraitThatDefines", () => {
    const { tcx: t } = world();
    const ext = new DefId(DefIndex.from_u32(1), 1 as never);
    const sentinel = EarlyBinder.bind_iter<readonly [Clause, Span][]>([]);
    const seen: unknown[] = [];
    const tcx = with_methods(t, {
      explicit_super_clauses_of: (d: DefId) => {
        seen.push(d);
        return sentinel;
      },
    });
    expect(ClausesOf.implied_clauses_with_filter(tcx, ext, { $: "SelfTraitThatDefines", _0: undefined as never })).toBe(sentinel);
    expect(seen).toEqual([ext]);
    // any other filter fails the `assert_matches!`
    expect(stop(() => ClausesOf.implied_clauses_with_filter(tcx, ext, PredicateFilter.SelfOnly))).toBe(
      "assertion `left matches right` failed\n  left: SelfOnly\n right: PredicateFilter::SelfTraitThatDefines(_)",
    );
  });
});

describe("assert_only_contains_clauses_from", () => {
  test("is a no-op without debug assertions (the oracle is a release rustc)", () => {
    const { tcx, outlives } = world();
    // a `RegionOutlives` clause would be a `bug!` under SelfOnly with debug assertions
    const c = Clause_upcast_from_ClauseKind({ $: "RegionOutlives", _0: { _0: tcx.lifetimes.re_static, _1: tcx.lifetimes.re_static } }, tcx);
    expect(stop(() => ClausesOf.assert_only_contains_clauses_from(PredicateFilter.SelfOnly, [[c, DUMMY_SP], [outlives(tcx.lifetimes.re_static), DUMMY_SP]], tcx.types.u8))).toBeUndefined();
  });
});

describe("const_conditions / explicit_implied_const_bounds / type_param_clauses", () => {
  test("ICE on an item that is not conditionally const", () => {
    const { tcx: t } = world();
    const tcx = with_methods(t, { is_conditionally_const: () => false });
    expect(stop(() => ClausesOf.const_conditions(tcx, ldid(2)))).toStartWith("const_conditions invoked for item that is not conditionally const: ");
    expect(stop(() => ClausesOf.explicit_implied_const_bounds(tcx, ldid(2)))).toStartWith("explicit_implied_const_bounds invoked for item that is not conditionally const: ");
  });

  test("RPITITs inherit their fn's const conditions", () => {
    const { tcx: t } = world();
    const cc = { parent: undefined, clauses: [] };
    const seen: unknown[] = [];
    const tcx = with_methods(t, {
      is_conditionally_const: () => true,
      opt_rpitit_info: () => ({ $: "Impl", fn_def_id: did(9) }),
      const_conditions: (d: DefId) => {
        seen.push(d);
        return cc;
      },
    });
    expect(ClausesOf.const_conditions(tcx, ldid(2))).toBe(cc);
    expect(seen).toEqual([did(9)]);
  });

  test("an RPITIT in an impl is unreachable for type_param_clauses", () => {
    const { tcx: t } = world();
    const tcx = with_methods(t, { opt_rpitit_info: () => ({ $: "Impl", fn_def_id: did(9) }) });
    expect(stop(() => ClausesOf.type_param_clauses(tcx, [ldid(2), ldid(4), undefined as never]))).toBe(
      "internal error: entered unreachable code: should not be lowering bounds on RPITIT in impl",
    );
  });
});

// ---- item_bounds.rs -------------------------------------------------------------------------------------------------

describe("remap_gat_vars_and_recurse_into_nested_projections", () => {
  test("maps the GAT's bound vars to its params and compresses the rest", () => {
    const { tcx, self_ty } = world();
    const item_trait_ref: TraitRefT = TraitRef.identity(tcx, TR);
    // for<'^0, '^1, '^2> <Self as Tr>::G<'^0, '^2>: Bound<'^1>
    const clause = bound_clause(tcx, gat(tcx, self_ty, bound_re(tcx, 0), bound_re(tcx, 2)), bound_re(tcx, 1), [anon_re, anon_re, anon_re]);
    const r = ItemBounds.remap_gat_vars_and_recurse_into_nested_projections(tcx, PredicateFilter.All, item_trait_ref, G.expect_local(), DUMMY_SP, clause);
    expect(r).toBeDefined();
    const [out, span] = r!;
    expect(span).toBe(DUMMY_SP);
    const gens = tcx.generics_of(G) as Generics;
    const x = GenericArg.expect_region(tcx.mk_param_from_def(gens.own_params[0]!));
    const y = GenericArg.expect_region(tcx.mk_param_from_def(gens.own_params[1]!));
    // for<'^0> <Self as Tr>::G<'x, 'y>: Bound<'^0>
    expect(out).toBe(bound_clause(tcx, gat(tcx, self_ty, x, y), bound_re(tcx, 0), [anon_re]));
  });

  test("no GAT args: the clause as is", () => {
    const { tcx, self_ty } = world();
    const proj = Ty.new_projection_from_args(tcx, IsRigid.No, A, tcx.mk_args([self_ty]));
    const clause = bound_clause(tcx, proj, tcx.lifetimes.re_static, []);
    const r = ItemBounds.remap_gat_vars_and_recurse_into_nested_projections(tcx, PredicateFilter.All, TraitRef.identity(tcx, TR), A.expect_local(), DUMMY_SP, clause);
    expect(r![0]).toBe(clause);
  });

  test("a duplicated or non-bound GAT arg cannot be mapped", () => {
    const { tcx, self_ty } = world();
    const tr = TraitRef.identity(tcx, TR);
    const dup = bound_clause(tcx, gat(tcx, self_ty, bound_re(tcx, 0), bound_re(tcx, 0)), tcx.lifetimes.re_static, [anon_re]);
    expect(ItemBounds.remap_gat_vars_and_recurse_into_nested_projections(tcx, PredicateFilter.All, tr, G.expect_local(), DUMMY_SP, dup)).toBeUndefined();
    const free = bound_clause(tcx, gat(tcx, self_ty, tcx.lifetimes.re_static, bound_re(tcx, 0)), tcx.lifetimes.re_static, [anon_re]);
    expect(ItemBounds.remap_gat_vars_and_recurse_into_nested_projections(tcx, PredicateFilter.All, tr, G.expect_local(), DUMMY_SP, free)).toBeUndefined();
  });

  test("a non-projection self type, or another projection under SelfOnly, gives nothing; All recurses", () => {
    const { tcx, self_ty, outlives } = world();
    const tr = TraitRef.identity(tcx, TR);
    expect(ItemBounds.remap_gat_vars_and_recurse_into_nested_projections(tcx, PredicateFilter.All, tr, G.expect_local(), DUMMY_SP, outlives(tcx.lifetimes.re_static))).toBeUndefined();
    // `<<Self as Tr>::G<'^0, '^1> as Tr>::A: 'static`: the outer projection is `A`, the inner one the GAT
    const inner = gat(tcx, self_ty, bound_re(tcx, 0), bound_re(tcx, 1));
    const outer = Ty.new_projection_from_args(tcx, IsRigid.No, A, tcx.mk_args([inner]));
    const kind: ClauseKind = { $: "TypeOutlives", _0: { _0: outer, _1: tcx.lifetimes.re_static } };
    const c = Clause_upcast_from_Binder_ClauseKind(Binder.bind_with_vars(kind, tcx.mk_bound_variable_kinds([anon_re, anon_re])), tcx);
    expect(ItemBounds.remap_gat_vars_and_recurse_into_nested_projections(tcx, PredicateFilter.SelfOnly, tr, G.expect_local(), DUMMY_SP, c)).toBeUndefined();
    const r = ItemBounds.remap_gat_vars_and_recurse_into_nested_projections(tcx, PredicateFilter.All, tr, G.expect_local(), DUMMY_SP, c);
    expect(r).toBeDefined();
    expect(Binder.bound_vars(r![0].kind()).length).toBe(0);
    expect(stop(() => ItemBounds.remap_gat_vars_and_recurse_into_nested_projections(tcx, PredicateFilter.SelfAndAssociatedTypeBounds, tr, G.expect_local(), DUMMY_SP, c))).toBe(
      "internal error: entered unreachable code: invalid predicate filter for `remap_gat_vars_and_recurse_into_nested_projections`",
    );
  });
});

describe("item_non_self_bounds", () => {
  test("the item bounds that are not self bounds, in order", () => {
    const { tcx: t, outlives } = world();
    const [c1, c2, c3] = [outlives(t.lifetimes.re_static), outlives(t.lifetimes.re_erased), outlives(Region.new_early_param(t, { index: 0, name: sym.Abi }))];
    const tcx = with_methods(t, {
      item_bounds: () => EarlyBinder.bind_iter(t.mk_clauses([c1!, c2!, c3!])),
      item_self_bounds: () => EarlyBinder.bind_iter(t.mk_clauses([c1!, c3!])),
    });
    expect([...EarlyBinder.skip_binder(ItemBounds.item_non_self_bounds(tcx, A))]).toEqual([c2!]);
    const tcx2 = with_methods(t, {
      item_bounds: () => EarlyBinder.bind_iter(t.mk_clauses([c1!])),
      item_self_bounds: () => EarlyBinder.bind_iter(t.mk_clauses([c1!])),
    });
    expect(EarlyBinder.skip_binder(ItemBounds.item_non_self_bounds(tcx2, A))).toBe(RawList.empty_with_type_info<Clause>() as Clauses);
  });
});

// ---- driver tests on no_core crates ---------------------------------------------------------------------------------

const DIR = join(import.meta.dir, "collect_b_oracle");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

function run(cmd: string[]): { exit: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

const args = (s: string, file: string): string[] => ["--sysroot", s, "--edition=2021", "--crate-type", "lib", "--emit=metadata", "-o", "/dev/null", file];

test("dump.rs def_parents: #[rustc_dump_def_parents] prints as the oracle", () => {
  const s = sysroot();
  if (s === undefined) {
    if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
    return;
  }
  const oracle = run(["rustc", `+${PIN.toolchain}`, ...args(s, "def_parents.rs")]);
  const ours = run(["bun", join(DIR, "run.ts"), "dump", "def_parents", ...args(s, "def_parents.rs")]);
  expect(oracle.stderr).toContain("rustc_dump_def_parents: DefId(0:16 ~ def_parents[");
  expect({ exit: ours.exit, stderr: ours.stderr }).toEqual({ exit: oracle.exit, stderr: oracle.stderr });
}, 120_000);

test("dump.rs: no #[rustc_dump_*] attribute, no output", () => {
  const s = sysroot();
  if (s === undefined) {
    if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
    return;
  }
  const all = "clauses_and_item_bounds,def_parents,generics,object_lifetime_defaults,opaque_hidden_types,vtables";
  const ours = run(["bun", join(DIR, "run.ts"), "dump", all, ...args(s, "queries.rs")]);
  expect({ exit: ours.exit, stderr: ours.stderr }).toEqual({ exit: 0, stderr: "" });
}, 120_000);

/**
 * Where the queries stop today: stubs of lanes collect-a (`ItemCtxt::new`, `generics_of`) and of files nobody owns yet.
 * Each entry is the exact `unported(..)` text.
 */
const PENDING = new Set([
  "rustc_hir_analysis::collect::ItemCtxt::new",
  "rustc_hir_analysis::collect::generics_of::generics_of",
]);

test("queries.rs: clauses_of / explicit_item_bounds / item_bounds agree with the tydump probe, or stop as PENDING", () => {
  const s = sysroot();
  const { probeBinary } = require("../../../scripts/probes.ts") as typeof import("../../../scripts/probes.ts");
  const probe = probeBinary("tydump");
  if (s === undefined || !existsSync(probe)) {
    if (REQUIRE) throw new Error("ERROR: oracle sysroot or tydump probe missing");
    return;
  }
  const oracle = run([probe, "--sysroot", s, "--edition=2021", "--crate-type", "lib", "queries.rs"]);
  const ours = run(["bun", join(DIR, "run.ts"), "queries", "--sysroot", s, "--edition=2021", "--crate-type", "lib", "queries.rs"]);
  expect(ours.exit).toBe(0);
  // the probe's facts per DefId header
  const facts = new Map<string, Map<string, string>>();
  let cur: Map<string, string> | undefined;
  for (const line of oracle.stdout.split("\n")) {
    if (line.startsWith("DefId(")) facts.set(line, (cur = new Map()));
    else if (line.startsWith("  ") && !line.startsWith("   ") && cur !== undefined) {
      const sp = line.indexOf(" ", 2);
      cur.set(line.slice(2, sp), line.slice(sp + 1));
    }
  }
  const stops: string[] = [];
  let compared = 0;
  let header = "";
  for (const line of ours.stdout.split("\n")) {
    if (line === "") continue;
    if (!line.startsWith("  ")) {
      header = line;
      expect(facts.has(header)).toBe(true);
      continue;
    }
    const sp = line.indexOf(" ", 2);
    const [query, value] = [line.slice(2, sp), line.slice(sp + 1)];
    if (value.startsWith("UNPORTED ")) {
      stops.push(value.slice("UNPORTED ".length));
      continue;
    }
    const want = facts.get(header)!.get(query);
    if (want !== undefined) {
      expect(`${header} ${query} ${value}`).toBe(`${header} ${query} ${want}`);
      compared++;
    }
  }
  expect(stops.filter((w) => !PENDING.has(w))).toEqual([]);
  // The probe dumps `explicit_item_bounds` only for associated / opaque types; a type alias has none (item_bounds.rs:486).
  expect(ours.stdout).toContain("TyAlias\n  clauses_of UNPORTED rustc_hir_analysis::collect::ItemCtxt::new\n  explicit_item_bounds EarlyBinder { value: [], .. }\n  item_bounds EarlyBinder { value: [], .. }\n");
  void compared;
}, 120_000);
