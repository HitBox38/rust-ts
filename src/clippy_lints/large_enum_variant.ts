// Port of src/tools/clippy/clippy_lints/src/large_enum_variant.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { LargeEnumVariant_impl_lint_pass } from "./large_enum_variant.lints.gen.ts";
export * from "./large_enum_variant.lints.gen.ts";

// ---- LargeEnumVariant (late sub-pass; impl_lint_pass! in large_enum_variant.rs) ----
export interface LargeEnumVariant extends LateLintPass {}
/** `struct LargeEnumVariant { .. }` (large_enum_variant.rs:62); its `impl_lint_pass!` expansion is `LargeEnumVariant_impl_lint_pass`. Fields: ported by the fill lane. */
export class LargeEnumVariant implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/large_enum_variant.rs:67 new (lane lint-files)
  static new(conf: Conf): LargeEnumVariant {
    return unported("clippy_lints::large_enum_variant::LargeEnumVariant::new");
  }

  name(): string {
    return LargeEnumVariant_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return LargeEnumVariant_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return LargeEnumVariant_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for LargeEnumVariant (large_enum_variant.rs:74)
// stub: src/tools/clippy/clippy_lints/src/large_enum_variant.rs:75 check_item (lane lint-files)
LargeEnumVariant.prototype.check_item = function (cx, item) {
  unported("clippy_lints::large_enum_variant::LargeEnumVariant::check_item");
};
