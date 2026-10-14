// Tests of lane nts-canonical: rustc_next_trait_solver canonical/{mod,canonicalizer}.rs, placeholder.rs, coherence.rs,
// normalize.rs and solve/inspect/build.rs, on a `TyCtxt` over fresh interners with a fake `InferCtxtLike` /
// `SolverDelegate` (the wave-17 `SolverDelegate` over `InferCtxt` does not exist yet).
//
// Oracle: canonical_oracle/probe.rs is a rustc-dev program that canonicalizes the same values with the real
// `Canonicalizer` (response mode through the public `make_canonical_state`, input mode through
// `SolverDelegateEvalExt::evaluate_root_goal` on `WellFormed(<tuple>)`, recorded in its delegate's
// `build_with_canonical`). The fixture canonical_oracle/canonical.stdout is its output (`REGEN=1` rebuilds the probe and
// rewrites it). The fake infcx below mirrors the probe's `InferCtxt`: the same vids, universes and sub-unification.
// The other tests check upstream semantics directly (documented per test).
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../rustc_middle/lib.ts";
import "./lib.ts";
import { PIN } from "../../scripts/lib/common.ts";
import { create_default_session_globals_then } from "../rustc_span/lib.ts";
import { DefId, DefIndex, LOCAL_CRATE } from "../rustc_span/def_id.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import type { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { debug_RawList } from "../rustc_middle/ty/list.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { debug_GenericArg, debug_Ty, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { ParamConst } from "../rustc_middle/ty/sty.ts";
import { PlaceholderConst, PlaceholderRegion, PlaceholderType } from "../rustc_type_ir/binder.ts";
import { type Canonical, CanonicalVarKind, debug_CanonicalVarKind } from "../rustc_type_ir/canonical.ts";
import type { BoundVar, ConstVid, RegionVid, TyVid } from "../rustc_type_ir/decls.ts";
import { type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../rustc_type_ir/fold.ts";
import { type InferCtxtLike, InferCtxtLike_provided } from "../rustc_type_ir/infer_ctxt.ts";
import { debug_UniverseIndex, INNERMOST, UniverseIndex } from "../rustc_type_ir/lib.ts";
import { debug_State, type State } from "../rustc_type_ir/solve/inspect.ts";
import { debug_NestedNormalizationGoals } from "../rustc_type_ir/solve/mod.ts";
import { Const, fold_Const } from "../rustc_type_ir/sty/consts.ts";
import { Region } from "../rustc_type_ir/sty/mod.ts";
import { PLAIN } from "../std/fmt.ts";
import { Panic, Unported } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { Canonicalizer } from "./canonical/canonicalizer.ts";
import { instantiate_and_apply_query_response, make_canonical_state, response_no_constraints_raw } from "./canonical/mod.ts";
import {
  debug_OrphanCheckErr,
  type OrphanCheckErr,
  IsFirstInputType,
  OrphanCheckMode,
  orphan_check_trait_ref,
  trait_ref_is_knowable,
} from "./coherence.ts";
import { type SolverDelegate, SolverDelegate_provided } from "./delegate.ts";
import { NormalizationFolder } from "./normalize.ts";
import { BoundVarReplacer, PlaceholderReplacer } from "./placeholder.ts";
import { ProofTreeBuilder } from "./solve/inspect/build.ts";

const DIR = join(import.meta.dir, "canonical_oracle");
const FIXTURE = join(DIR, "canonical.stdout");

if (process.env.REGEN === "1") {
  const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
  const s = oracleSysroot();
  const out = join(tmpdir(), "rust-ts-nts-canonical-probe");
  mkdirSync(out, { recursive: true });
  const exe = join(out, "probe");
  const run = (cmd: string[]) => Bun.spawnSync(cmd, { cwd: DIR, env: { ...process.env, RUSTC_ICE: "0" }, stdout: "pipe", stderr: "pipe" });
  const b = run(["rustc", `+${PIN.toolchain}`, "--edition", "2024", join(DIR, "probe.rs"), "-o", exe, "-C", `link-arg=-Wl,-rpath,${s}/lib`]);
  if (b.exitCode !== 0) throw new Error(`ERROR: probe build failed: ${b.stderr.toString().split("\n")[0]}`);
  const r = run([exe, "--edition=2021", "--crate-type", "lib", "--sysroot", s, "empty.rs"]);
  if (r.exitCode !== 0) throw new Error(`ERROR: probe exit ${r.exitCode}`);
  writeFileSync(FIXTURE, r.stdout.toString());
}

/** The fixture's blocks: header line (`response <label>` / `input <label>`) -> its indented lines. */
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
    sess: {
      opts: {
        trimmed_def_paths: false,
        unstable_opts: { trim_diagnostic_paths: true, assumptions_on_binders: false, renormalize_rigid_aliases: false },
      },
      verbose_internals: () => false,
    },
  };
  return new TyCtxt(gcx as unknown as GlobalCtxt);
}

const U = (n: number) => n as UniverseIndex;
const sg = (f: () => void) => () => create_default_session_globals_then(f);

/** What the fake infcx records (the `*_raw` unification calls of `ResponseRelating`). */
interface Log {
  calls: string[];
  universe: UniverseIndex;
}

/**
 * The probe's `InferCtxt` after `vars()`: universes U1, U2 created; `?0t` (U0), `?1t` (U2), `?2t` (U1, sub-unified
 * with `?0t`), `?0i`, `?0f`, `'?0` (U0), `'?1` (U2), `?0c` (U2); the "many" case's fresh `?3t..?20t` are in the then
 * current universe U2. Nothing is instantiated, so the `shallow_resolve_*` are the identity.
 */
function fake_infcx(tcx: TyCtxt, log: Log): InferCtxtLike {
  const ty_universe = (v: number): UniverseIndex => (v === 0 ? U(0) : v === 2 ? U(1) : U(2));
  const infcx = {
    cx: () => tcx,
    universe: () => log.universe,
    create_next_universe: () => {
      log.universe = U(log.universe + 1);
      return log.universe;
    },
    sub_unification_table_root_var: (v: TyVid) => (v === 2 ? (0 as TyVid) : v),
    universe_of_ty: (v: TyVid) => ty_universe(v),
    universe_of_region: (v: RegionVid) => (v === 0 ? U(0) : U(2)),
    universe_of_const: (_v: ConstVid) => U(2),
    shallow_resolve_ty_var: (v: TyVid) => Ty.new_var(tcx, v),
    shallow_resolve_int_var: (v: number) => Ty.new_int_var(tcx, v as never),
    shallow_resolve_float_var: (v: number) => Ty.new_float_var(tcx, v as never),
    shallow_resolve_const_var: (v: ConstVid) => Const.new_var(tcx, v),
    shallow_resolve_region_var: (v: RegionVid) => Region.new_var(tcx, v),
    shallow_resolve: (t: Ty) => t,
    shallow_resolve_const: (c: Const) => c,
    equate_ty_vids_raw: (a: TyVid, b: TyVid) => log.calls.push(`equate_ty_vids_raw(?${a}t, ?${b}t)`),
    instantiate_ty_var_raw: (a: TyVid, t: Ty) => log.calls.push(`instantiate_ty_var_raw(?${a}t, ${debug_Ty(t, PLAIN)})`),
    equate_int_vids_raw: (a: number, b: number) => log.calls.push(`equate_int_vids_raw(?${a}i, ?${b}i)`),
    equate_float_vids_raw: (a: number, b: number) => log.calls.push(`equate_float_vids_raw(?${a}f, ?${b}f)`),
    equate_const_vids_raw: (a: number, b: number) => log.calls.push(`equate_const_vids_raw(?${a}c, ?${b}c)`),
    equate_regions: (a: Region, b: Region) => log.calls.push(`equate_regions(${debug_GenericArg(a, PLAIN)}, ${debug_GenericArg(b, PLAIN)})`),
    register_hidden_type_in_storage: () => undefined,
    deeply_resolve_via_unification_table<T>(value: T, d_T: TypeFoldable<T>): T {
      return InferCtxtLike_provided.deeply_resolve_via_unification_table(infcx as unknown as InferCtxtLike, value, d_T);
    },
  };
  return infcx as unknown as InferCtxtLike;
}

/** The test-local `CanonicalInstantiator` (rustc_infer canonical/instantiate.rs, the wave-17 delegate's
 *  `instantiate_canonical`): replaces `^c_N` by `var_values[N]`. */
class Instantiator implements TypeFolder {
  constructor(
    public tcx: TyCtxt,
    public var_values: readonly GenericArg[],
  ) {}
  cx(): TyCtxt {
    return this.tcx;
  }
  fold_ty(t: Ty): Ty {
    const k = t.kind();
    if (k.$ === "Bound" && k._0.$ === "Canonical") return this.var_values[k._1.var] as Ty;
    return fold_Ty.super_fold_with(t, this);
  }
  fold_region(r: Region): Region {
    const k = r.kind();
    if (k.$ === "ReBound" && k._0.$ === "Canonical") return this.var_values[k._1.var] as Region;
    return r;
  }
  fold_const(c: Const): Const {
    const k = c.kind();
    if (k.$ === "Bound" && k._0.$ === "Canonical") return this.var_values[k._1.var] as Const;
    return fold_Const.super_fold_with(c, this);
  }
  fold_binder: TypeFolder["fold_binder"] = (t, d) => TypeFolder_provided.fold_binder(this, t, d);
  fold_predicate: TypeFolder["fold_predicate"] = (p, d) => TypeFolder_provided.fold_predicate(this, p, d);
  fold_clauses: TypeFolder["fold_clauses"] = (c) => TypeFolder_provided.fold_clauses(this, c);
}

function fake_delegate(tcx: TyCtxt, infcx: InferCtxtLike, log: Log): SolverDelegate {
  let fresh = 100;
  const d = {
    deref: () => infcx,
    cx: () => tcx,
    obtain_canonicalizer_state: () => SolverDelegate_provided.obtain_canonicalizer_state(d as unknown as SolverDelegate),
    release_canonicalizer_state: () => {},
    instantiate_canonical<V>(canonical: Canonical<V>, values: { var_values: readonly GenericArg[] }, d_V: TypeFoldable<V>): V {
      return d_V.fold_with(canonical.value, new Instantiator(tcx, values.var_values));
    },
    instantiate_canonical_var(kind: CanonicalVarKind, _span: unknown, _vv: unknown, universe_map: (u: UniverseIndex) => UniverseIndex): GenericArg {
      const u = universe_map(CanonicalVarKind.universe(kind));
      log.calls.push(`instantiate_canonical_var(${debug_CanonicalVarKind(kind, PLAIN)}, ${debug_UniverseIndex(u, PLAIN)})`);
      return Ty.new_var(tcx, fresh++ as TyVid);
    },
  };
  return d as unknown as SolverDelegate;
}

interface Vars {
  t0: Ty;
  t1: Ty;
  t2: Ty;
  i0: Ty;
  f0: Ty;
  r0: Region;
  r1: Region;
  c0: Const;
  ph_t: Ty;
  ph_r: Region;
  ph_r0: Region;
  ph_c: Const;
}

function vars(tcx: TyCtxt): Vars {
  return {
    t0: Ty.new_var(tcx, 0 as TyVid),
    t1: Ty.new_var(tcx, 1 as TyVid),
    t2: Ty.new_var(tcx, 2 as TyVid),
    i0: Ty.new_int_var(tcx, 0 as never),
    f0: Ty.new_float_var(tcx, 0 as never),
    r0: Region.new_var(tcx, 0 as RegionVid),
    r1: Region.new_var(tcx, 1 as RegionVid),
    c0: Const.new_var(tcx, 0 as ConstVid),
    ph_t: Ty.new_placeholder(tcx, PlaceholderType.new_anon(U(2), 0 as BoundVar)),
    ph_r: Region.new_placeholder(tcx, PlaceholderRegion.new_anon(U(2), 1 as BoundVar)),
    ph_r0: Region.new_placeholder(tcx, PlaceholderRegion.new_anon(U(0), 3 as BoundVar)),
    ph_c: Const.new_placeholder(tcx, PlaceholderConst.new_anon(U(2), 2 as BoundVar)),
  };
}

const ref = (tcx: TyCtxt, r: Region, t: Ty): Ty => Ty.new_ref(tcx, r, t, "Not");
const arr = (tcx: TyCtxt, c: Const): Ty => Ty.new_array_with_const_len(tcx, tcx.types.u8, c);

/** `{:?}` of `inspect::CanonicalState<I, Ty>`. PORT: generated `debug_Canonical` prints `var_kinds` through
 *  `unported_debug` (tyir-misc "For root"), so the struct is formatted here with the same field order. */
function debug_canonical_state(c: Canonical<State<Ty>>): string {
  return `Canonical { value: ${debug_State(c.value, PLAIN, debug_Ty)}, max_universe: ${debug_UniverseIndex(c.max_universe, PLAIN)}, var_kinds: ${debug_RawList(c.var_kinds, PLAIN, debug_CanonicalVarKind)} }`;
}

type Build = (tcx: TyCtxt, v: Vars) => [GenericArg[], Ty];
const response_cases: [string, UniverseIndex, Build][] = [
  [
    "all-u1",
    U(1),
    (tcx, v) => {
      const u8 = tcx.types.u8;
      const data = Ty.new_tup(tcx, [
        v.t0, ref(tcx, v.r0, v.t1), v.t2, v.i0, v.f0, arr(tcx, v.c0), ref(tcx, v.r1, v.ph_t),
        ref(tcx, tcx.lifetimes.re_static, u8), ref(tcx, tcx.lifetimes.re_erased, u8),
        ref(tcx, v.ph_r, u8), ref(tcx, v.ph_r0, u8), arr(tcx, v.ph_c), Ty.new_tup(tcx, [v.t0, u8]),
        Ty.new_tup(tcx, [v.t0, u8]), v.t1, ref(tcx, v.r0, u8),
      ]);
      return [[v.t1, v.r1], data];
    },
  ],
  ["all-u2", U(2), (tcx, v) => [[], Ty.new_tup(tcx, [v.t0, v.t1, v.t2, ref(tcx, v.r1, v.t0), arr(tcx, v.c0)])]],
  ["root", U(0), (tcx, v) => [[v.t0], Ty.new_tup(tcx, [v.t1, v.t2, v.t0, ref(tcx, v.r1, v.ph_t), v.i0])]],
  ["placeholder-in-input-universe", U(2), (tcx, v) => [[], ref(tcx, v.ph_r, tcx.types.u8)]],
  [
    "many",
    U(1),
    (tcx, v) => {
      const fresh = Array.from({ length: 18 }, (_, i) => Ty.new_var(tcx, (3 + i) as TyVid));
      const tys = [v.t0, v.t2, ...fresh, v.t0, fresh[17]!, fresh[3]!, ref(tcx, v.r0, fresh[0]!)];
      return [[fresh[5]!], Ty.new_tup(tcx, tys)];
    },
  ],
];

const input_cases: [string, (tcx: TyCtxt, v: Vars) => Ty][] = [
  [
    "all",
    (tcx, v) => {
      const u8 = tcx.types.u8;
      return Ty.new_tup(tcx, [
        v.t0, ref(tcx, v.r0, v.t1), v.t2, v.i0, v.f0, arr(tcx, v.c0), ref(tcx, v.r1, v.ph_t),
        ref(tcx, tcx.lifetimes.re_static, u8), ref(tcx, tcx.lifetimes.re_erased, u8), ref(tcx, v.ph_r, u8),
        Ty.new_tup(tcx, [v.t0, u8]), Ty.new_tup(tcx, [v.t0, u8]), v.t1, ref(tcx, v.r0, v.ph_t),
        ref(tcx, tcx.lifetimes.re_static, v.t2), ref(tcx, v.ph_r0, u8),
      ]);
    },
  ],
  [
    "params",
    (tcx, v) => {
      const p_t = Ty.new_param(tcx, 0, Symbol.intern("T"));
      const p_n = Const.new_param(tcx, ParamConst.new(1, Symbol.intern("N")));
      return Ty.new_tup(tcx, [p_t, v.t0, arr(tcx, p_n), ref(tcx, v.r0, p_t), p_t, arr(tcx, v.ph_c)]);
    },
  ],
];

function setup(): { tcx: TyCtxt; log: Log; infcx: InferCtxtLike; delegate: SolverDelegate; v: Vars } {
  const tcx = mk_tcx();
  const log: Log = { calls: [], universe: U(2) };
  const infcx = fake_infcx(tcx, log);
  return { tcx, log, infcx, delegate: fake_delegate(tcx, infcx, log), v: vars(tcx) };
}

/** Input mode as `canonicalize_input` runs it on `WellFormed(term)` with an empty `ParamEnv`: the empty `ParamEnv` has
 *  no `NEEDS_CANONICAL` flags, so the rest canonicalizer is a fresh `Input(Predicate)` one, and the predicate fold
 *  reaches `fold_ty(term)` through the binder (`fold_binder` is the provided one, no shifting). */
function canonicalize_input_term(delegate: SolverDelegate, term: Ty): [UniverseIndex, GenericArg[], Ty, string] {
  const c = Canonicalizer.new(delegate, { $: "Input", _0: "Predicate" });
  const folded = fold_Ty.fold_with(term, c);
  const [max_universe, variables, var_kinds] = c.finalize();
  return [max_universe, variables, folded, debug_RawList(var_kinds, PLAIN, debug_CanonicalVarKind)];
}

describe("Canonicalizer vs the oracle probe", () => {
  const oracle = fixture();

  for (const [label, max, build] of response_cases) {
    test(
      `response ${label}`,
      sg(() => {
        const { tcx, delegate, v } = setup();
        const [var_values, data] = build(tcx, v);
        const expected = oracle.get(`response ${label}`);
        expect(expected).toBeDefined();
        let got: string;
        try {
          got = debug_canonical_state(make_canonical_state(delegate, var_values, max, data, fold_Ty));
        } catch (e) {
          if (!(e instanceof Panic)) throw e;
          got = `panic: ${e.message}`;
        }
        expect(got).toBe(expected![0]!);
      }),
    );
  }

  for (const [label, build] of input_cases) {
    test(
      `input ${label}`,
      sg(() => {
        const { tcx, delegate, v } = setup();
        const [max_universe, variables, term, var_kinds] = canonicalize_input_term(delegate, build(tcx, v));
        const expected = oracle.get(`input ${label}`)!;
        expect(`max_universe: ${debug_UniverseIndex(max_universe, PLAIN)}`).toBe(expected[0]!);
        expect(`var_kinds: ${var_kinds}`).toBe(expected[1]!);
        expect(`term: Term::Ty(${debug_Ty(term, PLAIN)})`).toBe(expected[2]!);
        const orig = expected.find((l) => l.startsWith("orig_values: "));
        if (orig !== undefined) {
          expect(`orig_values: [${variables.map((a) => debug_GenericArg(a, PLAIN)).join(", ")}]`).toBe(orig);
        }
      }),
    );
  }
});

describe("canonical/mod.rs (upstream semantics)", () => {
  test(
    "canonicalize_input stops UNPORTED at the ParamEnv traversal (rustc_middle derive, not ported)",
    sg(() => {
      const { delegate, v } = setup();
      const input = { goal: { param_env: {} as never, predicate: v.t0 }, predefined_opaques_in_body: [] as never };
      expect(() => Canonicalizer.canonicalize_input(delegate, input, fold_Ty)).toThrow(Unported);
    }),
  );

  test(
    "round trip: canonicalize input, then instantiate with the original values",
    sg(() => {
      const { tcx, delegate, v } = setup();
      for (const [, build] of input_cases) {
        const value = build(tcx, v);
        const [, variables, canonical] = canonicalize_input_term(delegate, value);
        expect(fold_Ty.fold_with(canonical, new Instantiator(tcx, variables))).toBe(value);
      }
    }),
  );

  test(
    "response_no_constraints_raw: the identity response",
    sg(() => {
      const { tcx, delegate, v } = setup();
      const c = Canonicalizer.new(delegate, { $: "Input", _0: "Predicate" });
      fold_Ty.fold_with(input_cases[0]![1](tcx, v), c);
      const [max_universe, , var_kinds] = c.finalize();
      const r = response_no_constraints_raw(tcx, max_universe, var_kinds, { $: "Yes" } as never);
      expect(r.var_kinds).toBe(var_kinds);
      expect(r.value.var_values.map((a) => debug_GenericArg(a, PLAIN)).join(", ")).toBe(
        "^c_0, '^c_1, ^c_2, ^c_3, ^c_4, ^c_5, ^c_BoundConst { var: 6, .. }, '^c_7, ^c_8, '^c_9, '^c_10, '^c_11, '^c_12",
      );
    }),
  );

  test(
    "instantiate_and_apply_query_response on the identity response unifies the fresh vars with the inputs",
    sg(() => {
      const { tcx, log, delegate, v } = setup();
      const value = Ty.new_tup(tcx, [v.t0, ref(tcx, v.r0, v.ph_t), v.i0, arr(tcx, v.c0)]);
      const [max_universe, variables, , ] = canonicalize_input_term(delegate, value);
      const c = Canonicalizer.new(delegate, { $: "Input", _0: "Predicate" });
      fold_Ty.fold_with(value, c);
      const [, , var_kinds] = c.finalize();
      const response = response_no_constraints_raw(tcx, max_universe, var_kinds, { $: "Yes" } as never);
      const [goals, certainty] = instantiate_and_apply_query_response(delegate, variables, response, undefined as never);
      expect(debug_NestedNormalizationGoals(goals, PLAIN)).toBe("NestedNormalizationGoals([])");
      expect(certainty).toEqual({ $: "Yes" } as never);
      // Only `CanonicalVarKind::Ty` takes a fresh var (the instantiation guess is disabled for type inference vars);
      // `ResponseRelating` then unifies it with the original. Every other kind (the `Int`, the region, the
      // placeholder, the const) takes its original value directly, and relating `a == b` returns early, except for
      // regions, which `ResponseRelating::regions` always equates.
      expect(log.calls).toEqual([
        "instantiate_canonical_var(Ty { ui: U0, sub_root: 0 }, U2)",
        "equate_ty_vids_raw(?0t, ?100t)",
        "equate_regions('?0, '?0)",
      ]);
    }),
  );
});

describe("placeholder.rs (upstream semantics)", () => {
  test(
    "BoundVarReplacer / PlaceholderReplacer round trip; universes are created lazily",
    sg(() => {
      const { tcx, log, infcx } = setup();
      const bt = { var: 0 as BoundVar, kind: { $: "Anon" } } as never;
      const br = { var: 1 as BoundVar, kind: { $: "Anon" } } as never;
      const bound_ty = Ty.new_bound(tcx, INNERMOST, bt);
      const bound_re = Region.new_bound(tcx, INNERMOST, br);
      const value = Ty.new_tup(tcx, [bound_ty, ref(tcx, bound_re, tcx.types.u8)]);
      const universes: (UniverseIndex | undefined)[] = [undefined];
      const [replaced, regions, types, consts] = BoundVarReplacer.replace_bound_vars(infcx, universes, value, fold_Ty);
      expect(universes).toEqual([U(3)]);
      expect(log.universe).toBe(U(3));
      expect(debug_Ty(replaced, PLAIN)).toBe("(!3_0, &'!3_1 u8)");
      expect(types.size).toBe(1);
      expect(regions.size).toBe(1);
      expect(consts.size).toBe(0);
      const back = PlaceholderReplacer.replace_placeholders(infcx, regions, types, consts, universes, replaced, fold_Ty);
      expect(back).toBe(value);
    }),
  );

  test(
    "BoundVarReplacer panics on bound vars outside `universe_indices`",
    sg(() => {
      const { tcx, infcx } = setup();
      const bound_ty = Ty.new_bound(tcx, 1 as never, { var: 0 as BoundVar, kind: { $: "Anon" } } as never);
      expect(() => BoundVarReplacer.replace_bound_vars(infcx, [undefined], bound_ty, fold_Ty)).toThrow(
        "Bound vars ^1_0 outside of `self.universe_indices`: [\n    None,\n]",
      );
    }),
  );
});

describe("coherence.rs (upstream semantics)", () => {
  const local_trait = new DefId(DefIndex.from_u32(7), LOCAL_CRATE);
  const orphan_err = <E>(r: Result<Result<undefined, OrphanCheckErr<Ty>>, E>): OrphanCheckErr<Ty> => {
    if (r.$ !== "Ok" || r._0.$ !== "Err") throw new Error("expected Ok(Err(..))");
    return r._0._0;
  };

  test("IsFirstInputType::from", () => {
    expect(IsFirstInputType.from(true)).toBe("Yes");
    expect(IsFirstInputType.from(false)).toBe("No");
  });

  test(
    "orphan_check_trait_ref: Remote finds the infer var, Local reports it as uncovered",
    sg(() => {
      const { tcx, infcx, v } = setup();
      const trait_ref = { def_id: local_trait, args: tcx.mk_args([tcx.types.u8, v.t0]), _use_trait_ref_new_instead: null } as never;
      const norm = (t: Ty) => Ok(t);
      expect(orphan_check_trait_ref(infcx, trait_ref, { $: "Remote" }, norm)).toEqual(Ok(Ok(undefined)));
      const local = orphan_check_trait_ref(infcx, trait_ref, { $: "Local", mode: OrphanCheckMode.Proper }, norm);
      expect(debug_OrphanCheckErr(orphan_err(local), PLAIN, debug_Ty)).toBe("UncoveredTyParams(UncoveredTyParams { uncovered: ?0t, local_ty: None })");

      const concrete = { def_id: local_trait, args: tcx.mk_args([tcx.types.u8, tcx.types.i32]), _use_trait_ref_new_instead: null } as never;
      const r = orphan_check_trait_ref(infcx, concrete, { $: "Remote" }, norm);
      expect(debug_OrphanCheckErr(orphan_err(r), PLAIN, debug_Ty)).toBe("NonLocalInputType([(u8, Yes), (i32, No)])");
      // A normalization failure is returned as is.
      expect(orphan_check_trait_ref(infcx, concrete, { $: "Remote" }, () => Err("boom"))).toEqual(Err("boom"));
    }),
  );

  test(
    "trait_ref_is_knowable",
    sg(() => {
      const { tcx, infcx, v } = setup();
      const norm = (t: Ty) => Ok(t);
      const with_var = { def_id: local_trait, args: tcx.mk_args([tcx.types.u8, v.t0]), _use_trait_ref_new_instead: null } as never;
      expect(trait_ref_is_knowable(infcx, with_var, norm)).toEqual(Ok(Err("Downstream")) as never);
      const concrete = { def_id: local_trait, args: tcx.mk_args([tcx.types.u8]), _use_trait_ref_new_instead: null } as never;
      expect(trait_ref_is_knowable(infcx, concrete, norm)).toEqual(Ok(Ok(undefined)) as never);
    }),
  );
});

describe("normalize.rs (upstream semantics)", () => {
  test(
    "NormalizationFolder leaves alias-free types alone and never calls `normalize`",
    sg(() => {
      const { tcx, infcx, v } = setup();
      const folder = NormalizationFolder.new(infcx, [], () => {
        throw new Error("normalize called");
      });
      const t = Ty.new_tup(tcx, [v.t0, ref(tcx, v.r0, tcx.types.u8)]);
      expect(fold_Ty.try_fold_with(t, folder)).toEqual(Ok(t));
    }),
  );
});

describe("solve/inspect/build.rs (upstream semantics)", () => {
  test(
    "a proof tree: root evaluation with one nested probe",
    sg(() => {
      const { tcx, delegate, v } = setup();
      const builder = ProofTreeBuilder.new();
      expect(builder.is_noop()).toBe(false);
      const step = builder.new_evaluation_step(tcx.mk_args([v.t0]));
      const probe = step.take_and_enter_probe();
      expect(step.is_noop()).toBe(true);
      probe.add_var_value(v.t1);
      probe.probe_kind({ $: "TraitCandidate", source: { $: "BuiltinImpl", _0: { $: "Misc" } }, result: Err({}) } as never);
      probe.make_canonical_response({ $: "Yes" } as never);
      probe.probe_final_state(delegate, U(0));
      const back = probe.finish_probe();
      expect(back.state!.var_values).toEqual([v.t0]);
      back.query_result(Err({}) as never);
      back.probe_final_state(delegate, U(0));
      builder.finish_evaluation_step(back);
      const tree = builder.unwrap();
      expect(tree.kind.$).toBe("Root");
      expect(tree.steps.length).toBe(1);
      const nested = tree.steps[0]!;
      expect(nested.$).toBe("NestedProbe");
      const inner = (nested as { _0: { steps: { $: string }[]; final_state: { value: State<null> } } })._0;
      expect(inner.steps.map((s) => s.$)).toEqual(["MakeCanonicalResponse"]);
      // The nested probe's final state saw the extra var value `?1t` (U2 -> U2 in the response, max input U0).
      expect(debug_State(inner.final_state.value, PLAIN, () => "()")).toBe("State { var_values: [^c_0, ^c_1], data: () }");
    }),
  );

  test(
    "noop builders record nothing; probe_kind twice is an assert_eq failure",
    sg(() => {
      const { tcx, v } = setup();
      const noop = ProofTreeBuilder.new_noop();
      const step = noop.new_evaluation_step(tcx.mk_args([v.t0]));
      expect(step.is_noop()).toBe(true);
      step.add_var_value(v.t1);
      step.query_result(Err({}) as never);
      expect(step.finish_probe()).toBe(step);

      const b = ProofTreeBuilder.new();
      const s = b.new_evaluation_step(tcx.mk_args([]));
      const p = s.take_and_enter_probe();
      p.probe_kind({ $: "ShadowedEnvProbing" } as never);
      expect(() => p.probe_kind({ $: "ShadowedEnvProbing" } as never)).toThrow(
        "assertion `left == right` failed\n  left: Some(ShadowedEnvProbing)\n right: None",
      );
      expect(() => s.finish_probe()).not.toThrow();
      const q = new (p.constructor as typeof p.constructor & (new (s: undefined) => typeof p))(undefined);
      expect(q.is_noop()).toBe(true);
    }),
  );
});
