// Port of src/tools/clippy/clippy_lints/src/redundant_static_lifetimes.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { RedundantStaticLifetimes_impl_lint_pass } from "./redundant_static_lifetimes.lints.gen.ts";
export * from "./redundant_static_lifetimes.lints.gen.ts";

// ---- RedundantStaticLifetimes (early sub-pass; impl_lint_pass! in redundant_static_lifetimes.rs) ----
export interface RedundantStaticLifetimes extends EarlyLintPass {}
/** `struct RedundantStaticLifetimes { .. }` (redundant_static_lifetimes.rs:38); its `impl_lint_pass!` expansion is `RedundantStaticLifetimes_impl_lint_pass`. Fields: ported by the fill lane. */
export class RedundantStaticLifetimes implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/redundant_static_lifetimes.rs:43 new (lane always-running)
  static new(conf: Conf): RedundantStaticLifetimes {
    return unported("clippy_lints::redundant_static_lifetimes::RedundantStaticLifetimes::new");
  }

  name(): string {
    return RedundantStaticLifetimes_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return RedundantStaticLifetimes_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return RedundantStaticLifetimes_impl_lint_pass.lint_vec();
  }
}

// impl EarlyLintPass for RedundantStaticLifetimes (redundant_static_lifetimes.rs:90)
// stub: src/tools/clippy/clippy_lints/src/redundant_static_lifetimes.rs:91 check_item (lane always-running)
RedundantStaticLifetimes.prototype.check_item = function (cx, item) {
  unported("clippy_lints::redundant_static_lifetimes::RedundantStaticLifetimes::check_item");
};
