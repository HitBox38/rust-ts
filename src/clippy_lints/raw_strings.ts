// Port of src/tools/clippy/clippy_lints/src/raw_strings.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { RawStrings_impl_lint_pass } from "./raw_strings.lints.gen.ts";
export * from "./raw_strings.lints.gen.ts";

// ---- RawStrings (early sub-pass; impl_lint_pass! in raw_strings.rs) ----
export interface RawStrings extends EarlyLintPass {}
/** `struct RawStrings { .. }` (raw_strings.rs:60); its `impl_lint_pass!` expansion is `RawStrings_impl_lint_pass`. Fields: ported by the fill lane. */
export class RawStrings implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/raw_strings.rs:65 new (lane always-running)
  static new(conf: Conf): RawStrings {
    return unported("clippy_lints::raw_strings::RawStrings::new");
  }

  name(): string {
    return RawStrings_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return RawStrings_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return RawStrings_impl_lint_pass.lint_vec();
  }
}

// impl EarlyLintPass for RawStrings (raw_strings.rs:72)
// stub: src/tools/clippy/clippy_lints/src/raw_strings.rs:73 check_expr (lane always-running)
RawStrings.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::raw_strings::RawStrings::check_expr");
};
