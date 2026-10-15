//! Code for type-checking closure expressions.
// Port of compiler/rustc_hir_typeck/src/closure.rs (lane typeck-method).
//
// The `impl FnCtxt` methods of this file are assigned onto `FnCtxt.prototype` (declared in ./decls.ts). `ExpectedSig`
// and `ClosureSignatures` are generated (closure.gen.ts).
// - `#[instrument]` / `debug!` / `trace!` are tracing only and stay as comments.
// - Lazy iterators with side effects keep upstream's evaluation order: in `supplied_sig_of_closure` /
//   `error_sig_of_closure` the argument types are lowered inside `mk_fn_sig`, i.e. *after* the return type.
// Init order: top-level code here touches only ./decls.ts, this file's .gen.ts and other crates.
import { ExternAbi } from "../rustc_abi/extern_abi.ts";
import { ControlFlow, try_visit, type VisitorResult, VisitorResult as VisitorResultC } from "../rustc_ast_ir/visit.ts";
import * as hir from "../rustc_hir/lib.ts";
import { ToTrace_Ty } from "../rustc_infer/infer/at.ts";
import { BoundRegionConversionTime, InferOk, type InferResult } from "../rustc_infer/infer/mod.ts";
import type { PredicateObligations } from "../rustc_infer/traits/mod.ts";
import type { AdtDef } from "../rustc_middle/ty/adt.ts";
import type { Const, Region } from "../rustc_middle/ty/decls.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import type { Clauses } from "../rustc_middle/ty/list.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { fold_Term, Term, Ty } from "../rustc_middle/ty/mod.ts";
import type { Clause } from "../rustc_middle/ty/predicate.ts";
import { fold_Clause, fold_Span, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { DefId, LocalDefId } from "../rustc_span/def_id.ts";
import { LocalDefId as LocalDefIdC } from "../rustc_span/def_id.ts";
import { DUMMY_SP, type ErrorGuaranteed, type Span } from "../rustc_span/lib.ts";
import { MultiSpan } from "../rustc_error_messages/lib.ts";
import { span_bug } from "../rustc_span/macros.ts";
import { Binder, EarlyBinder, fold_Binder } from "../rustc_type_ir/binder.ts";
import type { ClosureKind, PolyFnSig, PolyProjectionClause, ProjectionClause } from "../rustc_type_ir/decls.ts";
import { type Elaboratable, elaborate } from "../rustc_type_ir/elaborate.ts";
import { fold_Option, fold_tuple2, type PredicateProxy, type TypeFoldable } from "../rustc_type_ir/fold.ts";
import { INNERMOST } from "../rustc_type_ir/lib.gen.ts";
import { visit_with_trivial } from "../rustc_type_ir/macros.ts";
import { as_interner, fold_with_ProjectionClause, PolyExistentialProjection, PolyProjectionClause as PolyProjectionClauseC, ProjectionClause as ProjectionClauseC, TraitClause, try_fold_with_ProjectionClause, visit_with_ProjectionClause } from "../rustc_type_ir/predicate.ts";
import { ClosureArgs, CoroutineArgs, CoroutineClosureArgs, CoroutineClosureSignature as CoroutineClosureSignatureC, type CoroutineClosureSignature } from "../rustc_type_ir/ty_kind/closure.ts";
import { AliasTerm } from "../rustc_type_ir/term_kind.ts";
import { debug_AliasTermKind } from "../rustc_type_ir/term_kind.gen.ts";
import { debug_DefId, DefId_eq } from "../rustc_span/def_id.ts";
import { fold_FnSig, FnSig, FnSigKind, PolyFnSig as PolyFnSigC, PolyFnSigTys } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt, type TypeVisitable, type TypeVisitor, TypeVisitor_provided, visit_with_Option } from "../rustc_type_ir/visit.ts";
import { debug_Ty } from "../rustc_middle/ty/mod.ts";
import { PLAIN } from "../std/fmt.ts";
import { assert, panic, unported } from "../std/panic.ts";
import { Ok, type Result } from "../std/result.ts";
import { check_fn } from "./check.ts";
import type { ClosureSignatures, ExpectedSig } from "./closure.gen.ts";
import { FnCtxt } from "./decls.ts";
import { Expectation } from "./expectation.ts";
import type { CoroutineTypes } from "./lib.gen.ts";

export * from "./closure.gen.ts";

/** The `TypeFoldable` descriptor of `ty::PolyFnSig` (`Binder<FnSig>`). */
const fold_PolyFnSig = fold_Binder(fold_FnSig);
/** The `TypeFoldable` descriptor of `ty::ProjectionClause` (its derived impls). */
const fold_ProjectionClause: TypeFoldable<ProjectionClause> = { visit_with: visit_with_ProjectionClause, try_fold_with: try_fold_with_ProjectionClause, fold_with: fold_with_ProjectionClause };
/** The `TypeFoldable` descriptor of `ty::PolyProjectionClause`. */
const fold_PolyProjectionClause = fold_Binder(fold_ProjectionClause);

/**
 * PORT: `#[derive(TypeFoldable, TypeVisitable)] struct ExpectedSig` (closure.rs:28) as a descriptor. The generated
 * impls (closure.gen.ts) stop `unported` on the field `sig: ty::PolyFnSig` (codegen has no `type_fold.json` entry for the
 * alias `PolyFnSig`, fnctxt-contract report "2 missing TypeFoldable"); this is the derive's field-by-field traversal
 * with `Binder<FnSig>`'s impls (`cause_span: Option<Span>` is trivial). Root: replace with the generated impls once
 * codegen knows `PolyFnSig`.
 */
const fold_ExpectedSig: TypeFoldable<ExpectedSig> = {
  visit_with<R>(self: ExpectedSig, visitor: TypeVisitor<R>): R {
    let r: R | undefined;
    if ((r = try_visit(visitor.Result, visit_with_Option<Span, R>(self.cause_span, visitor, visit_with_trivial))) !== undefined) return r;
    if ((r = try_visit(visitor.Result, fold_PolyFnSig.visit_with(self.sig, visitor))) !== undefined) return r;
    return visitor.Result.output();
  },
  try_fold_with(self, folder) {
    const sig = fold_PolyFnSig.try_fold_with(self.sig, folder);
    if (sig.$ === "Err") return sig;
    return Ok({ cause_span: self.cause_span, sig: sig._0 });
  },
  fold_with(self, folder) {
    return { cause_span: self.cause_span, sig: fold_PolyFnSig.fold_with(self.sig, folder) };
  },
};

/**
 * PORT(stand-in): `impl Elaboratable<TyCtxt> for (ty::Clause, Span)` (rustc_middle ty/elaborate_impl.rs:66, not ported);
 * a faithful copy without markers, as rustc_hir_analysis check/wfcheck.ts's `Elaboratable_Clause_Span`.
 */
const Elaboratable_Clause_Span: Elaboratable<[Clause, Span]> = {
  predicate(self) {
    return self[0].as_predicate();
  },
  child(self, clause) {
    return [clause, self[1]];
  },
  child_with_derived_cause(self, clause, _span, _parent_trait_pred, _index) {
    return [clause, self[1]];
  },
};

/** `FnSigKind::default().set_abi(ExternAbi::RustCall).set_safety(hir::Safety::Safe).set_c_variadic(c_variadic)` */
function rust_call_safe_fn_sig_kind(c_variadic: boolean): FnSigKind {
  return FnSigKind.set_c_variadic(FnSigKind.set_safety(FnSigKind.set_abi(FnSigKind.default_(), ExternAbi.RustCall), hir.Safety.Safe), c_variadic);
}

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {
// #[instrument(skip(self, closure), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/closure.rs:48 check_expr_closure
FnCtxt.prototype.check_expr_closure = function (this: FnCtxt, closure: hir.Closure, expr_span: Span, expected: Expectation): Ty {
  const tcx = this.tcx;
  const body = tcx.hir_body(closure.body);
  const expr_def_id = closure.def_id;

  // It's always helpful for inference if we know the kind of
  // closure sooner rather than later, so first examine the expected
  // type, and see if can glean a closure kind from there.
  const ety = Expectation.to_option(expected, this);
  const [expected_sig, expected_kind] =
    ety !== undefined ? this.deduce_closure_signature(this.deeply_resolve_ignoring_regions_with_obligations(ety, fold_Ty), closure.kind) : [undefined, undefined];

  const sigs = this.sig_of_closure(expr_def_id, closure.fn_decl, closure.kind, expected_sig);
  const bound_sig = sigs.bound_sig;
  let liberated_sig = sigs.liberated_sig;

  // debug!(?bound_sig, ?liberated_sig);

  const parent_args = RawList.identity_for_item(tcx, LocalDefIdC.to_def_id(tcx.typeck_root_def_id_local(expr_def_id)));

  const tupled_upvars_ty = this.next_ty_var(expr_span);

  // FIXME: We could probably actually just unify this further --
  // instead of having a `FnSig` and a `Option<CoroutineTypes>`,
  // we can have a `ClosureSignature { Coroutine { .. }, Closure { .. } }`,
  // similar to how `ty::GenSig` is a distinct data structure.
  let closure_ty: Ty;
  let coroutine_types: CoroutineTypes | undefined;
  const ck = closure.kind;
  switch (ck.$) {
    case "Closure": {
      // Tuple up the arguments and insert the resulting function type into
      // the `closures` table.
      const sig = Binder.map_bound(bound_sig, (sig) => tcx.mk_fn_sig([Ty.new_tup(tcx, FnSig.inputs(sig))], FnSig.output(sig), sig.fn_sig_kind));

      // debug!(?sig, ?expected_kind);

      const closure_kind_ty =
        expected_kind !== undefined
          ? Ty.from_closure_kind(tcx, expected_kind)
          : // Create a type variable (for now) to represent the closure kind.
            // It will be unified during the upvar inference phase (`upvar.rs`)
            this.next_ty_var(expr_span);

      const closure_args = ClosureArgs.new(tcx, {
        parent_args,
        closure_kind_ty,
        closure_sig_as_fn_ptr_ty: Ty.new_fn_ptr(tcx, sig),
        tupled_upvars_ty,
      });

      [closure_ty, coroutine_types] = [Ty.new_closure(tcx, LocalDefIdC.to_def_id(expr_def_id), closure_args.args), undefined];
      break;
    }
    case "Coroutine": {
      const kind = ck._0;
      let yield_ty: Ty;
      if ((kind.$ === "Desugared" && kind._0 === "Gen") || kind.$ === "Coroutine") {
        const yield_ty_ = this.next_ty_var(expr_span);
        this.require_type_is_sized(yield_ty_, expr_span, { $: "SizedYieldType" });
        yield_ty = yield_ty_;
      } else if (kind.$ === "Desugared" && kind._0 === "AsyncGen") {
        // HACK(-Ztrait-solver=next): In the *old* trait solver, we must eagerly
        // guide inference on the yield type so that we can handle `AsyncIterator`
        // in this block in projection correctly. In the new trait solver, it is
        // not a problem.
        const yield_ty_ = this.next_ty_var(expr_span);
        this.require_type_is_sized(yield_ty_, expr_span, { $: "SizedYieldType" });

        yield_ty = Ty.new_adt(
          tcx,
          tcx.adt_def(tcx.require_lang_item("Poll", expr_span)) as AdtDef,
          tcx.mk_args([GenericArg.from_Ty(Ty.new_adt(tcx, tcx.adt_def(tcx.require_lang_item("Option", expr_span)) as AdtDef, tcx.mk_args([GenericArg.from_Ty(yield_ty_)])))]),
        );
      } else {
        // hir::CoroutineKind::Desugared(hir::CoroutineDesugaring::Async, _)
        yield_ty = tcx.types.unit;
      }

      // Resume type defaults to `()` if the coroutine has no argument.
      const resume_ty = FnSig.inputs(liberated_sig)[0] ?? tcx.types.unit;

      // Coroutines that come from coroutine closures have not yet determined
      // their kind ty, so make a fresh infer var which will be constrained
      // later during upvar analysis. Regular coroutines always have the kind
      // ty of `().`
      const kind_ty = kind.$ === "Desugared" && kind._1 === "Closure" ? this.next_ty_var(expr_span) : tcx.types.unit;

      const coroutine_args = CoroutineArgs.new(tcx, {
        parent_args,
        kind_ty,
        resume_ty,
        yield_ty,
        return_ty: FnSig.output(liberated_sig),
        tupled_upvars_ty,
      });

      [closure_ty, coroutine_types] = [Ty.new_coroutine(tcx, LocalDefIdC.to_def_id(expr_def_id), coroutine_args.args), { resume_ty, yield_ty }];
      break;
    }
    case "CoroutineClosure": {
      const kind = ck._0;
      let bound_return_ty: Ty;
      let bound_yield_ty: Ty;
      switch (kind) {
        case "Gen":
          // `iter!` closures always return unit and yield the `Iterator::Item` type
          // that we have to infer.
          [bound_return_ty, bound_yield_ty] = [tcx.types.unit, this.infcx.next_ty_var(expr_span)];
          break;
        case "Async":
          // async closures always return the type ascribed after the `->` (if present),
          // and yield `()`.
          [bound_return_ty, bound_yield_ty] = [FnSig.output(Binder.skip_binder(bound_sig)), tcx.types.unit];
          break;
        case "AsyncGen":
          return panic("not implemented: `async gen` closures not supported yet");
      }
      // Compute all of the variables that will be used to populate the coroutine.
      const resume_ty = this.next_ty_var(expr_span);

      const closure_kind_ty =
        expected_kind !== undefined
          ? Ty.from_closure_kind(tcx, expected_kind)
          : // Create a type variable (for now) to represent the closure kind.
            // It will be unified during the upvar inference phase (`upvar.rs`)
            this.next_ty_var(expr_span);

      const coroutine_captures_by_ref_ty = this.next_ty_var(expr_span);
      const closure_args = CoroutineClosureArgs.new(tcx, {
        parent_args,
        closure_kind_ty,
        signature_parts_ty: Ty.new_fn_ptr(
          tcx,
          Binder.map_bound(bound_sig, (sig) =>
            tcx.mk_fn_sig([resume_ty, Ty.new_tup_from_iter(tcx, FnSig.inputs(sig))], Ty.new_tup(tcx, [bound_yield_ty, bound_return_ty]), sig.fn_sig_kind),
          ),
        ),
        tupled_upvars_ty,
        coroutine_captures_by_ref_ty,
      });

      const coroutine_kind_ty =
        expected_kind !== undefined
          ? Ty.from_coroutine_closure_kind(tcx, expected_kind)
          : // Create a type variable (for now) to represent the closure kind.
            // It will be unified during the upvar inference phase (`upvar.rs`)
            this.next_ty_var(expr_span);

      const coroutine_upvars_ty = this.next_ty_var(expr_span);

      // We need to turn the liberated signature that we got from HIR, which
      // looks something like `|Args...| -> T`, into a signature that is suitable
      // for type checking the inner body of the closure, which always returns a
      // coroutine. To do so, we use the `CoroutineClosureSignature` to compute
      // the coroutine type, filling in the tupled_upvars_ty and kind_ty with infer
      // vars which will get constrained during upvar analysis.
      const coroutine_output_ty = tcx.liberate_late_bound_regions(
        LocalDefIdC.to_def_id(expr_def_id),
        Binder.map_bound(CoroutineClosureArgs.coroutine_closure_sig(closure_args), (sig: CoroutineClosureSignature) =>
          CoroutineClosureSignatureC.to_coroutine(sig, tcx, parent_args, coroutine_kind_ty, tcx.coroutine_for_closure(expr_def_id), coroutine_upvars_ty),
        ),
        fold_Ty,
      );
      liberated_sig = tcx.mk_fn_sig(FnSig.inputs(liberated_sig), coroutine_output_ty, liberated_sig.fn_sig_kind);

      [closure_ty, coroutine_types] = [Ty.new_coroutine_closure(tcx, LocalDefIdC.to_def_id(expr_def_id), closure_args.args), undefined];
      break;
    }
  }

  check_fn(
    FnCtxt.new(this.root_ctxt, this.param_env, closure.def_id),
    liberated_sig,
    coroutine_types,
    closure.fn_decl,
    expr_def_id,
    body,
    // Closure "rust-call" ABI doesn't support unsized params
    false,
  );

  return closure_ty;
};

/// Given the expected type, figures out what it can about this closure we
/// are about to type check:
// #[instrument(skip(self), level = "debug", ret)]
// rustc: compiler/rustc_hir_typeck/src/closure.rs:290 deduce_closure_signature
FnCtxt.prototype.deduce_closure_signature = function (this: FnCtxt, expected_ty: Ty, closure_kind: hir.ClosureKind): [ExpectedSig | undefined, ClosureKind | undefined] {
  const k = expected_ty.kind();
  if (k.$ === "Alias" && k._1.kind.$ === "Opaque") {
    const def_id = k._1.kind.def_id;
    const args = k._1.args;
    return this.deduce_closure_signature_from_predicates(
      expected_ty,
      closure_kind,
      Array.from(
        EarlyBinder.iter_instantiated_copied(this.tcx.explicit_item_self_bounds(def_id) as EarlyBinder<readonly [Clause, Span][]>, this.tcx, args, fold_tuple2(fold_Clause, fold_Span)),
        Unnormalized.skip_norm_wip,
      ),
    );
  } else if (k.$ === "Dynamic") {
    const object_type = k._0;
    let sig: ExpectedSig | undefined = undefined;
    for (const pb_ of object_type.projection_bounds()) {
      const pb = PolyExistentialProjection.with_self_ty(pb_, this.tcx, this.tcx.types.trait_object_dummy_self);
      sig = this.deduce_sig_from_projection(undefined, closure_kind, pb);
      if (sig !== undefined) break;
    }
    const did = object_type.principal_def_id();
    const kind = did !== undefined ? this.tcx.fn_trait_kind_from_def_id(did) : undefined;
    return [sig, kind];
  } else if (k.$ === "Infer" && k._0.$ === "TyVar") {
    const vid = k._0._0;
    const clauses: [Clause, Span][] = [];
    for (const obl of this.obligations_for_self_ty(vid, "No")) {
      const clause = obl.predicate.as_clause();
      if (clause === undefined) continue;
      clauses.push([clause, obl.cause.span]);
    }
    return this.deduce_closure_signature_from_predicates(Ty.new_var(this.tcx, this.root_var(vid)), closure_kind, clauses);
  } else if (k.$ === "FnPtr") {
    const [sig_tys, hdr] = [k._0, k._1];
    switch (closure_kind.$) {
      case "Closure": {
        const expected_sig: ExpectedSig = { cause_span: undefined, sig: PolyFnSigTys.with(sig_tys, hdr) };
        return [expected_sig, "Fn"];
      }
      case "Coroutine":
      case "CoroutineClosure":
        return [undefined, undefined];
    }
  } else {
    return [undefined, undefined];
  }
};

// rustc: compiler/rustc_hir_typeck/src/closure.rs:335 deduce_closure_signature_from_predicates
FnCtxt.prototype.deduce_closure_signature_from_predicates = function (this: FnCtxt, expected_ty: Ty, closure_kind: hir.ClosureKind, clauses: Iterable<[Clause, Span]>): [ExpectedSig | undefined, ClosureKind | undefined] {
  let expected_sig: ExpectedSig | undefined = undefined;
  let expected_kind: ClosureKind | undefined = undefined;

  for (const [clause, span] of elaborate(
    this.tcx,
    // Reverse the obligations here, since `elaborate_*` uses a stack,
    // and we want to keep inference generally in the same order of
    // the registered obligations.
    [...clauses].reverse(),
    Elaboratable_Clause_Span,
  )
    // We only care about self bounds
    .filter_only_self()) {
    // debug!(?clause);
    const bound_clause = clause.kind();

    // Given a Projection clause, we can potentially infer the complete signature.
    const bk = Binder.skip_binder(bound_clause);
    if (expected_sig === undefined && bk.$ === "Projection") {
      const proj_clause = bk._0;
      const inferred_sig = this.normalize(
        span,
        Unnormalized.new_wip(this.deduce_sig_from_projection(span, closure_kind, Binder.rebind(bound_clause, proj_clause))),
        fold_Option(fold_ExpectedSig),
      );

      // Make sure that we didn't infer a signature that mentions itself.
      // This can happen when we elaborate certain supertrait bounds that
      // mention projections containing the `Self` type. See #105401.
      // struct MentionsTy<'tcx> { expected_ty: Ty<'tcx> }
      class MentionsTy implements TypeVisitor<ControlFlow<null>> {
        // type Result = ControlFlow<()>;
        readonly Result: VisitorResult<ControlFlow<null>, unknown> = VisitorResultC.ControlFlow<null>();
        constructor(public expected_ty: Ty) {}

        // impl<'tcx> TypeVisitor<TyCtxt<'tcx>> for MentionsTy<'tcx>
        // rustc: compiler/rustc_hir_typeck/src/closure.rs:379 visit_ty
        visit_ty(t: Ty): ControlFlow<null> {
          if (t === this.expected_ty) {
            return ControlFlow.Break(null);
          } else {
            return fold_Ty.super_visit_with(t, this);
          }
        }

        // PORT: the provided `TypeVisitor` methods (PORTING §8).
        visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<null> {
          return TypeVisitor_provided.visit_binder(this, t, d);
        }

        visit_region(r: Region): ControlFlow<null> {
          return TypeVisitor_provided.visit_region(this, r);
        }

        visit_const(c: Const): ControlFlow<null> {
          return TypeVisitor_provided.visit_const(this, c);
        }

        visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<null> {
          return TypeVisitor_provided.visit_predicate(this, p, d);
        }

        visit_clauses(c: Clauses): ControlFlow<null> {
          return TypeVisitor_provided.visit_clauses(this, c);
        }

        visit_error(guar: ErrorGuaranteed): ControlFlow<null> {
          return TypeVisitor_provided.visit_error(this, guar);
        }
      }

      if (fold_Option(fold_ExpectedSig).visit_with(inferred_sig, new MentionsTy(expected_ty)).$ === "Continue") {
        expected_sig = inferred_sig;
      }
    }

    // Even if we can't infer the full signature, we may be able to
    // infer the kind. This can occur when we elaborate a predicate
    // like `F : Fn<A>`. Note that due to subtyping we could encounter
    // many viable options, so pick the most restrictive.
    let trait_def_id: DefId | undefined;
    switch (bk.$) {
      case "Projection":
        trait_def_id = AliasTerm.trait_def_id(bk._0.projection_term, as_interner(this.tcx));
        break;
      case "Trait":
        trait_def_id = TraitClause.def_id(bk._0);
        break;
      default:
        trait_def_id = undefined;
    }

    if (trait_def_id !== undefined) {
      let found_kind: ClosureKind | undefined;
      if (closure_kind.$ === "Closure" || (closure_kind.$ === "CoroutineClosure" && closure_kind._0 === "Gen")) {
        // FIXME(iter_macro): Someday we'll probably want iterator closures instead of
        // just using Fn* for iterators.
        found_kind = this.tcx.fn_trait_kind_from_def_id(trait_def_id);
      } else if (closure_kind.$ === "CoroutineClosure" && closure_kind._0 === "Async") {
        found_kind = this.tcx.async_fn_trait_kind_from_def_id(trait_def_id) ?? this.tcx.fn_trait_kind_from_def_id(trait_def_id);
      } else {
        found_kind = undefined;
      }

      if (found_kind !== undefined) {
        // always use the closure kind that is more permissive.
        if (expected_kind === undefined) {
          expected_kind = found_kind;
        } else if (expected_kind === "FnMut" && found_kind === "Fn") {
          expected_kind = "Fn";
        } else if (expected_kind === "FnOnce" && (found_kind === "Fn" || found_kind === "FnMut")) {
          expected_kind = found_kind;
        }
      }
    }
  }

  return [expected_sig, expected_kind];
};

/// Given a projection like "<F as Fn(X)>::Result == Y", we can deduce
/// everything we need to know about a closure or coroutine.
///
/// The `cause_span` should be the span that caused us to
/// have this expected signature, or `None` if we can't readily
/// know that.
// #[instrument(level = "debug", skip(self, cause_span), ret)]
// rustc: compiler/rustc_hir_typeck/src/closure.rs:446 deduce_sig_from_projection
FnCtxt.prototype.deduce_sig_from_projection = function (this: FnCtxt, cause_span: Span | undefined, closure_kind: hir.ClosureKind, projection: PolyProjectionClause): ExpectedSig | undefined {
  const def_id = PolyProjectionClauseC.item_def_id(projection);

  // For now, we only do signature deduction based off of the `Fn` and `AsyncFn` traits,
  // for closures and async closures, respectively.
  if (closure_kind.$ === "Closure" && this.tcx.is_lang_item(def_id, "FnOnceOutput")) {
    return this.extract_sig_from_projection(cause_span, projection);
  } else if (closure_kind.$ === "CoroutineClosure" && closure_kind._0 === "Async" && this.tcx.is_lang_item(def_id, "AsyncFnOnceOutput")) {
    return this.extract_sig_from_projection(cause_span, projection);
  } else if (
    // It's possible we've passed the closure to a (somewhat out-of-fashion)
    // `F: FnOnce() -> Fut, Fut: Future<Output = T>` style bound. Let's still
    // guide inference here, since it's beneficial for the user.
    closure_kind.$ === "CoroutineClosure" &&
    closure_kind._0 === "Async" &&
    this.tcx.is_lang_item(def_id, "FnOnceOutput")
  ) {
    return this.extract_sig_from_projection_and_future_bound(cause_span, projection);
  } else {
    return undefined;
  }
};

/// Given an `FnOnce::Output` or `AsyncFn::Output` projection, extract the args
/// and return type to infer a [`ty::PolyFnSig`] for the closure.
// rustc: compiler/rustc_hir_typeck/src/closure.rs:479 extract_sig_from_projection
FnCtxt.prototype.extract_sig_from_projection = function (this: FnCtxt, cause_span: Span | undefined, projection_: PolyProjectionClause): ExpectedSig | undefined {
  const projection = this.deeply_resolve_ignoring_regions(projection_, fold_PolyProjectionClause);

  const arg_param_ty = Binder.skip_binder(projection).projection_term.args.type_at(1);
  // debug!(?arg_param_ty);

  const ak = arg_param_ty.kind();
  if (ak.$ !== "Tuple") {
    return undefined;
  }
  const input_tys = ak._0;

  // Since this is a return parameter type it is safe to unwrap.
  const ret_param_ty = Term.expect_type(Binder.skip_binder(projection).term);
  // debug!(?ret_param_ty);

  const sig = Binder.rebind(projection, this.tcx.mk_fn_sig_safe_rust_abi(input_tys, ret_param_ty));

  return { cause_span, sig };
};

/// When an async closure is passed to a function that has a "two-part" `Fn`
/// and `Future` trait bound, like:
///
/// ```rust
/// use std::future::Future;
///
/// fn not_exactly_an_async_closure<F, Fut>(_f: F)
/// where
///     F: FnOnce(String, u32) -> Fut,
///     Fut: Future<Output = i32>,
/// {}
/// ```
///
/// The we want to be able to extract the signature to guide inference in the async
/// closure. We will have two projection predicates registered in this case. First,
/// we identify the `FnOnce<Args, Output = ?Fut>` bound, and if the output type is
/// an inference variable `?Fut`, we check if that is bounded by a `Future<Output = Ty>`
/// projection.
///
/// This function is actually best-effort with the return type; if we don't find a
/// `Future` projection, we still will return arguments that we extracted from the `FnOnce`
/// projection, and the output will be an unconstrained type variable instead.
// rustc: compiler/rustc_hir_typeck/src/closure.rs:524 extract_sig_from_projection_and_future_bound
FnCtxt.prototype.extract_sig_from_projection_and_future_bound = function (this: FnCtxt, cause_span: Span | undefined, projection_: PolyProjectionClause): ExpectedSig | undefined {
  const projection = this.deeply_resolve_ignoring_regions(projection_, fold_PolyProjectionClause);

  const arg_param_ty = Binder.skip_binder(projection).projection_term.args.type_at(1);
  // debug!(?arg_param_ty);

  const ak = arg_param_ty.kind();
  if (ak.$ !== "Tuple") {
    return undefined;
  }
  const input_tys = ak._0;

  // If the return type is a type variable, look for bounds on it.
  // We could theoretically support other kinds of return types here,
  // but none of them would be useful, since async closures return
  // concrete anonymous future types, and their futures are not coerced
  // into any other type within the body of the async closure.
  const rk = Term.expect_type(Binder.skip_binder(projection).term).kind();
  if (!(rk.$ === "Infer" && rk._0.$ === "TyVar")) {
    return undefined;
  }
  const return_vid = rk._0._0;

  // FIXME: We may want to elaborate here, though I assume this will be exceedingly rare.
  let return_ty: Ty | undefined = undefined;
  for (const bound of this.obligations_for_self_ty(return_vid, "No")) {
    const ret_projection_ = bound.predicate.as_projection_clause();
    if (ret_projection_ === undefined) continue;
    const ret_projection = Binder.no_bound_vars(ret_projection_, fold_ProjectionClause);
    if (ret_projection === undefined) continue;
    if (this.tcx.is_lang_item(ProjectionClauseC.def_id(ret_projection), "FutureOutput")) {
      return_ty = Term.expect_type(ret_projection.term);
      break;
    }
  }

  // SUBTLE: If we didn't find a `Future<Output = ...>` bound for the return
  // vid, we still want to attempt to provide inference guidance for the async
  // closure's arguments. Instantiate a new vid to plug into the output type.
  //
  // You may be wondering, what if it's higher-ranked? Well, given that we
  // found a type variable for the `FnOnce::Output` projection above, we know
  // that the output can't mention any of the vars.
  //
  // Also note that we use a fresh var here for the signature since the signature
  // records the output of the *future*, and `return_vid` above is the type
  // variable of the future, not its output.
  //
  // FIXME: We probably should store this signature inference output in a way
  // that does not misuse a `FnSig` type, but that can be done separately.
  const return_ty_ = return_ty ?? this.next_ty_var(cause_span ?? DUMMY_SP);

  const sig = Binder.rebind(projection, this.tcx.mk_fn_sig_safe_rust_abi(input_tys, return_ty_));

  return { cause_span, sig };
};

// rustc: compiler/rustc_hir_typeck/src/closure.rs:582 sig_of_closure
FnCtxt.prototype.sig_of_closure = function (this: FnCtxt, expr_def_id: LocalDefId, decl: hir.FnDecl, closure_kind: hir.ClosureKind, expected_sig: ExpectedSig | undefined): ClosureSignatures {
  if (expected_sig !== undefined) {
    const e = expected_sig;
    return this.sig_of_closure_with_expectation(expr_def_id, decl, closure_kind, e);
  } else {
    return this.sig_of_closure_no_expectation(expr_def_id, decl, closure_kind);
  }
};

/// If there is no expected signature, then we will convert the
/// types that the user gave into a signature.
// #[instrument(skip(self, expr_def_id, decl), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/closure.rs:599 sig_of_closure_no_expectation
FnCtxt.prototype.sig_of_closure_no_expectation = function (this: FnCtxt, expr_def_id: LocalDefId, decl: hir.FnDecl, closure_kind: hir.ClosureKind): ClosureSignatures {
  const bound_sig = this.supplied_sig_of_closure(expr_def_id, decl, closure_kind);

  return this.closure_sigs(expr_def_id, bound_sig);
};

/// Invoked to compute the signature of a closure expression. This
/// combines any user-provided type annotations (e.g., `|x: u32|
/// -> u32 { .. }`) with the expected signature.
///
/// The approach is as follows:
///
/// - Let `S` be the (higher-ranked) signature that we derive from the user's annotations.
/// - Let `E` be the (higher-ranked) signature that we derive from the expectations, if any.
///   - If we have no expectation `E`, then the signature of the closure is `S`.
///   - Otherwise, the signature of the closure is E. Moreover:
///     - Skolemize the late-bound regions in `E`, yielding `E'`.
///     - Instantiate all the late-bound regions bound in the closure within `S`
///       with fresh (existential) variables, yielding `S'`
///     - Require that `E' = S'`
///       - We could use some kind of subtyping relationship here,
///         I imagine, but equality is easier and works fine for
///         our purposes.
///
/// The key intuition here is that the user's types must be valid
/// from "the inside" of the closure, but the expectation
/// ultimately drives the overall signature.
///
/// # Examples
///
/// ```ignore (illustrative)
/// fn with_closure<F>(_: F)
///   where F: Fn(&u32) -> &u32 { .. }
///
/// with_closure(|x: &u32| { ... })
/// ```
///
/// Here:
/// - E would be `fn(&u32) -> &u32`.
/// - S would be `fn(&u32) -> ?T`
/// - E' is `&'!0 u32 -> &'!0 u32`
/// - S' is `&'?0 u32 -> ?T`
///
/// S' can be unified with E' with `['?0 = '!0, ?T = &'!10 u32]`.
///
/// # Arguments
///
/// - `expr_def_id`: the `LocalDefId` of the closure expression
/// - `decl`: the HIR declaration of the closure
/// - `body`: the body of the closure
/// - `expected_sig`: the expected signature (if any). Note that
///   this is missing a binder: that is, there may be late-bound
///   regions with depth 1, which are bound then by the closure.
// #[instrument(skip(self, expr_def_id, decl), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/closure.rs:658 sig_of_closure_with_expectation
FnCtxt.prototype.sig_of_closure_with_expectation = function (this: FnCtxt, expr_def_id: LocalDefId, decl: hir.FnDecl, closure_kind: hir.ClosureKind, expected_sig: ExpectedSig): ClosureSignatures {
  // Watch out for some surprises and just ignore the
  // expectation if things don't see to match up with what we
  // expect.
  if (PolyFnSigC.c_variadic(expected_sig.sig) !== decl.c_variadic()) {
    return this.sig_of_closure_no_expectation(expr_def_id, decl, closure_kind);
  } else if (Binder.skip_binder(expected_sig.sig).inputs_and_output.length !== decl.inputs.length + 1) {
    return this.sig_of_closure_with_mismatched_number_of_arguments(expr_def_id, decl, expected_sig);
  }

  // Create a `PolyFnSig`. Note the oddity that late bound
  // regions appearing free in `expected_sig` are now bound up
  // in this binder we are creating.
  assert(!TypeVisitableExt.has_vars_bound_above(Binder.skip_binder(expected_sig.sig), INNERMOST, fold_FnSig), "assertion failed: !expected_sig.sig.skip_binder().has_vars_bound_above(ty::INNERMOST)");
  const bound_sig_ = Binder.map_bound(expected_sig.sig, (sig) => {
    // Ignore splatting, it is unsupported on closures.
    const fn_sig_kind = rust_call_safe_fn_sig_kind(FnSig.c_variadic(sig));
    return this.tcx.mk_fn_sig(FnSig.inputs(sig), FnSig.output(sig), fn_sig_kind);
  });

  // `deduce_expectations_from_expected_type` introduces
  // late-bound lifetimes defined elsewhere, which we now
  // anonymize away, so as not to confuse the user.
  const bound_sig = this.tcx.anonymize_bound_vars(bound_sig_, fold_FnSig);

  const closure_sigs = this.closure_sigs(expr_def_id, bound_sig);

  // Up till this point, we have ignored the annotations that the user
  // gave. This function will check that they unify successfully.
  // Along the way, it also writes out entries for types that the user
  // wrote into our typeck results, which are then later used by the privacy
  // check.
  const r = this.merge_supplied_sig_with_expectation(expr_def_id, decl, closure_kind, closure_sigs);
  if (r.$ === "Ok") {
    const infer_ok = r._0;
    return this.register_infer_ok_obligations(infer_ok);
  } else {
    return this.sig_of_closure_no_expectation(expr_def_id, decl, closure_kind);
  }
};

// rustc: compiler/rustc_hir_typeck/src/closure.rs:714 sig_of_closure_with_mismatched_number_of_arguments
FnCtxt.prototype.sig_of_closure_with_mismatched_number_of_arguments = function (this: FnCtxt, expr_def_id: LocalDefId, decl: hir.FnDecl, expected_sig: ExpectedSig): ClosureSignatures {
  const expr_map_node = this.tcx.hir_node_by_def_id(expr_def_id);
  const expected_args = FnSig.inputs(Binder.skip_binder(expected_sig.sig)).map((ty) => ArgKind_from_expected_ty(ty, undefined));
  // PORT: error path (wave 19): `self.err_ctxt()` stops (`TypeErrCtxt` is pending); its
  // `get_fn_like_arguments(expr_map_node)` / `report_arg_count_mismatch(..).emit_err()` and then
  // `self.error_sig_of_closure(decl, guar)` / `self.closure_sigs(expr_def_id, error_sig)` follow upstream.
  this.err_ctxt();
  void expr_map_node;
  void expected_args;
  void decl;
  return unported("rustc_trait_selection::error_reporting::TypeErrCtxt::{get_fn_like_arguments, report_arg_count_mismatch}");
};

/// Enforce the user's types against the expectation. See
/// `sig_of_closure_with_expectation` for details on the overall
/// strategy.
// #[instrument(level = "debug", skip(self, expr_def_id, decl, expected_sigs))]
// rustc: compiler/rustc_hir_typeck/src/closure.rs:756 merge_supplied_sig_with_expectation
FnCtxt.prototype.merge_supplied_sig_with_expectation = function (this: FnCtxt, expr_def_id: LocalDefId, decl: hir.FnDecl, closure_kind: hir.ClosureKind, expected_sigs: ClosureSignatures): InferResult<ClosureSignatures> {
  // Get the signature S that the user gave.
  //
  // (See comment on `sig_of_closure_with_expectation` for the
  // meaning of these letters.)
  const supplied_sig_ = this.supplied_sig_of_closure(expr_def_id, decl, closure_kind);

  // debug!(?supplied_sig);

  // FIXME(#45727): As discussed in [this comment][c1], naively
  // forcing equality here actually results in suboptimal error
  // messages in some cases. For now, if there would have been
  // an obvious error, we fallback to declaring the type of the
  // closure to be the one the user gave, which allows other
  // error message code to trigger.
  //
  // However, I think [there is potential to do even better
  // here][c2], since in *this* code we have the precise span of
  // the type parameter in question in hand when we report the
  // error.
  //
  // [c1]: https://github.com/rust-lang/rust/pull/45072#issuecomment-341089706
  // [c2]: https://github.com/rust-lang/rust/pull/45072#issuecomment-341096796
  return this.commit_if_ok((_) => {
    const all_obligations: PredicateObligations = [];
    const supplied_sig = this.instantiate_binder_with_fresh_vars(this.tcx.def_span(expr_def_id), BoundRegionConversionTime.FnCall, supplied_sig_, fold_FnSig);

    // The liberated version of this signature should be a subtype
    // of the liberated form of the expectation.
    const supplied_inputs = FnSig.inputs(supplied_sig);
    const expected_inputs = FnSig.inputs(expected_sigs.liberated_sig); // `liberated_sig` is E'.
    const n = Math.min(decl.inputs.length, supplied_inputs.length, expected_inputs.length);
    for (let i = 0; i < n; i++) {
      const [hir_ty, supplied_ty, expected_ty] = [decl.inputs[i]!, supplied_inputs[i]!, expected_inputs[i]!];
      // Check that E' = S'.
      const cause = this.misc(hir_ty.span);
      const r = this.at(cause, this.param_env).eq("Yes", expected_ty, supplied_ty, ToTrace_Ty);
      if (r.$ === "Err") return r;
      const { obligations } = r._0;
      all_obligations.push(...obligations);
    }

    const supplied_output_ty = FnSig.output(supplied_sig);
    const cause = this.misc(hir.FnRetTy.span(decl.output));
    const r = this.at(cause, this.param_env).eq("Yes", FnSig.output(expected_sigs.liberated_sig), supplied_output_ty, ToTrace_Ty);
    if (r.$ === "Err") return r;
    const { obligations } = r._0;
    all_obligations.push(...obligations);

    const inputs = supplied_inputs.map((ty) => this.deeply_resolve_ignoring_regions(ty, fold_Ty));

    const fn_sig_kind = rust_call_safe_fn_sig_kind(FnSig.c_variadic(expected_sigs.liberated_sig));
    expected_sigs.liberated_sig = this.tcx.mk_fn_sig(inputs, supplied_output_ty, fn_sig_kind);

    return Ok(new InferOk(expected_sigs, all_obligations));
  });
};

/// If there is no expected signature, then we will convert the
/// types that the user gave into a signature.
///
/// Also, record this closure signature for later.
// #[instrument(skip(self, decl), level = "debug", ret)]
// rustc: compiler/rustc_hir_typeck/src/closure.rs:839 supplied_sig_of_closure
FnCtxt.prototype.supplied_sig_of_closure = function (this: FnCtxt, expr_def_id: LocalDefId, decl: hir.FnDecl, closure_kind: hir.ClosureKind): PolyFnSig {
  const lowerer = this.lowerer();

  // trace!("decl = {:#?}", decl);
  // debug!(?closure_kind);

  const hir_id = this.tcx.local_def_id_to_hir_id(expr_def_id);
  const bound_vars = this.tcx.late_bound_vars(hir_id);

  // First, convert the types that the user supplied (if any).
  // PORT: `decl.inputs.iter().map(|a| lowerer.lower_ty(a))` is lazy: it runs inside `mk_fn_sig` below, after
  // `supplied_return`.
  const supplied_arguments = (): Ty[] => decl.inputs.map((a) => lowerer.lower_ty(a));
  let supplied_return: Ty;
  const output = decl.output;
  if (output.$ === "Return") {
    supplied_return = lowerer.lower_ty(output._0);
  } else if (closure_kind.$ === "Coroutine" && closure_kind._0.$ === "Desugared" && closure_kind._0._0 === "Async" && closure_kind._0._1 === "Fn") {
    // In the case of the async block that we create for a function body,
    // we expect the return type of the block to match that of the enclosing
    // function.
    // debug!("closure is async fn body");
    supplied_return =
      this.deduce_future_output_from_obligations(expr_def_id) ??
      // AFAIK, deducing the future output
      // always succeeds *except* in error cases
      // like #65159. I'd like to return Error
      // here, but I can't because I can't
      // easily (and locally) prove that we
      // *have* reported an
      // error. --nikomatsakis
      lowerer.ty_infer(undefined, hir.FnRetTy.span(decl.output));
  } else if (closure_kind.$ === "Coroutine" && closure_kind._0.$ === "Desugared" && (closure_kind._0._0 === "Gen" || closure_kind._0._0 === "AsyncGen")) {
    // All `gen {}` and `async gen {}` must return unit.
    supplied_return = this.tcx.types.unit;
  } else {
    // For async blocks, we just fall back to `_` here.
    // For closures/coroutines, we know nothing about the return
    // type unless it was supplied.
    supplied_return = lowerer.ty_infer(undefined, hir.FnRetTy.span(decl.output));
  }

  const fn_sig_kind = rust_call_safe_fn_sig_kind(decl.c_variadic());
  const result = Binder.bind_with_vars(this.tcx.mk_fn_sig(supplied_arguments(), supplied_return, fn_sig_kind), bound_vars);

  const c_result = this.infcx.canonicalize_response(result, fold_PolyFnSig);
  this.typeck_results.user_provided_sigs.set(expr_def_id, c_result);

  // Normalize only after registering in `user_provided_sigs`.
  return this.normalize(this.tcx.def_span(expr_def_id), Unnormalized.new_wip(result), fold_PolyFnSig);
};

/// Invoked when we are translating the coroutine that results
/// from desugaring an `async fn`. Returns the "sugared" return
/// type of the `async fn` -- that is, the return type that the
/// user specified. The "desugared" return type is an `impl
/// Future<Output = T>`, so we do this by searching through the
/// obligations to extract the `T`.
// #[instrument(skip(self), level = "debug", ret)]
// rustc: compiler/rustc_hir_typeck/src/closure.rs:921 deduce_future_output_from_obligations
FnCtxt.prototype.deduce_future_output_from_obligations = function (this: FnCtxt, body_def_id: LocalDefId): Ty | undefined {
  const ret_coercion = this.ret_coercion ?? span_bug(this.tcx.def_span(body_def_id), "async fn coroutine outside of a fn");

  const closure_span = this.tcx.def_span(body_def_id);
  const ret_ty_ = ret_coercion.expected_ty();
  const ret_ty = this.deeply_resolve_ignoring_regions_with_obligations(ret_ty_, fold_Ty);

  const get_future_output = (clause: Clause, span: Span): Ty | undefined => {
    // Search for a pending obligation like
    //
    // `<R as Future>::Output = T`
    //
    // where R is the return type we are expecting. This type `T`
    // will be our output.
    const bound_clause = clause.kind();
    const bk = Binder.skip_binder(bound_clause);
    if (bk.$ === "Projection") {
      const proj_clause = bk._0;
      return this.deduce_future_output_from_projection(span, Binder.rebind(bound_clause, proj_clause));
    } else {
      return undefined;
    }
  };

  let output_ty: Ty | undefined = undefined;
  const k = ret_ty.kind();
  if (k.$ === "Infer" && k._0.$ === "TyVar") {
    const ret_vid = k._0._0;
    for (const obligation of this.obligations_for_self_ty(ret_vid, "No")) {
      const clause = obligation.predicate.as_clause();
      output_ty = clause !== undefined ? get_future_output(clause, obligation.cause.span) : undefined;
      if (output_ty !== undefined) break;
    }
    if (output_ty === undefined) return undefined;
  } else if (k.$ === "Alias" && k._1.kind.$ === "Projection") {
    return Ty.new_error_with_message(this.tcx, MultiSpan.from_span(closure_span), "this projection should have been projected to an opaque type");
  } else if (k.$ === "Alias" && k._1.kind.$ === "Opaque") {
    const def_id = k._1.kind.def_id;
    const args = k._1.args;
    for (const cs of EarlyBinder.iter_instantiated_copied(this.tcx.explicit_item_self_bounds(def_id) as EarlyBinder<readonly [Clause, Span][]>, this.tcx, args, fold_tuple2(fold_Clause, fold_Span))) {
      const [c, s] = Unnormalized.skip_norm_wip(cs);
      output_ty = get_future_output(c, s);
      if (output_ty !== undefined) break;
    }
    if (output_ty === undefined) return undefined;
  } else if (k.$ === "Error") {
    return ret_ty;
  } else {
    return span_bug(closure_span, `invalid async fn coroutine return type: ${debug_Ty(ret_ty, PLAIN)}`);
  }

  output_ty = this.normalize(closure_span, Unnormalized.new_wip(output_ty), fold_Ty);

  // async fn that have opaque types in their return type need to redo the conversion to inference variables
  // as they fetch the still opaque version from the signature.
  const { value: output_ty_, obligations } = this.replace_opaque_types_with_inference_vars(output_ty, body_def_id, closure_span, this.param_env, fold_Ty);
  this.register_predicates(obligations);

  return output_ty_;
};

/// Given a projection like
///
/// `<X as Future>::Output = T`
///
/// where `X` is some type that has no late-bound regions, returns
/// `Some(T)`. If the projection is for some other trait, returns
/// `None`.
// rustc: compiler/rustc_hir_typeck/src/closure.rs:997 deduce_future_output_from_projection
FnCtxt.prototype.deduce_future_output_from_projection = function (this: FnCtxt, cause_span: Span, predicate_: PolyProjectionClause): Ty | undefined {
  // debug!("deduce_future_output_from_projection(predicate={:?})", predicate);

  // We do not expect any bound regions in our predicate, so
  // skip past the bound vars.
  const predicate = Binder.no_bound_vars(predicate_, fold_ProjectionClause);
  if (predicate === undefined) {
    // debug!("deduce_future_output_from_projection: has late-bound regions");
    return undefined;
  }

  // Check that this is a projection from the `Future` trait.
  const trait_def_id = AliasTerm.trait_def_id(predicate.projection_term, as_interner(this.tcx));
  if (!this.tcx.is_lang_item(trait_def_id, "Future")) {
    // debug!("deduce_future_output_from_projection: not a future");
    return undefined;
  }

  // The `Future` trait has only one associated item, `Output`,
  // so check that this is what we see.
  const output_assoc_item = this.tcx.associated_item_def_ids(trait_def_id)[0]!;
  if (!DefId_eq(output_assoc_item, ProjectionClauseC.def_id(predicate))) {
    span_bug(
      cause_span,
      `projecting associated item \`${debug_AliasTermKind(predicate.projection_term.kind, PLAIN)}\` from future, which is not Output \`${debug_DefId(output_assoc_item, PLAIN)}\``,
    );
  }

  // Extract the type from the projection. Note that there can
  // be no bound variables in this type because the "self type"
  // does not have any regions in it.
  const output_ty = this.deeply_resolve_ignoring_regions(predicate.term, fold_Term);
  // debug!("deduce_future_output_from_projection: output_ty={:?}", output_ty);
  // This is a projection on a Fn trait so will always be a type.
  return Term.expect_type(output_ty);
};

/// Converts the types that the user supplied, in case that doing
/// so should yield an error, but returns back a signature where
/// all parameters are of type `ty::Error`.
// rustc: compiler/rustc_hir_typeck/src/closure.rs:1042 error_sig_of_closure
FnCtxt.prototype.error_sig_of_closure = function (this: FnCtxt, decl: hir.FnDecl, guar: ErrorGuaranteed): PolyFnSig {
  const lowerer = this.lowerer();
  const err_ty = Ty.new_error(this.tcx, guar);

  // PORT: lazy (`map`), consumed by `mk_fn_sig` below, after the return type is lowered.
  const supplied_arguments = (): Ty[] =>
    decl.inputs.map((a) => {
      // Convert the types that the user supplied (if any), but ignore them.
      lowerer.lower_ty(a);
      return err_ty;
    });

  if (decl.output.$ === "Return") {
    const output = decl.output._0;
    lowerer.lower_ty(output);
  }

  const fn_sig_kind = rust_call_safe_fn_sig_kind(decl.c_variadic());
  const result = Binder.dummy(this.tcx.mk_fn_sig(supplied_arguments(), err_ty, fn_sig_kind), fold_FnSig);

  // debug!("supplied_sig_of_closure: result={:?}", result);

  return result;
};

// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_hir_typeck/src/closure.rs:1072 closure_sigs
FnCtxt.prototype.closure_sigs = function (this: FnCtxt, expr_def_id: LocalDefId, bound_sig: PolyFnSig): ClosureSignatures {
  const liberated_sig_ = this.tcx.liberate_late_bound_regions(LocalDefIdC.to_def_id(expr_def_id), bound_sig, fold_FnSig);
  const liberated_sig = this.normalize(this.tcx.def_span(expr_def_id), Unnormalized.new_wip(liberated_sig_), fold_FnSig);
  return { bound_sig, liberated_sig };
};
// }

/** PORT(stand-in): `ArgKind::from_expected_ty` (rustc_trait_selection error_reporting/traits/mod.rs, wave 19, not ported). */
function ArgKind_from_expected_ty(_t: Ty, _span: Span | undefined): never {
  return unported("rustc_trait_selection::error_reporting::traits::ArgKind::from_expected_ty");
}
