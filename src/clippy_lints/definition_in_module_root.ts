// Port of src/tools/clippy/clippy_lints/src/definition_in_module_root.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { DefinitionInModuleRoot_impl_lint_pass } from "./definition_in_module_root.lints.gen.ts";
export * from "./definition_in_module_root.lints.gen.ts";

// ---- DefinitionInModuleRoot (early sub-pass; impl_lint_pass! in definition_in_module_root.rs) ----
export interface DefinitionInModuleRoot extends EarlyLintPass {}
/** `struct DefinitionInModuleRoot { .. }` (definition_in_module_root.rs:56); its `impl_lint_pass!` expansion is `DefinitionInModuleRoot_impl_lint_pass`. Fields: ported by the fill lane. */
export class DefinitionInModuleRoot implements LintPass {
  /** `#[derive(Default)]` */
  static default(): DefinitionInModuleRoot {
    return unported("clippy_lints::definition_in_module_root::DefinitionInModuleRoot::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return DefinitionInModuleRoot_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return DefinitionInModuleRoot_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return DefinitionInModuleRoot_impl_lint_pass.lint_vec();
  }
}

// impl EarlyLintPass for DefinitionInModuleRoot (definition_in_module_root.rs:63)
// stub: src/tools/clippy/clippy_lints/src/definition_in_module_root.rs:64 check_item (lane always-running)
DefinitionInModuleRoot.prototype.check_item = function (cx, item) {
  unported("clippy_lints::definition_in_module_root::DefinitionInModuleRoot::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/definition_in_module_root.rs:110 check_item_post (lane always-running)
DefinitionInModuleRoot.prototype.check_item_post = function (_0, item) {
  unported("clippy_lints::definition_in_module_root::DefinitionInModuleRoot::check_item_post");
};
