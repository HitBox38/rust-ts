// Port of compiler/rustc_hir_typeck/src/lib.rs: the crate root (lane fnctxt-contract; see
// docs/handoff/fnctxt-contract.md).
//
// Layout and init order (a TDZ ReferenceError at load otherwise):
// - The other crates first (rustc_infer, rustc_trait_selection, rustc_hir_analysis), so that every `InferCtxt`
//   prototype method (including rustc_trait_selection's extension methods) exists before `install_derefs()` below.
// - ./decls.ts, the contract (`FnCtxt`, `TypeckRootCtxt`, the Deref registry), which imports only types.
// - Every module in upstream `mod` order (each extends `FnCtxt.prototype` / its classes; the stubs install `unported`
//   placeholders), the sub-modules of fn_ctxt/ and method/ after their parent.
// - Then `install_derefs()`: the `Deref` forwarders of `TypeckRootCtxt -> InferCtxt`, `FnCtxt -> TypeckRootCtxt`,
//   `Coerce` / `ProbeContext` / `ConfirmContext -> FnCtxt`, ... (decls.ts "Deref").
// - Consumers outside the crate import this module only.
//
// `macro_rules! type_error_struct` (lib.rs:66) is the fn `type_error_struct` below (PORT: a macro used by the
// diagnostics of several files).
import { CodegenFnAttrFlags, type CodegenFnAttrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import "../rustc_infer/lib.ts";
import "../rustc_trait_selection/lib.ts";
import "../rustc_hir_analysis/lib.ts";
import { install_derefs } from "./decls.ts";

// mod _match;
import "./_match.ts";
// mod autoderef;
import "./autoderef.ts";
// mod callee;
import "./callee.ts";
// // Used by clippy;
// pub mod cast;
import * as cast from "./cast.ts";
// mod check;
import * as check_mod from "./check.ts";
// mod closure;
import "./closure.ts";
// mod coercion;
import * as coercion from "./coercion.ts";
// mod demand;
import "./demand.ts";
// mod diagnostics;
import "./diagnostics.ts";
// mod diverges;
import "./diverges.ts";
// mod expectation;
import "./expectation.ts";
// mod expr;
import "./expr.ts";
// mod inline_asm;
import "./inline_asm.ts";
// // Used by clippy;
// pub mod expr_use_visitor;
import * as expr_use_visitor from "./expr_use_visitor.ts";
// mod fallback;
import "./fallback.ts";
// mod fn_ctxt;
import "./fn_ctxt/mod.ts";
import "./fn_ctxt/_impl.ts";
import "./fn_ctxt/adjust_fulfillment_errors.ts";
import "./fn_ctxt/arg_matrix.ts";
import "./fn_ctxt/checks.ts";
import "./fn_ctxt/inspect_obligations.ts";
import "./fn_ctxt/suggestions.ts";
// mod gather_locals;
import "./gather_locals.ts";
// mod intrinsicck;
import * as intrinsicck from "./intrinsicck.ts";
// mod loops;
import * as loops from "./loops.ts";
// mod method;
import "./method/mod.ts";
import "./method/confirm.ts";
import "./method/prelude_edition_lints.ts";
import * as method_probe from "./method/probe.ts";
import "./method/suggest.ts";
// mod naked_functions;
import * as naked_functions from "./naked_functions.ts";
// mod op;
import "./op.ts";
// mod opaque_types;
import "./opaque_types.ts";
// mod pat;
import "./pat.ts";
// mod place_op;
import "./place_op.ts";
// mod typeck_root_ctxt;
import "./typeck_root_ctxt.ts";
// mod upvar;
import "./upvar.ts";
// mod writeback;
import "./writeback.ts";

import type { Diag, DiagCtxtHandle } from "../rustc_errors/lib.ts";
import * as hir from "../rustc_hir/lib.ts";
import type { DefKind, Res } from "../rustc_hir/def.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import { check_abi } from "../rustc_hir_analysis/check/check.ts";
import type { ObligationInspector } from "../rustc_infer/traits/mod.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import type { Generics } from "../rustc_middle/ty/generics.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { host_tuple } from "../rustc_session/config.ts";
import { extra_compiler_flags } from "../rustc_session/utils.ts";
import { debug_LocalDefId, LocalDefId } from "../rustc_span/def_id.ts";
import { AssocItem } from "../rustc_middle/ty/assoc.ts";
import type { ParamEnv } from "../rustc_middle/ty/mod.ts";
import { PLAIN } from "../std/fmt.ts";
import { display_HirId } from "../rustc_hir_id/lib.ts";
import { type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { EarlyBinder, Binder } from "../rustc_type_ir/binder.ts";
import type { FnSig as FnSigT, PolyFnSig } from "../rustc_type_ir/decls.ts";
import { FnSig, FnSigKind, fold_FnSig } from "../rustc_type_ir/ty_kind.ts";
import type { FnSigKind as FnSigKindT } from "../rustc_type_ir/decls.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import type { Mutability } from "../rustc_ast_ir/lib.ts";
import type { ErrCode } from "../rustc_errors/lib.ts";
import { E0164 } from "../rustc_errors/error_codes.gen.ts";
import { Res as ResC } from "../rustc_hir/def.ts";
import { qpath_to_string } from "../rustc_hir_pretty/lib.ts";
import { debug_OwnerId, HirId_eq, OwnerId_eq } from "../rustc_hir_id/lib.ts";
import { display_Ident, Symbol } from "../rustc_span/symbol.ts";
import { FnCtxt_as_PpAnn } from "./fn_ctxt/mod.ts";
import { assert, assert_eq, unported, unwrap } from "../std/panic.ts";
import { FnCtxt, TypeckRootCtxt, type Companions } from "./decls.ts";
import * as gen from "./lib.gen.ts";
import { type BreakableCtxt, EnclosingBreakables, type Needs as NeedsT, type TupleArgumentsFlag as TupleArgumentsFlagT } from "./lib.gen.ts";

export * from "./lib.gen.ts";
export { cast, expr_use_visitor };
// pub use coercion::can_coerce;
export const can_coerce = coercion.can_coerce;
export { FnCtxt, TypeckRootCtxt } from "./decls.ts";
export { Expectation } from "./expectation.ts";
export { Diverges } from "./diverges.ts";
export { LoweredTy } from "./fn_ctxt/mod.ts";
export { GatherLocalsVisitor } from "./gather_locals.ts";
export { CoerceMany } from "./coercion.ts";


// #[macro_export] macro_rules! type_error_struct
/** PORT: `type_error_struct!($dcx, $span, $typ, $code, $($message)*)` (lib.rs:66), the message already formatted. */
export function type_error_struct(dcx: DiagCtxtHandle, span: Span, typ: Ty, code: ErrCode, message: string): Diag {
  const err = dcx.struct_span_err(span, message).with_code(code);

  if (TypeVisitableExt.references_error(typ, fold_Ty)) {
    err.downgrade_to_delayed_bug();
  }

  return err;
}

// rustc: compiler/rustc_hir_typeck/src/lib.rs:80 used_trait_imports
export function used_trait_imports(tcx: TyCtxt, def_id: LocalDefId): Set<LocalDefId> {
  return (tcx.typeck(def_id) as TypeckResults).used_trait_imports;
}

// rustc: compiler/rustc_hir_typeck/src/lib.rs:84 typeck_root
export function typeck_root(tcx: TyCtxt, def_id: LocalDefId): TypeckResults {
  return typeck_with_inspect(tcx, def_id, undefined);
}

/// Same as `typeck` but `inspect` is invoked on evaluation of each root obligation.
/// Inspecting obligations only works with the new trait solver.
/// This function is *only to be used* by external tools, it should not be
/// called from within rustc. Note, this is not a query, and thus is not cached.
// rustc: compiler/rustc_hir_typeck/src/lib.rs:92 inspect_typeck
export function inspect_typeck(tcx: TyCtxt, def_id: LocalDefId, inspect: ObligationInspector): TypeckResults {
  // Closures' typeck results come from their outermost function,
  // as they are part of the same "inference environment".
  const typeck_root_def_id = tcx.typeck_root_def_id_local(def_id);
  if (typeck_root_def_id !== def_id) {
    return tcx.typeck(typeck_root_def_id) as TypeckResults;
  }

  return typeck_with_inspect(tcx, def_id, inspect);
}

// #[instrument(level = "debug", skip(tcx, inspector), ret)]
// rustc: compiler/rustc_hir_typeck/src/lib.rs:108 typeck_with_inspect
export function typeck_with_inspect(tcx: TyCtxt, def_id: LocalDefId, inspector: ObligationInspector | undefined): TypeckResults {
  assert(!tcx.is_typeck_child(LocalDefId.to_def_id(def_id)), "assertion failed: !tcx.is_typeck_child(def_id.to_def_id())");

  const id = tcx.local_def_id_to_hir_id(def_id);
  const node = tcx.hir_node(id);
  const span = tcx.def_span(def_id);

  // Figure out what primary body this item has.
  const body_id = hir.Node.body_id(node) ?? span_bug(span, `can't type-check body of ${debug_LocalDefId(def_id, PLAIN)}`);
  const body = tcx.hir_body(body_id);

  const param_env = tcx.param_env(def_id) as ParamEnv;

  const root_ctxt = TypeckRootCtxt.new(tcx, def_id);
  if (inspector !== undefined) {
    root_ctxt.infcx.attach_obligation_inspector(inspector);
  }
  const fcx = FnCtxt.new(root_ctxt, param_env, def_id);

  const fn_sig_ = hir.Node.fn_sig(node);
  if (node.$ === "Item" && node._0.kind.$ === "GlobalAsm") {
    // Check the fake body of a global ASM. There's not much to do here except
    // for visit the asm expr of the body.
    const ty = fcx.check_expr(body.value);
    fcx.write_ty(id, ty);
  } else if (fn_sig_ !== undefined) {
    const { header, decl } = fn_sig_;
    let fn_sig_poly: PolyFnSig;
    if (decl.output.$ === "Return" ? decl.output._0.is_suggestable_infer_ty() : false) {
      // In the case that we're recovering `fn() -> W<_>` or some other return
      // type that has an infer in it, lower the type directly so that it'll
      // be correctly filled with infer. We'll use this inference to provide
      // a suggestion later on.
      fn_sig_poly = fcx.lowerer().lower_fn_ty(id, header.safety_(), header.abi, decl, undefined, undefined);
    } else {
      fn_sig_poly = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(def_id) as EarlyBinder<PolyFnSig>));
    }

    check_abi(tcx, id, span, FnSig.abi(Binder.skip_binder(fn_sig_poly)));

    loops.check(tcx, def_id, body);

    // Compute the function signature from point of view of inside the fn.
    let fn_sig: FnSigT = tcx.liberate_late_bound_regions(LocalDefId.to_def_id(def_id), fn_sig_poly, fold_FnSig);

    // Normalize the input and output types one at a time, using a different
    // `WellFormedLoc` for each. We cannot call `normalize_associated_types`
    // on the entire `FnSig`, since this would use the same `WellFormedLoc`
    // for each type, preventing the HIR wf check from generating
    // a nice error message.
    const arg_span = (idx: number): Span => {
      const arg = decl.inputs[idx];
      return arg !== undefined ? arg.span : decl_output_span(decl.output);
    };

    fn_sig = {
      ...fn_sig,
      inputs_and_output: tcx.mk_type_list_from_iter([...fn_sig.inputs_and_output].map((ty, idx) => fcx.normalize(arg_span(idx), Unnormalized.new_wip(ty), fold_Ty))),
    };

    // PORT: the `codegen_fn_attrs` query value is `unknown` in queries.gen.ts.
    if (CodegenFnAttrFlags.contains((tcx.codegen_fn_attrs(LocalDefId.to_def_id(def_id)) as CodegenFnAttrs).flags, CodegenFnAttrFlags.NAKED)) {
      naked_functions.typeck_naked_fn(tcx, def_id, body);
    }

    check_mod.check_fn(fcx, fn_sig, undefined, decl, def_id, body, tcx.features().unsized_fn_params());
  } else {
    let expected_type_: Ty;
    const infer_ty = infer_type_if_missing(fcx, node);
    const node_ty = hir.Node.ty(node);
    if (infer_ty !== undefined) {
      expected_type_ = infer_ty;
    } else if (node_ty !== undefined && node_ty.is_suggestable_infer_ty()) {
      // In the case that we're recovering `const X: [T; _]` or some other
      // type that has an infer in it, lower the type directly so that it'll
      // be correctly filled with infer. We'll use this inference to provide
      // a suggestion later on.
      expected_type_ = fcx.lowerer().lower_ty(node_ty);
    } else {
      expected_type_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>));
    }

    loops.check(tcx, def_id, body);

    const expected_type = fcx.normalize(body.value.span, Unnormalized.new_wip(expected_type_), fold_Ty);

    const wf_code = { $: "WellFormed", _0: { $: "Ty", _0: def_id } } as const;
    fcx.register_wf_obligation(expected_type, body.value.span, wf_code);

    if (node.$ === "AnonConst") {
      fcx.require_type_is_sized(expected_type, body.value.span, { $: "SizedConstOrStatic" });
    }

    fcx.check_expr_coercible_to_type_or_error(body.value, expected_type, undefined, (err, _) => {
      extend_err_with_const_context(err, tcx, node, expected_type);
    });

    fcx.write_ty(id, expected_type);
  }

  // Whether to check repeat exprs before/after inference fallback is somewhat
  // arbitrary of a decision as neither option is strictly more permissive than
  // the other. However, we opt to check repeat exprs first as errors from not
  // having inferred array lengths yet seem less confusing than errors from inference
  // fallback arbitrarily inferring something incompatible with `Copy` inference
  // side effects.
  //
  // FIXME(#140855): This should also be forwards compatible with moving
  // repeat expr checks to a custom goal kind or using marker traits in
  // the future.
  fcx.check_repeat_exprs();

  // We need to handle opaque types before emitting ambiguity errors as applying
  // defining uses may guide type inference.
  if (fcx.next_trait_solver()) {
    fcx.try_handle_opaque_type_uses_next();
  }

  fcx.type_inference_fallback();

  // Even though coercion casts provide type hints, we check casts after fallback for
  // backwards compatibility. This makes fallback a stronger type hint than a cast coercion.
  fcx.check_casts();
  fcx.select_obligations_where_possible((_) => {});

  // Closure and coroutine analysis may run after fallback
  // because they don't constrain other type variables.
  fcx.closure_analyze(body);
  assert(fcx.deferred_call_resolutions.size === 0, "assertion failed: fcx.deferred_call_resolutions.borrow().is_empty()");

  const deferred = fcx.deferred_sized_obligations.splice(0);
  for (const [ty_, span, code] of deferred) {
    const ty = fcx.normalize(span, Unnormalized.new_wip(ty_), fold_Ty);
    fcx.require_type_is_sized(ty, span, code);
  }

  fcx.select_obligations_where_possible((_) => {});

  // debug!(pending_obligations = ?fcx.fulfillment_cx.borrow().pending_obligations());

  // We need to handle opaque types before emitting ambiguity errors as applying
  // defining uses may guide type inference.
  if (fcx.next_trait_solver()) {
    fcx.handle_opaque_type_uses_next();
  }

  // This must be the last thing before `report_ambiguity_errors` below except `select_obligations_where_possible`.
  // So don't put anything after this.
  fcx.drain_stalled_coroutine_obligations();
  if (fcx.infcx.tainted_by_errors() === undefined) {
    fcx.report_ambiguity_errors();
  }

  fcx.check_asms();

  const typeck_results = fcx.resolve_type_vars_in_body(body);

  fcx.detect_opaque_types_added_during_writeback();

  // Consistency check our TypeckResults instance can hold all ItemLocalIds
  // it will need to hold.
  assert_eq(typeck_results.hir_owner, id.owner, (v) => debug_OwnerId(v, PLAIN), OwnerId_eq);

  return typeck_results;
}

/** `hir::FnRetTy::span(&self)`. */
function decl_output_span(output: hir.FnRetTy): Span {
  return output.$ === "Return" ? output._0.span : output._0;
}

// rustc: compiler/rustc_hir_typeck/src/lib.rs:279 extend_err_with_const_context
export function extend_err_with_const_context(err: Diag, tcx: TyCtxt, node: hir.Node, expected_ty: Ty): void {
  if ((node.$ === "ImplItem" && node._0.kind.$ === "Const") || (node.$ === "TraitItem" && node._0.kind.$ === "Const")) {
    const ty = node._0.kind._0;
    // Point at the `Type` in `const NAME: Type = value;`.
    err.span_label(ty.span, "expected because of the type of the associated constant");
    return;
  }
  if (node.$ === "Item" && node._0.kind.$ === "Const") {
    const ty = node._0.kind._2;
    // Point at the `Type` in `const NAME: Type = value;`.
    err.span_label(ty.span, "expected because of the type of the constant");
    return;
  }
  if (node.$ === "Item" && node._0.kind.$ === "Static") {
    const ty = node._0.kind._2;
    // Point at the `Type` in `static NAME: Type = value;`.
    err.span_label(ty.span, "expected because of the type of the static");
    return;
  }
  if (node.$ === "AnonConst") {
    const anon = node._0;
    {
      const parent = tcx.parent_hir_node(anon.hir_id);
      if (parent.$ === "ConstArg") {
        const gp = tcx.parent_hir_node(parent._0.hir_id);
        if (gp.$ === "Ty" && gp._0.kind.$ === "Array") {
          // `[type; len]` in type context.
          err.note("array length can only be `usize`");
          return;
        }
      }
    }
    {
      const parent = tcx.parent_hir_node(anon.hir_id);
      if (parent.$ === "ConstArg") {
        const gp = tcx.parent_hir_node(parent._0.hir_id);
        if (gp.$ === "Expr" && gp._0.kind.$ === "Repeat") {
          // `[type; len]` in expr context.
          err.note("array length can only be `usize`");
          return;
        }
      }
    }
    // FIXME: support method calls too.
    {
      const parent = tcx.parent_hir_node(anon.hir_id);
      if (parent.$ === "ConstArg") {
        const path = hir.Node.path(tcx.parent_hir_node(parent._0.hir_id));
        if (path !== undefined && path.$ === "Resolved" && path._1.res.$ === "Def") {
          const def_id = path._1.res._1;
          const parent_hir_id = parent._0.hir_id;
          // `foo<N>()`, point at the const parameter in the definition of `foo`.
          const segment = path._1.segments[path._1.segments.length - 1];
          const args = segment?.args;
          const i = args === undefined ? -1 : args.args.findIndex((arg: hir.GenericArg) => arg.$ === "Const" && arg._0.hir_id.owner === parent_hir_id.owner && arg._0.hir_id.local_id === parent_hir_id.local_id);
          if (i >= 0) {
            const generics = tcx.generics_of(def_id) as Generics;
            const param = generics.param_at(i, tcx);
            const sp = tcx.def_span(param.def_id);
            err.span_note(sp, "expected because of the type of the const parameter");
          }
          return;
        }
      }
    }
    if (tcx.parent_hir_node(anon.hir_id).$ === "Variant") {
      // FIXME: point at `repr` when present in the type.
      err.note("enum variant discriminant can only be of a primitive type compatible with the enum's `repr`");
      return;
    }
    {
      const parent = tcx.parent_hir_node(anon.hir_id);
      if (parent.$ === "ConstArg") {
        const gp = tcx.parent_hir_node(parent._0.hir_id);
        if (gp.$ === "GenericParam" && gp._0.kind.$ === "Const") {
          const ty = gp._0.kind.ty;
          // `fn foo<const N: usize = ()>` point at the `usize`.
          err.span_label(ty.span, "expected because of the type of the const parameter");
          return;
        }
      }
    }
    {
      const parent = tcx.parent_hir_node(anon.hir_id);
      if (parent.$ === "ConstArg") {
        const ty_pat = tcx.parent_hir_node(parent._0.hir_id);
        if (ty_pat.$ === "TyPat") {
          const ty = tcx.parent_hir_node(ty_pat._0.hir_id);
          if (ty.$ === "Ty" && ty._0.kind.$ === "Pat") {
            // Point at `char` in `pattern_type!(char is 1..=1)`.
            err.span_label(ty._0.kind._0.span, "the pattern must match the type");
            return;
          }
        }
      }
    }
    if (tcx.parent_hir_node(anon.hir_id).$ === "Field" && expected_ty.kind().$ === "Param") {
      err.note("the type of default fields referencing type parameters can't be assumed inside the struct defining them");
      return;
    }
  }
}

// rustc: compiler/rustc_hir_typeck/src/lib.rs:375 infer_type_if_missing
export function infer_type_if_missing(fcx: FnCtxt, node: hir.Node): Ty | undefined {
  const tcx = fcx.tcx;
  const def_id = fcx.body_def_id;
  const node_ty = hir.Node.ty(node);
  let expected_type: Ty | undefined;
  if (node_ty !== undefined && node_ty.kind.$ === "Infer") {
    const span = node_ty.span;
    const item = tcx.opt_associated_item(LocalDefId.to_def_id(def_id));
    if (item !== undefined && item.kind.$ === "Const" && item.container.$ === "TraitImpl" && item.container._0.$ === "Ok") {
      const trait_item_def_id = item.container._0._0;
      const impl_def_id = AssocItem.container_id(item, tcx);
      const impl_trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.impl_trait_ref(impl_def_id)));
      const args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(def_id)).rebase_onto(tcx, impl_def_id, impl_trait_ref.args);
      const alias_kind = { $: "ProjectionConst", def_id: trait_item_def_id } as const;
      expected_type = tcx.check_alias_term_args_compatible(alias_kind, args)
        ? Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(trait_item_def_id) as EarlyBinder<Ty>, tcx, args, fold_Ty))
        : undefined;
    } else {
      expected_type = fcx.next_ty_var(span);
    }
  } else if (node.$ === "AnonConst") {
    const id = tcx.local_def_id_to_hir_id(def_id);
    const parent = tcx.parent_hir_node(id);
    let asm: hir.InlineAsm | undefined;
    let span: Span | undefined;
    if (parent.$ === "Expr" && parent._0.kind.$ === "InlineAsm") {
      asm = parent._0.kind._0;
      span = parent._0.span;
    } else if (parent.$ === "Item" && parent._0.kind.$ === "GlobalAsm") {
      asm = parent._0.kind.asm;
      span = parent._0.span;
    }
    if (asm !== undefined) {
      expected_type = undefined;
      for (const [op, _op_sp] of asm.operands) {
        if (op.$ === "Const" && op.anon_const.hir_id.owner === id.owner && op.anon_const.hir_id.local_id === id.local_id) {
          expected_type = fcx.next_ty_var(span!);
          break;
        }
      }
    } else {
      expected_type = undefined;
    }
  } else {
    expected_type = undefined;
  }
  return expected_type;
}

/// When `check_fn` is invoked on a coroutine (i.e., a body that
/// includes yield), it returns back some information about the yield
/// points.
// (`struct CoroutineTypes` is generated: lib.gen.ts)

export type Needs = NeedsT;
export const Needs: typeof gen.Needs & Companions["Needs"] = {
  ...gen.Needs,

  // impl Needs {
  // rustc: compiler/rustc_hir_typeck/src/lib.rs:437 maybe_mut_place
  maybe_mut_place(m: Mutability): NeedsT {
    switch (m) {
      case "Mut":
        return gen.Needs.MutPlace;
      case "Not":
        return gen.Needs.None;
    }
  },
};

// impl<'tcx> EnclosingBreakables<'tcx> {
// rustc: compiler/rustc_hir_typeck/src/lib.rs:465 find_breakable
EnclosingBreakables.prototype.find_breakable = function (this: EnclosingBreakables, target_id: HirId): BreakableCtxt {
  return this.opt_find_breakable(target_id) ?? bug(`could not find enclosing breakable with id ${display_HirId(target_id)}`);
};

// rustc: compiler/rustc_hir_typeck/src/lib.rs:471 opt_find_breakable
EnclosingBreakables.prototype.opt_find_breakable = function (this: EnclosingBreakables, target_id: HirId): BreakableCtxt | undefined {
  const ix = this.by_id.get(target_id);
  if (ix !== undefined) {
    return this.stack[ix];
  } else {
    return undefined;
  }
};

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {
// rustc: compiler/rustc_hir_typeck/src/lib.rs:479 report_unexpected_variant_res
FnCtxt.prototype.report_unexpected_variant_res = function (
  this: FnCtxt,
  res: Res,
  expr: hir.Expr | undefined,
  sub_pats: readonly hir.Pat[],
  qpath: hir.QPath,
  span: Span,
  err_code: ErrCode,
  expected: string,
): ErrorGuaranteed {
  const tcx = this.tcx;
  const res_descr = res.$ === "Def" && res._0.$ === "Variant" ? "struct variant" : ResC.descr(res);
  const path_str = qpath_to_string(FnCtxt_as_PpAnn(this), qpath);
  const err = tcx.dcx().struct_span_err(span, `expected ${expected}, found ${res_descr} \`${path_str}\``).with_code(err_code);
  let d: Diag;
  if (res.$ === "Def" && (res._0.$ === "Fn" || res._0.$ === "AssocFn") && err_code === E0164) {
    const patterns_url = "https://doc.rust-lang.org/book/ch19-00-patterns.html";
    d = err.with_span_label(span, "`fn` calls are not allowed in patterns").with_help(`for more information, visit ${patterns_url}`);
  } else if (res.$ === "Def" && res._0.$ === "Variant" && expr !== undefined) {
    err.span_label(span, `not a ${expected}`);
    const variant = tcx.expect_variant_res(res);
    const sugg =
      variant.fields.length === 0 ? " {}" : ` { ${variant.fields.map((f) => `${Symbol.as_str(f.name)}: /* value */`).join(", ")} }`;
    const descr = "you might have meant to create a new value of the struct";
    const suggestion: [Span, string][] = [];
    const parent = tcx.parent_hir_node(expr.hir_id);
    if (parent.$ === "Expr" && parent._0.kind.$ === "Call") {
      const call_span = parent._0.span;
      suggestion.push([Span.with_hi(Span.shrink_to_hi(span), Span.hi(call_span)), sugg]);
    } else if (parent.$ === "Expr" && parent._0.kind.$ === "Binary") {
      const hir_id = parent._0.hir_id;
      suggestion.push([Span.shrink_to_lo(expr.span), "("]);
      let parent_: hir.Node;
      let block: hir.Block;
      let expr_: hir.Expr | undefined;
      if (
        (parent_ = tcx.parent_hir_node(hir_id)).$ === "Expr" &&
        parent_._0.kind.$ === "If" &&
        parent_._0.kind._2 === undefined &&
        HirId_eq(parent_._0.kind._0.hir_id, hir_id) &&
        parent_._0.kind._1.kind.$ === "Block" &&
        (block = parent_._0.kind._1.kind._0).stmts.length === 0 &&
        (expr_ = block.expr) !== undefined &&
        expr_.kind.$ === "Path"
      ) {
        // Special case: you can incorrectly write an equality condition:
        // if foo == Struct { field } { /* if body */ }
        // which should have been written
        // if foo == (Struct { field }) { /* if body */ }
        suggestion.push([Span.shrink_to_hi(block.span), ")"]);
      } else {
        suggestion.push([Span.with_hi(Span.shrink_to_hi(span), Span.hi(expr.span)), sugg]);
      }
    } else {
      suggestion.push([Span.shrink_to_hi(span), sugg]);
    }

    err.multipart_suggestion(descr, suggestion, "HasPlaceholders");
    d = err;
  } else if (res.$ === "Def" && res._0.$ === "Variant" && expr === undefined) {
    err.span_label(span, `not a ${expected}`);

    const fields = tcx.expect_variant_res(res).fields;
    // PORT: upstream shadows `span` here; the suggestion below reads the shadowed one.
    const span_ = Span.to(Span.shrink_to_hi(hir.QPath.span(qpath)), Span.shrink_to_hi(span));
    let msg: string;
    let sugg: string;
    if (fields.length === 0) {
      [msg, sugg] = ["use the struct variant pattern syntax", " {}"];
    } else {
      const msg_ = fields.length === 0 ? "use struct variant pattern syntax" : "add the names to match a struct variant's fields";
      const fields_sugg = fields
        .map((field, i) => {
          const field_name = display_Ident(field.ident(tcx));

          let pat_snippet: string | undefined;
          const sub_pat = sub_pats[i];
          if (sub_pat !== undefined) {
            const r = tcx.sess.source_map().span_to_snippet(sub_pat.span);
            pat_snippet = r.$ === "Ok" ? r._0.toString() : undefined;
          }
          pat_snippet ??= "_";

          if (field_name === pat_snippet) {
            return field_name;
          } else {
            return `${field_name}: ${pat_snippet}`;
          }
        })
        .join(", ");
      const sugg_ = ` { ${fields_sugg} }`;
      [msg, sugg] = [msg_, sugg_];
    }

    err.span_suggestion_verbose(Span.to(Span.shrink_to_hi(hir.QPath.span(qpath)), Span.shrink_to_hi(span_)), msg, sugg, "HasPlaceholders");
    d = err;
  } else {
    d = err.with_span_label(span, `not a ${expected}`);
  }
  return d.emit_err();
};
// }

/// Controls whether all arguments are tupled. This is used for the call operator only.
///
/// Tupling means that all call-side arguments are packed into a tuple and passed as a single
/// parameter. For example, if tupling is enabled, this function:
/// ```
/// fn f(x: (isize, isize)) {}
/// ```
/// Can be called as:
/// ```ignore UNSOLVED (can this be done in user code?)
/// # fn f(x: (isize, isize)) {}
/// f(1, 2);
/// ```
/// Instead of:
/// ```
/// # fn f(x: (isize, isize)) {}
/// f((1, 2));
/// ```
///
/// Note: splatted arguments are handled separately.
export type TupleArgumentsFlag = TupleArgumentsFlagT;
export const TupleArgumentsFlag: typeof gen.TupleArgumentsFlag & Companions["TupleArgumentsFlag"] = {
  ...gen.TupleArgumentsFlag,

  // impl TupleArgumentsFlag {
  /// Returns the TupleArgumentsFlag for a known RustCall function.
  // rustc: compiler/rustc_hir_typeck/src/lib.rs:646 rust_fn_trait_call
  rust_fn_trait_call(): TupleArgumentsFlagT {
    return gen.TupleArgumentsFlag.TupleAllCallArgs;
  },

  /// Returns the appropriate TupleArgumentsFlag for the given FnSigKind and method flag.
  // rustc: compiler/rustc_hir_typeck/src/lib.rs:651 with_fn_sig_kind
  with_fn_sig_kind(fn_sig_kind: FnSigKindT, is_method: boolean): TupleArgumentsFlagT {
    const splatted_arg_index_ = FnSigKind.splatted(fn_sig_kind);
    if (splatted_arg_index_ !== undefined) {
      if (is_method) {
        // `checked_sub(1)` on a `u8`
        if (splatted_arg_index_ >= 1) {
          const splatted_arg_index = splatted_arg_index_ - 1;
          return { $: "TupleSplattedArg", _0: splatted_arg_index };
        } else {
          // In `check_argument_types`, this is effectively `TupleSplattedArg(-1)`
          return gen.TupleArgumentsFlag.TupleSplattedSelfArg;
        }
      }

      return { $: "TupleSplattedArg", _0: splatted_arg_index_ };
    }

    return gen.TupleArgumentsFlag.DontTupleArguments;
  },

  /// Returns true if the arguments are tupled through "rust-call" or splatting.
  // rustc: compiler/rustc_hir_typeck/src/lib.rs:669 is_tupled
  is_tupled(self_: TupleArgumentsFlagT): boolean {
    switch (self_.$) {
      case "DontTupleArguments":
        return false;
      case "TupleAllCallArgs":
      case "TupleSplattedSelfArg":
      case "TupleSplattedArg":
        return true;
    }
  },

  /// Returns true if the arguments are tupled through splatting.
  /// (But false if they are "rust-call" or not tupled.)
  // rustc: compiler/rustc_hir_typeck/src/lib.rs:678 is_splatted
  is_splatted(self_: TupleArgumentsFlagT): boolean {
    switch (self_.$) {
      case "TupleSplattedSelfArg":
      case "TupleSplattedArg":
        return true;
      case "DontTupleArguments":
      case "TupleAllCallArgs":
        return false;
    }
  },

  /// Returns the tupled argument index, and whether the `self` argument is splatted.
  /// Returns `None` if the arguments are not tupled, or if the `self` argument is splatted.
  // rustc: compiler/rustc_hir_typeck/src/lib.rs:687 tupled_arg_index
  tupled_arg_index(self_: TupleArgumentsFlagT): [number | undefined, boolean /* is_self_splatted */] {
    switch (self_.$) {
      case "TupleSplattedArg":
        return [self_._0, false];
      case "TupleAllCallArgs":
        return [0, false];
      case "TupleSplattedSelfArg":
        return [undefined, true];
      case "DontTupleArguments":
        return [undefined, false];
    }
  },
};

// rustc: compiler/rustc_hir_typeck/src/lib.rs:697 fatally_break_rust
export function fatally_break_rust(tcx: TyCtxt, span: Span): never {
  const dcx = tcx.dcx();
  const diag = dcx.struct_span_bug(span, "It looks like you're trying to break rust; would you like some ICE?");
  diag.note("the compiler expectedly panicked. this is a feature.");
  diag.note("we would appreciate a joke overview: https://github.com/rust-lang/rust/issues/43162#issuecomment-320764675");
  diag.note(`rustc ${tcx.sess.cfg_version} running on ${host_tuple()}`);
  const extra = extra_compiler_flags();
  if (extra !== undefined) {
    const [flags, excluded_cargo_defaults] = extra;
    diag.note(`compiler flags: ${flags.join(" ")}`);
    if (excluded_cargo_defaults) {
      diag.note("some of the compiler flags provided by cargo are hidden");
    }
  }
  return diag.emit_bug();
}

/// Adds query implementations to the [Providers] vtable, see [`rustc_middle::query`]
// rustc: compiler/rustc_hir_typeck/src/lib.rs:719 provide
export function provide(providers: Providers): void {
  // `*providers = Providers { .., ..*providers }`
  providers.method_autoderef_steps = method_probe.method_autoderef_steps;
  providers.typeck_root = typeck_root;
  providers.used_trait_imports = used_trait_imports;
  providers.check_transmutes = intrinsicck.check_transmutes;
  providers.check_offloads = intrinsicck.check_offloads;
}

// The `Deref` forwarders, once every module of the crate is loaded (see the header).
install_derefs();
