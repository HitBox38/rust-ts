// Stub of compiler/rustc_lint/src/opaque_hidden_inferred_bound.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (opaque_hidden_inferred_bound.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { OpaqueHiddenInferredBound } from "./opaque_hidden_inferred_bound.lints.gen.ts";

export * from "./opaque_hidden_inferred_bound.lints.gen.ts";

// impl LateLintPass for OpaqueHiddenInferredBound (opaque_hidden_inferred_bound.rs:69)
unported_methods(OpaqueHiddenInferredBound.prototype, "rustc_lint::opaque_hidden_inferred_bound::OpaqueHiddenInferredBound", ["check_ty"]);
