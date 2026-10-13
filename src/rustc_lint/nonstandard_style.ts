// Stub of compiler/rustc_lint/src/nonstandard_style.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (nonstandard_style.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { NonCamelCaseTypes, NonSnakeCase, NonUpperCaseGlobals } from "./nonstandard_style.lints.gen.ts";

export * from "./nonstandard_style.lints.gen.ts";

// impl EarlyLintPass for NonCamelCaseTypes (nonstandard_style.rs:160)
unported_methods(NonCamelCaseTypes.prototype, "rustc_lint::nonstandard_style::NonCamelCaseTypes", ["check_item", "check_trait_item", "check_variant", "check_generic_param"]);
// impl LateLintPass for NonSnakeCase (nonstandard_style.rs:330)
unported_methods(NonSnakeCase.prototype, "rustc_lint::nonstandard_style::NonSnakeCase", ["check_mod", "check_generic_param", "check_fn", "check_item", "check_ty", "check_trait_item", "check_pat", "check_field_def"]);
// impl LateLintPass for NonUpperCaseGlobals (nonstandard_style.rs:584)
unported_methods(NonUpperCaseGlobals.prototype, "rustc_lint::nonstandard_style::NonUpperCaseGlobals", ["check_item", "check_trait_item", "check_impl_item", "check_pat", "check_generic_param"]);
