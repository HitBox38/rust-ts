// Port of src/tools/clippy/clippy_lints/src/unit_types/mod.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { FormatArgsStorage } from "../../clippy_utils/macros.ts";
import type { LateLintPass } from "../../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../../rustc_lint_defs/lib.ts";
import { unported } from "../../std/panic.ts";
import { UnitTypes_impl_lint_pass } from "./mod.lints.gen.ts";
export * from "./mod.lints.gen.ts";

// ---- UnitTypes (late sub-pass; impl_lint_pass! in unit_types/mod.rs) ----
export interface UnitTypes extends LateLintPass {}
/** `struct UnitTypes { .. }` (unit_types/mod.rs:101); its `impl_lint_pass!` expansion is `UnitTypes_impl_lint_pass`. Fields: ported by the fill lane. */
export class UnitTypes implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/unit_types/mod.rs:106 new (lane dispatch)
  static new(format_args: FormatArgsStorage): UnitTypes {
    return unported("clippy_lints::unit_types::UnitTypes::new");
  }

  name(): string {
    return UnitTypes_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return UnitTypes_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return UnitTypes_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for UnitTypes (unit_types/mod.rs:111)
// stub: src/tools/clippy/clippy_lints/src/unit_types/mod.rs:112 check_local (lane dispatch)
UnitTypes.prototype.check_local = function (cx, local) {
  unported("clippy_lints::unit_types::UnitTypes::check_local");
};
// stub: src/tools/clippy/clippy_lints/src/unit_types/mod.rs:116 check_expr (lane dispatch)
UnitTypes.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::unit_types::UnitTypes::check_expr");
};
