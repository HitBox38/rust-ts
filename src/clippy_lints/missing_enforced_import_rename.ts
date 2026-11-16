// Port of src/tools/clippy/clippy_lints/src/missing_enforced_import_rename.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { unported } from "../std/panic.ts";
import { ImportRename_impl_lint_pass } from "./missing_enforced_import_rename.lints.gen.ts";
export * from "./missing_enforced_import_rename.lints.gen.ts";

// ---- ImportRename (late sub-pass; impl_lint_pass! in missing_enforced_import_rename.rs) ----
export interface ImportRename extends LateLintPass {}
/** `struct ImportRename { .. }` (missing_enforced_import_rename.rs:50); its `impl_lint_pass!` expansion is `ImportRename_impl_lint_pass`. Fields: ported by the fill lane. */
export class ImportRename implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/missing_enforced_import_rename.rs:55 new (lane lint-files)
  static new(tcx: TyCtxt, conf: Conf): ImportRename {
    return unported("clippy_lints::missing_enforced_import_rename::ImportRename::new");
  }

  name(): string {
    return ImportRename_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ImportRename_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ImportRename_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ImportRename (missing_enforced_import_rename.rs:114)
// stub: src/tools/clippy/clippy_lints/src/missing_enforced_import_rename.rs:115 check_item (lane lint-files)
ImportRename.prototype.check_item = function (cx, item) {
  unported("clippy_lints::missing_enforced_import_rename::ImportRename::check_item");
};
