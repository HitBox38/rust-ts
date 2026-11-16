// Port of src/tools/clippy/clippy_lints/src/single_component_path_imports.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { SingleComponentPathImports_impl_lint_pass } from "./single_component_path_imports.lints.gen.ts";
export * from "./single_component_path_imports.lints.gen.ts";

// ---- SingleComponentPathImports (early sub-pass; impl_lint_pass! in single_component_path_imports.rs) ----
export interface SingleComponentPathImports extends EarlyLintPass {}
/** `struct SingleComponentPathImports { .. }` (single_component_path_imports.rs:42); its `impl_lint_pass!` expansion is `SingleComponentPathImports_impl_lint_pass`. Fields: ported by the fill lane. */
export class SingleComponentPathImports implements LintPass {
  /** `#[derive(Default)]` */
  static default(): SingleComponentPathImports {
    return unported("clippy_lints::single_component_path_imports::SingleComponentPathImports::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return SingleComponentPathImports_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return SingleComponentPathImports_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return SingleComponentPathImports_impl_lint_pass.lint_vec();
  }
}

// impl EarlyLintPass for SingleComponentPathImports (single_component_path_imports.rs:54)
// stub: src/tools/clippy/clippy_lints/src/single_component_path_imports.rs:55 check_crate (lane always-running)
SingleComponentPathImports.prototype.check_crate = function (cx, krate) {
  unported("clippy_lints::single_component_path_imports::SingleComponentPathImports::check_crate");
};
// stub: src/tools/clippy/clippy_lints/src/single_component_path_imports.rs:63 check_item (lane always-running)
SingleComponentPathImports.prototype.check_item = function (cx, item) {
  unported("clippy_lints::single_component_path_imports::SingleComponentPathImports::check_item");
};
