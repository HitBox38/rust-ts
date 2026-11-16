// Port of src/tools/clippy/clippy_lints/src/item_name_repetitions.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { ItemNameRepetitions_impl_lint_pass } from "./item_name_repetitions.lints.gen.ts";
export * from "./item_name_repetitions.lints.gen.ts";

// ---- ItemNameRepetitions (late sub-pass; impl_lint_pass! in item_name_repetitions.rs) ----
export interface ItemNameRepetitions extends LateLintPass {}
/** `struct ItemNameRepetitions { .. }` (item_name_repetitions.rs:165); its `impl_lint_pass!` expansion is `ItemNameRepetitions_impl_lint_pass`. Fields: ported by the fill lane. */
export class ItemNameRepetitions implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/item_name_repetitions.rs:188 new (lane lint-files)
  static new(conf: Conf): ItemNameRepetitions {
    return unported("clippy_lints::item_name_repetitions::ItemNameRepetitions::new");
  }

  name(): string {
    return ItemNameRepetitions_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ItemNameRepetitions_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ItemNameRepetitions_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ItemNameRepetitions (item_name_repetitions.rs:527)
// stub: src/tools/clippy/clippy_lints/src/item_name_repetitions.rs:528 check_item_post (lane lint-files)
ItemNameRepetitions.prototype.check_item_post = function (_0, item) {
  unported("clippy_lints::item_name_repetitions::ItemNameRepetitions::check_item_post");
};
// stub: src/tools/clippy/clippy_lints/src/item_name_repetitions.rs:535 check_body (lane lint-files)
ItemNameRepetitions.prototype.check_body = function (_0, _1) {
  unported("clippy_lints::item_name_repetitions::ItemNameRepetitions::check_body");
};
// stub: src/tools/clippy/clippy_lints/src/item_name_repetitions.rs:541 check_body_post (lane lint-files)
ItemNameRepetitions.prototype.check_body_post = function (_0, _1) {
  unported("clippy_lints::item_name_repetitions::ItemNameRepetitions::check_body_post");
};
// stub: src/tools/clippy/clippy_lints/src/item_name_repetitions.rs:547 check_item (lane lint-files)
ItemNameRepetitions.prototype.check_item = function (cx, item) {
  unported("clippy_lints::item_name_repetitions::ItemNameRepetitions::check_item");
};
