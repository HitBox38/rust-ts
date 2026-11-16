// Port of src/tools/clippy/clippy_lints/src/use_self.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { UseSelf_impl_lint_pass } from "./use_self.lints.gen.ts";
export * from "./use_self.lints.gen.ts";

// ---- UseSelf (late sub-pass; impl_lint_pass! in use_self.rs) ----
export interface UseSelf extends LateLintPass {}
/** `struct UseSelf { .. }` (use_self.rs:60); its `impl_lint_pass!` expansion is `UseSelf_impl_lint_pass`. Fields: ported by the fill lane. */
export class UseSelf implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/use_self.rs:67 new (lane lint-files)
  static new(conf: Conf): UseSelf {
    return unported("clippy_lints::use_self::UseSelf::new");
  }

  name(): string {
    return UseSelf_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return UseSelf_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return UseSelf_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for UseSelf (use_self.rs:87)
// stub: src/tools/clippy/clippy_lints/src/use_self.rs:88 check_item (lane lint-files)
UseSelf.prototype.check_item = function (cx, item) {
  unported("clippy_lints::use_self::UseSelf::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/use_self.rs:132 check_item_post (lane lint-files)
UseSelf.prototype.check_item_post = function (_0, _1) {
  unported("clippy_lints::use_self::UseSelf::check_item_post");
};
// stub: src/tools/clippy/clippy_lints/src/use_self.rs:136 check_impl_item (lane lint-files)
UseSelf.prototype.check_impl_item = function (cx, impl_item) {
  unported("clippy_lints::use_self::UseSelf::check_impl_item");
};
// stub: src/tools/clippy/clippy_lints/src/use_self.rs:197 check_impl_item_post (lane lint-files)
UseSelf.prototype.check_impl_item_post = function (_0, impl_item) {
  unported("clippy_lints::use_self::UseSelf::check_impl_item_post");
};
// stub: src/tools/clippy/clippy_lints/src/use_self.rs:205 check_ty (lane lint-files)
UseSelf.prototype.check_ty = function (cx, hir_ty) {
  unported("clippy_lints::use_self::UseSelf::check_ty");
};
// stub: src/tools/clippy/clippy_lints/src/use_self.rs:231 check_expr (lane lint-files)
UseSelf.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::use_self::UseSelf::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/use_self.rs:250 check_pat (lane lint-files)
UseSelf.prototype.check_pat = function (cx, pat) {
  unported("clippy_lints::use_self::UseSelf::check_pat");
};
