// Port of compiler/rustc_mir_build/src/check_tail_calls.rs (lanes builder-contract: the provider and the `Visitor` impl;
// mb-custom-tail: the rest). `build_mir_inner_impl` runs `check_tail_calls` on every body; `check_tail_call` is reached
// only for `become` expressions.
//
// PORT: `TailCallCkVisitor` (a thir `Visitor` impl) is a hand class extending rustc_middle thir/visit.ts's `Visitor`; its
// field `thir` is `thir_` (the `Visitor::thir()` method has the same name; precedent check_match.ts's `MatchVisitor`).
// The methods of `impl TailCallCkVisitor` are in the class body, in upstream order, before the `Visitor` impl's.
import { display_ExternAbi, ExternAbi } from "../rustc_abi/extern_abi.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { CodegenFnAttrFlags, type CodegenFnAttrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import { debug_Expr, debug_ExprId, type Expr, type ExprId, type Thir } from "../rustc_middle/thir.ts";
import { Visitor, walk_expr } from "../rustc_middle/thir/visit.ts";
import type { Steal } from "../rustc_data_structures/steal.ts";
import { type TyCtxt } from "../rustc_middle/ty/context.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { type Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { fold_GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { CRATE_DEF_ID, type DefId, LocalDefId } from "../rustc_span/def_id.ts";
import { type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { span_bug } from "../rustc_span/macros.ts";
import { Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import { display_FnSig } from "../rustc_type_ir/ir_print.ts";
import { FnSig, type FnSig as FnSigT, fold_FnSig } from "../rustc_type_ir/ty_kind.ts";
import { debug_vec, format_debug, PLAIN } from "../std/fmt.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { unwrap } from "../std/panic.ts";
export * from "./check_tail_calls.gen.ts";

// rustc: compiler/rustc_mir_build/src/check_tail_calls.rs:13 check_tail_calls
export function check_tail_calls(tcx: TyCtxt, def: LocalDefId): Result<null, ErrorGuaranteed> {
  // PORT: queries.gen.ts types `thir_body`'s value loosely (`[Steal<unknown>, unknown]`); it is `(&Steal<Thir>, ExprId)`.
  const r = tcx.thir_body(def) as Result<[Steal<Thir>, ExprId], ErrorGuaranteed>;
  if (r.$ === "Err") return r;
  const [thir_, expr] = r._0;
  const thir = thir_.borrow();

  // If `thir` is empty, a type error occurred, skip this body.
  if (thir.exprs.length === 0) {
    return Ok(null);
  }

  const is_closure = tcx.def_kind(LocalDefId.to_def_id(def)).$ === "Closure";

  const visitor = new TailCallCkVisitor(
    tcx,
    thir,
    TypingEnv.post_typeck_until_borrowck_for_mir_build(tcx, def),
    is_closure,
    Ok(null),
    def,
  );

  visitor.visit_expr(thir.index_ExprId(expr));

  return visitor.found_errors;
}

// rustc-type: compiler/rustc_mir_build/src/check_tail_calls.rs:38 TailCallCkVisitor
export class TailCallCkVisitor extends Visitor {
  constructor(
    public tcx: TyCtxt,
    // PORT: the field `thir` is `thir_` (the `Visitor::thir()` method has the same name).
    public thir_: Thir,
    public typing_env: TypingEnv,
    /// Whatever the currently checked body is one of a closure
    public is_closure: boolean,
    /// The result of the checks, `Err(_)` if there was a problem with some
    /// tail call, `Ok(())` if all of them were fine.
    public found_errors: Result<null, ErrorGuaranteed>,
    /// `LocalDefId` of the caller function.
    public caller_def_id: LocalDefId,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_build/src/check_tail_calls.rs:52 check_tail_call
  check_tail_call(call: Expr, expr: Expr): void {
    if (this.is_closure) {
      this.report_in_closure(expr);
      return;
    }

    const body_type = this.thir_.body_type;
    if (body_type.$ !== "Fn") {
      return span_bug(call.span, "`become` outside of functions should have been disallowed by hir_typeck");
    }
    let caller_sig = body_type._0;
    // While the `caller_sig` does have its free regions erased, it does not have its
    // binders anonymized. We call `erase_and_anonymize_regions` once again to anonymize any binders
    // within the signature, such as in function pointer or `dyn Trait` args.
    caller_sig = this.tcx.erase_and_anonymize_regions(caller_sig, fold_FnSig);

    if (call.kind.$ !== "Scope") {
      return span_bug(call.span, `expected scope, found: ${format_debug(call, debug_Expr, PLAIN)}`);
    }
    const value = this.thir_.index_ExprId(call.kind.value);

    if (value.kind.$ === "Binary" || value.kind.$ === "Unary" || value.kind.$ === "AssignOp" || value.kind.$ === "Index") {
      this.report_builtin_op(call, expr);
      return;
    }

    if (value.kind.$ !== "Call") {
      this.report_non_call(value, expr);
      return;
    }
    const { ty, fun, args, from_hir_call, fn_span } = value.kind;

    if (!from_hir_call) {
      this.report_op(ty, args, fn_span, expr);
    }

    const k = ty.kind();
    if (k.$ === "FnDef") {
      const did = k._0;
      const args = unwrap(Binder.no_bound_vars(k._1, fold_GenericArgs));
      // Closures in thir look something akin to
      // `for<'a> extern "rust-call" fn(&'a [closure@...], ()) -> <[closure@...] as FnOnce<()>>::Output {<[closure@...] as Fn<()>>::call}`
      // So we have to check for them in this weird way...
      const parent = this.tcx.parent(did);
      let this_: GenericArg | undefined;
      let this_ty: Ty | undefined;
      if (
        this.tcx.fn_trait_kind_from_def_id(parent) !== undefined &&
        (this_ = args[0]) !== undefined &&
        (this_ty = GenericArg.as_type(this_)) !== undefined
      ) {
        if (this_ty.is_closure()) {
          this.report_calling_closure(this.thir_.index_ExprId(fun), unwrap(GenericArg.as_type(args[1]!)), expr);
        } else {
          // This can happen when tail calling `Box` that wraps a function
          this.report_nonfn_callee(fn_span, this.thir_.index_ExprId(fun).span, this_ty);
        }

        // Tail calling is likely to cause unrelated errors (ABI, argument mismatches),
        // skip them, producing an error about calling a closure is enough.
        return;
      }

      if (this.tcx.intrinsic(did) !== undefined) {
        this.report_calling_intrinsic(expr);
      }
    }

    if (!(k.$ === "FnDef" || k.$ === "FnPtr")) {
      this.report_nonfn_callee(fn_span, this.thir_.index_ExprId(fun).span, ty);

      // `fn_sig` below panics otherwise
      return;
    }

    // Erase regions since tail calls don't care about lifetimes
    const callee_sig = this.tcx.normalize_erasing_late_bound_regions(this.typing_env, ty.fn_sig(this.tcx), fold_FnSig);

    if (!ExternAbi.eq(FnSig.abi(caller_sig), FnSig.abi(callee_sig))) {
      this.report_abi_mismatch(expr.span, FnSig.abi(caller_sig), FnSig.abi(callee_sig));
    }

    if (!ExternAbi.supports_guaranteed_tail_call(FnSig.abi(callee_sig))) {
      this.report_unsupported_abi(expr.span, FnSig.abi(callee_sig));
    }

    // FIXME(explicit_tail_calls): this currently fails for cases where opaques are used.
    // e.g.
    // ```
    // fn a() -> impl Sized { become b() } // ICE
    // fn b() -> u8 { 0 }
    // ```
    // we should think what is the expected behavior here.
    // (we should probably just accept this by revealing opaques?)
    // PORT: `Tys` are interned lists: `!=` is identity.
    if (caller_sig.inputs_and_output !== callee_sig.inputs_and_output && FnSig.abi(callee_sig).$ !== "RustTail") {
      const caller_ty = EarlyBinder.skip_binder(this.tcx.type_of(LocalDefId.to_def_id(this.caller_def_id)) as EarlyBinder<Ty>);

      this.report_signature_mismatch(
        expr.span,
        this.tcx.liberate_late_bound_regions(LocalDefId.to_def_id(CRATE_DEF_ID), caller_ty.fn_sig(this.tcx), fold_FnSig),
        this.tcx.liberate_late_bound_regions(LocalDefId.to_def_id(CRATE_DEF_ID), ty.fn_sig(this.tcx), fold_FnSig),
      );
    }

    {
      // `#[track_caller]` affects the ABI of a function (by adding a location argument),
      // so a `track_caller` can only tail call other `track_caller` functions.
      //
      // The issue is however that we can't know if a function is `track_caller` or not at
      // this point (THIR can be polymorphic, we may have an unresolved trait function).
      // We could only allow functions that we *can* resolve and *are* `track_caller`,
      // but that would turn changing `track_caller`-ness into a breaking change,
      // which is probably undesirable.
      //
      // Also note that we don't check callee's `track_caller`-ness at all, mostly for the
      // reasons above, but also because we can always tailcall the shim we'd generate for
      // coercing the function to an `fn()` pointer. (although in that case the tailcall is
      // basically useless -- the shim calls the actual function, so tailcalling the shim is
      // equivalent to calling the function)
      const caller_needs_location = this.caller_needs_location();

      if (caller_needs_location) {
        this.report_track_caller_caller(expr.span);
      }
    }

    if (FnSig.c_variadic(caller_sig)) {
      this.report_c_variadic_caller(expr.span);
    }

    if (FnSig.c_variadic(callee_sig)) {
      this.report_c_variadic_callee(expr.span);
    }

    for (const arg_ty of FnSig.inputs(callee_sig)) {
      if (!arg_ty.is_sized(this.tcx, this.typing_env)) {
        this.report_unsized_argument(expr.span, arg_ty);
      }
    }
  }

  /// Returns true if the caller function needs a location argument
  /// (i.e. if a function is marked as `#[track_caller]`)
  // rustc: compiler/rustc_mir_build/src/check_tail_calls.rs:202 caller_needs_location
  caller_needs_location(): boolean {
    const flags = (this.tcx.codegen_fn_attrs(LocalDefId.to_def_id(this.caller_def_id)) as CodegenFnAttrs).flags;
    return CodegenFnAttrFlags.contains(flags, CodegenFnAttrFlags.TRACK_CALLER);
  }

  // rustc: compiler/rustc_mir_build/src/check_tail_calls.rs:207 report_in_closure
  report_in_closure(expr: Expr): void {
    const guar = this.tcx.dcx().span_err(expr.span, "`become` is not allowed in closures");
    this.found_errors = Err(guar);
  }

  // rustc: compiler/rustc_mir_build/src/check_tail_calls.rs:212 report_builtin_op
  report_builtin_op(value: Expr, expr: Expr): void {
    const guar = this.tcx
      .dcx()
      .struct_span_err(value.span, "`become` does not support operators")
      .with_note("using `become` on a builtin operator is not useful")
      .with_span_suggestion(Span.until(value.span, expr.span), "try using `return` instead", "return ", "MachineApplicable")
      .emit_err();
    this.found_errors = Err(guar);
  }

  // rustc: compiler/rustc_mir_build/src/check_tail_calls.rs:228 report_op
  report_op(fun_ty: Ty, args: readonly ExprId[], fn_span: Span, expr: Expr): void {
    const err = this.tcx.dcx().struct_span_err(fn_span, "`become` does not support operators");

    const k = fun_ty.kind();
    let parent: DefId;
    let method: string | undefined;
    if (
      k.$ === "FnDef" &&
      ((parent = this.tcx.parent(k._0)), true) &&
      this.tcx.def_kind(parent).$ === "Trait" &&
      (method = op_trait_as_method_name(this.tcx, parent)) !== undefined
    ) {
      if (args.length === 1) {
        const arg = this.thir_.index_ExprId(args[0]!);

        err.multipart_suggestion(
          "try using the method directly",
          [
            [Span.until(Span.shrink_to_lo(fn_span), arg.span), "("],
            [Span.shrink_to_hi(arg.span), `).${method}()`],
          ],
          "MaybeIncorrect",
        );
      } else if (args.length === 2) {
        const lhs = this.thir_.index_ExprId(args[0]!);
        const rhs = this.thir_.index_ExprId(args[1]!);

        err.multipart_suggestion(
          "try using the method directly",
          [
            [Span.shrink_to_lo(lhs.span), `(`],
            [Span.between(lhs.span, rhs.span), `).${method}(`],
            [Span.between(rhs.span, Span.shrink_to_hi(expr.span)), ")"],
          ],
          "MaybeIncorrect",
        );
      } else {
        return span_bug(expr.span, `operator with more than 2 args? ${debug_vec(args, PLAIN, debug_ExprId)}`);
      }
    }

    this.found_errors = Err(err.emit_err());
  }

  // rustc: compiler/rustc_mir_build/src/check_tail_calls.rs:271 report_non_call
  report_non_call(value: Expr, expr: Expr): void {
    const guar = this.tcx
      .dcx()
      .struct_span_err(value.span, "`become` requires a function call")
      .with_span_note(value.span, "not a function call")
      .with_span_suggestion(Span.until(value.span, expr.span), "try using `return` instead", "return ", "MaybeIncorrect")
      .emit_err();
    this.found_errors = Err(guar);
  }

  // rustc: compiler/rustc_mir_build/src/check_tail_calls.rs:287 report_calling_closure
  report_calling_closure(fun: Expr, tupled_args: Ty, expr: Expr): void {
    const k = tupled_args.kind();
    let underscored_args: string;
    if (k.$ === "Tuple" && k._0.length === 0) {
      underscored_args = "";
    } else if (k.$ === "Tuple") {
      underscored_args = "_, ".repeat(k._0.length - 1) + "_";
    } else {
      underscored_args = "_";
    }

    const guar = this.tcx
      .dcx()
      .struct_span_err(expr.span, "tail calling closures directly is not allowed")
      .with_multipart_suggestion(
        "try casting the closure to a function pointer type",
        [
          [Span.shrink_to_lo(fun.span), "("],
          [Span.shrink_to_hi(fun.span), ` as fn(${underscored_args}) -> _)`],
        ],
        "MaybeIncorrect",
      )
      .emit_err();
    this.found_errors = Err(guar);
  }

  // rustc: compiler/rustc_mir_build/src/check_tail_calls.rs:310 report_calling_intrinsic
  report_calling_intrinsic(expr: Expr): void {
    const guar = this.tcx.dcx().struct_span_err(expr.span, "tail calling intrinsics is not allowed").emit_err();

    this.found_errors = Err(guar);
  }

  // rustc: compiler/rustc_mir_build/src/check_tail_calls.rs:320 report_nonfn_callee
  report_nonfn_callee(call_sp: Span, fun_sp: Span, ty: Ty): void {
    const err = this.tcx
      .dcx()
      .struct_span_err(call_sp, "tail calls can only be performed with function definitions or pointers")
      .with_note(`callee has type \`${display_Ty(ty)}\``);

    let ty_ = ty;
    let refs = 0;
    while (ty_.is_box() || ty_.is_ref()) {
      ty_ = unwrap(ty_.builtin_deref(false));
      refs += 1;
    }

    if (refs > 0 && ty_.is_fn()) {
      const thing = ty_.is_fn_ptr() ? "pointer" : "definition";

      const derefs = "(" + "*".repeat(refs);

      err.multipart_suggestion(
        `consider dereferencing the expression to get a function ${thing}`,
        [
          [Span.shrink_to_lo(fun_sp), derefs],
          [Span.shrink_to_hi(fun_sp), ")"],
        ],
        "MachineApplicable",
      );
    }

    const guar = err.emit_err();
    this.found_errors = Err(guar);
  }

  // rustc: compiler/rustc_mir_build/src/check_tail_calls.rs:354 report_abi_mismatch
  report_abi_mismatch(sp: Span, caller_abi: ExternAbi, callee_abi: ExternAbi): void {
    const guar = this.tcx
      .dcx()
      .struct_span_err(sp, "mismatched function ABIs")
      .with_note("`become` requires caller and callee to have the same ABI")
      .with_note(`caller ABI is \`${display_ExternAbi(caller_abi)}\`, while callee ABI is \`${display_ExternAbi(callee_abi)}\``)
      .emit_err();
    this.found_errors = Err(guar);
  }

  // rustc: compiler/rustc_mir_build/src/check_tail_calls.rs:365 report_unsupported_abi
  report_unsupported_abi(sp: Span, callee_abi: ExternAbi): void {
    const guar = this.tcx
      .dcx()
      .struct_span_err(sp, "ABI does not support guaranteed tail calls")
      .with_note(`\`become\` is not supported for \`extern ${display_ExternAbi(callee_abi)}\` functions`)
      .emit_err();
    this.found_errors = Err(guar);
  }

  // rustc: compiler/rustc_mir_build/src/check_tail_calls.rs:375 report_signature_mismatch
  report_signature_mismatch(sp: Span, caller_sig: FnSigT, callee_sig: FnSigT): void {
    const guar = this.tcx
      .dcx()
      .struct_span_err(sp, "mismatched signatures")
      .with_note("`become` requires caller and callee to have matching signatures")
      .with_note(`caller signature: \`${display_FnSig(caller_sig)}\``)
      .with_note(`callee signature: \`${display_FnSig(callee_sig)}\``)
      .emit_err();
    this.found_errors = Err(guar);
  }

  // rustc: compiler/rustc_mir_build/src/check_tail_calls.rs:392 report_track_caller_caller
  report_track_caller_caller(sp: Span): void {
    const guar = this.tcx.dcx().struct_span_err(sp, "a function marked with `#[track_caller]` cannot perform a tail-call").emit_err();

    this.found_errors = Err(guar);
  }

  // rustc: compiler/rustc_mir_build/src/check_tail_calls.rs:405 report_c_variadic_caller
  report_c_variadic_caller(sp: Span): void {
    const guar = this.tcx
      .dcx()
      // FIXME(explicit_tail_calls): highlight the `...`
      .struct_span_err(sp, "tail-calls are not allowed in c-variadic functions")
      .emit_err();

    this.found_errors = Err(guar);
  }

  // rustc: compiler/rustc_mir_build/src/check_tail_calls.rs:416 report_c_variadic_callee
  report_c_variadic_callee(sp: Span): void {
    const guar = this.tcx
      .dcx()
      // FIXME(explicit_tail_calls): highlight the function or something...
      .struct_span_err(sp, "c-variadic functions can't be tail-called")
      .emit_err();

    this.found_errors = Err(guar);
  }

  // rustc: compiler/rustc_mir_build/src/check_tail_calls.rs:427 report_unsized_argument
  report_unsized_argument(sp: Span, arg_ty: Ty): void {
    const guar = this.tcx
      .dcx()
      .struct_span_err(sp, `unsized arguments cannot be used in a tail call`)
      .with_note(`unsized argument of type \`${display_Ty(arg_ty)}\``)
      .emit_err();

    this.found_errors = Err(guar);
  }

  // impl<'a, 'tcx> Visitor<'a, 'tcx> for TailCallCkVisitor<'a, 'tcx>
  // rustc: compiler/rustc_mir_build/src/check_tail_calls.rs:440 thir
  thir(): Thir {
    return this.thir_;
  }

  // rustc: compiler/rustc_mir_build/src/check_tail_calls.rs:444 visit_expr
  override visit_expr(expr: Expr): void {
    if (expr.kind.$ === "Become") {
      const value = expr.kind.value;
      const call = this.thir_.index_ExprId(value);
      this.check_tail_call(call, expr);
    }

    walk_expr(this, expr);
  }
}

// rustc: compiler/rustc_mir_build/src/check_tail_calls.rs:454 op_trait_as_method_name
export function op_trait_as_method_name(tcx: TyCtxt, trait_did: DefId): string | undefined {
  const li = tcx.as_lang_item(trait_did);
  if (li === undefined) return undefined;
  let m: string;
  switch (li) {
    case LangItem.Add: m = "add"; break;
    case LangItem.Sub: m = "sub"; break;
    case LangItem.Mul: m = "mul"; break;
    case LangItem.Div: m = "div"; break;
    case LangItem.Rem: m = "rem"; break;
    case LangItem.Neg: m = "neg"; break;
    case LangItem.Not: m = "not"; break;
    case LangItem.BitXor: m = "bitxor"; break;
    case LangItem.BitAnd: m = "bitand"; break;
    case LangItem.BitOr: m = "bitor"; break;
    case LangItem.Shl: m = "shl"; break;
    case LangItem.Shr: m = "shr"; break;
    case LangItem.AddAssign: m = "add_assign"; break;
    case LangItem.SubAssign: m = "sub_assign"; break;
    case LangItem.MulAssign: m = "mul_assign"; break;
    case LangItem.DivAssign: m = "div_assign"; break;
    case LangItem.RemAssign: m = "rem_assign"; break;
    case LangItem.BitXorAssign: m = "bitxor_assign"; break;
    case LangItem.BitAndAssign: m = "bitand_assign"; break;
    case LangItem.BitOrAssign: m = "bitor_assign"; break;
    case LangItem.ShlAssign: m = "shl_assign"; break;
    case LangItem.ShrAssign: m = "shr_assign"; break;
    case LangItem.Index: m = "index"; break;
    case LangItem.IndexMut: m = "index_mut"; break;
    default: return undefined;
  }

  return m;
}
