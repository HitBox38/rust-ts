// Stub of compiler/rustc_lint/src/types.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (types.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { VariantSizeDifferences, InvalidAtomicOrdering, TypeLimits_impl_lint_pass } from "./types.lints.gen.ts";

export * from "./types.lints.gen.ts";

/** `TypeLimits` (struct defined in types.rs; its `impl_lint_pass!` expansion is `TypeLimits_impl_lint_pass`). PORT: stub. */
export class TypeLimits implements LintPass {
  name(): string {
    return TypeLimits_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return TypeLimits_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return TypeLimits_impl_lint_pass.lint_vec();
  }
  static new(): TypeLimits {
    return unported("rustc_lint::types::TypeLimits::new");
  }
}

// impl LateLintPass for TypeLimits (types.rs:569)
unported_methods(TypeLimits.prototype, "rustc_lint::types::TypeLimits", ["check_lit", "check_expr"]);
// impl LateLintPass for VariantSizeDifferences (types.rs:979)
unported_methods(VariantSizeDifferences.prototype, "rustc_lint::types::VariantSizeDifferences", ["check_item"]);
// impl LateLintPass for InvalidAtomicOrdering (types.rs:1176)
unported_methods(InvalidAtomicOrdering.prototype, "rustc_lint::types::InvalidAtomicOrdering", ["check_expr"]);
