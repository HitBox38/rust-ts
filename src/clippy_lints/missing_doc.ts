// Port of src/tools/clippy/clippy_lints/src/missing_doc.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { MissingDoc_impl_lint_pass } from "./missing_doc.lints.gen.ts";
export * from "./missing_doc.lints.gen.ts";

// ---- MissingDoc (late sub-pass; impl_lint_pass! in missing_doc.rs) ----
export interface MissingDoc extends LateLintPass {}
/** `struct MissingDoc { .. }` (missing_doc.rs:31); its `impl_lint_pass!` expansion is `MissingDoc_impl_lint_pass`. Fields: ported by the fill lane. */
export class MissingDoc implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/missing_doc.rs:55 new (lane lint-files)
  static new(conf: Conf): MissingDoc {
    return unported("clippy_lints::missing_doc::MissingDoc::new");
  }

  name(): string {
    return MissingDoc_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return MissingDoc_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return MissingDoc_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for MissingDoc (missing_doc.rs:101)
// stub: src/tools/clippy/clippy_lints/src/missing_doc.rs:102 check_attributes (lane lint-files)
MissingDoc.prototype.check_attributes = function (_0, attrs) {
  unported("clippy_lints::missing_doc::MissingDoc::check_attributes");
};
// stub: src/tools/clippy/clippy_lints/src/missing_doc.rs:109 check_attributes_post (lane lint-files)
MissingDoc.prototype.check_attributes_post = function (_0, _1) {
  unported("clippy_lints::missing_doc::MissingDoc::check_attributes_post");
};
// stub: src/tools/clippy/clippy_lints/src/missing_doc.rs:119 check_item (lane lint-files)
MissingDoc.prototype.check_item = function (cx, item) {
  unported("clippy_lints::missing_doc::MissingDoc::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/missing_doc.rs:183 check_item_post (lane lint-files)
MissingDoc.prototype.check_item_post = function (_0, item) {
  unported("clippy_lints::missing_doc::MissingDoc::check_item_post");
};
// stub: src/tools/clippy/clippy_lints/src/missing_doc.rs:196 check_trait_item (lane lint-files)
MissingDoc.prototype.check_trait_item = function (cx, item) {
  unported("clippy_lints::missing_doc::MissingDoc::check_trait_item");
};
// stub: src/tools/clippy/clippy_lints/src/missing_doc.rs:214 check_impl_item (lane lint-files)
MissingDoc.prototype.check_impl_item = function (cx, item) {
  unported("clippy_lints::missing_doc::MissingDoc::check_impl_item");
};
// stub: src/tools/clippy/clippy_lints/src/missing_doc.rs:235 check_body (lane lint-files)
MissingDoc.prototype.check_body = function (_0, body) {
  unported("clippy_lints::missing_doc::MissingDoc::check_body");
};
// stub: src/tools/clippy/clippy_lints/src/missing_doc.rs:241 check_body_post (lane lint-files)
MissingDoc.prototype.check_body_post = function (_0, body) {
  unported("clippy_lints::missing_doc::MissingDoc::check_body_post");
};
// stub: src/tools/clippy/clippy_lints/src/missing_doc.rs:247 check_field_def (lane lint-files)
MissingDoc.prototype.check_field_def = function (cx, field) {
  unported("clippy_lints::missing_doc::MissingDoc::check_field_def");
};
// stub: src/tools/clippy/clippy_lints/src/missing_doc.rs:266 check_variant (lane lint-files)
MissingDoc.prototype.check_variant = function (cx, variant) {
  unported("clippy_lints::missing_doc::MissingDoc::check_variant");
};
