// Port of src/tools/clippy/clippy_lints/src/wildcard_imports.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { WildcardImports_impl_lint_pass } from "./wildcard_imports.lints.gen.ts";
export * from "./wildcard_imports.lints.gen.ts";

// ---- WildcardImports (late sub-pass; impl_lint_pass! in wildcard_imports.rs) ----
export interface WildcardImports extends LateLintPass {}
/** `struct WildcardImports { .. }` (wildcard_imports.rs:105); its `impl_lint_pass!` expansion is `WildcardImports_impl_lint_pass`. Fields: ported by the fill lane. */
export class WildcardImports implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/wildcard_imports.rs:111 new (lane lint-files)
  static new(conf: Conf): WildcardImports {
    return unported("clippy_lints::wildcard_imports::WildcardImports::new");
  }

  name(): string {
    return WildcardImports_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return WildcardImports_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return WildcardImports_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for WildcardImports (wildcard_imports.rs:119)
// stub: src/tools/clippy/clippy_lints/src/wildcard_imports.rs:120 check_item (lane lint-files)
WildcardImports.prototype.check_item = function (cx, item) {
  unported("clippy_lints::wildcard_imports::WildcardImports::check_item");
};
