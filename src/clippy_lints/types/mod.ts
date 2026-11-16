// Port of src/tools/clippy/clippy_lints/src/types/mod.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../../clippy_config/lib.ts";
import type { LateLintPass } from "../../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../../rustc_lint_defs/lib.ts";
import { unported } from "../../std/panic.ts";
import { Types_impl_lint_pass } from "./mod.lints.gen.ts";
export * from "./mod.lints.gen.ts";

// ---- Types (late sub-pass; impl_lint_pass! in types/mod.rs) ----
export interface Types extends LateLintPass {}
/** `struct Types { .. }` (types/mod.rs:406); its `impl_lint_pass!` expansion is `Types_impl_lint_pass`. Fields: ported by the fill lane. */
export class Types implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/types/mod.rs:545 new (lane dispatch)
  static new(conf: Conf): Types {
    return unported("clippy_lints::types::Types::new");
  }

  name(): string {
    return Types_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return Types_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return Types_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for Types (types/mod.rs:412)
// stub: src/tools/clippy/clippy_lints/src/types/mod.rs:413 check_fn (lane dispatch)
Types.prototype.check_fn = function (cx, fn_kind, decl, _0, _1, def_id) {
  unported("clippy_lints::types::Types::check_fn");
};
// stub: src/tools/clippy/clippy_lints/src/types/mod.rs:445 check_item (lane dispatch)
Types.prototype.check_item = function (cx, item) {
  unported("clippy_lints::types::Types::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/types/mod.rs:462 check_impl_item (lane dispatch)
Types.prototype.check_impl_item = function (cx, item) {
  unported("clippy_lints::types::Types::check_impl_item");
};
// stub: src/tools/clippy/clippy_lints/src/types/mod.rs:490 check_field_def (lane dispatch)
Types.prototype.check_field_def = function (cx, field) {
  unported("clippy_lints::types::Types::check_field_def");
};
// stub: src/tools/clippy/clippy_lints/src/types/mod.rs:507 check_trait_item (lane dispatch)
Types.prototype.check_trait_item = function (cx, item) {
  unported("clippy_lints::types::Types::check_trait_item");
};
// stub: src/tools/clippy/clippy_lints/src/types/mod.rs:530 check_local (lane dispatch)
Types.prototype.check_local = function (cx, local) {
  unported("clippy_lints::types::Types::check_local");
};
