// Stub of compiler/rustc_lint/src/async_fn_in_trait.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (async_fn_in_trait.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { AsyncFnInTrait } from "./async_fn_in_trait.lints.gen.ts";

export * from "./async_fn_in_trait.lints.gen.ts";

// impl LateLintPass for AsyncFnInTrait (async_fn_in_trait.rs:92)
unported_methods(AsyncFnInTrait.prototype, "rustc_lint::async_fn_in_trait::AsyncFnInTrait", ["check_trait_item"]);
