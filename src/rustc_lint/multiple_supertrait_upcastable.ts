// Stub of compiler/rustc_lint/src/multiple_supertrait_upcastable.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (multiple_supertrait_upcastable.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { MultipleSupertraitUpcastable } from "./multiple_supertrait_upcastable.lints.gen.ts";

export * from "./multiple_supertrait_upcastable.lints.gen.ts";

// impl LateLintPass for MultipleSupertraitUpcastable (multiple_supertrait_upcastable.rs:39)
unported_methods(MultipleSupertraitUpcastable.prototype, "rustc_lint::multiple_supertrait_upcastable::MultipleSupertraitUpcastable", ["check_item"]);
