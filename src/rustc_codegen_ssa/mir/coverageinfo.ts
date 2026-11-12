// Port of compiler/rustc_codegen_ssa/src/mir/coverageinfo.rs (lane ssa-mir-rest, plan-m7 wave 41).
//
// PORT (ssa-mir-rest): one `impl FunctionCx` block, attached by `install_FunctionCx_coverageinfo(FunctionCx)` as constant.ts's
// header says; this file imports mod.ts for types only.
import type { CoverageKind } from "../../rustc_middle/mir/coverage.ts";
import { type SourceScope, SourceScope as SourceScopeC } from "../../rustc_middle/mir/mod.ts";
import { fold_with_Instance, type Instance, try_fold_with_Instance, visit_with_Instance } from "../../rustc_middle/ty/instance.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import type { BackendTypes } from "../traits/backend.ts";
import type { BuilderMethods } from "../traits/builder.ts";
import type { CodegenMethods } from "../traits/mod.ts";
import type { FunctionCx } from "./mod.ts";

/** `TypeFoldable` of `Instance` (rustc_monomorphize collector.ts's form), for `monomorphize`. */
const d_Instance: TypeFoldable<Instance> = { visit_with: visit_with_Instance, try_fold_with: try_fold_with_Instance, fold_with: fold_with_Instance };

declare module "./mod.ts" {
  interface FunctionCx<B extends BackendTypes, Cx extends CodegenMethods<B> = CodegenMethods<B>, Bx extends BuilderMethods<B, Cx> = BuilderMethods<B, Cx>> {
    codegen_coverage(bx: Bx, kind: CoverageKind, scope: SourceScope): void;
  }
}

/** `impl<'a, 'tcx, Bx: BuilderMethods<'a, 'tcx>> FunctionCx<'a, 'tcx, Bx>` of coverageinfo.rs (header). */
// PORT: installer instead of top-level prototype writes (TDZ cycle with mod.ts; constant.ts header).
export function install_FunctionCx_coverageinfo(FunctionCx_: { prototype: FunctionCx<BackendTypes> }): void {
  // rustc: compiler/rustc_codegen_ssa/src/mir/coverageinfo.rs:8 codegen_coverage
  FunctionCx_.prototype.codegen_coverage = function (
    this: FunctionCx<BackendTypes>,
    bx: BuilderMethods<BackendTypes>,
    kind: CoverageKind,
    scope: SourceScope,
  ): void {
    // Determine the instance that coverage data was originally generated for.
    const inlined = SourceScopeC.inlined_instance(scope, this.mir.source_scopes);
    const instance = inlined !== undefined ? this.monomorphize(inlined, d_Instance) : this.instance;

    // Handle the coverage info in a backend-specific way.
    bx.add_coverage(instance, kind);
  };
}
