// Stub of compiler/rustc_lint/src/disallowed_pass_by_ref.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (disallowed_pass_by_ref.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { DisallowedPassByRef } from "./disallowed_pass_by_ref.lints.gen.ts";

export * from "./disallowed_pass_by_ref.lints.gen.ts";

// impl LateLintPass for DisallowedPassByRef (disallowed_pass_by_ref.rs:23)
unported_methods(DisallowedPassByRef.prototype, "rustc_lint::disallowed_pass_by_ref::DisallowedPassByRef", ["check_ty"]);
