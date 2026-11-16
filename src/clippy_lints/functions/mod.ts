// Port of src/tools/clippy/clippy_lints/src/functions/mod.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass types src/clippy_lints/lib.gen.ts names,
// each `check_*` of their `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../../clippy_config/lib.ts";
import type { EarlyLintPass, LateLintPass } from "../../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../../rustc_lint_defs/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { unported } from "../../std/panic.ts";
import { EarlyFunctions, Functions_impl_lint_pass } from "./mod.lints.gen.ts";
export * from "./mod.lints.gen.ts";

declare module "./mod.lints.gen.ts" {
  interface EarlyFunctions extends EarlyLintPass {}
}

// ---- EarlyFunctions (early sub-pass; declare_lint_pass! in functions/mod.rs) ----

// impl EarlyLintPass for EarlyFunctions (functions/mod.rs:523)
// stub: src/tools/clippy/clippy_lints/src/functions/mod.rs:524 check_fn (lane dispatch)
EarlyFunctions.prototype.check_fn = function (cx, fn_kind, _0, _1) {
  unported("clippy_lints::functions::EarlyFunctions::check_fn");
};

// ---- Functions (late sub-pass; impl_lint_pass! in functions/mod.rs) ----
export interface Functions extends LateLintPass {}
/** `struct Functions { .. }` (functions/mod.rs:529); its `impl_lint_pass!` expansion is `Functions_impl_lint_pass`. Fields: ported by the fill lane. */
export class Functions implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/functions/mod.rs:542 new (lane dispatch)
  static new(tcx: TyCtxt, conf: Conf): Functions {
    return unported("clippy_lints::functions::Functions::new");
  }

  name(): string {
    return Functions_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return Functions_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return Functions_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for Functions (functions/mod.rs:563)
// stub: src/tools/clippy/clippy_lints/src/functions/mod.rs:564 check_fn (lane dispatch)
Functions.prototype.check_fn = function (cx, kind, decl, body, span, def_id) {
  unported("clippy_lints::functions::Functions::check_fn");
};
// stub: src/tools/clippy/clippy_lints/src/functions/mod.rs:591 check_item (lane dispatch)
Functions.prototype.check_item = function (cx, item) {
  unported("clippy_lints::functions::Functions::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/functions/mod.rs:602 check_impl_item (lane dispatch)
Functions.prototype.check_impl_item = function (cx, item) {
  unported("clippy_lints::functions::Functions::check_impl_item");
};
// stub: src/tools/clippy/clippy_lints/src/functions/mod.rs:615 check_trait_item (lane dispatch)
Functions.prototype.check_trait_item = function (cx, item) {
  unported("clippy_lints::functions::Functions::check_trait_item");
};
// stub: src/tools/clippy/clippy_lints/src/functions/mod.rs:630 check_expr (lane dispatch)
Functions.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::functions::Functions::check_expr");
};
