// Port of src/tools/clippy/clippy_lints/src/try_from_instead_of_from_str.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { TryFromInsteadOfFromStr_impl_lint_pass } from "./try_from_instead_of_from_str.lints.gen.ts";
export * from "./try_from_instead_of_from_str.lints.gen.ts";

// ---- TryFromInsteadOfFromStr (late sub-pass; impl_lint_pass! in try_from_instead_of_from_str.rs) ----
export interface TryFromInsteadOfFromStr extends LateLintPass {}
/** `struct TryFromInsteadOfFromStr { .. }` (try_from_instead_of_from_str.rs:79); its `impl_lint_pass!` expansion is `TryFromInsteadOfFromStr_impl_lint_pass`. Fields: ported by the fill lane. */
export class TryFromInsteadOfFromStr implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/try_from_instead_of_from_str.rs:84 new (lane lint-files)
  static new(conf: Conf): TryFromInsteadOfFromStr {
    return unported("clippy_lints::try_from_instead_of_from_str::TryFromInsteadOfFromStr::new");
  }

  name(): string {
    return TryFromInsteadOfFromStr_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return TryFromInsteadOfFromStr_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return TryFromInsteadOfFromStr_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for TryFromInsteadOfFromStr (try_from_instead_of_from_str.rs:163)
// stub: src/tools/clippy/clippy_lints/src/try_from_instead_of_from_str.rs:164 check_item (lane lint-files)
TryFromInsteadOfFromStr.prototype.check_item = function (cx, item) {
  unported("clippy_lints::try_from_instead_of_from_str::TryFromInsteadOfFromStr::check_item");
};
