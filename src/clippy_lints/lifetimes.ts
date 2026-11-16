// Port of src/tools/clippy/clippy_lints/src/lifetimes.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { Lifetimes_impl_lint_pass } from "./lifetimes.lints.gen.ts";
export * from "./lifetimes.lints.gen.ts";

// ---- Lifetimes (late sub-pass; impl_lint_pass! in lifetimes.rs) ----
export interface Lifetimes extends LateLintPass {}
/** `struct Lifetimes { .. }` (lifetimes.rs:133); its `impl_lint_pass!` expansion is `Lifetimes_impl_lint_pass`. Fields: ported by the fill lane. */
export class Lifetimes implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/lifetimes.rs:138 new (lane lint-files)
  static new(conf: Conf): Lifetimes {
    return unported("clippy_lints::lifetimes::Lifetimes::new");
  }

  name(): string {
    return Lifetimes_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return Lifetimes_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return Lifetimes_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for Lifetimes (lifetimes.rs:143)
// stub: src/tools/clippy/clippy_lints/src/lifetimes.rs:144 check_item (lane lint-files)
Lifetimes.prototype.check_item = function (cx, item) {
  unported("clippy_lints::lifetimes::Lifetimes::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/lifetimes.rs:163 check_poly_trait_ref (lane lint-files)
Lifetimes.prototype.check_poly_trait_ref = function (cx, poly_trait_ref) {
  unported("clippy_lints::lifetimes::Lifetimes::check_poly_trait_ref");
};
// stub: src/tools/clippy/clippy_lints/src/lifetimes.rs:169 check_impl_item (lane lint-files)
Lifetimes.prototype.check_impl_item = function (cx, item) {
  unported("clippy_lints::lifetimes::Lifetimes::check_impl_item");
};
// stub: src/tools/clippy/clippy_lints/src/lifetimes.rs:186 check_trait_item (lane lint-files)
Lifetimes.prototype.check_trait_item = function (cx, item) {
  unported("clippy_lints::lifetimes::Lifetimes::check_trait_item");
};
