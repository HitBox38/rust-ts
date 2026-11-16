// Port of src/tools/clippy/clippy_lints/src/arbitrary_source_item_ordering.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { unported } from "../std/panic.ts";
import { ArbitrarySourceItemOrdering_impl_lint_pass } from "./arbitrary_source_item_ordering.lints.gen.ts";
export * from "./arbitrary_source_item_ordering.lints.gen.ts";

// ---- ArbitrarySourceItemOrdering (late sub-pass; impl_lint_pass! in arbitrary_source_item_ordering.rs) ----
export interface ArbitrarySourceItemOrdering extends LateLintPass {}
/** `struct ArbitrarySourceItemOrdering { .. }` (arbitrary_source_item_ordering.rs:170); its `impl_lint_pass!` expansion is `ArbitrarySourceItemOrdering_impl_lint_pass`. Fields: ported by the fill lane. */
export class ArbitrarySourceItemOrdering implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/arbitrary_source_item_ordering.rs:183 new (lane lint-files)
  static new(tcx: TyCtxt, conf: Conf): ArbitrarySourceItemOrdering {
    return unported("clippy_lints::arbitrary_source_item_ordering::ArbitrarySourceItemOrdering::new");
  }

  name(): string {
    return ArbitrarySourceItemOrdering_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ArbitrarySourceItemOrdering_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ArbitrarySourceItemOrdering_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ArbitrarySourceItemOrdering (arbitrary_source_item_ordering.rs:395)
// stub: src/tools/clippy/clippy_lints/src/arbitrary_source_item_ordering.rs:396 check_item (lane lint-files)
ArbitrarySourceItemOrdering.prototype.check_item = function (cx, item) {
  unported("clippy_lints::arbitrary_source_item_ordering::ArbitrarySourceItemOrdering::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/arbitrary_source_item_ordering.rs:489 check_mod (lane lint-files)
ArbitrarySourceItemOrdering.prototype.check_mod = function (cx, module, _0) {
  unported("clippy_lints::arbitrary_source_item_ordering::ArbitrarySourceItemOrdering::check_mod");
};
