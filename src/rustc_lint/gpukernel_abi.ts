// Stub of compiler/rustc_lint/src/gpukernel_abi.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (gpukernel_abi.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { ImproperGpuKernelLint } from "./gpukernel_abi.lints.gen.ts";

export * from "./gpukernel_abi.lints.gen.ts";

// impl LateLintPass for ImproperGpuKernelLint (gpukernel_abi.rs:148)
unported_methods(ImproperGpuKernelLint.prototype, "rustc_lint::gpukernel_abi::ImproperGpuKernelLint", ["check_fn"]);
