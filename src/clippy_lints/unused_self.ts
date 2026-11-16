// Port of src/tools/clippy/clippy_lints/src/unused_self.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { UnusedSelf_impl_lint_pass } from "./unused_self.lints.gen.ts";
export * from "./unused_self.lints.gen.ts";

// ---- UnusedSelf (late sub-pass; impl_lint_pass! in unused_self.rs) ----
export interface UnusedSelf extends LateLintPass {}
/** `struct UnusedSelf { .. }` (unused_self.rs:40); its `impl_lint_pass!` expansion is `UnusedSelf_impl_lint_pass`. Fields: ported by the fill lane. */
export class UnusedSelf implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/unused_self.rs:45 new (lane lint-files)
  static new(conf: Conf): UnusedSelf {
    return unported("clippy_lints::unused_self::UnusedSelf::new");
  }

  name(): string {
    return UnusedSelf_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return UnusedSelf_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return UnusedSelf_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for UnusedSelf (unused_self.rs:52)
// stub: src/tools/clippy/clippy_lints/src/unused_self.rs:53 check_impl_item (lane lint-files)
UnusedSelf.prototype.check_impl_item = function (cx, impl_item) {
  unported("clippy_lints::unused_self::UnusedSelf::check_impl_item");
};
