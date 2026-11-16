// Port of src/tools/clippy/clippy_lints/src/escape.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { BoxedLocal_impl_lint_pass } from "./escape.lints.gen.ts";
export * from "./escape.lints.gen.ts";

// ---- BoxedLocal (late sub-pass; impl_lint_pass! in escape.rs) ----
export interface BoxedLocal extends LateLintPass {}
/** `struct BoxedLocal { .. }` (escape.rs:15); its `impl_lint_pass!` expansion is `BoxedLocal_impl_lint_pass`. Fields: ported by the fill lane. */
export class BoxedLocal implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/escape.rs:20 new (lane lint-files)
  static new(conf: Conf): BoxedLocal {
    return unported("clippy_lints::escape::BoxedLocal::new");
  }

  name(): string {
    return BoxedLocal_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return BoxedLocal_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return BoxedLocal_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for BoxedLocal (escape.rs:66)
// stub: src/tools/clippy/clippy_lints/src/escape.rs:67 check_fn (lane lint-files)
BoxedLocal.prototype.check_fn = function (cx, fn_kind, _0, body, _1, fn_def_id) {
  unported("clippy_lints::escape::BoxedLocal::check_fn");
};
