// Port of src/tools/clippy/clippy_lints/src/from_over_into.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { FromOverInto_impl_lint_pass } from "./from_over_into.lints.gen.ts";
export * from "./from_over_into.lints.gen.ts";

// ---- FromOverInto (late sub-pass; impl_lint_pass! in from_over_into.rs) ----
export interface FromOverInto extends LateLintPass {}
/** `struct FromOverInto { .. }` (from_over_into.rs:56); its `impl_lint_pass!` expansion is `FromOverInto_impl_lint_pass`. Fields: ported by the fill lane. */
export class FromOverInto implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/from_over_into.rs:61 new (lane lint-files)
  static new(conf: Conf): FromOverInto {
    return unported("clippy_lints::from_over_into::FromOverInto::new");
  }

  name(): string {
    return FromOverInto_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return FromOverInto_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return FromOverInto_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for FromOverInto (from_over_into.rs:66)
// stub: src/tools/clippy/clippy_lints/src/from_over_into.rs:67 check_item (lane lint-files)
FromOverInto.prototype.check_item = function (cx, item) {
  unported("clippy_lints::from_over_into::FromOverInto::check_item");
};
