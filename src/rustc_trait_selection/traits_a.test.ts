// Tests of lane trait-sel-traits-a: `ObligationCtxt` (traits/engine.rs) on a real `InferCtxt` (`tcx.infer_ctxt().build(..)`
// over fresh interners, as rustc_infer infer_core.test.ts), `expand_trait_aliases` (traits/util.rs) on hand-built trait
// aliases, and the stops the ported code reaches until other lanes land.
//
// PORT(test): the fulfillment engines are other lanes' (`solve::FulfillmentCtxt`, lane trait-sel-solve; the old
// solver's `FulfillmentContext`, wave 20), so the `ObligationCtxt` tests build it over a recording `TraitEngine` (the
// `FulfillmentEngine::Next` variant): everything above the engine (eq/sub/sup/lub through `At`, `register_*`,
// `register_infer_ok_obligations`, the `TraitEngine` dispatch of `FulfillmentEngine`) is the real port.
import { describe, expect, test } from "bun:test";
import "./lib.ts";
import type { InferCtxt } from "../rustc_infer/decls.ts";
import { ToTrace_Ty } from "../rustc_infer/infer/at.ts";
import { type TraitEngine, TraitEngine_provided, TraitErrors } from "../rustc_infer/traits/engine.ts";
import type { PredicateObligation, PredicateObligations } from "../rustc_infer/traits/mod.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import * as tls from "../rustc_middle/ty/context/tls.ts";
import type { Clause } from "../rustc_middle/ty/decls.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { ParamEnv, Term, Ty } from "../rustc_middle/ty/mod.ts";
import { Clause_upcast_from_ProjectionClause, Clause_upcast_from_TraitRef } from "../rustc_middle/ty/predicate.ts";
import { DefId, DefIndex, LOCAL_CRATE } from "../rustc_span/def_id.ts";
import { create_default_session_globals_then, DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { kw } from "../rustc_span/symbol.ts";
import { Binder } from "../rustc_type_ir/binder.ts";
import { TypingMode } from "../rustc_type_ir/infer_ctxt.ts";
import { as_interner, TraitRef } from "../rustc_type_ir/predicate.ts";
import { AliasTerm } from "../rustc_type_ir/term_kind.ts";
import { Unported } from "../std/panic.ts";
import { FulfillmentEngine, ObligationCtxt } from "./traits/engine.ts";
import type { FulfillmentError } from "./traits/mod.gen.ts";
import { expand_trait_aliases } from "./traits/util.ts";
import { normalize_param_env_or_error } from "./traits/mod.ts";
import { FulfillmentErrorKinds_ScrubbedTraitError } from "./traits/engine.ts";
import type { ScrubbedTraitError } from "../rustc_infer/traits/engine.ts";
import { spyOn } from "bun:test";

/** A `TyCtxt` over fresh interners (as rustc_infer infer_core.test.ts). */
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
  // PORT(test): `next_trait_solver_globally` / `renormalize_rigid_aliases` read the session; the test has none (the
  // oracle's default is the next solver, without `-Zrenormalize-rigid-aliases`).
  (tcx as unknown as { next_trait_solver_globally: () => boolean }).next_trait_solver_globally = () => true;
  (tcx as unknown as { renormalize_rigid_aliases: () => boolean }).renormalize_rigid_aliases = () => false;
  return tcx;
}

const sg = (f: (tcx: TyCtxt) => void) => () =>
  create_default_session_globals_then(() => {
    const tcx = mk_tcx();
    tls.enter_context(new tls.ImplicitCtxt(tcx, undefined, 0), () => f(tcx));
  });

const def = (i: number): DefId => new DefId(DefIndex.from_u32(i), LOCAL_CRATE);
const sp = (lo: number): Span => Span.with_root_ctxt(lo as never, (lo + 1) as never);

/** A `TraitEngine` that records what is registered and answers `NoErrors` (or the queued errors). */
class Recorder<E> implements TraitEngine<E> {
  pending: PredicateObligation[] = [];
  registered: PredicateObligation[] = [];
  errors: E[] = [];
  register_predicate_obligation(_infcx: InferCtxt, obligation: PredicateObligation): void {
    this.registered.push(obligation);
    this.pending.push(obligation);
  }
  register_predicate_obligations(infcx: InferCtxt, obligations: PredicateObligations): void {
    TraitEngine_provided.register_predicate_obligations(this, infcx, obligations);
  }
  register_bound(infcx: InferCtxt, param_env: ParamEnv, ty: Ty, def_id: DefId, cause: ObligationCause): void {
    TraitEngine_provided.register_bound(this, infcx, param_env, ty, def_id, cause);
  }
  try_evaluate_obligations(_infcx: InferCtxt): TraitErrors<E> {
    const errors = this.errors;
    this.errors = [];
    if (errors.length > 0) this.pending = [];
    return TraitErrors.from_iter(errors);
  }
  collect_remaining_errors(_infcx: InferCtxt): TraitErrors<E> {
    return TraitErrors.from_iter([]);
  }
  evaluate_obligations_error_on_ambiguity(infcx: InferCtxt): TraitErrors<E> {
    return TraitEngine_provided.evaluate_obligations_error_on_ambiguity(this, infcx);
  }
  has_pending_obligations(): boolean {
    return this.pending.length > 0;
  }
  pending_obligations(): PredicateObligations {
    return [...this.pending];
  }
  pending_obligations_potentially_referencing_sub_root(infcx: InferCtxt, sub_root: import("../rustc_type_ir/decls.ts").TyVid): PredicateObligations {
    return TraitEngine_provided.pending_obligations_potentially_referencing_sub_root(this, infcx, sub_root);
  }
  pending_obligations_potentially_referencing_float_infer(infcx: InferCtxt): PredicateObligations {
    return TraitEngine_provided.pending_obligations_potentially_referencing_float_infer(this, infcx);
  }
  drain_stalled_obligations_for_coroutines(_infcx: InferCtxt): PredicateObligations {
    return [];
  }
}

function ocx_over(infcx: InferCtxt): [ObligationCtxt<ScrubbedTraitError>, Recorder<ScrubbedTraitError>] {
  const rec = new Recorder<ScrubbedTraitError>();
  return [new ObligationCtxt(infcx, new FulfillmentEngine<ScrubbedTraitError>("Next", rec), FulfillmentErrorKinds_ScrubbedTraitError), rec];
}

describe("ObligationCtxt on a real InferCtxt", () => {
  test(
    "eq unifies a type variable and registers nothing; a mismatch is a TypeError",
    sg((tcx) => {
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const [ocx, rec] = ocx_over(infcx);
      const v = infcx.next_ty_var(DUMMY_SP);
      const env = ParamEnv.empty();
      expect(ocx.eq(ObligationCause.dummy(), env, v, tcx.types.u8, ToTrace_Ty).$).toBe("Ok");
      expect(infcx.shallow_resolve(v)).toBe(tcx.types.u8);
      const r = ocx.eq(ObligationCause.dummy(), env, tcx.types.u8, tcx.types.u32, ToTrace_Ty);
      expect(r.$).toBe("Err");
      if (r.$ === "Err") expect(r._0.$).toBe("Sorts");
      expect(rec.registered).toEqual([]);
      expect(TraitErrors.no_errors(ocx.try_evaluate_obligations())).toBe(true);
    }),
  );

  test(
    "sub / sup / lub / relate of equal types succeed and lub returns the type",
    sg((tcx) => {
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const [ocx] = ocx_over(infcx);
      const env = ParamEnv.empty();
      const c = ObligationCause.dummy();
      expect(ocx.sub(c, env, tcx.types.bool, tcx.types.bool, ToTrace_Ty).$).toBe("Ok");
      expect(ocx.sup(c, env, tcx.types.bool, tcx.types.bool, ToTrace_Ty).$).toBe("Ok");
      expect(ocx.relate(c, env, "Invariant", tcx.types.char, tcx.types.char, ToTrace_Ty).$).toBe("Ok");
      const l = ocx.lub(c, env, tcx.types.i32, tcx.types.i32, ToTrace_Ty);
      expect(l).toEqual({ $: "Ok", _0: tcx.types.i32 });
      expect(ocx.sub(c, env, tcx.types.bool, tcx.types.char, ToTrace_Ty).$).toBe("Err");
    }),
  );

  test(
    "register_bound / register_obligations go to the engine; errors come back through evaluate_*",
    sg((tcx) => {
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const [ocx, rec] = ocx_over(infcx);
      const env = ParamEnv.empty();
      const tr = def(5);
      ocx.register_bound(ObligationCause.dummy(), env, tcx.types.u8, tr);
      expect(rec.registered.length).toBe(1);
      const p = rec.registered[0]!.predicate.as_trait_clause()!;
      expect(Binder.skip_binder(p).trait_ref.def_id).toBe(tr);
      expect(GenericArg.as_type(Binder.skip_binder(p).trait_ref.args[0]!)).toBe(tcx.types.u8);
      expect(rec.registered[0]!.recursion_depth).toBe(0);

      ocx.register_obligations([rec.registered[0]!, rec.registered[0]!]);
      expect(rec.registered.length).toBe(3);
      expect(ocx.into_pending_obligations().length).toBe(3);

      rec.errors = [{ $: "TrueError" }];
      const errs = ocx.evaluate_obligations_error_on_ambiguity();
      expect(errs).toEqual({ $: "HasErrors", _0: [{ $: "TrueError" }] });
    }),
  );

  test(
    "structurally_normalize_ty of a non-alias type returns it (next solver) without registering",
    sg((tcx) => {
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const [ocx, rec] = ocx_over(infcx);
      const r = ocx.structurally_normalize_ty(ObligationCause.dummy(), ParamEnv.empty(), { value: tcx.types.u16, _tcx: undefined });
      expect(r).toEqual({ $: "Ok", _0: tcx.types.u16 });
      expect(rec.registered).toEqual([]);
    }),
  );

  test(
    "ObligationCtxt::new on the next solver uses solve::FulfillmentCtxt",
    sg((tcx) => {
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      expect(ObligationCtxt.new(infcx).engine.$).toBe("Next");
      expect(ObligationCtxt.new_with_diagnostics(infcx).engine.$).toBe("Next");
      expect(infcx.can_eq(ParamEnv.empty(), tcx.types.u8, tcx.types.u8, ToTrace_Ty)).toBe(true);
      expect(infcx.can_eq(ParamEnv.empty(), tcx.types.u8, tcx.types.bool, ToTrace_Ty)).toBe(false);
      const _typed: ObligationCtxt<FulfillmentError> | undefined = undefined;
      void _typed;
    }),
  );
});

describe("expand_trait_aliases", () => {
  // trait Bar {}  trait Baz {}  trait Foo = Bar + Baz;  trait Outer = Foo + Bar;  (all `Self`-only)
  // `Proj` is an associated type of `Bar`; `Foo` also carries the projection `<Self as Bar>::Proj == u8` twice.
  const [BAR, BAZ, FOO, OUTER, PROJ] = [def(20), def(21), def(22), def(23), def(24)];

  function setup(tcx: TyCtxt) {
    const self_ty = Ty.new_param(tcx, 0, kw.SelfUpper);
    const tref = (d: DefId, t: Ty) => TraitRef.new(as_interner(tcx), d, [GenericArg.from_Ty(t)]);
    const trait_clause = (d: DefId, t: Ty): Clause => Clause_upcast_from_TraitRef(tref(d, t), tcx);
    const proj_clause = (t: Ty): Clause =>
      Clause_upcast_from_ProjectionClause(
        { projection_term: AliasTerm.new(tcx, { $: "ProjectionTy", def_id: PROJ }, [GenericArg.from_Ty(t)]), term: Term.from_Ty(tcx.types.u8) },
        tcx,
      );
    const supers = new Map<number, [Clause, Span][]>([
      [FOO.index, [
        [trait_clause(BAR, self_ty), sp(100)],
        [proj_clause(self_ty), sp(101)],
        [trait_clause(BAZ, self_ty), sp(102)],
        [proj_clause(self_ty), sp(103)],
      ]],
      [OUTER.index, [
        [trait_clause(FOO, self_ty), sp(200)],
        [trait_clause(BAR, self_ty), sp(201)],
      ]],
    ]);
    const s1 = spyOn(TyCtxt.prototype, "is_trait_alias").mockImplementation(((d: DefId) => d === FOO || d === OUTER) as never);
    const s2 = spyOn(TyCtxt.prototype, "explicit_super_clauses_of").mockImplementation(((d: DefId) => ({ value: supers.get(d.index)!, _tcx: undefined })) as never);
    return { trait_clause, restore: () => (s1.mockRestore(), s2.mockRestore()) };
  }

  test(
    "a non-alias trait clause passes through with its span",
    sg((tcx) => {
      const { trait_clause, restore } = setup(tcx);
      try {
        const [traits, projs] = expand_trait_aliases(tcx, [[trait_clause(BAR, tcx.types.u8), sp(1)]]);
        expect(traits.map(([p, s]) => [Binder.skip_binder(p).trait_ref.def_id, s])).toEqual([[BAR, [sp(1)]]]);
        expect(projs).toEqual([]);
      } finally {
        restore();
      }
    }),
  );

  test(
    "aliases expand breadth-first, instantiating `Self`, stacking spans; projections are deduplicated",
    sg((tcx) => {
      const { trait_clause, restore } = setup(tcx);
      try {
        const [traits, projs] = expand_trait_aliases(tcx, [[trait_clause(OUTER, tcx.types.u8), sp(1)]]);
        // queue: Outer<u8> -> [Foo<u8> (1,200), Bar<u8> (1,201)] -> Foo expands to Bar (1,200,100), proj, Baz, proj
        expect(traits.map(([p, s]) => [Binder.skip_binder(p).trait_ref.def_id, s])).toEqual([
          [BAR, [sp(1), sp(201)]],
          [BAR, [sp(1), sp(200), sp(100)]],
          [BAZ, [sp(1), sp(200), sp(102)]],
        ]);
        for (const [p] of traits) {
          expect(GenericArg.as_type(Binder.skip_binder(p).trait_ref.args[0]!)).toBe(tcx.types.u8);
        }
        // the duplicate `<u8 as Bar>::Proj == u8` is dropped; the span is the last of the stack
        expect(projs.length).toBe(1);
        expect(projs[0]![1]).toEqual(sp(101));
        const pc = Binder.skip_binder(projs[0]![0]);
        expect(pc.projection_term.kind).toEqual({ $: "ProjectionTy", def_id: PROJ });
        expect(GenericArg.as_type(pc.projection_term.args[0]!)).toBe(tcx.types.u8);
      } finally {
        restore();
      }
    }),
  );
});

describe("normalize_param_env_or_error", () => {
  test(
    "an alias-free env is elaborated (supertraits) and returned without normalizing",
    sg((tcx) => {
      // trait Super {}  trait Sub: Super {}  env: `T: Sub`
      const [SUPER, SUB] = [def(30), def(31)];
      const t = Ty.new_param(tcx, 0, kw.SelfUpper);
      const self_ty = Ty.new_param(tcx, 0, kw.SelfUpper);
      const tc = (d: DefId, ty: Ty): Clause => Clause_upcast_from_TraitRef(TraitRef.new(as_interner(tcx), d, [GenericArg.from_Ty(ty)]), tcx);
      const implied = new Map<number, [Clause, Span][]>([
        [SUB.index, [[tc(SUPER, self_ty), sp(5)]]],
        [SUPER.index, []],
      ]);
      const s1 = spyOn(TyCtxt.prototype, "explicit_implied_clauses_of").mockImplementation(((d: DefId) => ({ value: implied.get(d.index)!, _tcx: undefined })) as never);
      // PORT(test): no query system: `features()` answers `generic_const_exprs: false`; `next_trait_solver_globally` is
      // true (mk_tcx), so the clauses skip the `ConstNormalizer`.
      const s2 = spyOn(TyCtxt.prototype, "features").mockImplementation((() => ({ generic_const_exprs: () => false })) as never);
      // PORT(test): no lang items: neither trait is `Sized` (the elaborator skips `Sized` clauses).
      const s3 = spyOn(TyCtxt.prototype, "is_trait_lang_item").mockImplementation((() => false) as never);
      try {
        const env = normalize_param_env_or_error(tcx, ParamEnv.new(tcx, [tc(SUB, t)]), ObligationCause.dummy());
        expect([...env.caller_bounds()]).toEqual([tc(SUB, t), tc(SUPER, t)]);
        expect(normalize_param_env_or_error(tcx, ParamEnv.empty(), ObligationCause.dummy()).caller_bounds_).toBe(ParamEnv.empty().caller_bounds_);
      } finally {
        s1.mockRestore();
        s2.mockRestore();
        s3.mockRestore();
      }
    }),
  );
});
