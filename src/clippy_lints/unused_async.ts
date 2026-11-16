// Port of src/tools/clippy/clippy_lints/src/unused_async.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { UnusedAsync_impl_lint_pass } from "./unused_async.lints.gen.ts";
export * from "./unused_async.lints.gen.ts";

// ---- UnusedAsync (late sub-pass; impl_lint_pass! in unused_async.rs) ----
export interface UnusedAsync extends LateLintPass {}
/** `struct UnusedAsync { .. }` (unused_async.rs:95); its `impl_lint_pass!` expansion is `UnusedAsync_impl_lint_pass`. Fields: ported by the fill lane. */
export class UnusedAsync implements LintPass {
  /** `#[derive(Default)]` */
  static default(): UnusedAsync {
    return unported("clippy_lints::unused_async::UnusedAsync::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return UnusedAsync_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return UnusedAsync_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return UnusedAsync_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for UnusedAsync (unused_async.rs:177)
// stub: src/tools/clippy/clippy_lints/src/unused_async.rs:178 check_fn (lane lint-files)
UnusedAsync.prototype.check_fn = function (cx, fn_kind, fn_decl, body, span, def_id) {
  unported("clippy_lints::unused_async::UnusedAsync::check_fn");
};
// stub: src/tools/clippy/clippy_lints/src/unused_async.rs:213 check_path (lane lint-files)
UnusedAsync.prototype.check_path = function (cx, path, hir_id) {
  unported("clippy_lints::unused_async::UnusedAsync::check_path");
};
// stub: src/tools/clippy/clippy_lints/src/unused_async.rs:237 check_crate_post (lane lint-files)
UnusedAsync.prototype.check_crate_post = function (cx) {
  unported("clippy_lints::unused_async::UnusedAsync::check_crate_post");
};
// stub: src/tools/clippy/clippy_lints/src/unused_async.rs:265 check_impl_item (lane lint-files)
UnusedAsync.prototype.check_impl_item = function (cx, impl_item) {
  unported("clippy_lints::unused_async::UnusedAsync::check_impl_item");
};
