// Port of src/tools/clippy/clippy_lints/src/panic_unimplemented.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { PanicUnimplemented_impl_lint_pass } from "./panic_unimplemented.lints.gen.ts";
export * from "./panic_unimplemented.lints.gen.ts";

// ---- PanicUnimplemented (late sub-pass; impl_lint_pass! in panic_unimplemented.rs) ----
export interface PanicUnimplemented extends LateLintPass {}
/** `struct PanicUnimplemented { .. }` (panic_unimplemented.rs:9); its `impl_lint_pass!` expansion is `PanicUnimplemented_impl_lint_pass`. Fields: ported by the fill lane. */
export class PanicUnimplemented implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/panic_unimplemented.rs:14 new (lane lint-files)
  static new(conf: Conf): PanicUnimplemented {
    return unported("clippy_lints::panic_unimplemented::PanicUnimplemented::new");
  }

  name(): string {
    return PanicUnimplemented_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return PanicUnimplemented_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return PanicUnimplemented_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for PanicUnimplemented (panic_unimplemented.rs:96)
// stub: src/tools/clippy/clippy_lints/src/panic_unimplemented.rs:97 check_expr (lane lint-files)
PanicUnimplemented.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::panic_unimplemented::PanicUnimplemented::check_expr");
};
