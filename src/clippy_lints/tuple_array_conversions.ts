// Port of src/tools/clippy/clippy_lints/src/tuple_array_conversions.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { TupleArrayConversions_impl_lint_pass } from "./tuple_array_conversions.lints.gen.ts";
export * from "./tuple_array_conversions.lints.gen.ts";

// ---- TupleArrayConversions (late sub-pass; impl_lint_pass! in tuple_array_conversions.rs) ----
export interface TupleArrayConversions extends LateLintPass {}
/** `struct TupleArrayConversions { .. }` (tuple_array_conversions.rs:51); its `impl_lint_pass!` expansion is `TupleArrayConversions_impl_lint_pass`. Fields: ported by the fill lane. */
export class TupleArrayConversions implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/tuple_array_conversions.rs:55 new (lane lint-files)
  static new(conf: Conf): TupleArrayConversions {
    return unported("clippy_lints::tuple_array_conversions::TupleArrayConversions::new");
  }

  name(): string {
    return TupleArrayConversions_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return TupleArrayConversions_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return TupleArrayConversions_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for TupleArrayConversions (tuple_array_conversions.rs:63)
// stub: src/tools/clippy/clippy_lints/src/tuple_array_conversions.rs:65 check_expr (lane lint-files)
TupleArrayConversions.prototype.check_expr = function (cx, e) {
  unported("clippy_lints::tuple_array_conversions::TupleArrayConversions::check_expr");
};
