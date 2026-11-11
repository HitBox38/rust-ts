// Port of compiler/rustc_codegen_ssa/src/traits/coverageinfo.rs (lane ssa-contract).
import type { CoverageKind } from "../../rustc_middle/mir/coverage.ts";
import type { Instance } from "../../rustc_middle/ty/instance.ts";

// rustc-trait: compiler/rustc_codegen_ssa/src/traits/coverageinfo.rs:4 CoverageInfoBuilderMethods
export interface CoverageInfoBuilderMethods {
  /// Handle the MIR coverage info in a backend-specific way.
  ///
  /// This can potentially be a no-op in backends that don't support
  /// coverage instrumentation.
  // rustc: compiler/rustc_codegen_ssa/src/traits/coverageinfo.rs:9 add_coverage
  add_coverage(instance: Instance, kind: CoverageKind): void;
}
