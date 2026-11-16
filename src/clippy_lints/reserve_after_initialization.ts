// Port of src/tools/clippy/clippy_lints/src/reserve_after_initialization.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { ReserveAfterInitialization_impl_lint_pass } from "./reserve_after_initialization.lints.gen.ts";
export * from "./reserve_after_initialization.lints.gen.ts";

// ---- ReserveAfterInitialization (late sub-pass; impl_lint_pass! in reserve_after_initialization.rs) ----
export interface ReserveAfterInitialization extends LateLintPass {}
/** `struct ReserveAfterInitialization { .. }` (reserve_after_initialization.rs:37); its `impl_lint_pass!` expansion is `ReserveAfterInitialization_impl_lint_pass`. Fields: ported by the fill lane. */
export class ReserveAfterInitialization implements LintPass {
  /** `#[derive(Default)]` */
  static default(): ReserveAfterInitialization {
    return unported("clippy_lints::reserve_after_initialization::ReserveAfterInitialization::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return ReserveAfterInitialization_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ReserveAfterInitialization_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ReserveAfterInitialization_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ReserveAfterInitialization (reserve_after_initialization.rs:67)
// stub: src/tools/clippy/clippy_lints/src/reserve_after_initialization.rs:68 check_block (lane lint-files)
ReserveAfterInitialization.prototype.check_block = function (_0, _1) {
  unported("clippy_lints::reserve_after_initialization::ReserveAfterInitialization::check_block");
};
// stub: src/tools/clippy/clippy_lints/src/reserve_after_initialization.rs:72 check_local (lane lint-files)
ReserveAfterInitialization.prototype.check_local = function (cx, local) {
  unported("clippy_lints::reserve_after_initialization::ReserveAfterInitialization::check_local");
};
// stub: src/tools/clippy/clippy_lints/src/reserve_after_initialization.rs:99 check_expr (lane lint-files)
ReserveAfterInitialization.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::reserve_after_initialization::ReserveAfterInitialization::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/reserve_after_initialization.rs:125 check_stmt (lane lint-files)
ReserveAfterInitialization.prototype.check_stmt = function (cx, stmt) {
  unported("clippy_lints::reserve_after_initialization::ReserveAfterInitialization::check_stmt");
};
// stub: src/tools/clippy/clippy_lints/src/reserve_after_initialization.rs:144 check_block_post (lane lint-files)
ReserveAfterInitialization.prototype.check_block_post = function (cx, _0) {
  unported("clippy_lints::reserve_after_initialization::ReserveAfterInitialization::check_block_post");
};
