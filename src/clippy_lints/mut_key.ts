// Port of src/tools/clippy/clippy_lints/src/mut_key.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { unported } from "../std/panic.ts";
import { MutableKeyType_impl_lint_pass } from "./mut_key.lints.gen.ts";
export * from "./mut_key.lints.gen.ts";

// ---- MutableKeyType (late sub-pass; impl_lint_pass! in mut_key.rs) ----
export interface MutableKeyType extends LateLintPass {}
/** `struct MutableKeyType { .. }` (mut_key.rs:71); its `impl_lint_pass!` expansion is `MutableKeyType_impl_lint_pass`. Fields: ported by the fill lane. */
export class MutableKeyType implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/mut_key.rs:105 new (lane lint-files)
  static new(tcx: TyCtxt, conf: Conf): MutableKeyType {
    return unported("clippy_lints::mut_key::MutableKeyType::new");
  }

  name(): string {
    return MutableKeyType_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return MutableKeyType_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return MutableKeyType_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for MutableKeyType (mut_key.rs:75)
// stub: src/tools/clippy/clippy_lints/src/mut_key.rs:76 check_item (lane lint-files)
MutableKeyType.prototype.check_item = function (cx, item) {
  unported("clippy_lints::mut_key::MutableKeyType::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/mut_key.rs:82 check_impl_item (lane lint-files)
MutableKeyType.prototype.check_impl_item = function (cx, item) {
  unported("clippy_lints::mut_key::MutableKeyType::check_impl_item");
};
// stub: src/tools/clippy/clippy_lints/src/mut_key.rs:90 check_trait_item (lane lint-files)
MutableKeyType.prototype.check_trait_item = function (cx, item) {
  unported("clippy_lints::mut_key::MutableKeyType::check_trait_item");
};
// stub: src/tools/clippy/clippy_lints/src/mut_key.rs:96 check_local (lane lint-files)
MutableKeyType.prototype.check_local = function (cx, local) {
  unported("clippy_lints::mut_key::MutableKeyType::check_local");
};
