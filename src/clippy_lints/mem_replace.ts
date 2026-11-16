// Port of src/tools/clippy/clippy_lints/src/mem_replace.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { MemReplace_impl_lint_pass } from "./mem_replace.lints.gen.ts";
export * from "./mem_replace.lints.gen.ts";

// ---- MemReplace (late sub-pass; impl_lint_pass! in mem_replace.rs) ----
export interface MemReplace extends LateLintPass {}
/** `struct MemReplace { .. }` (mem_replace.rs:288); its `impl_lint_pass!` expansion is `MemReplace_impl_lint_pass`. Fields: ported by the fill lane. */
export class MemReplace implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/mem_replace.rs:293 new (lane lint-files)
  static new(conf: Conf): MemReplace {
    return unported("clippy_lints::mem_replace::MemReplace::new");
  }

  name(): string {
    return MemReplace_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return MemReplace_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return MemReplace_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for MemReplace (mem_replace.rs:298)
// stub: src/tools/clippy/clippy_lints/src/mem_replace.rs:299 check_expr (lane lint-files)
MemReplace.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::mem_replace::MemReplace::check_expr");
};
