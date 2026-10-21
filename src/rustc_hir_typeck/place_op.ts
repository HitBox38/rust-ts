// Port of compiler/rustc_hir_typeck/src/place_op.rs (lane typeck-impl).
//
// `impl<'a, 'tcx> FnCtxt<'a, 'tcx>` (place_op.rs:18): every method is assigned onto `FnCtxt.prototype` (declared in
// ./decls.ts), in upstream order.
// Init order: top-level code here touches only ./decls.ts and other crates; every other rustc_hir_typeck export is read
// inside function bodies only.
import type { Autoderef } from "../rustc_hir_analysis/autoderef.ts";
import type * as hir from "../rustc_hir/lib.ts";
import type { InferOk } from "../rustc_infer/infer/mod.ts";
import { Obligation } from "../rustc_infer/traits/mod.ts";
import type { Adjustment } from "../rustc_middle/ty/adjustment.ts";
import { Mutability_from_AutoBorrowMutability, type AutoBorrowMutability } from "../rustc_middle/ty/adjustment.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_ClauseKind } from "../rustc_middle/ty/predicate.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { Span, type Span as SpanT } from "../rustc_span/lib.ts";
import { span_bug } from "../rustc_span/macros.ts";
import { sym, type Symbol } from "../rustc_span/symbol.ts";
import type { ClauseKind } from "../rustc_type_ir/predicate_kind.ts";
import { FnSig } from "../rustc_type_ir/ty_kind.ts";
import { unwrap } from "../std/panic.ts";
import { FnCtxt } from "./decls.ts";
import type { PlaceOp } from "./lib.gen.ts";
import type { MethodCallee } from "./method/mod.gen.ts";

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {

/// Type-check `*oprnd_expr` with `oprnd_expr` type-checked already.
// rustc: compiler/rustc_hir_typeck/src/place_op.rs:20 lookup_derefing
FnCtxt.prototype.lookup_derefing = function (this: FnCtxt, expr: hir.Expr, oprnd_expr: hir.Expr, oprnd_ty: Ty): Ty | undefined {
  const builtin = oprnd_ty.builtin_deref(true);
  if (builtin !== undefined) {
    return builtin;
  }

  const ok = this.try_overloaded_deref(expr.span, oprnd_ty);
  if (ok === undefined) return undefined;
  const method = this.register_infer_ok_obligations(ok);
  const input0 = FnSig.inputs(method.sig)[0]!;
  const k = input0.kind();
  if (k.$ === "Ref" && k._2 === "Not") {
    this.apply_adjustments(oprnd_expr, [{ kind: { $: "Borrow", _0: { $: "Ref", _0: { $: "Not" } } }, target: input0 }]);
  } else {
    span_bug(expr.span, "input to deref is not a ref?");
  }
  const ty = this.make_overloaded_place_return_type(method);
  this.write_method_call_and_enforce_effects(expr.hir_id, expr.span, method);
  return ty;
};

/// Type-check `*base_expr[index_expr]` with `base_expr` and `index_expr` type-checked already.
// rustc: compiler/rustc_hir_typeck/src/place_op.rs:49 lookup_indexing
FnCtxt.prototype.lookup_indexing = function (
  this: FnCtxt,
  expr: hir.Expr,
  base_expr: hir.Expr,
  base_ty: Ty,
  index_expr: hir.Expr,
  idx_ty: Ty,
): [/*index type*/ Ty, /*element type*/ Ty] | undefined {
  // FIXME(#18741) -- this is almost but not quite the same as the
  // autoderef that normal method probing does. They could likely be
  // consolidated.

  const autoderef = this.autoderef(base_expr.span, base_ty);
  let result: [Ty, Ty] | undefined = undefined;
  while (result === undefined && autoderef.next() !== undefined) {
    result = this.try_index_step(expr, base_expr, autoderef, idx_ty, index_expr);
  }
  this.register_predicates(autoderef.into_obligations());
  return result;
};

// rustc: compiler/rustc_hir_typeck/src/place_op.rs:70 negative_index
FnCtxt.prototype.negative_index = function (this: FnCtxt, ty_: Ty, span: SpanT, base_expr: hir.Expr): [Ty, Ty] | undefined {
  const ty = this.deeply_resolve_ignoring_regions(ty_, fold_Ty);
  const err = this.dcx().struct_span_err(span, `negative integers cannot be used to index on a \`${display_Ty(ty)}\``);
  err.span_label(span, `cannot use a negative integer for indexing on \`${display_Ty(ty)}\``);
  const snippet = this.tcx.sess.source_map().span_to_snippet(base_expr.span);
  if (base_expr.kind.$ === "Path" && snippet.$ === "Ok") {
    // `foo[-1]` to `foo[foo.len() - 1]`
    err.span_suggestion_verbose(
      Span.shrink_to_lo(span),
      `to access an element starting from the end of the \`${display_Ty(ty)}\`, compute the index`,
      `${snippet._0.toString()}.len() `,
      "MachineApplicable",
    );
  }
  const guar = err.emit_err();
  return [Ty.new_error(this.tcx, guar), Ty.new_error(this.tcx, guar)];
};

/// To type-check `base_expr[index_expr]`, we progressively autoderef
/// (and otherwise adjust) `base_expr`, looking for a type which either
/// supports builtin indexing or overloaded indexing.
/// This loop implements one step in that search; the autoderef loop
/// is implemented by `lookup_indexing`.
// rustc: compiler/rustc_hir_typeck/src/place_op.rs:104 try_index_step
FnCtxt.prototype.try_index_step = function (
  this: FnCtxt,
  expr: hir.Expr,
  base_expr: hir.Expr,
  autoderef: Autoderef,
  index_ty: Ty,
  index_expr: hir.Expr,
): [/*index type*/ Ty, /*element type*/ Ty] | undefined {
  const adjusted_ty = this.structurally_resolve_type(autoderef.span(), autoderef.final_ty());
  // debug!("try_index_step(expr={:?}, base_expr={:?}, adjusted_ty={:?}, index_ty={:?})", expr, base_expr, adjusted_ty, index_ty);

  if (index_expr.kind.$ === "Unary" && index_expr.kind._0 === "Neg") {
    const inner = index_expr.kind._1;
    if (inner.kind.$ === "Lit" && inner.kind._0.node.$ === "Int") {
      const k = adjusted_ty.kind();
      if (k.$ === "Adt" && this.tcx.is_diagnostic_item(sym.Vec, k._0.did())) {
        return this.negative_index(adjusted_ty, index_expr.span, base_expr);
      } else if (k.$ === "Slice" || k.$ === "Array") {
        return this.negative_index(adjusted_ty, index_expr.span, base_expr);
      }
    }
  }

  for (const unsize of [false, true]) {
    let self_ty = adjusted_ty;
    if (unsize) {
      // We only unsize arrays here.
      const k = adjusted_ty.kind();
      if (k.$ === "Array") {
        const element_ty = k._0;
        const ct = k._1;
        this.register_predicate(
          Obligation.new(
            this.tcx,
            this.cause(base_expr.span, { $: "ArrayLen", _0: adjusted_ty }),
            this.param_env,
            { $: "ConstArgHasType", _0: ct, _1: this.tcx.types.usize } as ClauseKind,
            (from: ClauseKind, interner) => Predicate_upcast_from_ClauseKind(from, interner as unknown as TyCtxt),
          ),
        );
        self_ty = Ty.new_slice(this.tcx, element_ty);
      } else {
        continue;
      }
    }

    // If some lookup succeeds, write callee into table and extract index/element
    // type from the method signature.
    // If some lookup succeeded, install method in table
    const input_ty = this.next_ty_var(base_expr.span);
    const method_ = this.try_overloaded_place_op(expr.span, self_ty, input_ty, "Index");

    if (method_ !== undefined) {
      const result = method_;
      // debug!("try_index_step: success, using overloaded indexing");
      const method = this.register_infer_ok_obligations(result);

      const adjustments = this.adjust_steps(autoderef);
      const k = FnSig.inputs(method.sig)[0]!.kind();
      if (k.$ === "Ref" && k._2 === "Not") {
        const region = k._0;
        adjustments.push({
          kind: { $: "Borrow", _0: { $: "Ref", _0: { $: "Not" } } },
          target: Ty.new_imm_ref(this.tcx, region, adjusted_ty),
        });
      } else {
        span_bug(expr.span, "input to index is not a ref?");
      }
      if (unsize) {
        adjustments.push({
          kind: { $: "Pointer", _0: { $: "Unsize" } },
          target: FnSig.inputs(method.sig)[0]!,
        });
      }
      this.apply_adjustments(base_expr, adjustments);

      this.write_method_call_and_enforce_effects(expr.hir_id, expr.span, method);

      return [input_ty, this.make_overloaded_place_return_type(method)];
    }
  }

  return undefined;
};

/// Try to resolve an overloaded place op. We only deal with the immutable
/// variant here (Deref/Index). In some contexts we would need the mutable
/// variant (DerefMut/IndexMut); those would be later converted by
/// `convert_place_derefs_to_mutable`.
// rustc: compiler/rustc_hir_typeck/src/place_op.rs:196 try_overloaded_place_op
FnCtxt.prototype.try_overloaded_place_op = function (
  this: FnCtxt,
  span: SpanT,
  base_ty: Ty,
  opt_rhs_ty: Ty | undefined,
  op: PlaceOp,
): InferOk<MethodCallee> | undefined {
  // debug!("try_overloaded_place_op({:?},{:?},{:?})", span, base_ty, op);

  let imm_tr: DefId | undefined;
  let imm_op: Symbol;
  switch (op) {
    case "Deref":
      [imm_tr, imm_op] = [this.tcx.lang_items().deref_trait(), sym.deref];
      break;
    case "Index":
      [imm_tr, imm_op] = [this.tcx.lang_items().index_trait(), sym.index];
      break;
  }
  if (imm_tr === undefined) {
    // Bail if `Deref` or `Index` isn't defined.
    return undefined;
  }

  // FIXME(trait-system-refactor-initiative#231): we may want to treat
  // opaque types as rigid here to support `impl Deref<Target = impl Index<usize>>`.
  const treat_opaques = "AsInfer";
  return this.lookup_method_for_operator(this.misc(span), imm_op, imm_tr, base_ty, opt_rhs_ty, treat_opaques);
};

// rustc: compiler/rustc_hir_typeck/src/place_op.rs:226 try_mutable_overloaded_place_op
FnCtxt.prototype.try_mutable_overloaded_place_op = function (
  this: FnCtxt,
  span: SpanT,
  base_ty: Ty,
  opt_rhs_ty: Ty | undefined,
  op: PlaceOp,
): InferOk<MethodCallee> | undefined {
  // debug!("try_mutable_overloaded_place_op({:?},{:?},{:?})", span, base_ty, op);

  let mut_tr: DefId | undefined;
  let mut_op: Symbol;
  switch (op) {
    case "Deref":
      [mut_tr, mut_op] = [this.tcx.lang_items().deref_mut_trait(), sym.deref_mut];
      break;
    case "Index":
      [mut_tr, mut_op] = [this.tcx.lang_items().index_mut_trait(), sym.index_mut];
      break;
  }
  if (mut_tr === undefined) {
    // Bail if `DerefMut` or `IndexMut` isn't defined.
    return undefined;
  }

  // We have to replace the operator with the mutable variant for the
  // program to compile, so we don't really have a choice here and want
  // to just try using `DerefMut` even if its not in the item bounds
  // of the opaque.
  const treat_opaques = "AsInfer";
  return this.lookup_method_for_operator(this.misc(span), mut_op, mut_tr, base_ty, opt_rhs_ty, treat_opaques);
};

/// Convert auto-derefs, indices, etc of an expression from `Deref` and `Index`
/// into `DerefMut` and `IndexMut` respectively.
///
/// This is a second pass of typechecking derefs/indices. We need this because we do not
/// always know whether a place needs to be mutable or not in the first pass.
/// This happens whether there is an implicit mutable reborrow, e.g. when the type
/// is used as the receiver of a method call.
// rustc: compiler/rustc_hir_typeck/src/place_op.rs:265 convert_place_derefs_to_mutable
FnCtxt.prototype.convert_place_derefs_to_mutable = function (this: FnCtxt, expr0: hir.Expr): void {
  // Gather up expressions we want to munge.
  const exprs: hir.Expr[] = [expr0];

  for (;;) {
    const k = exprs[exprs.length - 1]!.kind;
    if (k.$ === "Field" || k.$ === "Index") {
      exprs.push(k._0);
    } else if (k.$ === "Unary" && k._0 === "Deref") {
      exprs.push(k._1);
    } else {
      break;
    }
  }

  // debug!("convert_place_derefs_to_mutable: exprs={:?}", exprs);

  // Fix up autoderefs and derefs.
  let inside_union = false;
  for (let i = exprs.length - 1; i >= 0; i--) {
    const expr = exprs[i]!;
    // debug!("convert_place_derefs_to_mutable: i={} expr={:?}", i, expr);

    let source = this.node_ty(expr.hir_id);
    if (expr.kind.$ === "Unary" && expr.kind._0 === "Deref") {
      // Clear previous flag; after a pointer indirection it does not apply any more.
      inside_union = false;
    }
    if (source.is_union()) {
      inside_union = true;
    }
    // Fix up the autoderefs. Autorefs can only occur immediately preceding
    // overloaded place ops, and will be fixed by them in order to get
    // the correct region.
    // Do not mutate adjustments in place, but rather take them,
    // and replace them after mutating them, to avoid having the
    // typeck results borrowed during (`deref_mut`) method resolution.
    const previous_adjustments = this.typeck_results.adjustments_mut().remove(expr.hir_id);
    if (previous_adjustments !== undefined) {
      const adjustments = previous_adjustments;
      for (let j = 0; j < adjustments.length; j++) {
        const adjustment = adjustments[j]!;
        if (adjustment.kind.$ === "Deref" && adjustment.kind._0.$ === "Overloaded") {
          const deref = adjustment.kind._0._0;
          const ok = this.try_mutable_overloaded_place_op(expr.span, source, undefined, "Deref");
          if (ok !== undefined) {
            const method = this.register_infer_ok_obligations(ok);
            const out = FnSig.output(method.sig).kind();
            if (out.$ !== "Ref") {
              span_bug(this.tcx.def_span(method.def_id), "expected DerefMut to return a &mut");
            }
            const mutbl = out._2;
            // PORT: `*deref = OverloadedDeref { .. }` writes through the adjustment: the element is replaced (the
            // adjustment objects may be shared with the vector a caller built).
            adjustments[j] = { kind: { $: "Deref", _0: { $: "Overloaded", _0: { mutbl, span: deref.span } } }, target: adjustment.target };
            this.enforce_context_effects(undefined, expr.span, method.def_id, method.args);
            // If this is a union field, also throw an error for `DerefMut` of `ManuallyDrop` (see RFC 2514).
            // This helps avoid accidental drops.
            const adt = source.ty_adt_def();
            if (inside_union && adt !== undefined && adt.is_manually_drop()) {
              this.dcx()
                .struct_span_err(expr.span, "not automatically applying `DerefMut` on `ManuallyDrop` union field")
                .with_help("writing to this reference calls the destructor for the old value")
                .with_help("add an explicit `*` if that is desired, or call `ptr::write` to not run the destructor")
                .emit();
            }
          }
        }
        source = adjustments[j]!.target;
      }
      this.typeck_results.adjustments_mut().insert(expr.hir_id, adjustments);
    }

    const k = expr.kind;
    if (k.$ === "Index") {
      const base_expr = k._0;
      this.convert_place_op_to_mutable("Index", expr, base_expr);
    } else if (k.$ === "Unary" && k._0 === "Deref") {
      const base_expr = k._1;
      this.convert_place_op_to_mutable("Deref", expr, base_expr);
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/place_op.rs:352 convert_place_op_to_mutable
FnCtxt.prototype.convert_place_op_to_mutable = function (this: FnCtxt, op: PlaceOp, expr: hir.Expr, base_expr: hir.Expr): void {
  // debug!("convert_place_op_to_mutable({:?}, {:?}, {:?})", op, expr, base_expr);
  if (!this.typeck_results.is_method_call(expr)) {
    // debug!("convert_place_op_to_mutable - builtin, nothing to do");
    return;
  }

  // Need to deref because overloaded place ops take self by-reference.
  const base_ty = unwrap(this.typeck_results.expr_ty_adjusted(base_expr).builtin_deref(false), "place op takes something that is not a ref");

  let arg_ty: Ty | undefined;
  switch (op) {
    case "Deref":
      arg_ty = undefined;
      break;
    case "Index":
      // We would need to recover the `T` used when we resolve `<_ as Index<T>>::index`
      // in try_index_step. This is the arg at index 1.
      //
      // Note: we should *not* use `expr_ty` of index_expr here because autoderef
      // during coercions can cause type of index_expr to differ from `T` (#72002).
      // We also could not use `expr_ty_adjusted` of index_expr because reborrowing
      // during coercions can also cause type of index_expr to differ from `T`,
      // which can potentially cause regionck failure (#74933).
      arg_ty = this.typeck_results.node_args(expr.hir_id).type_at(1);
      break;
  }
  const method_ = this.try_mutable_overloaded_place_op(expr.span, base_ty, arg_ty, op);
  if (method_ === undefined) {
    // Couldn't find the mutable variant of the place op, keep the
    // current, immutable version.
    return;
  }
  const method = this.register_infer_ok_obligations(method_);
  // debug!("convert_place_op_to_mutable: method={:?}", method);
  this.write_method_call_and_enforce_effects(expr.hir_id, expr.span, method);

  const k = FnSig.inputs(method.sig)[0]!.kind();
  if (!(k.$ === "Ref" && k._2 === "Mut")) {
    span_bug(expr.span, "input to mutable place op is not a mut ref?");
  }
  const region = k._0;

  // Convert the autoref in the base expr to mutable with the correct
  // region and mutability.
  const base_expr_ty = this.node_ty(base_expr.hir_id);
  const adjustments_ref = this.typeck_results.adjustments_mut().get_mut(base_expr.hir_id);
  if (adjustments_ref !== undefined) {
    const adjustments: Adjustment[] = adjustments_ref.value;
    let source = base_expr_ty;
    for (let j = 0; j < adjustments.length; j++) {
      const adjustment = adjustments[j]!;
      if (adjustment.kind.$ === "Borrow" && adjustment.kind._0.$ === "Ref") {
        // debug!("convert_place_op_to_mutable: converting autoref {:?}", adjustment);
        const mutbl: AutoBorrowMutability = {
          $: "Mut",
          // Deref/indexing can be desugared to a method call,
          // so maybe we could use two-phase here.
          // See the documentation of AllowTwoPhase for why that's
          // not the case today.
          allow_two_phase_borrow: "No",
        };
        // PORT: `adjustment.kind = ..; adjustment.target = ..` writes the stored adjustment: the element is replaced.
        adjustments[j] = {
          kind: { $: "Borrow", _0: { $: "Ref", _0: mutbl } },
          target: Ty.new_ref(this.tcx, region, source, Mutability_from_AutoBorrowMutability(mutbl)),
        };
      }
      source = adjustments[j]!.target;
    }

    // If we have an autoref followed by unsizing at the end, fix the unsize target.
    const n = adjustments.length;
    if (
      n >= 2 &&
      adjustments[n - 2]!.kind.$ === "Borrow" &&
      (adjustments[n - 2]!.kind as { _0: { $: string } })._0.$ === "Ref" &&
      adjustments[n - 1]!.kind.$ === "Pointer" &&
      (adjustments[n - 1]!.kind as { _0: { $: string } })._0.$ === "Unsize"
    ) {
      adjustments[n - 1] = { kind: adjustments[n - 1]!.kind, target: FnSig.inputs(method.sig)[0]! };
    }
  }
};
