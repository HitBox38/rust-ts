// Port of compiler/rustc_lint/src/gpukernel_abi.rs. The lint statics and the `declare_lint_pass!` expansion are
// generated (gpukernel_abi.lints.gen.ts).
//
// PORT: `CheckGpuKernelTypes` is a class implementing `TypeFolder` (erase_regions.ts precedent); the provided
// methods it does not override forward to `TypeFolder_provided`.
import { find_attr } from "../rustc_attr_ir/lib.ts";
import type * as hir from "../rustc_hir/hir.ts";
import type { FnKind } from "../rustc_hir/intravisit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Clauses } from "../rustc_middle/ty/decls.ts";
import { HasAttrs_LocalDefId, type Ty } from "../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { type LocalDefId, LocalDefId as LocalDefIdC } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { type Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import type { PolyFnSig } from "../rustc_type_ir/decls.ts";
import { type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../rustc_type_ir/fold.ts";
import type { Const, Region } from "../rustc_type_ir/sty/mod.ts";
import { FnSig, fold_FnSig } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import type { LateContext } from "./context.ts";
import { ImproperGpuKernelArg_diagnostic, MissingGpuKernelExportName_diagnostic } from "./diagnostics.ts";
import { IMPROPER_GPU_KERNEL_ARG, ImproperGpuKernelLint, MISSING_GPU_KERNEL_EXPORT_NAME } from "./gpukernel_abi.lints.gen.ts";
import type { LateLintPass } from "./passes.ts";

export * from "./gpukernel_abi.lints.gen.ts";

declare module "./gpukernel_abi.lints.gen.ts" {
  interface ImproperGpuKernelLint extends LateLintPass {}
}

/// Check for valid and invalid types.
class CheckGpuKernelTypes implements TypeFolder {
  constructor(
    public tcx: TyCtxt,
    // If one or more invalid types were encountered while folding.
    public has_invalid: boolean,
  ) {}

  // impl<'tcx> TypeFolder<TyCtxt<'tcx>> for CheckGpuKernelTypes<'tcx>
  // rustc: compiler/rustc_lint/src/gpukernel_abi.rs:104 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  // rustc: compiler/rustc_lint/src/gpukernel_abi.rs:108 fold_ty
  fold_ty(ty: Ty): Ty {
    switch (ty.kind().$) {
      case "Bool":
      case "Char":
      case "Int":
      case "Uint":
      case "Float":
        break;
      // Thin pointers are allowed but fat pointers with metadata are not
      case "RawPtr":
        if (!ty.pointee_metadata_ty_or_projection(this.tcx).is_unit()) {
          this.has_invalid = true;
        }
        break;

      case "Adt":
      case "Alias":
      case "Array":
      case "Bound":
      case "Closure":
      case "Coroutine":
      case "CoroutineClosure":
      case "CoroutineWitness":
      case "Dynamic":
      case "FnDef":
      case "FnPtr":
      case "Foreign":
      case "Never":
      case "Pat":
      case "Placeholder":
      case "Ref":
      case "Slice":
      case "Str":
      case "Tuple":
        this.has_invalid = true;
        break;

      default:
        return fold_Ty.super_fold_with(ty, this);
    }
    return ty;
  }

  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }
  fold_region(r: Region): Region {
    return TypeFolder_provided.fold_region(this, r);
  }
  fold_const(c: Const): Const {
    return TypeFolder_provided.fold_const(this, c);
  }
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }
  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

/// `ImproperGpuKernelLint` checks `gpu-kernel` function definitions:
///
/// - `extern "gpu-kernel" fn` arguments should be primitive types.
/// - `extern "gpu-kernel" fn` should have an unmangled name.
// impl<'tcx> LateLintPass<'tcx> for ImproperGpuKernelLint
// rustc: compiler/rustc_lint/src/gpukernel_abi.rs:149 check_fn
ImproperGpuKernelLint.prototype.check_fn = function (
  this: ImproperGpuKernelLint,
  cx: LateContext,
  kind: FnKind,
  decl: hir.FnDecl,
  _: hir.Body,
  span: Span,
  id: LocalDefId,
): void {
  let abi;
  switch (kind.$) {
    case "ItemFn":
      abi = kind._2.abi;
      break;
    case "Method":
      abi = kind._1.header.abi;
      break;
    default:
      return;
  }

  if (abi.$ !== "GpuKernel") {
    return;
  }

  const sig_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(cx.tcx.fn_sig(LocalDefIdC.to_def_id(id)) as EarlyBinder<PolyFnSig>));
  const sig = cx.tcx.instantiate_bound_regions_with_erased(sig_, fold_FnSig);

  const inputs = FnSig.inputs(sig);
  const n = Math.min(inputs.length, decl.inputs.length);
  for (let i = 0; i < n; i++) {
    const input_ty = inputs[i]!;
    const input_hir = decl.inputs[i]!;
    const checker = new CheckGpuKernelTypes(cx.tcx, false);
    fold_Ty.fold_with(input_ty, checker);
    if (checker.has_invalid) {
      cx.tcx.emit_node_span_lint(IMPROPER_GPU_KERNEL_ARG, input_hir.hir_id, input_hir.span, ImproperGpuKernelArg_diagnostic({ ty: input_ty }));
    }
  }

  // Check for no_mangle/export_name, so the kernel can be found when querying the compiled object for the kernel function by name
  if (
    find_attr(HasAttrs_LocalDefId.get_attrs(id, cx.tcx), (k) => (k.$ === "NoMangle" || k.$ === "ExportName" ? null : undefined)) === undefined
  ) {
    cx.emit_span_lint(MISSING_GPU_KERNEL_EXPORT_NAME, span, MissingGpuKernelExportName_diagnostic({}));
  }
};
