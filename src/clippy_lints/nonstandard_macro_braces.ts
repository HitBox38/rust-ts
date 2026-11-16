// Port of src/tools/clippy/clippy_lints/src/nonstandard_macro_braces.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { MacroBraces_impl_lint_pass } from "./nonstandard_macro_braces.lints.gen.ts";
export * from "./nonstandard_macro_braces.lints.gen.ts";

// ---- MacroBraces (pre-expansion + early sub-passes; impl_lint_pass! in nonstandard_macro_braces.rs) ----
export interface MacroBraces extends EarlyLintPass {}
/** `struct MacroBraces { .. }` (nonstandard_macro_braces.rs:39); its `impl_lint_pass!` expansion is `MacroBraces_impl_lint_pass`. Fields: ported by the fill lane. */
export class MacroBraces implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/nonstandard_macro_braces.rs:46 new (lane always-running)
  static new(conf: Conf): MacroBraces {
    return unported("clippy_lints::nonstandard_macro_braces::MacroBraces::new");
  }

  name(): string {
    return MacroBraces_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return MacroBraces_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return MacroBraces_impl_lint_pass.lint_vec();
  }
}

// impl EarlyLintPass for MacroBraces (nonstandard_macro_braces.rs:54)
// stub: src/tools/clippy/clippy_lints/src/nonstandard_macro_braces.rs:55 check_mac (lane always-running)
MacroBraces.prototype.check_mac = function (cx, mac) {
  unported("clippy_lints::nonstandard_macro_braces::MacroBraces::check_mac");
};
// stub: src/tools/clippy/clippy_lints/src/nonstandard_macro_braces.rs:77 check_stmt (lane always-running)
MacroBraces.prototype.check_stmt = function (_0, stmt) {
  unported("clippy_lints::nonstandard_macro_braces::MacroBraces::check_stmt");
};
// stub: src/tools/clippy/clippy_lints/src/nonstandard_macro_braces.rs:88 check_mac_def (lane always-running)
MacroBraces.prototype.check_mac_def = function (cx, mac) {
  unported("clippy_lints::nonstandard_macro_braces::MacroBraces::check_mac_def");
};
