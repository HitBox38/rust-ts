//! Implementation of the late lint pass.
//!
//! The late lint pass Works on HIR nodes, towards the end of analysis (after
//! borrow checking, etc.). These lints have full type information available.
//
// Port of compiler/rustc_lint/src/late.rs: `unerased_lint_store`. The rest (the HIR traversal of late lint
// passes) is M3: stubs with `unported` bodies and no markers (parser-core pattern).
import type { Session } from "../rustc_session/session.ts";
import { panic, unported, unwrap } from "../std/panic.ts";
import { LintStore } from "./context.ts";
import type { LateLintPass } from "./passes.ts";

/// Extract the [`LintStore`] from [`Session`].
///
/// This function exists because [`Session::lint_store`] is type-erased.
// rustc: compiler/rustc_lint/src/late.rs:25 unerased_lint_store
export function unerased_lint_store(sess: Session): LintStore {
  const store: unknown = unwrap(sess.lint_store);
  // `store.downcast_ref().unwrap()`
  if (!(store instanceof LintStore)) return panic("called `Option::unwrap()` on a `None` value");
  return store;
}

/** `pub fn late_lint_mod` (late.rs:353). PORT: stub (HIR, M3). */
export function late_lint_mod(_tcx: unknown, _module_def_id: unknown, _builtin_lints: LateLintPass): never {
  return unported("rustc_lint::late::late_lint_mod (HIR, M3)");
}

/** `pub fn check_crate` (late.rs:462). PORT: stub (HIR, M3). */
export function check_crate(_tcx: unknown): never {
  return unported("rustc_lint::late::check_crate (HIR, M3)");
}
