// Port of src/tools/clippy/clippy_lints/src/methods/mod.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../../clippy_config/lib.ts";
import type { FormatArgsStorage } from "../../clippy_utils/macros.ts";
import type { LateLintPass } from "../../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../../rustc_lint_defs/lib.ts";
import { unported } from "../../std/panic.ts";
import { Methods_impl_lint_pass } from "./mod.lints.gen.ts";
export * from "./mod.lints.gen.ts";

// ---- Methods (late sub-pass; impl_lint_pass! in methods/mod.rs) ----
export interface Methods extends LateLintPass {}
/** `struct Methods { .. }` (methods/mod.rs:5245); its `impl_lint_pass!` expansion is `Methods_impl_lint_pass`. Fields: ported by the fill lane. */
export class Methods implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/methods/mod.rs:5260 new (lane dispatch-methods)
  static new(conf: Conf, format_args: FormatArgsStorage): Methods {
    return unported("clippy_lints::methods::Methods::new");
  }

  name(): string {
    return Methods_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return Methods_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return Methods_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for Methods (methods/mod.rs:5294)
// stub: src/tools/clippy/clippy_lints/src/methods/mod.rs:5295 check_crate (lane dispatch-methods)
Methods.prototype.check_crate = function (cx) {
  unported("clippy_lints::methods::Methods::check_crate");
};
// stub: src/tools/clippy/clippy_lints/src/methods/mod.rs:5308 check_expr (lane dispatch-methods)
Methods.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::methods::Methods::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/methods/mod.rs:5361 check_impl_item (lane dispatch-methods)
Methods.prototype.check_impl_item = function (cx, impl_item) {
  unported("clippy_lints::methods::Methods::check_impl_item");
};
// stub: src/tools/clippy/clippy_lints/src/methods/mod.rs:5398 check_trait_item (lane dispatch-methods)
Methods.prototype.check_trait_item = function (cx, item) {
  unported("clippy_lints::methods::Methods::check_trait_item");
};
