// Port of compiler/rustc_codegen_ssa/src/back/mod.rs (lane fixers-47).
//
// PORT: the `mod` declarations are the sibling files, which callers import directly; the `pub use` of
// `symbol_export`'s two helpers is not repeated here. `Cow<'_, str>` is a `string`.
import type { EarlySession } from "../../rustc_session/session.ts";
import { add_version_to_llvm_target } from "./apple.ts";

/// The target triple depends on the deployment target, and is required to
/// enable features such as cross-language LTO, and for picking the right
/// Mach-O commands.
///
/// Certain optimizations also depend on the deployment target.
// rustc: compiler/rustc_codegen_ssa/src/back/mod.rs:25 versioned_llvm_target
export function versioned_llvm_target(sess: EarlySession): string {
  if (sess.target.options.is_like_darwin) {
    return add_version_to_llvm_target(sess.target.llvm_target, sess.apple_deployment_target());
  } else {
    // FIXME(madsmtm): Certain other targets also include a version,
    // we might want to move that here as well.
    return sess.target.llvm_target;
  }
}
