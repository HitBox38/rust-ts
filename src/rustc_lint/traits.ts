// Stub of compiler/rustc_lint/src/traits.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (traits.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { DropTraitConstraints } from "./traits.lints.gen.ts";

export * from "./traits.lints.gen.ts";

// impl LateLintPass for DropTraitConstraints (traits.rs:89)
unported_methods(DropTraitConstraints.prototype, "rustc_lint::traits::DropTraitConstraints", ["check_item", "check_ty"]);
