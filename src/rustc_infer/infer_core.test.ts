// Tests of lane infer-core: rustc_infer infer/mod.rs (the `impl InferCtxt` methods), at.rs, resolve.rs and freshen.rs on a
// real `InferCtxt` (`tcx.infer_ctxt().build(..)` over fresh interners).
//
// Oracle: infer_core_oracle/probe.rs is a rustc-dev program that runs one script on rustc's own `InferCtxt`: create
// type / int / float / const variables, unify them with the raw `InferCtxtLike` ops, resolve them (shallow, deep, numeric
// literal default, via the region graph), freshen, `probe` (snapshot rollback), `fork`, `instantiate_binder_with_fresh_vars`.
// The fixture infer_core_oracle/infer_core.stdout is its output (`REGEN=1` rebuilds the probe and rewrites it);
// `oracle_dump` below runs the same script on the port.
//
// The raw `InferCtxtLike` ops (infer/context.rs) and `InferCtxt::probe` (infer/snapshot/mod.rs) are the real ports.
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "./lib.ts";
import { PIN } from "../../scripts/lib/common.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import { ParamEnv, debug_Term, debug_Ty, Term, Ty } from "../rustc_middle/ty/mod.ts";
import { ParamConst } from "../rustc_middle/ty/sty.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { DefId, DefIndex, debug_LocalDefId, LOCAL_CRATE, LocalDefId } from "../rustc_span/def_id.ts";
import { Limit } from "../rustc_structures/limit.ts";
import * as tls from "../rustc_middle/ty/context/tls.ts";
import { create_default_session_globals_then, DUMMY_SP, type ErrorGuaranteed } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { Binder } from "../rustc_type_ir/binder.ts";
import type { BoundVar, ConstVid, FloatVid, IntVid, TyVid, UniverseIndex as UniverseIndexT } from "../rustc_type_ir/decls.ts";
import { TypingMode } from "../rustc_type_ir/infer_ctxt.ts";
import { debug_UniverseIndex, INNERMOST, UniverseIndex } from "../rustc_type_ir/lib.ts";
import type { TyOrConstInferVar } from "../rustc_type_ir/solve/mod.ts";
import { Const, debug_Const } from "../rustc_type_ir/sty/consts.ts";
import { debug_FloatVid, debug_IntVid, debug_TyVid } from "../rustc_type_ir/ty_kind.ts";
import { debug_ConstVid } from "../rustc_type_ir/const_kind.ts";
import { type Debug, debug_option, debug_vec, PLAIN } from "../std/fmt.ts";
import { Panic } from "../std/panic.ts";
import type { Result } from "../std/result.ts";
import type { InferCtxt } from "./decls.ts";
import { ToTrace_GenericArg, ToTrace_Region, ToTrace_Ty } from "./infer/at.ts";
import { TypeFreshener } from "./infer/freshen.ts";
import { BoundRegionConversionTime, debug_FixupError, display_FixupError, RegionVariableOrigin, SubregionOrigin, TypeTrace, ValuePairs } from "./infer/mod.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";

const DIR = join(import.meta.dir, "infer_core_oracle");
const FIXTURE = join(DIR, "infer_core.stdout");
const REGEN = process.env.REGEN === "1";

if (REGEN) {
  const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
  const s = oracleSysroot();
  const out = join(tmpdir(), "rust-ts-infer-core-probe");
  mkdirSync(out, { recursive: true });
  const exe = join(out, "probe");
  const run = (cmd: string[]) => Bun.spawnSync(cmd, { cwd: DIR, env: { ...process.env, RUSTC_ICE: "0" }, stdout: "pipe", stderr: "pipe" });
  const b = run(["rustc", `+${PIN.toolchain}`, "--edition", "2024", join(DIR, "probe.rs"), "-o", exe, "-C", `link-arg=-Wl,-rpath,${s}/lib`]);
  if (b.exitCode !== 0) throw new Error(`ERROR: probe build failed: ${b.stderr.toString().split("\n")[0]}`);
  const r = run([exe, "--edition=2021", "--crate-type", "lib", "--sysroot", s, "empty.rs"]);
  if (r.exitCode !== 0) throw new Error(`ERROR: probe exit ${r.exitCode}`);
  writeFileSync(FIXTURE, r.stdout.toString());
}

/** A `TyCtxt` over fresh interners (as contract.test.ts / sty.test.ts), with the solver choice and printing session fixed. */
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
      opts: { trimmed_def_paths: false, unstable_opts: { trim_diagnostic_paths: true } },
      verbose_internals: () => false,
    },
  };
  const tcx = new TyCtxt(gcx as unknown as GlobalCtxt);
  // PORT(test): `next_trait_solver_globally` reads the session; the test has none (the oracle's default is `Globally`).
  (tcx as unknown as { next_trait_solver_globally: () => boolean }).next_trait_solver_globally = () => true;
  // PORT(test): `FmtPrinter::new` (Display of `Ty`) reads the `limits` query; the test has no query system. The default
  // `type_length_limit` is 1048576 (rustc_middle middle/limits.rs); the script's types are far below it.
  (tcx as unknown as { type_length_limit: () => Limit }).type_length_limit = () => Limit.new(1048576);
  return tcx;
}

/** Session globals plus the `ImplicitCtxt` of `tcx` (`ty::tls::with`: Display of `Ty` reads it). */
const sg = (f: (tcx: TyCtxt) => void) => () =>
  create_default_session_globals_then(() => {
    const tcx = mk_tcx();
    tls.enter_context(new tls.ImplicitCtxt(tcx, undefined, 0), () => f(tcx));
  });

const d = (ty: Ty): string => debug_Ty(ty, PLAIN);
const dc = (ct: Const): string => debug_Const(ct, PLAIN);
function res<T, E>(r: Result<T, E>, dt: Debug<T>, de: Debug<E>): string {
  return r.$ === "Ok" ? `Ok(${dt(r._0, PLAIN)})` : `Err(${de(r._0, PLAIN)})`;
}
function tv(ty: Ty): TyVid {
  return ty.ty_vid()!;
}
function iv(ty: Ty): IntVid {
  const k = ty.kind();
  if (k.$ === "Infer" && k._0.$ === "IntVar") return k._0._0;
  throw new Error("not an int var");
}
function fv(ty: Ty): FloatVid {
  const k = ty.kind();
  if (k.$ === "Infer" && k._0.$ === "FloatVar") return k._0._0;
  throw new Error("not a float var");
}
function cv(ct: Const): ConstVid {
  const k = ct.kind();
  if (k.$ === "Infer" && k._0.$ === "Var") return k._0._0;
  throw new Error("not a const var");
}
function unresolved(infcx: InferCtxt): string {
  const [t, i, f] = infcx.unresolved_root_variables();
  return `(${debug_vec(t, PLAIN, debug_TyVid)}, ${debug_vec(i, PLAIN, debug_IntVid)}, ${debug_vec(f, PLAIN, debug_FloatVid)})`;
}

// The raw `InferCtxtLike` ops of infer/context.rs, and `InferCtxt::probe` (snapshot/mod.rs:101).
const raw = {
  equate_ty_vids(infcx: InferCtxt, a: TyVid, b: TyVid): void {
    infcx.equate_ty_vids_raw(a, b);
  },
  instantiate_ty_var(infcx: InferCtxt, vid: TyVid, ty: Ty): void {
    infcx.instantiate_ty_var_raw(vid, ty);
  },
  equate_int_vids(infcx: InferCtxt, a: IntVid, b: IntVid): void {
    infcx.equate_int_vids_raw(a, b);
  },
  equate_float_vids(infcx: InferCtxt, a: FloatVid, b: FloatVid): void {
    infcx.equate_float_vids_raw(a, b);
  },
  equate_const_vids(infcx: InferCtxt, a: ConstVid, b: ConstVid): void {
    infcx.equate_const_vids_raw(a, b);
  },
  instantiate_const_var(infcx: InferCtxt, vid: ConstVid, value: Const): void {
    infcx.instantiate_const_var_raw(vid, value);
  },
  probe<R>(infcx: InferCtxt, f: () => R): R {
    return infcx.probe(() => f());
  },
};

/**
 * `{:?}` of the two `TypingMode`s the script prints. PORT(test): the generated `debug_TypingMode` stops at the Debug of
 * `LocalDefIds` (`unported_debug`); the lists here are empty.
 */
function debug_mode(m: TypingMode): string {
  switch (m.$) {
    case "Coherence":
      return "Coherence";
    case "Typeck":
      return `Typeck { defining_opaque_types_and_generators: ${debug_vec(m.defining_opaque_types_and_generators, PLAIN, debug_LocalDefId)} }`;
    default:
      throw new Error(`ERROR: unexpected typing mode ${m.$}`);
  }
}

/** The resolution steps of the script on one value (probe.rs `resolve_all`). */
function resolve_all(infcx: InferCtxt, n: number, value: Ty): string {
  let out = "";
  out += `freshen${n}: ${d(fold_Ty.fold_with(value, TypeFreshener.new(infcx)))}\n`;
  out += `deep${n}: ${d(infcx.deeply_resolve_ignoring_regions(value, fold_Ty))}\n`;
  out += `unification_table${n}: ${d(infcx.deeply_resolve_via_unification_table(value, fold_Ty))}\n`;
  out += `literals${n}: ${d(infcx.resolve_numeric_literals_with_default(value, fold_Ty))}\n`;
  const r = infcx.deeply_resolve_via_region_graph(value, fold_Ty);
  if (r.$ === "Ok") out += `region_graph${n}: Ok(${d(r._0)})\n`;
  else out += `region_graph${n}: Err(${debug_FixupError(r._0, PLAIN)}) ${display_FixupError(r._0)}\n`;
  out += `ty_to_string${n}: ${infcx.ty_to_string(value)}\n`;
  return out;
}

/** probe.rs `after_expansion`, on the port. */
function oracle_dump(tcx: TyCtxt): string {
  let out = "";
  const t = tcx.types;
  const sp = DUMMY_SP;
  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  const U = (u: UniverseIndexT): string => debug_UniverseIndex(u, PLAIN);

  // == variables
  const t0 = infcx.next_ty_var(sp);
  const t1 = infcx.next_ty_var(sp);
  const t2 = infcx.next_ty_var(sp);
  const u1 = infcx.create_next_universe();
  const t3 = infcx.next_ty_var_in_universe(sp, UniverseIndex.ROOT);
  const t4 = infcx.next_ty_var(sp);
  const i0 = infcx.next_int_var();
  const i1 = infcx.next_int_var();
  const i2 = infcx.next_int_var();
  const f0 = infcx.next_float_var(sp, undefined);
  const f1 = infcx.next_float_var(sp, undefined);
  const c0 = infcx.next_const_var(sp);
  const c1 = infcx.next_const_var_in_universe(sp, UniverseIndex.ROOT);
  out += `vars: ${[t0, t1, t2, t3, t4, i0, i1, i2, f0, f1].map(d).join(" ")} ${dc(c0)} ${dc(c1)}\n`;
  out += `universe: ${U(u1)} ${U(infcx.universe())} num_ty_vars: ${infcx.num_ty_vars()}\n`;
  for (const [l, ty] of [["t0", t0], ["t1", t1], ["t2", t2], ["t3", t3], ["t4", t4]] as const) {
    out += `try_resolve_ty_var ${l}: ${res(infcx.try_resolve_ty_var(tv(ty)), debug_Ty, debug_UniverseIndex)}\n`;
  }
  out += `try_resolve_const_var c0: ${res(infcx.try_resolve_const_var(cv(c0)), debug_Const, debug_UniverseIndex)}\n`;
  out += `try_resolve_const_var c1: ${res(infcx.try_resolve_const_var(cv(c1)), debug_Const, debug_UniverseIndex)}\n`;
  out += `unresolved: ${unresolved(infcx)}\n`;

  // == unification
  raw.equate_ty_vids(infcx, tv(t2), tv(t1));
  raw.equate_ty_vids(infcx, tv(t4), tv(t3));
  infcx.sub_unify_ty_vids_raw(tv(t0), tv(t3));
  raw.equate_int_vids(infcx, iv(i1), iv(i2));
  raw.equate_float_vids(infcx, fv(f1), fv(f0));
  raw.equate_const_vids(infcx, cv(c1), cv(c0));
  out += `root_var t2: ${debug_TyVid(infcx.root_var(tv(t2)), PLAIN)} t4: ${debug_TyVid(infcx.root_var(tv(t4)), PLAIN)}\n`;
  out += `root_vid t2: ${debug_option(infcx.root_vid(t2), PLAIN, debug_TyVid)} i0: ${debug_option(infcx.root_vid(i0), PLAIN, debug_TyVid)}\n`;
  out += `shallow t1: ${d(infcx.shallow_resolve(t1))} t2: ${d(infcx.shallow_resolve(t2))} t4: ${d(infcx.shallow_resolve(t4))}\n`;
  out += `shallow_ty_var t2: ${d(infcx.shallow_resolve_ty_var(tv(t2)))}\n`;
  out += `shallow_or_root t2: ${res(infcx.shallow_resolve_ty_var_or_get_root(tv(t2)), debug_Ty, debug_TyVid)}\n`;
  out += `try_resolve_ty_var t4: ${res(infcx.try_resolve_ty_var(tv(t4)), debug_Ty, debug_UniverseIndex)}\n`;
  out += `sub_root t0: ${debug_TyVid(infcx.sub_unification_table_root_var(tv(t0)), PLAIN)} t3: ${debug_TyVid(infcx.sub_unification_table_root_var(tv(t3)), PLAIN)} t4: ${debug_TyVid(infcx.sub_unification_table_root_var(tv(t4)), PLAIN)}\n`;
  out += `shallow i1: ${d(infcx.shallow_resolve(i1))} i2: ${d(infcx.shallow_resolve(i2))} int_var i2: ${d(infcx.shallow_resolve_int_var(iv(i2)))}\n`;
  out += `root_float f1: ${debug_FloatVid(infcx.root_float_var(fv(f1)), PLAIN)} shallow f0: ${d(infcx.shallow_resolve(f0))} float_var f0: ${d(infcx.shallow_resolve_float_var(fv(f0)))}\n`;
  out += `root_const c0: ${debug_ConstVid(infcx.root_const_var(cv(c0)), PLAIN)} shallow c0: ${dc(infcx.shallow_resolve_const(c0))} const_var c0: ${dc(infcx.shallow_resolve_const_var(cv(c0)))}\n`;
  out += `shallow_term t2: ${debug_Term(infcx.shallow_resolve_term(Term.from_Ty(t2)), PLAIN)} c0: ${debug_Term(infcx.shallow_resolve_term(Term.from_Const(c0)), PLAIN)}\n`;
  out += `unresolved: ${unresolved(infcx)}\n`;

  const re_static = tcx.lifetimes.re_static;
  const tup = Ty.new_tup(tcx, [t0, t1, t2, t0, i0, i2, f0, f1, Ty.new_imm_ref(tcx, re_static, t2), Ty.new_array_with_const_len(tcx, t.u8, c0), t3]);
  out += resolve_all(infcx, 1, tup);

  // == instantiation
  raw.instantiate_ty_var(infcx, tv(t1), Ty.new_tup(tcx, [t.u8, i0]));
  raw.instantiate_ty_var(infcx, tv(t3), t.bool);
  infcx.instantiate_int_var_raw(iv(i2), { $: "UintType", _0: "U16" });
  infcx.instantiate_float_var_raw(fv(f0), { $: "Known", _0: "F32" });
  raw.instantiate_const_var(infcx, cv(c1), Const.new_param(tcx, ParamConst.new(0, Symbol.intern("N"))));
  out += `shallow t2: ${d(infcx.shallow_resolve(t2))} t4: ${d(infcx.shallow_resolve(t4))} i1: ${d(infcx.shallow_resolve(i1))} f1: ${d(infcx.shallow_resolve(f1))}\n`;
  out += `shallow c0: ${dc(infcx.shallow_resolve_const(c0))} try c0: ${res(infcx.try_resolve_const_var(cv(c0)), debug_Const, debug_UniverseIndex)}\n`;
  out += `root_vid t2: ${debug_option(infcx.root_vid(t2), PLAIN, debug_TyVid)} t0: ${debug_option(infcx.root_vid(t0), PLAIN, debug_TyVid)}\n`;
  out += `unresolved: ${unresolved(infcx)}\n`;
  out += resolve_all(infcx, 2, tup);
  out += resolve_all(infcx, 3, Ty.new_tup(tcx, [t2, i1, f1, Ty.new_array_with_const_len(tcx, t.u8, c0)]));
  out += resolve_all(infcx, 4, Ty.new_tup(tcx, [i1, f1, Ty.new_array_with_const_len(tcx, t.u8, c0)]));
  const changed = (v: TyOrConstInferVar): boolean => infcx.ty_or_const_infer_var_changed(v);
  out += `changed: t0 ${changed({ $: "Ty", _0: tv(t0) })} t1 ${changed({ $: "Ty", _0: tv(t1) })} t2 ${changed({ $: "Ty", _0: tv(t2) })} i0 ${changed({ $: "TyInt", _0: iv(i0) })} i1 ${changed({ $: "TyInt", _0: iv(i1) })} i2 ${changed({ $: "TyInt", _0: iv(i2) })} f0 ${changed({ $: "TyFloat", _0: fv(f0) })} f1 ${changed({ $: "TyFloat", _0: fv(f1) })} c0 ${changed({ $: "Const", _0: cv(c0) })} c1 ${changed({ $: "Const", _0: cv(c1) })}\n`;
  {
    const unchanged = infcx.is_ty_infer_var_definitely_unchanged();
    out += `unchanged: t0 ${unchanged({ $: "Ty", _0: tv(t0) })} t1 ${unchanged({ $: "Ty", _0: tv(t1) })} t2 ${unchanged({ $: "Ty", _0: tv(t2) })} i0 ${unchanged({ $: "TyInt", _0: iv(i0) })}\n`;
  }

  // == probe (snapshot rollback)
  const r = raw.probe(infcx, () => {
    const t5 = infcx.next_ty_var(sp);
    const u2 = infcx.create_next_universe();
    raw.instantiate_ty_var(infcx, tv(t0), t.char);
    infcx.instantiate_int_var_raw(iv(i0), { $: "IntType", _0: "I8" });
    raw.equate_ty_vids(infcx, tv(t5), tv(t0));
    return `${d(t5)} ${U(u2)} ${d(infcx.shallow_resolve(t0))} ${d(infcx.shallow_resolve(i0))} ${d(infcx.deeply_resolve_ignoring_regions(tup, fold_Ty))} ${infcx.num_ty_vars()} ${unresolved(infcx)}`;
  });
  out += `in probe: ${r}\n`;
  out += `after probe: ${d(infcx.shallow_resolve(t0))} ${d(infcx.shallow_resolve(i0))} ${infcx.num_ty_vars()} ${U(infcx.universe())} ${unresolved(infcx)}\n`;

  // == fork
  const forked = infcx.fork();
  raw.instantiate_ty_var(forked, tv(t0), t.str_);
  const t6 = forked.next_ty_var(sp);
  out += `fork: ${d(t6)} ${d(forked.shallow_resolve(t0))} ${forked.num_ty_vars()} | ${d(infcx.shallow_resolve(t0))} ${infcx.num_ty_vars()}\n`;
  out += `fork deep: ${d(forked.deeply_resolve_ignoring_regions(tup, fold_Ty))}\n`;
  const forked2 = infcx.fork_with_typing_mode(TypingMode.Coherence);
  out += `fork_with_typing_mode: ${debug_mode(forked2.typing_mode_raw())} ${d(forked2.shallow_resolve(t2))}\n`;

  // == instantiate_binder_with_fresh_vars
  const bound_vars = tcx.mk_bound_variable_kinds([{ $: "Ty", _0: { $: "Anon" } }, { $: "Const" }]);
  const value = Ty.new_tup(tcx, [
    Ty.new_bound(tcx, INNERMOST, { var: 0 as BoundVar, kind: { $: "Anon" } }),
    Ty.new_array_with_const_len(tcx, t.u8, Const.new_bound(tcx, INNERMOST, { var: 1 as BoundVar, _tcx: undefined })),
    t2,
  ]);
  const binder = Binder.bind_with_vars(value, bound_vars);
  const inst = infcx.instantiate_binder_with_fresh_vars(sp, BoundRegionConversionTime.FnCall, binder, fold_Ty);
  out += `instantiated: ${d(inst)} ${infcx.num_ty_vars()}\n`;
  const dummy = Binder.dummy(Ty.new_tup(tcx, [t.u8, t2]), fold_Ty);
  out += `instantiated dummy: ${d(infcx.instantiate_binder_with_fresh_vars(sp, BoundRegionConversionTime.FnCall, dummy, fold_Ty))}\n`;

  // == typing_env / tainted
  out += `typing_env: ${debug_mode(infcx.typing_env(ParamEnv.empty()).typing_mode())}\n`;
  out += `tainted: ${debug_option(infcx.tainted_by_errors(), PLAIN, () => "ErrorGuaranteed")} next_trait_solver: ${infcx.next_trait_solver()}\n`;
  return out;
}

test(
  "infer_core_oracle: variables, unification, resolution, freshening, probe and fork agree with rustc's InferCtxt",
  sg((tcx) => {
    const want = readFileSync(FIXTURE, "utf8").split("\n");
    const got = oracle_dump(tcx).split("\n");
    for (let i = 0; i < Math.max(want.length, got.length); i++) {
      // first difference (line number in the fixture)
      if (got[i] !== want[i]) expect(`${i + 1}: ${got[i]}`).toBe(`${i + 1}: ${want[i]}`);
    }
  }),
);

describe("InferCtxt (infer/mod.rs)", () => {
  test(
    "type variables: universes, origins, num_ty_vars",
    sg((tcx) => {
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const a = infcx.next_ty_vid(DUMMY_SP);
      const origin = { span: DUMMY_SP, param_def_id: new DefId(DefIndex.from_u32(7), LOCAL_CRATE) };
      const b = infcx.next_ty_vid_with_origin(origin);
      expect([a, b]).toEqual([0, 1] as TyVid[]);
      expect(infcx.type_var_origin(b)).toBe(origin);
      const u = infcx.create_next_universe();
      const c = infcx.next_ty_vid(DUMMY_SP);
      const e = infcx.next_ty_vid_in_universe(DUMMY_SP, UniverseIndex.ROOT);
      expect(infcx.try_resolve_ty_var(c)).toEqual({ $: "Err", _0: u });
      expect(infcx.try_resolve_ty_var(e)).toEqual({ $: "Err", _0: UniverseIndex.ROOT });
      expect(infcx.num_ty_vars()).toBe(4);
      // `with_disabled_next_solver_overflow_fcw` restores the flag.
      expect(infcx.with_disabled_next_solver_overflow_fcw(() => infcx.enable_next_solver_overflow_fcw_)).toBe(false);
      expect(infcx.enable_next_solver_overflow_fcw_).toBe(true);
    }),
  );

  test(
    "float variables record their origin; const variables keep theirs until known",
    sg((tcx) => {
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const f = infcx.next_float_var(DUMMY_SP, undefined);
      expect(infcx.float_var_origin(fv(f))).toEqual({ span: DUMMY_SP, lint_id: undefined });
      const c = infcx.next_const_var(DUMMY_SP);
      expect(infcx.const_var_origin(cv(c))).toEqual({ span: DUMMY_SP, param_def_id: undefined });
      raw.instantiate_const_var(infcx, cv(c), Const.new_param(tcx, ParamConst.new(0, Symbol.intern("N"))));
      expect(infcx.const_var_origin(cv(c))).toBeUndefined();
      expect(() => infcx.float_var_origin(5 as FloatVid)).toThrow(/index out of bounds: the len is 1 but the index is 5/);
    }),
  );

  test(
    "snapshot rollback undoes variables, unifications and the hir-typeck goal stack",
    sg((tcx) => {
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const a = infcx.next_ty_var(DUMMY_SP);
      const s = infcx.inner.undo_log.start_snapshot();
      const b = infcx.next_ty_var(DUMMY_SP);
      raw.equate_ty_vids(infcx, tv(b), tv(a));
      raw.instantiate_ty_var(infcx, tv(a), tcx.types.u32);
      const i = infcx.next_int_var();
      infcx.push_hir_typeck_potentially_region_dependent_goal({} as never);
      expect(infcx.shallow_resolve(b)).toBe(tcx.types.u32);
      expect(infcx.inner.hir_typeck_potentially_region_dependent_goals.length).toBe(1);
      infcx.inner.rollback_to(s);
      expect(infcx.num_ty_vars()).toBe(1);
      expect(infcx.shallow_resolve(a)).toBe(a);
      expect(infcx.inner.int_unification_storage.len()).toBe(0);
      expect(infcx.inner.hir_typeck_potentially_region_dependent_goals).toEqual([]);
      void i;
    }),
  );

  test(
    "freshening reuses fresh types per root, erases free regions, keeps bound/error regions",
    sg((tcx) => {
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const a = infcx.next_ty_var(DUMMY_SP);
      const b = infcx.next_ty_var(DUMMY_SP);
      raw.equate_ty_vids(infcx, tv(b), tv(a));
      const f = TypeFreshener.new(infcx);
      const ty = Ty.new_tup(tcx, [a, b, Ty.new_imm_ref(tcx, tcx.lifetimes.re_static, a)]);
      expect(d(fold_Ty.fold_with(ty, f))).toBe("(FreshTy(0), FreshTy(0), &'{erased} FreshTy(0))");
      // The same freshener keeps its map: a second fold reuses `FreshTy(0)`.
      expect(fold_Ty.fold_with(a, f)).toBe(Ty.new_fresh(tcx, 0));
      expect(f.ty_freshen_count).toBe(1);
      // A freshened type has no inference flags (`HAS_TY_FRESH` is not in `HAS_INFER`), so it folds to itself.
      expect(fold_Ty.fold_with(Ty.new_fresh(tcx, 3), f)).toBe(Ty.new_fresh(tcx, 3));
    }),
  );

  test(
    "closure_kind rejects non-closures; find_block_span of an empty block is the block",
    sg((tcx) => {
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      expect(() => infcx.closure_kind(tcx.types.u8)).toThrow(/unexpected type u8/);
      const blk = { stmts: [], expr: undefined, span: DUMMY_SP, innermost_block() { return this; } };
      expect(infcx.find_block_span(blk as never)).toBe(DUMMY_SP);
    }),
  );

  test(
    "deeply_resolve_ignoring_regions taints the infcx on error types",
    sg((tcx) => {
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const guar = { __brand: "ErrorGuaranteed" } as unknown as ErrorGuaranteed;
      const err = Ty.new_error(tcx, guar);
      expect(infcx.tainted_by_errors()).toBeUndefined();
      expect(infcx.deeply_resolve_ignoring_regions(err, fold_Ty)).toBe(err);
      expect(infcx.tainted_by_errors()).toBeDefined();
    }),
  );

  test(
    "the companions: ValuePairs::ty, SubregionOrigin::{span, from_obligation_cause}, RegionVariableOrigin::span, Display for FixupError",
    sg((tcx) => {
      const cause = ObligationCause.dummy();
      const trace = TypeTrace.types(cause, tcx.types.u8, tcx.types.bool);
      expect(ValuePairs.ty(trace.values)).toEqual([tcx.types.u8, tcx.types.bool]);
      expect(ValuePairs.ty(TypeTrace.consts(cause, Const.new_param(tcx, ParamConst.new(0, Symbol.intern("N"))), Const.new_param(tcx, ParamConst.new(1, Symbol.intern("M")))).values)).toBeUndefined();
      expect(trace.span()).toBe(DUMMY_SP);
      expect(SubregionOrigin.span({ $: "Subtype", _0: trace })).toBe(DUMMY_SP);
      const parent: SubregionOrigin = { $: "Reborrow", _0: DUMMY_SP };
      const local = LocalDefId.new(3);
      const did = new DefId(DefIndex.from_u32(4), LOCAL_CRATE);
      expect(SubregionOrigin.span({ $: "CheckAssociatedTypeBounds", parent, impl_item_def_id: local, trait_item_def_id: did })).toBe(DUMMY_SP);
      // A `Misc` cause falls back to the default origin.
      expect(SubregionOrigin.from_obligation_cause(cause, () => parent)).toBe(parent);
      expect(RegionVariableOrigin.span({ $: "UpvarRegion", _0: {} as never, _1: DUMMY_SP })).toBe(DUMMY_SP);
      expect(() => RegionVariableOrigin.span({ $: "Nll", _0: { $: "FreeRegion" } })).toThrow(/NLL variable used with `span`/);
      expect(display_FixupError({ unresolved: { $: "TyFloat", _0: 0 as FloatVid } })).toBe("cannot determine the type of this number; add a suffix to specify the type explicitly");
      expect(display_FixupError({ unresolved: { $: "Const", _0: 0 as ConstVid } })).toBe("unconstrained const value");
      // `to_constraint_category` (infer/mod.rs:483): a `Subtype` origin asks its cause (a `Misc` cause is
      // `BoringNoLocation`, rustc_middle traits/mod.rs:137), the two span-carrying arms keep their data, the rest is
      // `BoringNoLocation`.
      expect(SubregionOrigin.to_constraint_category(parent)).toEqual({ $: "BoringNoLocation" });
      expect(SubregionOrigin.to_constraint_category({ $: "Subtype", _0: trace })).toEqual({ $: "BoringNoLocation" });
      expect(SubregionOrigin.to_constraint_category({ $: "AscribeUserTypeProvePredicate", _0: DUMMY_SP, _1: did })).toEqual({ $: "Predicate", _0: DUMMY_SP, _1: did });
      expect(SubregionOrigin.to_constraint_category({ $: "SolverRegionConstraint", _0: DUMMY_SP })).toEqual({ $: "SolverRegionConstraint", _0: DUMMY_SP });
    }),
  );
});

describe("At / ToTrace (infer/at.rs)", () => {
  test(
    "the ToTrace impls build the upstream ValuePairs",
    sg((tcx) => {
      const cause = ObligationCause.dummy();
      const a = tcx.types.u8;
      const b = tcx.types.i8;
      expect(ToTrace_Ty.to_trace(cause, a, b).values).toEqual({ $: "Terms", _0: { expected: a, found: b } });
      const r = tcx.lifetimes.re_static;
      expect(ToTrace_Region.to_trace(cause, r, r).values).toEqual({ $: "Regions", _0: { expected: r, found: r } });
      expect(ToTrace_GenericArg.to_trace(cause, GenericArg.from_Ty(a), GenericArg.from_Ty(b)).values).toEqual({ $: "Terms", _0: { expected: a, found: b } });
      expect(() => ToTrace_GenericArg.to_trace(cause, GenericArg.from_Ty(a), GenericArg.from_Region(r))).toThrow(/relating different kinds: u8 'static/);
    }),
  );

  test(
    "at() captures its arguments; relate() routes by variance; goals_to_obligations is pending traits::Obligation",
    sg((tcx) => {
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const cause = ObligationCause.dummy();
      const at = infcx.at(cause, ParamEnv.empty());
      expect([at.infcx, at.cause]).toEqual([infcx, cause]);
      expect(() => at.relate("Yes", tcx.types.u8, "Bivariant", tcx.types.u8, ToTrace_Ty)).toThrow(/Bivariant given to `relate\(\)`/);
      // The next solver relates through `SolverRelating`: equal rigid types give no goals.
      const ok = at.eq("Yes", tcx.types.u8, tcx.types.u8, ToTrace_Ty);
      expect(ok.$ === "Ok" && ok._0.obligations).toEqual([]);
    }),
  );
});


