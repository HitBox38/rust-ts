// Tests of lane infer-canonical-outlives: rustc_infer canonical/{mod,canonicalizer,instantiate,query_response}.rs and
// outlives/{mod,obligations,test_type_match,verify}.rs, on a real `InferCtxt` (`tcx.infer_ctxt().build(..)` over a
// `TyCtxt` with fresh interners).
//
// Oracle: canonical_outlives_oracle/probe.rs is a rustc-dev program that runs the same cases through the real
// rustc_infer (`canonicalize_response`, `canonicalize_user_type_annotation`, `canonicalize_query`,
// `instantiate_canonical`, `TypeOutlives::type_must_outlive` with a recording delegate, `extract_verify_if_eq`) on an
// `InferCtxt` holding the variables of `vars()` below (same vids, universes and unifications). The fixture
// canonical_outlives_oracle/oracle.stdout is its output (`REGEN=1` rebuilds the probe and rewrites it).
//
// The test setup unifies variables directly through the tables, as context.rs's `*_raw` fns do (the values involved
// need no `lower_universe`). Region variables are only used where the canonicalizer does not consult the region
// constraint storage (query and user-type-annotation modes).
// The other tests check upstream semantics directly (documented per test).
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../../rustc_middle/lib.ts";
import "../lib.ts";
import { PIN } from "../../../scripts/lib/common.ts";
import { CanonicalParamEnvCache, debug_OriginalQueryValues, OriginalQueryValues, QueryRegionConstraints, QueryResponse } from "../../rustc_middle/infer/canonical.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { debug_RawList } from "../../rustc_middle/ty/list.ts";
import { ParamEnv, Ty } from "../../rustc_middle/ty/mod.ts";
import { Clause_upcast_from_Binder_ClauseKind } from "../../rustc_middle/ty/predicate.ts";
import { debug_GenericArg, debug_ParamTy, debug_Ty, fold_Clauses, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { ParamConst } from "../../rustc_middle/ty/sty.ts";
import { DUMMY_SP, create_default_session_globals_then } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { Binder, debug_Placeholder, debug_BoundTy, PlaceholderConst, PlaceholderRegion, PlaceholderType } from "../../rustc_type_ir/binder.ts";
import { type Canonical, type CanonicalVarKind, debug_CanonicalVarKind } from "../../rustc_type_ir/canonical.ts";
import type { BoundVar, ConstVid, RegionVid, TyVid } from "../../rustc_type_ir/decls.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { debug_UniverseIndex, INNERMOST, UniverseIndex } from "../../rustc_type_ir/lib.ts";
import { Const } from "../../rustc_type_ir/sty/consts.ts";
import { debug_Region, Region } from "../../rustc_type_ir/sty/mod.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Panic, Unported } from "../../std/panic.ts";
import { Err } from "../../std/result.ts";
import { InferCtxt } from "../decls.ts";
import { Canonical_instantiate, instantiate_value } from "./canonical/instantiate.ts";
import { make_query_region_constraints } from "./canonical/query_response.ts";
import { ConstVidKey_from } from "./unify_key.ts";
import { explicit_outlives_bounds } from "./outlives/mod.ts";
import { InferCtxt_TypeOutlivesDelegate, TypeOutlives, type TypeOutlivesDelegate } from "./outlives/obligations.ts";
import { extract_verify_if_eq } from "./outlives/test_type_match.ts";
import { debug_VerifyBound, type GenericKind, type VerifyBound, type VerifyIfEq, RegionConstraintData, type Verify } from "./region_constraints/mod.ts";
import type { SubregionOrigin } from "./mod.ts";

const DIR = join(import.meta.dir, "canonical_outlives_oracle");
const FIXTURE = join(DIR, "oracle.stdout");

if (process.env.REGEN === "1") {
  const { oracleSysroot } = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
  const s = oracleSysroot();
  const out = join(tmpdir(), "rust-ts-infer-canonical-outlives-probe");
  mkdirSync(out, { recursive: true });
  const exe = join(out, "probe");
  const run = (cmd: string[]) => Bun.spawnSync(cmd, { cwd: DIR, env: { ...process.env, RUSTC_ICE: "0" }, stdout: "pipe", stderr: "pipe" });
  const b = run(["rustc", `+${PIN.toolchain}`, "--edition", "2024", join(DIR, "probe.rs"), "-o", exe, "-C", `link-arg=-Wl,-rpath,${s}/lib`]);
  if (b.exitCode !== 0) throw new Error(`ERROR: probe build failed: ${b.stderr.toString().split("\n")[0]}`);
  const r = run([exe, "--edition=2021", "--crate-type", "lib", "--sysroot", s, "empty.rs"]);
  if (r.exitCode !== 0) throw new Error(`ERROR: probe exit ${r.exitCode}`);
  writeFileSync(FIXTURE, r.stdout.toString());
}

/** The fixture's blocks: header line (`response <label>`, `query <label>`, ...) -> its indented lines. */
function fixture(): Map<string, string[]> {
  const blocks = new Map<string, string[]>();
  let cur: string[] = [];
  for (const line of readFileSync(FIXTURE, "utf8").split("\n")) {
    if (line === "") continue;
    if (!line.startsWith(" ")) {
      cur = [];
      blocks.set(line, cur);
    } else {
      cur.push(line.slice(2));
    }
  }
  return blocks;
}

/** A `TyCtxt` over fresh interners; `sess` holds the `-Z` flags the ported code reads (all off, as the probe). */
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
    caches: {
      canonical_param_env_cache: CanonicalParamEnvCache.default_(),
      highest_var_in_clauses_cache: new Map(),
      clauses_cache: new Map(),
    },
    sess: {
      opts: {
        trimmed_def_paths: false,
        unstable_opts: {
          trim_diagnostic_paths: true,
          assumptions_on_binders: false,
          higher_ranked_assumptions: false,
          renormalize_rigid_aliases: false,
        },
      },
      verbose_internals: () => false,
    },
  };
  const tcx = new TyCtxt(gcx as unknown as GlobalCtxt);
  // PORT(test): `next_trait_solver_globally` reads the session options (the probe's default: off).
  (tcx as unknown as { next_trait_solver_globally: () => boolean }).next_trait_solver_globally = () => false;
  return tcx;
}

const U = (n: number) => n as UniverseIndex;
const sg = (f: () => void) => () => create_default_session_globals_then(f);

function mk_infcx(tcx: TyCtxt): InferCtxt {
  return tcx.infer_ctxt().build(TypingMode.non_body_analysis());
}

interface Vars {
  t0: Ty;
  t1: Ty;
  t2: Ty;
  t3: Ty;
  t4: Ty;
  i0: Ty;
  i1: Ty;
  f0: Ty;
  c0: Const;
  c1: Const;
  r0: Region;
  r1: Region;
  ph_t: Ty;
  ph_r: Region;
  ph_c: Const;
}

/** The probe's `vars()`: the same calls, in the same order (unifications through the tables, module comment). */
function vars(tcx: TyCtxt, infcx: InferCtxt): Vars {
  const u1 = infcx.create_next_universe();
  const u2 = infcx.create_next_universe();
  const t0 = infcx.next_ty_var_in_universe(DUMMY_SP, UniverseIndex.ROOT);
  const t1 = infcx.next_ty_var_in_universe(DUMMY_SP, u2);
  const t2 = infcx.next_ty_var_in_universe(DUMMY_SP, u1);
  const t3 = infcx.next_ty_var_in_universe(DUMMY_SP, u1);
  const t4 = infcx.next_ty_var_in_universe(DUMMY_SP, UniverseIndex.ROOT);
  const tv = infcx.inner.type_variables();
  tv.sub_unify(2 as TyVid, 0 as TyVid);
  infcx.inner.type_variables().equate(3 as TyVid, 1 as TyVid);
  infcx.inner.type_variables().instantiate(4 as TyVid, tcx.types.u8);
  const i0 = infcx.next_int_var();
  const i1 = infcx.next_int_var();
  infcx.inner.int_unification_table().union_value(1 as never, { $: "IntType", _0: "I32" });
  const f0 = infcx.next_float_var(DUMMY_SP, undefined);
  const c0 = infcx.next_const_var_in_universe(DUMMY_SP, u2);
  const c1 = infcx.next_const_var_in_universe(DUMMY_SP, UniverseIndex.ROOT);
  const n = Const.new_param(tcx, ParamConst.new(0, Symbol.intern("N")));
  infcx.inner.const_unification_table().union_value(ConstVidKey_from(1 as ConstVid), { $: "Known", value: n });
  // The probe creates '?0 (U0) and '?1 (U2) through the region constraint storage; only their vids matter here.
  const r0 = Region.new_var(tcx, 0 as RegionVid);
  const r1 = Region.new_var(tcx, 1 as RegionVid);
  const ph_t = Ty.new_placeholder(tcx, PlaceholderType.new_anon(u2, 0 as BoundVar));
  const ph_r = Region.new_placeholder(tcx, PlaceholderRegion.new_anon(u1, 1 as BoundVar));
  const ph_c = Const.new_placeholder(tcx, PlaceholderConst.new_anon(u1, 2 as BoundVar));
  return { t0, t1, t2, t3, t4, i0, i1, f0, c0, c1, r0, r1, ph_t, ph_r, ph_c };
}

const ref = (tcx: TyCtxt, r: Region, t: Ty): Ty => Ty.new_ref(tcx, r, t, "Not");
const arr = (tcx: TyCtxt, c: Const): Ty => Ty.new_array_with_const_len(tcx, tcx.types.u8, c);

function mixed(tcx: TyCtxt, v: Vars): Ty {
  const u8 = tcx.types.u8;
  return Ty.new_tup(tcx, [
    v.t0, v.t1, v.t2, v.t3, v.t4, v.i0, v.i1, v.f0, arr(tcx, v.c0), arr(tcx, v.c1), v.ph_t,
    ref(tcx, v.ph_r, u8), arr(tcx, v.ph_c), ref(tcx, tcx.lifetimes.re_static, v.t0),
    ref(tcx, tcx.lifetimes.re_erased, u8), Ty.new_tup(tcx, [v.t2, v.t0]),
  ]);
}

/** `{:?}` of `Canonical<Ty>`. PORT: generated `debug_Canonical` prints `var_kinds` through `unported_debug`, so the
 *  struct is formatted here with the same field order. */
function debug_canonical(c: Canonical<Ty>): string {
  return `Canonical { value: ${debug_Ty(c.value, PLAIN)}, max_universe: ${debug_UniverseIndex(c.max_universe, PLAIN)}, var_kinds: ${debug_var_kinds(c.var_kinds)} }`;
}
function debug_var_kinds(k: readonly CanonicalVarKind[]): string {
  return debug_RawList(k as never, PLAIN, debug_CanonicalVarKind);
}

/** `catch_unwind` of the probe: the value, or `panic: <message>`. */
function run<T>(f: () => T, show: (v: T) => string): string {
  try {
    return show(f());
  } catch (e) {
    if (e instanceof Unported) throw e;
    if (e instanceof Panic) return `panic: ${e.message}`;
    throw e;
  }
}

type Build = (tcx: TyCtxt, infcx: InferCtxt, v: Vars) => Ty;
const response_cases: [string, Build][] = [
  ["mixed", (tcx, _, v) => mixed(tcx, v)],
  ["root-only", (tcx, _, v) => Ty.new_tup(tcx, [v.t0, v.i0, v.t4, v.f0, v.t0])],
  [
    "many",
    (tcx, infcx, v) => {
      // More than 8 variables: `query_state.var_values` spills and `indices` takes over.
      const fresh = Array.from({ length: 10 }, () => infcx.next_ty_var(DUMMY_SP));
      return Ty.new_tup(tcx, [v.t1, v.t0, ...fresh, v.t1, fresh[9]!, fresh[2]!, v.ph_t, v.t3]);
    },
  ],
];

const user_cases: [string, (tcx: TyCtxt, v: Vars) => Ty][] = [
  [
    "vars",
    (tcx, v) => {
      const u8 = tcx.types.u8;
      return Ty.new_tup(tcx, [
        v.t1, ref(tcx, v.r1, u8), ref(tcx, tcx.lifetimes.re_static, v.t2), v.i0, v.f0, arr(tcx, v.c0),
        v.ph_t, ref(tcx, v.r0, v.t3), ref(tcx, v.r1, u8), ref(tcx, tcx.lifetimes.re_erased, u8),
      ]);
    },
  ],
  ["placeholder-const", (tcx, v) => arr(tcx, v.ph_c)],
];

const query_cases: [string, (tcx: TyCtxt, v: Vars) => Ty][] = [
  [
    "all",
    (tcx, v) => {
      const u8 = tcx.types.u8;
      return Ty.new_tup(tcx, [
        v.t0, v.t1, ref(tcx, v.r0, v.t2), ref(tcx, v.r1, u8), ref(tcx, tcx.lifetimes.re_static, u8),
        ref(tcx, tcx.lifetimes.re_erased, u8), v.ph_t, ref(tcx, v.ph_r, u8), arr(tcx, v.c0), v.i0, v.f0,
        ref(tcx, v.r0, u8), v.t3, arr(tcx, v.c1),
      ]);
    },
  ],
  ["placeholder-const", (tcx, v) => arr(tcx, v.ph_c)],
];

describe("old-solver canonicalizer vs the oracle probe", () => {
  const oracle = fixture();

  for (const [label, build] of response_cases) {
    test(
      `response ${label}`,
      sg(() => {
        const tcx = mk_tcx();
        const infcx = mk_infcx(tcx);
        const v = vars(tcx, infcx);
        const value = build(tcx, infcx, v);
        const got = run(() => infcx.canonicalize_response(value, fold_Ty), debug_canonical);
        expect([got]).toEqual(oracle.get(`response ${label}`)!);
      }),
    );
  }

  for (const [label, build] of user_cases) {
    test(
      `user ${label}`,
      sg(() => {
        const tcx = mk_tcx();
        const infcx = mk_infcx(tcx);
        const v = vars(tcx, infcx);
        const value = build(tcx, v);
        const got = run(() => infcx.canonicalize_user_type_annotation(value, fold_Ty), debug_canonical);
        expect([got]).toEqual(oracle.get(`user ${label}`)!);
      }),
    );
  }

  for (const [label, build] of query_cases) {
    test(
      `query ${label}`,
      sg(() => {
        const tcx = mk_tcx();
        const infcx = mk_infcx(tcx);
        const v = vars(tcx, infcx);
        const value = build(tcx, v);
        const query_state = OriginalQueryValues.default_();
        const got = run(
          () => infcx.canonicalize_query(ParamEnv.empty().and(value), query_state, fold_Ty),
          (c) =>
            [
              `max_universe: ${debug_UniverseIndex(c.canonical.max_universe, PLAIN)}`,
              `var_kinds: ${debug_var_kinds(c.canonical.var_kinds)}`,
              `value: ${debug_Ty(c.canonical.value.value, PLAIN)}`,
              `query_state: ${debug_OriginalQueryValues(query_state, PLAIN)}`,
            ].join("\n"),
        );
        expect(got.split("\n")).toEqual(oracle.get(`query ${label}`)!);
      }),
    );
  }

  test(
    "instantiate mixed",
    sg(() => {
      const tcx = mk_tcx();
      const infcx1 = mk_infcx(tcx);
      const v = vars(tcx, infcx1);
      const c = infcx1.canonicalize_response(mixed(tcx, v), fold_Ty);
      const infcx2 = mk_infcx(tcx);
      const [value, var_values] = infcx2.instantiate_canonical(DUMMY_SP, c, fold_Ty);
      const roots: string[] = [];
      for (const a of var_values.var_values) {
        if (a instanceof Ty) {
          const k = a.kind();
          if (k.$ === "Infer" && k._0.$ === "TyVar") {
            roots.push(`"?${k._0._0}t sub_root ?${infcx2.sub_unification_table_root_var(k._0._0)}t"`);
          }
        }
      }
      expect([
        `value: ${debug_Ty(value, PLAIN)}`,
        `var_values: ${debug_RawList(var_values.var_values, PLAIN, debug_GenericArg)}`,
        `universe: ${debug_UniverseIndex(infcx2.universe(), PLAIN)}`,
        `sub_roots: [${roots.join(", ")}]`,
      ]).toEqual(oracle.get("instantiate mixed")!);
    }),
  );
});

/** Records `TypeOutlives`' delegate calls as the probe's `Rec` prints them. */
function recorder(lines: string[]): TypeOutlivesDelegate {
  return {
    push_sub_region_constraint(_origin: SubregionOrigin, a: Region, b: Region, _c: unknown): void {
      lines.push(`push_sub_region_constraint(${debug_Region(a, PLAIN)}, ${debug_Region(b, PLAIN)})`);
    },
    push_verify(_origin: SubregionOrigin, kind: GenericKind, a: Region, bound: VerifyBound): void {
      lines.push(`push_verify(${debug_GenericKind_(kind)}, ${debug_Region(a, PLAIN)}, ${debug_VerifyBound(bound, PLAIN)})`);
    },
  };
}

/** `impl Debug for GenericKind` (region_constraints/mod.rs: each variant prints its payload's `{:?}`). PORT(test): the
 *  crate's `debug_GenericKind` is lane infer-regions'. */
function debug_GenericKind_(k: GenericKind): string {
  switch (k.$) {
    case "Param":
      return debug_ParamTy(k._0, PLAIN);
    case "Placeholder":
      return debug_Placeholder(k._0, PLAIN, debug_BoundTy);
    case "Alias":
      return "<alias>";
  }
}

describe("outlives vs the oracle probe", () => {
  const oracle = fixture();

  const setup = (tcx: TyCtxt) => {
    const p_t = Ty.new_param(tcx, 0, Symbol.intern("T"));
    const p_u = Ty.new_param(tcx, 1, Symbol.intern("U"));
    const re = (i: number): Region => Region.new_placeholder(tcx, PlaceholderRegion.new_anon(UniverseIndex.ROOT, i as BoundVar));
    return { p_t, p_u, re, u8: tcx.types.u8 };
  };

  const outlives_cases: [string, (tcx: TyCtxt) => [Region | undefined, Ty, Region]][] = [
    ["ref-param", (tcx) => { const { p_t, p_u, re } = setup(tcx); return [undefined, ref(tcx, re(0), Ty.new_tup(tcx, [p_t, ref(tcx, re(1), p_u)])), re(2)]; }],
    ["implicit", (tcx) => { const { p_t, re, u8 } = setup(tcx); return [tcx.lifetimes.re_static, Ty.new_tup(tcx, [p_t, u8]), re(2)]; }],
    [
      "placeholder",
      (tcx) => {
        const { re } = setup(tcx);
        const ph_t = Ty.new_placeholder(tcx, PlaceholderType.new_anon(U(1), 7 as BoundVar));
        return [undefined, Ty.new_tup(tcx, [ph_t, ref(tcx, tcx.lifetimes.re_static, ph_t)]), re(3)];
      },
    ],
    ["static-only", (tcx) => { const { p_t, u8 } = setup(tcx); return [undefined, ref(tcx, tcx.lifetimes.re_static, Ty.new_tup(tcx, [u8, p_t])), tcx.lifetimes.re_static]; }],
    [
      "fn-ptr",
      (tcx) => {
        const { p_t, p_u, re, u8 } = setup(tcx);
        const late = Region.new_bound(tcx, INNERMOST, { var: 0 as BoundVar, kind: { $: "Anon" } });
        const sig = tcx.mk_fn_sig_rust_abi([ref(tcx, late, p_t), ref(tcx, re(4), u8)], p_u, "Safe");
        const bv = tcx.mk_bound_variable_kinds([{ $: "Region", _0: { $: "Anon" } }]);
        return [undefined, Ty.new_fn_ptr(tcx, Binder.bind_with_vars(sig, bv)), re(2)];
      },
    ],
  ];

  for (const [label, build] of outlives_cases) {
    test(
      `outlives ${label}`,
      sg(() => {
        const tcx = mk_tcx();
        const [implicit, ty, region] = build(tcx);
        const lines: string[] = [];
        const o = TypeOutlives.new(recorder(lines), tcx, new Set(), implicit, []);
        o.type_must_outlive({ $: "RelateParamBound", _0: DUMMY_SP, _1: ty, _2: undefined }, ty, region, "BoringNoLocation");
        expect(lines).toEqual(oracle.get(`outlives ${label}`)!);
      }),
    );
  }

  const verify_cases: [string, (tcx: TyCtxt) => [Binder<VerifyIfEq>, Ty]][] = (() => {
    const pat = (tcx: TyCtxt, ty: Ty, bound: Region): Binder<VerifyIfEq> =>
      Binder.bind_with_vars({ ty, bound }, tcx.mk_bound_variable_kinds([{ $: "Region", _0: { $: "Anon" } }]));
    const b0 = (tcx: TyCtxt) => Region.new_bound(tcx, INNERMOST, { var: 0 as BoundVar, kind: { $: "Anon" } });
    const pat_ty = (tcx: TyCtxt) => Ty.new_tup(tcx, [ref(tcx, b0(tcx), setup(tcx).p_t), tcx.types.u8]);
    const twice = (tcx: TyCtxt) => Ty.new_tup(tcx, [ref(tcx, b0(tcx), setup(tcx).p_t), ref(tcx, b0(tcx), tcx.types.u8)]);
    const t = (tcx: TyCtxt, r: Region, last: Ty) => Ty.new_tup(tcx, [ref(tcx, r, setup(tcx).p_t), last]);
    return [
      ["bound-static", (tcx) => [pat(tcx, pat_ty(tcx), b0(tcx)), t(tcx, tcx.lifetimes.re_static, tcx.types.u8)]],
      ["bound-placeholder", (tcx) => [pat(tcx, pat_ty(tcx), b0(tcx)), t(tcx, setup(tcx).re(5), tcx.types.u8)]],
      ["mismatch", (tcx) => [pat(tcx, pat_ty(tcx), b0(tcx)), t(tcx, setup(tcx).re(5), tcx.types.u16)]],
      ["free-bound", (tcx) => [pat(tcx, pat_ty(tcx), setup(tcx).re(6)), t(tcx, setup(tcx).re(5), tcx.types.u8)]],
      ["unconstrained", (tcx) => [pat(tcx, Ty.new_tup(tcx, [setup(tcx).p_t, tcx.types.u8]), b0(tcx)), Ty.new_tup(tcx, [setup(tcx).p_t, tcx.types.u8])]],
      ["twice-same", (tcx) => [pat(tcx, twice(tcx), b0(tcx)), Ty.new_tup(tcx, [ref(tcx, setup(tcx).re(5), setup(tcx).p_t), ref(tcx, setup(tcx).re(5), tcx.types.u8)])]],
      ["twice-different", (tcx) => [pat(tcx, twice(tcx), b0(tcx)), Ty.new_tup(tcx, [ref(tcx, setup(tcx).re(5), setup(tcx).p_t), ref(tcx, setup(tcx).re(6), tcx.types.u8)])]],
    ];
  })();

  for (const [label, build] of verify_cases) {
    test(
      `verify_if_eq ${label}`,
      sg(() => {
        const tcx = mk_tcx();
        const [pattern, test_ty] = build(tcx);
        const r = extract_verify_if_eq(tcx, pattern, test_ty);
        expect([r === undefined ? "None" : `Some(${debug_Region(r, PLAIN)})`]).toEqual(oracle.get(`verify_if_eq ${label}`)!);
      }),
    );
  }
});

describe("canonical: upstream semantics", () => {
  // instantiate.rs:55: an empty `var_values` returns the value untouched; instantiate_projected asserts the lengths.
  test(
    "instantiate_value / Canonical_instantiate",
    sg(() => {
      const tcx = mk_tcx();
      const t = Ty.new_canonical_bound(tcx, 0 as BoundVar);
      expect(instantiate_value(tcx, { var_values: tcx.mk_args([]) }, t, fold_Ty)).toBe(t);
      const c: Canonical<Ty> = { max_universe: U(0), var_kinds: tcx.mk_canonical_var_kinds([{ $: "Ty", ui: U(0), sub_root: 0 as BoundVar }]), value: Ty.new_tup(tcx, [t, t]) };
      expect(Canonical_instantiate(c, tcx, { var_values: tcx.mk_args([tcx.types.u8]) }, fold_Ty)).toBe(Ty.new_tup(tcx, [tcx.types.u8, tcx.types.u8]));
      expect(() => Canonical_instantiate(c, tcx, { var_values: tcx.mk_args([]) }, fold_Ty)).toThrow("assertion `left == right` failed\n  left: 1\n right: 0");
    }),
  );

  // instantiate.rs:132 `fold_clauses`: the clause list is instantiated, the cache keys on the highest named var
  // (`highest_var_in_clauses`: `^c_3` here) and the prefix of the var values up to it.
  test(
    "CanonicalInstantiator::fold_clauses and highest_var_in_clauses",
    sg(() => {
      const tcx = mk_tcx();
      const clause = (t: Ty, r: Region) =>
        Clause_upcast_from_Binder_ClauseKind(Binder.dummy({ $: "TypeOutlives", _0: { _0: t, _1: r } }, { visit_with: (s, v) => fold_Ty.visit_with((s as { _0: { _0: Ty } })._0._0, v) }), tcx);
      const c = tcx.mk_clauses([clause(Ty.new_canonical_bound(tcx, 1 as BoundVar), Region.new_canonical_bound(tcx, 3 as BoundVar))]);
      const vv = [tcx.types.u8, tcx.types.u16, tcx.types.u32, tcx.lifetimes.re_static, tcx.types.u64];
      const out = instantiate_value(tcx, { var_values: tcx.mk_args(vv) }, c, fold_Clauses);
      expect(out).toBe(tcx.mk_clauses([clause(tcx.types.u16, tcx.lifetimes.re_static)]));
      expect(tcx.caches.highest_var_in_clauses_cache.get(c)).toBe(3);
      expect(tcx.caches.clauses_cache.size).toBe(1);
      // A second instantiation with a different value past the highest var hits the cache.
      const vv2 = [tcx.types.u8, tcx.types.u16, tcx.types.u32, tcx.lifetimes.re_static, tcx.types.i8];
      expect(instantiate_value(tcx, { var_values: tcx.mk_args(vv2) }, c, fold_Clauses)).toBe(out);
      expect(tcx.caches.clauses_cache.size).toBe(1);
    }),
  );

  // query_response.rs:411: a canonical `Ty` var never takes the guess (fresh var), a region / int var takes the original
  // value, a placeholder must have been unified with itself, and a variable from a universe created in the query
  // gets a fresh universe.
  test(
    "query_response_instantiation_guess",
    sg(() => {
      const tcx = mk_tcx();
      const infcx = mk_infcx(tcx);
      const t0 = infcx.next_ty_var(DUMMY_SP);
      const i0 = infcx.next_int_var();
      const p = Region.new_placeholder(tcx, PlaceholderRegion.new_anon(U(0), 9 as BoundVar));
      const original_values: OriginalQueryValues = { universe_map: [U(0)], var_values: [t0, p, i0] };
      const var_kinds = tcx.mk_canonical_var_kinds([
        { $: "Ty", ui: U(0), sub_root: 0 as BoundVar },
        { $: "PlaceholderRegion", _0: PlaceholderRegion.new_anon(U(0), 9 as BoundVar) },
        { $: "Int" },
        { $: "Ty", ui: U(1), sub_root: 3 as BoundVar },
      ]);
      const response = new QueryResponse<null>(
        tcx.mk_args([Ty.new_canonical_bound(tcx, 0 as BoundVar), Region.new_canonical_bound(tcx, 1 as BoundVar), Ty.new_canonical_bound(tcx, 2 as BoundVar)]),
        new QueryRegionConstraints([], []),
        "Proven",
        [],
        null,
      );
      const r = infcx.query_response_instantiation_guess(
        { span: DUMMY_SP } as never,
        ParamEnv.empty(),
        original_values,
        { max_universe: U(1), var_kinds, value: response },
        { visit_with: () => undefined as never, try_fold_with: () => undefined as never, fold_with: (s) => s },
      );
      expect(r.$).toBe("Ok");
      if (r.$ !== "Ok") return;
      const vv = r._0.value.var_values as readonly GenericArg[];
      expect(vv.map((a) => debug_GenericArg(a, PLAIN))).toEqual(["?1t", "'!9", "?0i", "?2t"]);
      expect(r._0.obligations).toEqual([]);
      // One universe was created for U1 of the response; `?2t` lives in it.
      expect(infcx.universe()).toBe(U(1));
      expect(infcx.try_resolve_ty_var(2 as TyVid)).toEqual(Err(U(1)));
    }),
  );

  // query_response.rs:617: no constraints and no obligations give empty query constraints (the assumptions are passed
  // through); a remaining verify is an assertion failure.
  test("make_query_region_constraints", () => {
    const empty = make_query_region_constraints([], new RegionConstraintData([], []), []);
    expect(empty.constraints).toEqual([]);
    expect(empty.assumptions).toEqual([]);
    const v = { kind: undefined, origin: undefined, region: undefined, bound: undefined } as unknown as Verify;
    expect(() => make_query_region_constraints([], new RegionConstraintData([], [v]), [])).toThrow("assertion failed: verifys.is_empty()");
  });
});

describe("outlives: upstream semantics", () => {
  // obligations.rs:134-230: the region obligations / assumptions are pushed with an undo-log entry (popped on rollback)
  // and cannot be taken inside a snapshot.
  test(
    "register / take region obligations and assumptions",
    sg(() => {
      const tcx = mk_tcx();
      const infcx = mk_infcx(tcx);
      const p_t = Ty.new_param(tcx, 0, Symbol.intern("T"));
      const ob = { sup_type: p_t, sub_region: tcx.lifetimes.re_static, origin: { $: "RelateParamBound", _0: DUMMY_SP, _1: p_t, _2: undefined } } as const;
      infcx.register_type_outlives_constraint_inner(ob);
      expect(infcx.num_registered_region_obligations()).toBe(1);
      const snapshot = infcx.inner.undo_log.start_snapshot();
      infcx.register_type_outlives_constraint_inner(ob);
      infcx.register_region_assumption({ _0: p_t, _1: tcx.lifetimes.re_static });
      expect(infcx.registered_region_obligations_since(1).length).toBe(1);
      expect(() => infcx.take_registered_region_obligations()).toThrow("cannot take registered region obligations in a snapshot");
      expect(() => infcx.take_registered_region_assumptions()).toThrow("cannot take registered region assumptions in a snapshot");
      infcx.inner.rollback_to(snapshot);
      expect(infcx.num_registered_region_obligations()).toBe(1);
      expect(infcx.inner.region_assumptions_).toEqual([]);
      expect(infcx.clone_registered_region_obligations().length).toBe(1);
      expect(infcx.take_registered_region_obligations().length).toBe(1);
      expect(infcx.num_registered_region_obligations()).toBe(0);
      infcx.register_region_assumption({ _0: p_t, _1: tcx.lifetimes.re_static });
      expect(infcx.take_registered_region_assumptions().length).toBe(1);

      // `register_type_outlives_constraint` skips global types (nothing pushed, no `SubregionOrigin` built).
      infcx.register_type_outlives_constraint(tcx.types.u8, tcx.lifetimes.re_static, undefined as never);
      expect(infcx.num_registered_region_obligations()).toBe(0);

      // With no obligations, `process_registered_region_obligations` returns at once.
      infcx.process_registered_region_obligations(undefined as never);
      expect(() => {
        const s = infcx.inner.undo_log.start_snapshot();
        try {
          infcx.process_registered_region_obligations(undefined as never);
        } finally {
          infcx.inner.rollback_to(s);
        }
      }).toThrow("cannot process registered region obligations in a snapshot");
    }),
  );

  // obligations.rs:720: the `&InferCtxt` delegate forwards to `sub_regions` (leak check `Unreachable`) and
  // `verify_generic_bound`, arguments in order.
  test(
    "TypeOutlivesDelegate for &InferCtxt",
    sg(() => {
      const tcx = mk_tcx();
      const infcx = mk_infcx(tcx);
      const calls: unknown[] = [];
      (infcx as unknown as Record<string, unknown>).sub_regions = (...a: unknown[]) => calls.push(["sub_regions", ...a]);
      (infcx as unknown as Record<string, unknown>).verify_generic_bound = (...a: unknown[]) => calls.push(["verify_generic_bound", ...a]);
      const d = InferCtxt_TypeOutlivesDelegate(infcx);
      const origin = { $: "RelateRegionParamBound", _0: DUMMY_SP, _1: undefined } as const;
      const a = tcx.lifetimes.re_static;
      const b = tcx.lifetimes.re_erased;
      d.push_sub_region_constraint(origin, a, b, "BoringNoLocation");
      const kind: GenericKind = { $: "Param", _0: { index: 0, name: Symbol.intern("T") } };
      d.push_verify(origin, kind, a, { $: "IsEmpty" });
      expect(calls).toEqual([
        ["sub_regions", origin, a, b, "Unreachable"],
        ["verify_generic_bound", origin, kind, a, { $: "IsEmpty" }],
      ]);
    }),
  );

  // outlives/mod.rs:23: only the region-outlives clauses without bound vars, as `RegionSubRegion(b, a)`.
  test(
    "explicit_outlives_bounds",
    sg(() => {
      const tcx = mk_tcx();
      const a = Region.new_placeholder(tcx, PlaceholderRegion.new_anon(U(0), 1 as BoundVar));
      const b = Region.new_placeholder(tcx, PlaceholderRegion.new_anon(U(0), 2 as BoundVar));
      const late = Region.new_bound(tcx, INNERMOST, { var: 0 as BoundVar, kind: { $: "Anon" } });
      const bv = tcx.mk_bound_variable_kinds([{ $: "Region", _0: { $: "Anon" } }]);
      const ro = (x: Region, y: Region, vars = tcx.mk_bound_variable_kinds([])) =>
        Clause_upcast_from_Binder_ClauseKind(Binder.bind_with_vars({ $: "RegionOutlives", _0: { _0: x, _1: y } }, vars), tcx);
      const to = Clause_upcast_from_Binder_ClauseKind(
        Binder.bind_with_vars({ $: "TypeOutlives", _0: { _0: tcx.types.u8, _1: a } }, tcx.mk_bound_variable_kinds([])),
        tcx,
      );
      const env = ParamEnv.new(tcx, [ro(a, b), to, ro(late, b, bv), ro(b, tcx.lifetimes.re_static)]);
      const out = [...explicit_outlives_bounds(env)].map((o) => (o.$ === "RegionSubRegion" ? `${debug_Region(o._0, PLAIN)} <= ${debug_Region(o._1, PLAIN)}` : o.$));
      expect(out).toEqual(["'!2 <= '!1", "'static <= '!2"]);
    }),
  );
});
