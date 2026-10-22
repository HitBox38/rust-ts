// Port of compiler/rustc_mir_transform/src/function_item_references.rs (lane mt-built-lints).
//
// PORT: `FunctionItemRefChecker` is a class extending rustc_middle mir/visit.ts's `Visitor` (D4). `itertools::join`
// is `Array.join`; `{term}` is `display_Term`, `{other_abi}` is `display_ExternAbi`, `{ident}` is `display_Ident`.
import { display_ExternAbi, ExternAbi } from "../rustc_abi/extern_abi.ts";
import { Safety } from "../rustc_hir/hir.ts";
import { FUNCTION_ITEM_REFERENCES } from "../rustc_lint_defs/builtin.ts";
import {
  type Body,
  ClearCrossCrate,
  type Location,
  Operand,
  type SourceInfo,
  type Terminator,
} from "../rustc_middle/mir/mod.ts";
import { Visitor } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { fold_GenericArgs, GenericArg, type GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import type { ParamEnv, Ty } from "../rustc_middle/ty/mod.ts";
import type { Clause } from "../rustc_middle/ty/predicate.ts";
import { display_Term } from "../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { Span, type Spanned } from "../rustc_span/lib.ts";
import { display_Ident, sym } from "../rustc_span/symbol.ts";
import { Binder, EarlyBinder, fold_Binder } from "../rustc_type_ir/binder.ts";
import { TraitClause, TraitRef } from "../rustc_type_ir/predicate.ts";
import { FnSig, type FnSig as FnSigT, fold_FnSig, PolyFnSig } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { unwrap } from "../std/panic.ts";
import * as diagnostics from "./diagnostics.ts";
import { MirLint } from "./pass_manager.ts";

// rustc-type: compiler/rustc_mir_transform/src/function_item_references.rs:12 FunctionItemReferences
export class FunctionItemReferences extends MirLint {
  readonly type_name = "rustc_mir_transform::function_item_references::FunctionItemReferences";

  // impl<'tcx> crate::MirLint<'tcx> for FunctionItemReferences
  // rustc: compiler/rustc_mir_transform/src/function_item_references.rs:15 run_lint
  run_lint(tcx: TyCtxt, body: Body): void {
    const checker = new FunctionItemRefChecker(tcx, body);
    checker.visit_body(body);
  }
}

// rustc-type: compiler/rustc_mir_transform/src/function_item_references.rs:21 FunctionItemRefChecker
class FunctionItemRefChecker extends Visitor {
  constructor(
    public tcx: TyCtxt,
    public body: Body,
  ) {
    super();
  }

  // impl<'tcx> Visitor<'tcx> for FunctionItemRefChecker<'_, 'tcx>
  /// Emits a lint for function reference arguments bound by `fmt::Pointer` or passed to
  /// `transmute`. This only handles arguments in calls outside macro expansions to avoid double
  /// counting function references formatted as pointers by macros.
  // rustc: compiler/rustc_mir_transform/src/function_item_references.rs:30 visit_terminator
  override visit_terminator(terminator: Terminator, location: Location): void {
    const kind = terminator.kind;
    if (kind.$ === "Call") {
      const { func, args } = kind;
      // `*self.body.source_info(location)` (`SourceInfo: Copy`, never written)
      const source_info = this.body.source_info(location);
      const func_ty = Operand.ty(func, this.body, this.tcx);
      const func_kind = func_ty.kind();
      if (func_kind.$ === "FnDef") {
        const def_id = func_kind._0;
        const args_ref = func_kind._1;
        // Handle calls to `transmute`
        if (this.tcx.is_diagnostic_item(sym.transmute, def_id)) {
          const arg_ty = Operand.ty(args[0]!.node, this.body, this.tcx);
          for (const arg of arg_ty.walk()) {
            const inner_ty = GenericArg.as_type(arg);
            if (inner_ty === undefined) continue;
            const fn_ref = FunctionItemRefChecker.is_fn_ref(inner_ty);
            if (fn_ref !== undefined) {
              const [fn_id, fn_args] = fn_ref;
              const span = this.nth_arg_span(args, 0);
              this.emit_lint(fn_id, fn_args, source_info, span);
            }
          }
        } else {
          this.check_bound_args(def_id, unwrap(Binder.no_bound_vars(args_ref, fold_GenericArgs)), args, source_info);
        }
      }
    }
    this.super_terminator(terminator, location);
  }

  // impl<'tcx> FunctionItemRefChecker<'_, 'tcx>
  /// Emits a lint for function reference arguments bound by `fmt::Pointer` in calls to the
  /// function defined by `def_id` with the generic parameters `args_ref`.
  // rustc: compiler/rustc_mir_transform/src/function_item_references.rs:71 check_bound_args
  check_bound_args(
    def_id: DefId,
    args_ref: GenericArgs,
    args: readonly Spanned<Operand>[],
    source_info: SourceInfo,
  ): void {
    // PORT: the `param_env` / `fn_sig` query values are `unknown` in queries.gen.ts.
    const param_env = this.tcx.param_env(def_id) as ParamEnv;
    const bounds = param_env.caller_bounds();
    for (const bound of bounds) {
      const bound_ty = this.is_pointer_trait(bound);
      if (bound_ty !== undefined) {
        // Get the argument types as they appear in the function signature.
        const arg_defs = FnSig.inputs(
          Unnormalized.skip_binder(EarlyBinder.instantiate_identity(this.tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSigT>>)),
        );
        for (let arg_num = 0; arg_num < arg_defs.length; arg_num++) {
          const arg_def = arg_defs[arg_num]!;
          // For all types reachable from the argument type in the fn sig
          for (const arg of arg_def.walk()) {
            const inner_ty = GenericArg.as_type(arg);
            if (inner_ty === undefined) continue;
            // If the inner type matches the type bound by `Pointer`
            if (inner_ty === bound_ty) {
              // Do an instantiation using the parameters from the callsite
              const instantiated_ty = Unnormalized.skip_norm_wip(
                EarlyBinder.instantiate(EarlyBinder.bind(this.tcx, inner_ty, fold_Ty), this.tcx, args_ref, fold_Ty),
              );
              const fn_ref = FunctionItemRefChecker.is_fn_ref(instantiated_ty);
              if (fn_ref !== undefined) {
                const [fn_id, fn_args] = fn_ref;
                let span = this.nth_arg_span(args, arg_num);
                if (Span.from_expansion(span)) {
                  // The operand's ctxt wouldn't display the lint since it's
                  // inside a macro so we have to use the callsite's ctxt.
                  const callsite_ctxt = Span.ctxt(Span.source_callsite(span));
                  span = Span.with_ctxt(span, callsite_ctxt);
                }
                this.emit_lint(fn_id, fn_args, source_info, span);
              }
            }
          }
        }
      }
    }
  }

  /// If the given predicate is the trait `fmt::Pointer`, returns the bound parameter type.
  // rustc: compiler/rustc_mir_transform/src/function_item_references.rs:114 is_pointer_trait
  is_pointer_trait(bound: Clause): Ty | undefined {
    const kind = Binder.skip_binder(bound.kind());
    if (kind.$ === "Trait") {
      const predicate = kind._0;
      return this.tcx.is_diagnostic_item(sym.Pointer, TraitClause.def_id(predicate))
        ? TraitRef.self_ty(predicate.trait_ref)
        : undefined;
    } else {
      return undefined;
    }
  }

  /// If a type is a reference or raw pointer to the anonymous type of a function definition,
  /// returns that function's `DefId` and `GenericArgsRef`.
  // rustc: compiler/rustc_mir_transform/src/function_item_references.rs:126 is_fn_ref
  static is_fn_ref(ty: Ty): [DefId, GenericArgs] | undefined {
    const kind = ty.kind();
    let referent_ty: Ty | undefined;
    switch (kind.$) {
      case "Ref":
        referent_ty = kind._1;
        break;
      case "RawPtr":
        referent_ty = kind._0;
        break;
      default:
        referent_ty = undefined;
    }
    if (referent_ty === undefined) return undefined;
    const ref_kind = referent_ty.kind();
    if (ref_kind.$ === "FnDef") {
      return [ref_kind._0, unwrap(Binder.no_bound_vars(ref_kind._1, fold_GenericArgs))];
    } else {
      return undefined;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/function_item_references.rs:143 nth_arg_span
  nth_arg_span(args: readonly Spanned<Operand>[], n: number): Span {
    return Operand.span(args[n]!.node, this.body.local_decls);
  }

  // rustc: compiler/rustc_mir_transform/src/function_item_references.rs:147 emit_lint
  emit_lint(fn_id: DefId, fn_args: GenericArgs, source_info: SourceInfo, span: Span): void {
    const lint_root = ClearCrossCrate.unwrap_crate_local(
      ClearCrossCrate.as_ref(this.body.source_scopes[source_info.scope]!.local_data),
    ).lint_root;
    // FIXME: use existing printing routines to print the function signature
    // PORT: the `fn_sig` query value is `unknown` in queries.gen.ts.
    const fn_sig = Unnormalized.skip_norm_wip(
      EarlyBinder.instantiate(this.tcx.fn_sig(fn_id) as EarlyBinder<Binder<FnSigT>>, this.tcx, fn_args, fold_Binder(fold_FnSig)),
    );
    const unsafety = Safety.prefix_str(PolyFnSig.safety(fn_sig));
    const fn_abi = PolyFnSig.abi(fn_sig);
    const abi = ExternAbi.eq(fn_abi, ExternAbi.Rust) ? "" : `extern ${display_ExternAbi(fn_abi)} `;
    const ident = this.tcx.item_ident(fn_id);
    const params = [...fn_args.terms()].map((term) => display_Term(term)).join(", ");
    const num_args = Binder.skip_binder(PolyFnSig.inputs(fn_sig)).length;
    const variadic = PolyFnSig.c_variadic(fn_sig) ? ", ..." : "";
    const ret = Binder.skip_binder(PolyFnSig.output(fn_sig)).is_unit() ? "" : " -> _";
    const sugg = `${params.length === 0 ? display_Ident(ident) : `${display_Ident(ident)}::<${params}>`} as ${unsafety}${abi}fn(${Array<string>(num_args).fill("_").join(", ")}${variadic})${ret}`;

    this.tcx.emit_node_span_lint(
      FUNCTION_ITEM_REFERENCES,
      lint_root,
      span,
      diagnostics.FnItemRef_diagnostic({ span, sugg, ident }),
    );
  }
}
