// Port of src/tools/clippy/clippy_lints/src/write/mod.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../../clippy_config/lib.ts";
import type { FormatArgsStorage } from "../../clippy_utils/macros.ts";
import type { LateLintPass } from "../../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../../rustc_lint_defs/lib.ts";
import { unported } from "../../std/panic.ts";
import { Write_impl_lint_pass } from "./mod.lints.gen.ts";
export * from "./mod.lints.gen.ts";

// ---- Write (late sub-pass; impl_lint_pass! in write/mod.rs) ----
export interface Write extends LateLintPass {}
/** `struct Write { .. }` (write/mod.rs:251); its `impl_lint_pass!` expansion is `Write_impl_lint_pass`. Fields: ported by the fill lane. */
export class Write implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/write/mod.rs:259 new (lane dispatch)
  static new(conf: Conf, format_args: FormatArgsStorage): Write {
    return unported("clippy_lints::write::Write::new");
  }

  name(): string {
    return Write_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return Write_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return Write_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for Write (write/mod.rs:272)
// stub: src/tools/clippy/clippy_lints/src/write/mod.rs:273 check_item (lane dispatch)
Write.prototype.check_item = function (cx, item) {
  unported("clippy_lints::write::Write::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/write/mod.rs:280 check_item_post (lane dispatch)
Write.prototype.check_item_post = function (_cx, item) {
  unported("clippy_lints::write::Write::check_item_post");
};
// stub: src/tools/clippy/clippy_lints/src/write/mod.rs:287 check_expr (lane dispatch)
Write.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::write::Write::check_expr");
};
