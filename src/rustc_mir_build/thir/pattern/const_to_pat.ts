// Port of compiler/rustc_mir_build/src/thir/pattern/const_to_pat.rs (lanes thir-cx-print: stub; thir-pattern: port).
// The `impl PatCtxt` block of this file (`const_to_pat`) is put on the prototype of pattern/mod.ts's `PatCtxt`; lib.ts
// loads this module after mod.ts.
import { ControlFlow, VisitorResult } from "../../../rustc_ast_ir/visit.ts";
import { find_attr } from "../../../rustc_attr_ir/lib.ts";
import { LangItem } from "../../../rustc_attr_ir/lang_items.ts";
import type { Diag } from "../../../rustc_errors/lib.ts";
import { msg } from "../../../rustc_errors/lib.ts";
import type { Node as HirNode } from "../../../rustc_hir/hir.ts";
import type { HirId } from "../../../rustc_hir_id/lib.ts";
import type { InferCtxt } from "../../../rustc_infer/infer/mod.ts";
import { Obligation, type PolyTraitObligation } from "../../../rustc_infer/traits/mod.ts";
import type { PredicateObligation } from "../../../rustc_infer/traits/mod.gen.ts";
import { type FieldPat, Pat, type PatKind, visit_with_Pat } from "../../../rustc_middle/thir.ts";
import { ObligationCause } from "../../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Value } from "../../../rustc_middle/ty/decls.ts";
import { GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import { HasAttrs_DefId, type Ty, TypingEnv } from "../../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_TraitRef } from "../../../rustc_middle/ty/predicate.ts";
import { display_Ty } from "../../../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { fold_with_ParamEnv, try_fold_with_ParamEnv, visit_with_ParamEnv } from "../../../rustc_middle/ty/mod.ts";
import { type DefId, LocalDefId } from "../../../rustc_span/def_id.ts";
import { DUMMY_SP, Span } from "../../../rustc_span/lib.ts";
import { Edition } from "../../../rustc_span/edition.ts";
import type { Generics } from "../../../rustc_middle/ty/generics.ts";
import { span_bug } from "../../../rustc_span/macros.ts";
import { SyntaxContext } from "../../../rustc_span/hygiene.ts";
import { Binder } from "../../../rustc_type_ir/binder.ts";
import { AliasConstKind, ValTreeKind } from "../../../rustc_type_ir/const_kind.ts";
import type { AliasConst } from "../../../rustc_middle/ty/consts.gen.ts";
import type { TypeFoldable } from "../../../rustc_type_ir/fold.ts";
import { TypeVisitableExt, type TypeVisitor, TypeVisitor_provided } from "../../../rustc_type_ir/visit.ts";
import { visit_with_TraitRef } from "../../../rustc_type_ir/predicate.gen.ts";
import { as_interner, PolyTraitClause, TraitRef } from "../../../rustc_type_ir/predicate.ts";
import { compute_applicable_impls_for_diagnostics } from "../../../rustc_trait_selection/error_reporting/traits/ambiguity.ts";
import { relate_AliasConst } from "../../../rustc_type_ir/relate.ts";
import { type Const, debug_Const, fold_Const } from "../../../rustc_type_ir/sty/consts.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert, panic, unported, unreachable } from "../../../std/panic.ts";
import { Ok } from "../../../std/result.ts";
import {
  ConstPatternDependsOnGenericParameter_diagnostic,
  CouldNotEvalConstPattern_diagnostic,
  InvalidPattern_diagnostic,
  NaNPattern_diagnostic,
  PointerPattern_diagnostic,
  type SuggestEq,
  TypeNotPartialEq_diagnostic,
  TypeNotStructural_diagnostic,
  UnionPattern_diagnostic,
  UnsizedPattern_diagnostic,
} from "../../diagnostics.ts";
import { PatCtxt } from "./mod.ts";

declare module "./mod.ts" {
  interface PatCtxt {
    /// Converts a constant to a pattern (if possible).
    /// This means aggregate values (like structs and enums) are converted
    /// to a pattern that matches the value (as if you'd compared via structural equality).
    ///
    /// Only type system constants are supported, as we are using valtrees
    /// as an intermediate step. Unfortunately those don't carry a type
    /// so we have to carry one ourselves.
    const_to_pat(c: Const, ty: Ty, id: HirId, span: Span): Pat;
  }
}

// impl<'tcx, 'ptcx> PatCtxt<'tcx, 'ptcx>

/// Converts a constant to a pattern (if possible).
/// This means aggregate values (like structs and enums) are converted
/// to a pattern that matches the value (as if you'd compared via structural equality).
///
/// Only type system constants are supported, as we are using valtrees
/// as an intermediate step. Unfortunately those don't carry a type
/// so we have to carry one ourselves.
// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_mir_build/src/thir/pattern/const_to_pat.rs:43 const_to_pat
PatCtxt.prototype.const_to_pat = function (this: PatCtxt, c: Const, ty: Ty, id: HirId, span: Span): Pat {
  const convert = ConstToPat.new(this, id, span, c);

  const k = c.kind();
  switch (k.$) {
    case "Alias":
      return convert.alias_to_pat(k._1, ty);
    case "Value":
      return convert.valtree_to_pat(k._0);
    default:
      return span_bug(span, `Invalid \`ConstKind\` for \`const_to_pat\`: ${debug_Const(c, PLAIN)}`);
  }
};

// rustc-type: compiler/rustc_mir_build/src/thir/pattern/const_to_pat.rs:60 ConstToPat
export class ConstToPat {
  constructor(
    public tcx: TyCtxt,
    public typing_env: TypingEnv,
    public span: Span,
    public id: HirId,

    public c: Const,
  ) {}

  // rustc: compiler/rustc_mir_build/src/thir/pattern/const_to_pat.rs:70 new
  static new(pat_ctxt: PatCtxt, id: HirId, span: Span, c: Const): ConstToPat {
    // trace!(?pat_ctxt.typeck_results.hir_owner);
    return new ConstToPat(pat_ctxt.tcx, pat_ctxt.typing_env, span, id, c);
  }

  // rustc: compiler/rustc_mir_build/src/thir/pattern/const_to_pat.rs:75 type_marked_structural
  type_marked_structural(ty: Ty): boolean {
    return ty.is_structural_eq_shallow(this.tcx);
  }

  /// We errored. Signal that in the pattern, so that follow up errors can be silenced.
  // rustc: compiler/rustc_mir_build/src/thir/pattern/const_to_pat.rs:80 mk_err
  mk_err(err: Diag, ty: Ty): Pat {
    const ck = this.c.kind();
    if (ck.$ === "Alias") {
      const alias_const = ck._1;
      const ak = alias_const.kind;
      let local: LocalDefId | undefined;
      if (
        (ak.$ === "Projection" || ak.$ === "InherentSelf" || ak.$ === "InherentImpl") &&
        (local = ak.def_id.as_local()) !== undefined
      ) {
        const def_id = local;
        // Include the container item in the output.
        err.span_context(this.tcx.def_span(this.tcx.local_parent(def_id)));
      }
      if (ak.$ === "Projection" || ak.$ === "InherentSelf" || ak.$ === "InherentImpl" || ak.$ === "Free") {
        const def_id = ak.def_id;
        err.span_label(this.tcx.def_span(def_id), msg("constant defined here"));
      }
    }
    return new Pat(ty, this.span, undefined, { $: "Error", _0: err.emit_err() });
  }

  // rustc: compiler/rustc_mir_build/src/thir/pattern/const_to_pat.rs:101 alias_to_pat
  alias_to_pat(alias_const_: AliasConst, ty: Ty): Pat {
    // It's not *technically* correct to be revealing opaque types here as borrowcheck has
    // not run yet. However, CTFE itself uses `TypingMode::PostAnalysis` unconditionally even
    // during typeck and not doing so has a lot of (undesirable) fallout (#101478, #119821).
    // As a result we always use a revealed env when resolving the instance to evaluate.
    //
    // FIXME: `const_eval_resolve_for_typeck` should probably just modify the env itself
    // instead of having this logic here
    const typing_env = this.tcx.erase_and_anonymize_regions(this.typing_env, d_TypingEnv).with_codegen_normalized(this.tcx);
    const alias_const = this.tcx.erase_and_anonymize_regions(alias_const_, relate_AliasConst);

    const mk_too_generic_err = (): Pat => {
      const err = this.tcx.dcx().create_err(ConstPatternDependsOnGenericParameter_diagnostic({ span: this.span }));
      for (const arg of alias_const.args) {
        const ak = GenericArg.kind(arg);
        let tk;
        if (ak.$ === "Type" && (tk = ak._0.kind()).$ === "Param") {
          const param_ty = tk._0;
          const def_id = this.tcx.hir_enclosing_body_owner(this.id);
          const generics = this.tcx.generics_of(def_id) as Generics;
          const param = generics.type_param(param_ty, this.tcx);
          const span = this.tcx.def_span(param.def_id);
          err.span_label(span, "constant depends on this generic parameter");
          const ident = this.tcx.def_ident_span(def_id);
          if (ident !== undefined && this.tcx.sess.source_map().is_multiline(Span.between(ident, span))) {
            // Display the `fn` name as well in the diagnostic, as the generic isn't
            // in the same line and it could be confusing otherwise.
            err.span_context(ident);
          }
        }
      }
      return this.mk_err(err, ty);
    };

    // Under gca_const_items, `alias_const` might be a regular const declared in a trait, but
    // is `impl`d as a directly represented const. We do not know whether it is here, so we must
    // use type system normalization for all consts under gca_const_items.
    //
    // We probably want to always use type system normalization on stable too, but that would be
    // a breaking change (in addition to needing significant improvements to diagnostics), so
    // right now, we limit this to just gca_const_items.
    //
    // See: https://github.com/rust-lang/project-const-generics/issues/105
    let const_value: Value;
    if (this.tcx.features().gca_const_items() || AliasConstKind.is_direct_const(alias_const.kind, as_interner(this.tcx))) {
      const normalize_r = this.tcx.try_normalize_erasing_regions(this.typing_env, Unnormalized.new_wip(this.c), fold_Const);
      if (normalize_r.$ !== "Ok") {
        const err = this.tcx.dcx().create_err(CouldNotEvalConstPattern_diagnostic({ span: this.span }));
        return this.mk_err(err, ty);
      }
      const normalize = normalize_r._0;

      const nk = normalize.kind();
      if (nk.$ !== "Value") {
        const err = this.tcx.dcx().create_err(CouldNotEvalConstPattern_diagnostic({ span: this.span }));
        return this.mk_err(err, ty);
      }
      const_value = nk._0;
    } else {
      // try to resolve e.g. associated constants to their definition on an impl, and then
      // evaluate the const.
      // PORT: the `match` on `const_eval_resolve_for_typeck`'s result (its `Ok(Ok(c))`, `Err(ErrorHandled::Reported(..))`,
      // `Err(ErrorHandled::TooGeneric)` and `Ok(Err(bad_ty))` arms: UnionPattern / PointerPattern / InvalidPattern,
      // `mk_too_generic_err`) is `alias_to_pat_eval_result` below.
      const valtree = alias_to_pat_eval_result(
        this,
        this.tcx.const_eval_resolve_for_typeck(typing_env, alias_const, this.span),
        ty,
        mk_too_generic_err,
      );
      if (valtree instanceof Pat) return valtree;

      // Lower the valtree to a THIR pattern.
      const_value = { ty, valtree };
    }
    if (TypeVisitableExt.has_param(const_value.ty, fold_Ty)) {
      return mk_too_generic_err();
    }
    const thir_pat = this.valtree_to_pat(const_value);

    if (!TypeVisitableExt.references_error(thir_pat, d_Pat)) {
      // Always check for `PartialEq` if we had no other errors yet.
      if (!type_has_partial_eq_impl(this.tcx, typing_env, ty).has_impl) {
        const err = this.tcx.dcx().create_err(TypeNotPartialEq_diagnostic({ span: this.span, ty }));
        extend_type_not_partial_eq(this.tcx, typing_env, ty, err);
        return this.mk_err(err, ty);
      }
    }

    // Mark the pattern to indicate that it is the result of lowering a named
    // constant. This is used for diagnostics.
    if (thir_pat.extra === undefined) thir_pat.extra = { expanded_const: undefined, ascriptions: [] };
    thir_pat.extra.expanded_const = alias_const.kind;
    return thir_pat;
  }

  // rustc: compiler/rustc_mir_build/src/thir/pattern/const_to_pat.rs:232 lower_field_values_to_fieldpats
  lower_field_values_to_fieldpats(values: Iterable<Value>): FieldPat[] {
    const out: FieldPat[] = [];
    let index = 0;
    for (const value of values) {
      out.push({
        field: index as FieldPat["field"],
        pattern: this.valtree_to_pat(value),
      });
      index += 1;
    }
    return out;
  }

  // Recursive helper for `to_pat`; invoke that (instead of calling this directly).
  // #[instrument(skip(self), level = "debug")]
  // rustc: compiler/rustc_mir_build/src/thir/pattern/const_to_pat.rs:247 valtree_to_pat
  valtree_to_pat(value: Value): Pat {
    const span = this.span;
    const tcx = this.tcx;
    const { ty, valtree } = value;

    let kind: PatKind;
    const tk = ty.kind();
    // Extremely important check for all ADTs!
    // Make sure they are eligible to be used in patterns (structural), and if not, emit an
    // error.
    if (tk.$ === "Adt" && !this.type_marked_structural(ty)) {
      const adt_def = tk._0;
      // This ADT cannot be used as a constant in patterns.
      // debug!(?adt_def, ?value.ty, "ADT type in pattern is not `type_marked_structural`");
      const {
        is_derived,
        possibly_inapplicable_structural_partial_eq,
        non_blanket_impl,
        possibly_inapplicable_derived_partial_eq,
        has_impl,
      } = type_has_partial_eq_impl(this.tcx, this.typing_env, ty);

      // If we have a derived PartialEq impl but it does not apply,
      // then error about that instead, because `TypeNotStructural` gives advice that is
      // relevant only when the problem is that `ty` does not derive `PartialEq`.
      //
      // Note that this is a duplicate of a check in `alias_to_pat()`,
      // which we would run later if we weren’t emitting an error now.
      if (possibly_inapplicable_derived_partial_eq && !has_impl) {
        const err = this.tcx.dcx().create_err(TypeNotPartialEq_diagnostic({ span: this.span, ty }));
        extend_type_not_partial_eq(this.tcx, this.typing_env, ty, err);
        return this.mk_err(err, ty);
      }

      let manual_partialeq_impl_span: Span | undefined;
      let manual_partialeq_impl_note: boolean;
      if (possibly_inapplicable_structural_partial_eq) {
        [manual_partialeq_impl_span, manual_partialeq_impl_note] = [undefined, false];
      } else if (non_blanket_impl !== undefined && non_blanket_impl.is_local() && !is_derived) {
        const def_id = non_blanket_impl;
        [manual_partialeq_impl_span, manual_partialeq_impl_note] = [tcx.def_span(def_id), false];
      } else {
        [manual_partialeq_impl_span, manual_partialeq_impl_note] = [undefined, true];
      }
      const manual_partialeq_impl = manual_partialeq_impl_note || manual_partialeq_impl_span !== undefined;
      const is_local = adt_def.did().is_local();
      const ty_def_span = tcx.def_span(adt_def.did());
      let suggestion: SuggestEq | undefined;
      const snippet = tcx.sess.source_map().span_to_snippet(this.span);
      if (snippet.$ === "Ok" && (is_local || manual_partialeq_impl)) {
        const name = snippet._0.toString();
        let hir_id = this.id;
        let parent: HirNode;
        while ((parent = tcx.parent_hir_node(hir_id)).$ === "Pat") {
          const pat = parent._0;
          hir_id = pat.hir_id;
        }
        const node = tcx.parent_hir_node(hir_id);
        let let_stmt;
        let init;
        let els;
        if (node.$ === "Arm" && node._0.guard === undefined) {
          const pat = node._0.pat;
          // Add an if condition to the match arm.
          suggestion = {
            $: "AddIf",
            if_span: Span.shrink_to_hi(pat.span),
            pat_span: this.span,
            name,
            ty,
            manual_partialeq_impl,
          };
        } else if (node.$ === "Arm" && node._0.guard !== undefined) {
          const guard = node._0.guard;
          // Modify the the match arm if condition and add a check for equality.
          suggestion = {
            $: "AddToIf",
            span: Span.shrink_to_hi(guard.span),
            pat_span: this.span,
            name,
            ty,
            manual_partialeq_impl,
          };
        } else if (node.$ === "Expr" && node._0.kind.$ === "Let") {
          const let_expr = node._0.kind._0;
          const span_ = node._0.span;
          if (let_expr.pat.span === this.span) {
            // `if let CONST = expr` -> `if CONST == expr`.
            suggestion = {
              $: "ReplaceWithEq",
              removal: Span.until(span_, this.span),
              eq: Span.between(this.span, let_expr.init.span),
              ty,
              manual_partialeq_impl,
            };
          } else if (Edition.at_least_rust_2024(tcx.sess.edition())) {
            // `if let Some(CONST) = expr` ->
            // `if let Some(binding) = expr && binding == CONST`.
            suggestion = {
              $: "AddToLetChain",
              span: Span.shrink_to_hi(span_),
              pat_span: this.span,
              name,
              ty,
              manual_partialeq_impl,
            };
          } else {
            suggestion = undefined;
          }
        } else if (
          node.$ === "LetStmt" &&
          (let_stmt = node._0, (init = let_stmt.init) !== undefined) &&
          (els = let_stmt.els) !== undefined &&
          SyntaxContext.is_root(Span.ctxt(init.span)) &&
          SyntaxContext.is_root(Span.ctxt(els.span))
        ) {
          // `let PAT = expr else {` -> `if PAT == expr {`.
          suggestion = {
            $: "ReplaceLetElseWithIf",
            if_span: Span.until(let_stmt.span, let_stmt.pat.span),
            eq: Span.between(let_stmt.pat.span, init.span),
            else_span: Span.between(init.span, els.span),
            ty,
            manual_partialeq_impl,
          };
        } else {
          suggestion = undefined;
        }
      } else {
        suggestion = undefined;
      }
      const err = {
        span,
        ty,
        ty_def_span,
        manual_partialeq_impl_span,
        manual_partialeq_impl_note,
        is_local,
        suggestion,
      };
      return this.mk_err(tcx.dcx().create_err(TypeNotStructural_diagnostic(err)), ty);
    } else if (tk.$ === "Adt" && tk._0.is_enum()) {
      const [adt_def, args] = [tk._0, tk._1];
      const branch = ValTreeKind.to_branch(valtree.kind());
      if (branch.length === 0) return panic("called `Option::unwrap()` on a `None` value");
      const [variant_index_c, ...fields] = branch;
      const variant_index = variant_index_c!.to_leaf().to_u32();
      kind = {
        $: "Variant",
        adt_def,
        args,
        variant_index: variant_index as PatKindVariantIdx,
        subpatterns: this.lower_field_values_to_fieldpats(fields.map((ct) => ct.to_value())),
      };
    } else if (tk.$ === "Adt") {
      const def = tk._0;
      assert(!def.is_union(), "assertion failed: !def.is_union()"); // Valtree construction would never succeed for unions.
      kind = {
        $: "Leaf",
        subpatterns: this.lower_field_values_to_fieldpats(ValTreeKind.to_branch(valtree.kind()).map((ct) => ct.to_value())),
      };
    } else if (tk.$ === "Tuple") {
      kind = {
        $: "Leaf",
        subpatterns: this.lower_field_values_to_fieldpats(ValTreeKind.to_branch(valtree.kind()).map((ct) => ct.to_value())),
      };
    } else if (tk.$ === "Slice") {
      kind = {
        $: "Slice",
        prefix: ValTreeKind.to_branch(valtree.kind()).map((val) => this.valtree_to_pat(val.to_value())),
        slice: undefined,
        suffix: [],
      };
    } else if (tk.$ === "Array") {
      kind = {
        $: "Array",
        prefix: ValTreeKind.to_branch(valtree.kind()).map((val) => this.valtree_to_pat(val.to_value())),
        slice: undefined,
        suffix: [],
      };
    } else if (tk.$ === "Str") {
      // Constant/literal patterns of type `&str` are lowered to a
      // `PatKind::Deref` wrapping a `PatKind::Constant` of type `str`.
      // This pattern node is the `str` constant part.
      //
      // Under `feature(deref_patterns)`, string literal patterns can also
      // have type `str` directly, without the `&`, in order to allow things
      // like `deref!("...")` to work when the scrutinee is `String`.
      kind = { $: "Constant", value };
    } else if (tk.$ === "Ref") {
      const pointee_ty = tk._1;
      if (pointee_ty.is_str() || pointee_ty.is_slice() || pointee_ty.is_sized(tcx, this.typing_env)) {
        kind = {
          $: "Deref",
          // This node has type `ty::Ref`, so it's not a pin-deref.
          pin: "Not",
          // Lower the valtree to a pattern as the pointee type.
          // This works because references have the same valtree
          // representation as their pointee.
          subpattern: this.valtree_to_pat({ ty: pointee_ty, valtree }),
        };
      } else {
        return this.mk_err(tcx.dcx().create_err(UnsizedPattern_diagnostic({ span, non_sm_ty: pointee_ty })), ty);
      }
    } else if (tk.$ === "Float") {
      const flt = tk._0;
      const v = ValTreeKind.to_leaf(valtree.kind());
      // PORT: `ScalarInt::to_f16/32/64/128` need rustc_apfloat (not ported): they stop as UNPORTED (int.ts); the
      // `is_nan()` calls are on their results.
      let is_nan: boolean;
      switch (flt) {
        case "F16":
          is_nan = (v.to_f16() as { is_nan(): boolean }).is_nan();
          break;
        case "F32":
          is_nan = (v.to_f32() as { is_nan(): boolean }).is_nan();
          break;
        case "F64":
          is_nan = (v.to_f64() as { is_nan(): boolean }).is_nan();
          break;
        case "F128":
          is_nan = (v.to_f128() as { is_nan(): boolean }).is_nan();
          break;
      }
      if (is_nan) {
        // NaNs are not ever equal to anything so they make no sense as patterns.
        // Also see <https://github.com/rust-lang/rfcs/pull/3535>.
        return this.mk_err(tcx.dcx().create_err(NaNPattern_diagnostic({ span })), ty);
      } else {
        kind = { $: "Constant", value };
      }
    } else if (
      tk.$ === "Pat" ||
      tk.$ === "Bool" ||
      tk.$ === "Char" ||
      tk.$ === "Int" ||
      tk.$ === "Uint" ||
      tk.$ === "RawPtr"
    ) {
      // The raw pointers we see here have been "vetted" by valtree construction to be
      // just integers, so we simply allow them.
      kind = { $: "Constant", value };
    } else if (tk.$ === "FnPtr") {
      return unreachable(
        "internal error: entered unreachable code: Valtree construction would never succeed for FnPtr, so this is unreachable.",
      );
    } else {
      const err = {
        span,
        non_sm_ty: ty,
        prefix: ty.prefix_string(tcx),
      };
      return this.mk_err(tcx.dcx().create_err(InvalidPattern_diagnostic(err)), ty);
    }

    return new Pat(ty, span, undefined, kind);
  }
}

/** `VariantIdx` as `PatKind::Variant` types it (rustc_middle ty/decls.ts). */
type PatKindVariantIdx = Extract<PatKind, { $: "Variant" }>["variant_index"];

/** PORT: the `match self.tcx.const_eval_resolve_for_typeck(typing_env, alias_const, self.span)` of `alias_to_pat`
 *  (const_to_pat.rs:167), over its result type `EvalToValTreeResult` = `Result<Result<ValTree, Ty>, ErrorHandled>`
 *  (mir/interpret, M4: `ErrorHandled` is `{ $: "Reported" } | { $: "TooGeneric" }` per PORTING §5 until it lands).
 *  Returns the valtree, or the error pattern an arm returns. */
function alias_to_pat_eval_result(
  self: ConstToPat,
  r:
    | { $: "Ok"; _0: { $: "Ok"; _0: Value["valtree"] } | { $: "Err"; _0: Ty } }
    | { $: "Err"; _0: { $: "Reported" } | { $: "TooGeneric" } },
  ty: Ty,
  mk_too_generic_err: () => Pat,
): Value["valtree"] | Pat {
  if (r.$ === "Ok" && r._0.$ === "Ok") {
    return r._0._0;
  } else if (r.$ === "Err" && r._0.$ === "Reported") {
    // Let's tell the use where this failing const occurs.
    const err = self.tcx.dcx().create_err(CouldNotEvalConstPattern_diagnostic({ span: self.span }));
    // We've emitted an error on the original const, it would be redundant to complain
    // on its use as well.
    const ck = self.c.kind();
    if (
      ck.$ === "Alias" &&
      (ck._1.kind.$ === "Projection" ||
        ck._1.kind.$ === "InherentSelf" ||
        ck._1.kind.$ === "InherentImpl" ||
        ck._1.kind.$ === "Free")
    ) {
      err.downgrade_to_delayed_bug();
    }
    return self.mk_err(err, ty);
  } else if (r.$ === "Err") {
    return mk_too_generic_err();
  } else {
    const bad_ty = (r._0 as { $: "Err"; _0: Ty })._0;
    // The pattern cannot be turned into a valtree.
    let e: Diag;
    const bk = bad_ty.kind();
    switch (bk.$) {
      case "Adt": {
        const def = bk._0;
        assert(def.is_union(), "assertion failed: def.is_union()");
        e = self.tcx.dcx().create_err(UnionPattern_diagnostic({ span: self.span }));
        break;
      }
      case "FnPtr":
      case "RawPtr":
        e = self.tcx.dcx().create_err(PointerPattern_diagnostic({ span: self.span }));
        break;
      default:
        e = self.tcx.dcx().create_err(
          InvalidPattern_diagnostic({
            span: self.span,
            non_sm_ty: bad_ty,
            prefix: bad_ty.prefix_string(self.tcx),
          }),
        );
    }
    return self.mk_err(e, ty);
  }
}

/** PORT: `TypeFoldable for ty::TypingEnv` (`#[derive(TypeVisitable, TypeFoldable)]`, rustc_middle ty/mod.rs; no generated
 *  impl yet): `typing_mode` is `#[type_foldable(identity)] #[type_visitable(ignore)]`, `param_env` folds. */
const d_TypingEnv: TypeFoldable<TypingEnv> = {
  visit_with: (self, visitor) => visit_with_ParamEnv(self.param_env, visitor),
  try_fold_with: (self, folder) => {
    const r = try_fold_with_ParamEnv(self.param_env, folder);
    if (r.$ === "Err") return r;
    return Ok(new TypingEnv(self.typing_mode_, r._0));
  },
  fold_with: (self, folder) => new TypingEnv(self.typing_mode_, fold_with_ParamEnv(self.param_env, folder)),
};
/** `ty::TraitRef: TypeVisitable` (derived, rustc_type_ir predicate.gen.ts). */
const d_TraitRef = { visit_with: visit_with_TraitRef };
/** `thir::Pat: TypeVisitable` (`#[derive(TypeVisitable)]`, thir.gen.ts). */
const d_Pat = { visit_with: visit_with_Pat };

/// Given a type with type parameters, visit every ADT looking for types that need to
/// `#[derive(PartialEq)]` for it to be a structural type.
// rustc: compiler/rustc_mir_build/src/thir/pattern/const_to_pat.rs:493 extend_type_not_partial_eq
export function extend_type_not_partial_eq(tcx: TyCtxt, typing_env: TypingEnv, ty: Ty, err: Diag): void {
  /// Collect all types that need to be `StructuralPartialEq`.
  // PORT: the local `struct UsedParamsNeedInstantiationVisitor` with `impl TypeVisitor<TyCtxt>` (`type Result =
  // ControlFlow<()>`); the provided methods it does not override delegate to `TypeVisitor_provided`.
  class UsedParamsNeedInstantiationVisitor implements TypeVisitor<ControlFlow<null>> {
    readonly Result = VisitorResult.ControlFlow<null>();
    constructor(
      public tcx: TyCtxt,
      public typing_env: TypingEnv,
      /// The user has written `impl PartialEq for Ty` which means it's non-structural.
      public adts_with_manual_partialeq: Set<Span>,
      /// The type has no `PartialEq` implementation, neither manual or derived.
      public adts_without_partialeq: Set<Span>,
      /// The user has written `impl PartialEq for Ty` which means it's non-structural,
      /// but we don't have a span to point at, so we'll just add them as a `note`.
      public manual: Set<Ty>,
      /// The type has no `PartialEq` implementation, neither manual or derived, but
      /// we don't have a span to point at, so we'll just add them as a `note`.
      public without: Set<Ty>,
    ) {}

    // rustc: compiler/rustc_mir_build/src/thir/pattern/const_to_pat.rs:517 visit_ty
    visit_ty(ty: Ty): ControlFlow<null> {
      const k = ty.kind();
      switch (k.$) {
        case "Dynamic":
          return ControlFlow.Break(null);
        // Unsafe binders never implement `PartialEq`, so avoid walking into them
        // which would require instantiating its binder with placeholders too.
        case "UnsafeBinder":
          return ControlFlow.Break(null);
        case "FnPtr":
          return ControlFlow.CONTINUE;
        case "Adt": {
          const def = k._0;
          const ty_def_id = def.did();
          const ty_def_span = this.tcx.def_span(ty_def_id);
          const {
            has_impl,
            is_derived,
            possibly_inapplicable_structural_partial_eq: structural_partial_eq,
            non_blanket_impl,
          } = type_has_partial_eq_impl(this.tcx, this.typing_env, ty);
          if (structural_partial_eq) {
            // (_, _, true, _) => {}
          } else if (has_impl && !is_derived && non_blanket_impl !== undefined && non_blanket_impl.is_local()) {
            const def_id = non_blanket_impl;
            this.adts_with_manual_partialeq.add(this.tcx.def_span(def_id));
          } else if (has_impl && !is_derived && ty_def_id.is_local()) {
            this.adts_with_manual_partialeq.add(ty_def_span);
          } else if (!has_impl && ty_def_id.is_local()) {
            this.adts_without_partialeq.add(ty_def_span);
          } else if (has_impl && !is_derived) {
            this.manual.add(ty);
          } else if (!has_impl) {
            this.without.add(ty);
          } else {
            // _ => {}
          }
          return fold_Ty.super_visit_with(ty, this);
        }
        default:
          return fold_Ty.super_visit_with(ty, this);
      }
    }

    // (provided)
    visit_binder: TypeVisitor<ControlFlow<null>>["visit_binder"] = (t, d) => TypeVisitor_provided.visit_binder(this, t, d);
    visit_region: TypeVisitor<ControlFlow<null>>["visit_region"] = (r) => TypeVisitor_provided.visit_region(this, r);
    visit_const: TypeVisitor<ControlFlow<null>>["visit_const"] = (c) => TypeVisitor_provided.visit_const(this, c);
    visit_predicate: TypeVisitor<ControlFlow<null>>["visit_predicate"] = (p, d) => TypeVisitor_provided.visit_predicate(this, p, d);
    visit_clauses: TypeVisitor<ControlFlow<null>>["visit_clauses"] = (c) => TypeVisitor_provided.visit_clauses(this, c);
    visit_error: TypeVisitor<ControlFlow<null>>["visit_error"] = (g) => TypeVisitor_provided.visit_error(this, g);
  }
  const v = new UsedParamsNeedInstantiationVisitor(tcx, typing_env, new Set(), new Set(), new Set(), new Set());
  if (v.visit_ty(ty).$ === "Break") {
    return;
  }
  // #[allow(rustc::potential_query_instability)] // Span labels will be sorted by the rendering
  for (const span of v.adts_with_manual_partialeq) {
    err.span_note(
      span,
      "the `PartialEq` trait must be derived, manual `impl`s are not sufficient; see https://doc.rust-lang.org/stable/std/marker/trait.StructuralPartialEq.html for details",
    );
  }
  // #[allow(rustc::potential_query_instability)] // Span labels will be sorted by the rendering
  for (const span of v.adts_without_partialeq) {
    err.span_label(span, "must be annotated with `#[derive(PartialEq)]` to be usable in patterns");
  }
  // #[allow(rustc::potential_query_instability)]
  const manual: string[] = [...v.manual].map((t) => display_Ty(t));
  manual.sort(cmp_string);
  for (const ty of manual) {
    err.note(
      `\`${ty}\` must be annotated with \`#[derive(PartialEq)]\` to be usable in patterns, manual \`impl\`s are not sufficient; see https://doc.rust-lang.org/stable/std/marker/trait.StructuralPartialEq.html for details`,
    );
  }
  // #[allow(rustc::potential_query_instability)]
  const without: string[] = [...v.without].map((t) => display_Ty(t));
  without.sort(cmp_string);
  for (const ty of without) {
    err.note(`\`${ty}\` must be annotated with \`#[derive(PartialEq)]\` to be usable in patterns`);
  }
}

/** `Ord for String` (byte-wise; equal to UTF-16 code-unit order outside the surrogate range). */
function cmp_string(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// #[derive(Debug)]
// rustc-type: compiler/rustc_mir_build/src/thir/pattern/const_to_pat.rs:600 PartialEqImplStatus
export interface PartialEqImplStatus {
  /// There is a `PartialEq` impl that applies to the type.
  has_impl: boolean;

  /// The `PartialEq` impl is `#[automatically_derived]`.
  is_derived: boolean;
  /// The `DefId` of the same impl that `is_derived` refers to.
  non_blanket_impl: DefId | undefined;

  /// If true, there is a `StructuralPartialEq` implementation,
  /// but its bounds might not be satisfied.
  possibly_inapplicable_structural_partial_eq: boolean;
  /// If true, there is a derived `PartialEq` implementation for the type,
  /// but its bounds might not be satisfied.
  possibly_inapplicable_derived_partial_eq: boolean;
}

// #[instrument(level = "trace", skip(tcx), ret)]
// rustc: compiler/rustc_mir_build/src/thir/pattern/const_to_pat.rs:618 type_has_partial_eq_impl
export function type_has_partial_eq_impl(tcx: TyCtxt, typing_env: TypingEnv, ty: Ty): PartialEqImplStatus {
  const [infcx, param_env] = tcx.infer_ctxt().build_with_typing_env(typing_env);
  // double-check there even *is* a semantic `PartialEq` to dispatch to.
  //
  // (If there isn't, then we can safely issue a hard
  // error, because that's never worked, due to compiler
  // using `PartialEq::eq` in this scenario in the past.)
  const partial_eq_trait_id = tcx.require_lang_item(LangItem.PartialEq, DUMMY_SP);
  const structural_partial_eq_trait_id = tcx.require_lang_item(LangItem.StructuralPeq, DUMMY_SP);

  // This *could* accept a type that isn't actually `PartialEq`, because region bounds get
  // ignored. However that should be pretty much impossible since consts that do not depend on
  // generics can only mention the `'static` lifetime, and how would one have a type that's
  // `PartialEq` for some lifetime but *not* for `'static`? If this ever becomes a problem
  // we'll need to leave some sort of trace of this requirement in the MIR so that borrowck
  // can ensure that the type really implements `PartialEq`.
  // We also do *not* require `const PartialEq`, not even in `const fn`. This violates the model
  // that patterns can only do things that the code could also do without patterns, but it is
  // needed for backwards compatibility. The actual pattern matching compares primitive values,
  // `PartialEq::eq` never gets invoked, so there's no risk of us running non-const code.
  let has_impl: boolean;
  {
    const obligation: PredicateObligation = Obligation.new(
      tcx,
      ObligationCause.dummy(),
      param_env,
      TraitRef.new(as_interner(tcx), partial_eq_trait_id, [ty, ty]),
      (from, _cx) => Predicate_upcast_from_TraitRef(from, tcx),
    );
    has_impl = infcx.predicate_must_hold_modulo_regions(obligation);
  }

  // Determine whether there are is a derived `PartialEq` implementation, whether or not its
  // bounds are met.
  let possibly_inapplicable_derived_partial_eq: boolean;
  {
    const obligation: PolyTraitObligation = Obligation.new(
      tcx,
      ObligationCause.dummy(),
      param_env,
      Binder.dummy(TraitRef.new(as_interner(tcx), partial_eq_trait_id, [ty, ty]), d_TraitRef),
      (from, _cx) => PolyTraitClause.upcast_from_PolyTraitRef(from, as_interner(tcx)),
    );
    possibly_inapplicable_derived_partial_eq = compute_applicable_impls_for_diagnostics(infcx, obligation, true).some(
      (candidate_source) =>
        candidate_source.$ === "DefId" &&
        find_attr(HasAttrs_DefId.get_attrs(candidate_source._0, tcx), (k) => (k.$ === "AutomaticallyDerived" ? true : undefined)) !==
          undefined,
    );
  }

  let possibly_inapplicable_structural_partial_eq: boolean;
  {
    const obligation: PolyTraitObligation = Obligation.new(
      tcx,
      ObligationCause.dummy(),
      param_env,
      Binder.dummy(TraitRef.new(as_interner(tcx), structural_partial_eq_trait_id, [ty]), d_TraitRef),
      (from, _cx) => PolyTraitClause.upcast_from_PolyTraitRef(from, as_interner(tcx)),
    );
    possibly_inapplicable_structural_partial_eq = compute_applicable_impls_for_diagnostics(infcx, obligation, true).some(
      (candidate_source) => candidate_source.$ === "DefId",
    );
  }

  let automatically_derived = false;
  let impl_def_id: DefId | undefined = undefined;
  for (const def_id of tcx.non_blanket_impls_for_ty(partial_eq_trait_id, ty)) {
    automatically_derived =
      find_attr(HasAttrs_DefId.get_attrs(def_id, tcx), (k) => (k.$ === "AutomaticallyDerived" ? true : undefined)) !== undefined;
    impl_def_id = def_id;
  }

  return {
    has_impl,
    is_derived: automatically_derived,
    possibly_inapplicable_structural_partial_eq,
    non_blanket_impl: impl_def_id,
    possibly_inapplicable_derived_partial_eq,
  };
}
