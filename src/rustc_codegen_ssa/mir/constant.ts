// Port of compiler/rustc_codegen_ssa/src/mir/constant.rs (lane ssa-mir-rest, plan-m7 wave 41).
//
// PORT (ssa-mir-rest): the file is one `impl FunctionCx` block. As place.ts and operand.ts do (docs/handoff/
// ssa-operand-place.md, "Why installers"), its methods are attached by `install_FunctionCx_constant(FunctionCx)`, which
// mod.ts calls right after `class FunctionCx`; this file imports mod.ts for types only.
// Conventions: mod.ts's header (`monomorphize(value, d_T)`, `tcx_()` / `typing_env_()`).
import { debug_TyAndLayout_Ty } from "../../rustc_middle/ty/layout.ts";
import type { ErrorHandled } from "../../rustc_middle/mir/interpret/error.ts";
import { debug_ErrorHandled } from "../../rustc_middle/mir/interpret/error.gen.ts";
import { type ConstValue, Const as mir_Const, debug_Const as debug_mir_Const, fold_Const as fold_mir_Const } from "../../rustc_middle/mir/consts.ts";
import type { Scalar } from "../../rustc_middle/mir/interpret/value.ts";
import type { ConstOperand } from "../../rustc_middle/mir/syntax.ts";
import "../../rustc_middle/ty/consts.ts";
import type { ValTree } from "../../rustc_middle/ty/consts/valtree.ts";
import type { Ty } from "../../rustc_middle/ty/decls.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { debug_ConstKind, ValTreeKind, fold_with_AliasConstKind, try_fold_with_AliasConstKind, visit_with_AliasConstKind } from "../../rustc_type_ir/const_kind.ts";
import type { FallibleTypeFolder, TypeFoldable, TypeFolder } from "../../rustc_type_ir/fold.ts";
import { debug_Const as debug_ty_Const } from "../../rustc_type_ir/sty/consts.ts";
import { type AliasConst, fold_with_Alias, try_fold_with_Alias, visit_with_Alias } from "../../rustc_type_ir/ty/alias.ts";
import type { TypeVisitor } from "../../rustc_type_ir/visit.ts";
import { format_debug, PLAIN, PRETTY } from "../../std/fmt.ts";
import { assert, panic } from "../../std/panic.ts";
import { expect_result, Ok, type Result } from "../../std/result.ts";
import { ShuffleIndicesEvaluation_diagnostic } from "../diagnostics.gen.ts";
import type { BackendTypes } from "../traits/backend.ts";
import type { BuilderMethods } from "../traits/builder.ts";
import type { CodegenMethods } from "../traits/mod.ts";
import type { FunctionCx } from "./mod.ts";
import { OperandRef } from "./operand.ts";

/** `TypeFoldable` of `ty::AliasConst` (`uv.shrink(tcx)`'s type), for `monomorphize` (trait_selection normalize.ts's form). */
const d_AliasConst: TypeFoldable<AliasConst> = {
  visit_with: <R>(s: AliasConst, v: TypeVisitor<R>): R => visit_with_Alias(s, v, visit_with_AliasConstKind),
  try_fold_with: <E>(s: AliasConst, f: FallibleTypeFolder<E>): Result<AliasConst, E> => try_fold_with_Alias(s, f, try_fold_with_AliasConstKind),
  fold_with: (s: AliasConst, f: TypeFolder): AliasConst => fold_with_Alias(s, f, fold_with_AliasConstKind),
};

declare module "./mod.ts" {
  interface FunctionCx<B extends BackendTypes, Cx extends CodegenMethods<B> = CodegenMethods<B>, Bx extends BuilderMethods<B, Cx> = BuilderMethods<B, Cx>> {
    eval_mir_constant_to_operand(bx: Bx, constant: ConstOperand): OperandRef<B["Value"]>;
    eval_mir_constant(constant: ConstOperand): ConstValue;
    eval_unevaluated_mir_constant_to_valtree(constant: ConstOperand): Result<Result<ValTree, Ty>, ErrorHandled>;
    immediate_const_vector(bx: Bx, constant: ConstOperand): [B["Value"], Ty];
  }
}

/** `impl<'a, 'tcx, Bx: BuilderMethods<'a, 'tcx>> FunctionCx<'a, 'tcx, Bx>` of constant.rs (header). */
// PORT: installer instead of top-level prototype writes (TDZ cycle with mod.ts; header).
export function install_FunctionCx_constant(FunctionCx_: { prototype: FunctionCx<BackendTypes> }): void {
  // rustc: compiler/rustc_codegen_ssa/src/mir/constant.rs:15 eval_mir_constant_to_operand
  FunctionCx_.prototype.eval_mir_constant_to_operand = function (
    this: FunctionCx<BackendTypes>,
    bx: BuilderMethods<BackendTypes>,
    constant: ConstOperand,
  ): OperandRef<unknown> {
    const val = this.eval_mir_constant(constant);
    const ty = this.monomorphize(constant.ty(), fold_Ty);
    return OperandRef.from_const(bx, val, ty);
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/constant.rs:25 eval_mir_constant
  FunctionCx_.prototype.eval_mir_constant = function (this: FunctionCx<BackendTypes>, constant: ConstOperand): ConstValue {
    // `MirUsedCollector` visited all required_consts before codegen began, so if we got here
    // there can be no more constants that fail to evaluate.
    return expect_result(
      mir_Const.eval(this.monomorphize(constant.const_, fold_mir_Const), this.cx.tcx_(), this.cx.typing_env_(), constant.span),
      "erroneous constant missed by mono item collection",
      debug_ErrorHandled,
    );
  };

  /// This is a convenience helper for `immediate_const_vector`. It has the precondition
  /// that the given `constant` is an `Const::Unevaluated` and must be convertible to
  /// a `ValTree`. If you want a more general version of this, talk to `wg-const-eval` on zulip.
  ///
  /// Note that this function is cursed, since usually MIR consts should not be evaluated to
  /// valtrees!
  // rustc: compiler/rustc_codegen_ssa/src/mir/constant.rs:39 eval_unevaluated_mir_constant_to_valtree
  FunctionCx_.prototype.eval_unevaluated_mir_constant_to_valtree = function (
    this: FunctionCx<BackendTypes>,
    constant: ConstOperand,
  ): Result<Result<ValTree, Ty>, ErrorHandled> {
    const tcx = this.cx.tcx_();
    let uv: AliasConst;
    const c0 = this.monomorphize(constant.const_, fold_mir_Const);
    switch (c0.$) {
      case "Unevaluated":
        uv = c0._0.shrink(tcx);
        break;
      case "Ty": {
        const c = c0._1;
        const k = c.kind();
        switch (k.$) {
          // A constant that came from a const generic but was then used as an argument to
          // old-style simd_shuffle (passing as argument instead of as a generic param).
          case "Value": {
            const cv = k._0;
            return Ok(Ok(cv.valtree));
          }
          default:
            return span_bug(constant.span, format_debug(k, debug_ConstKind, PRETTY));
        }
      }
      // We should never encounter `Const::Val` unless MIR opts (like const prop) evaluate
      // a constant and write that value back into `Operand`s. This could happen, but is
      // unlikely. Also: all users of `simd_shuffle` are on unstable and already need to take
      // a lot of care around intrinsics. For an issue to happen here, it would require a
      // macro expanding to a `simd_shuffle` call without wrapping the constant argument in a
      // `const {}` block, but the user pass through arbitrary expressions.
      // FIXME(oli-obk): replace the magic const generic argument of `simd_shuffle` with a
      // real const generic, and get rid of this entire function.
      default:
        return span_bug(constant.span, format_debug(c0, debug_mir_Const, PRETTY));
    }
    uv = this.monomorphize(uv, d_AliasConst);
    return tcx.const_eval_resolve_for_typeck(this.cx.typing_env_(), uv, constant.span);
  };

  /// process constant containing SIMD shuffle indices & constant vectors
  // rustc: compiler/rustc_codegen_ssa/src/mir/constant.rs:67 immediate_const_vector
  FunctionCx_.prototype.immediate_const_vector = function (
    this: FunctionCx<BackendTypes>,
    bx: BuilderMethods<BackendTypes>,
    constant: ConstOperand,
  ): [unknown, Ty] {
    const ty = this.monomorphize(constant.ty(), fold_Ty);
    assert(ty.is_simd(), "assertion failed: ty.is_simd()");
    const field_ty = ty.simd_size_and_type(bx.tcx_())[1];

    // PORT: `.ok().map(|x| x.ok()).flatten()` of the nested `Result`.
    const r = this.eval_unevaluated_mir_constant_to_valtree(constant);
    const val0 = r.$ === "Ok" && r._0.$ === "Ok" ? r._0._0 : undefined;
    let val: unknown;
    if (val0 !== undefined) {
      // A SIMD type has a single field, which is an array.
      // PORT: `ValTree` derefs to `ValTreeKind` (`to_branch`, const_kind.rs:253).
      const fields = ValTreeKind.to_branch(val0.kind());
      if (fields.length !== 1) {
        panic(`assertion \`left == right\` failed\n  left: ${fields.length}\n right: 1`);
      }
      const array = fields[0]!.to_branch();
      // Iterate over the array elements to obtain the values in the vector.
      const values: unknown[] = array.map((field) => {
        const prim = field.try_to_scalar();
        if (prim === undefined) {
          return bug(`field is not a scalar ${format_debug(field, debug_ty_Const, PLAIN)}`);
        }
        const layout = bx.layout_of(field_ty);
        const repr = layout.backend_repr;
        if (repr.$ !== "Scalar") {
          return bug(`from_const: invalid ByVal layout: ${format_debug(layout, debug_TyAndLayout_Ty, PRETTY)}`);
        }
        const scalar = repr._0;
        // PORT: ty/decls.ts types `ty::Const::try_to_scalar`'s result as the `Pending<"Scalar">` placeholder; it is
        // mir::interpret's `Scalar` (ty/consts.ts builds `Scalar::Int`).
        return bx.scalar_to_backend(prim as unknown as Scalar, scalar, bx.immediate_backend_type(layout));
      });
      val = bx.const_vector(values);
    } else {
      bx.tcx_().dcx().emit_err(ShuffleIndicesEvaluation_diagnostic({ span: constant.span }));
      // We've errored, so we don't have to produce working code.
      const llty = bx.backend_type(bx.layout_of(ty));
      val = bx.const_undef(llty);
    }
    return [val, ty];
  };
}
