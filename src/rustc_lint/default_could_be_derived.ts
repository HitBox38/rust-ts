// Stub of compiler/rustc_lint/src/default_could_be_derived.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (default_could_be_derived.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { DefaultCouldBeDerived } from "./default_could_be_derived.lints.gen.ts";

export * from "./default_could_be_derived.lints.gen.ts";

// impl LateLintPass for DefaultCouldBeDerived (default_could_be_derived.rs:55)
unported_methods(DefaultCouldBeDerived.prototype, "rustc_lint::default_could_be_derived::DefaultCouldBeDerived", ["check_impl_item"]);
