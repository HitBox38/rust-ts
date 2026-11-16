// Port of src/tools/clippy/clippy_lints/src/duration_suboptimal_units.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { unported } from "../std/panic.ts";
import { DurationSuboptimalUnits_impl_lint_pass } from "./duration_suboptimal_units.lints.gen.ts";
export * from "./duration_suboptimal_units.lints.gen.ts";

// ---- DurationSuboptimalUnits (late sub-pass; impl_lint_pass! in duration_suboptimal_units.rs) ----
export interface DurationSuboptimalUnits extends LateLintPass {}
/** `struct DurationSuboptimalUnits { .. }` (duration_suboptimal_units.rs:56); its `impl_lint_pass!` expansion is `DurationSuboptimalUnits_impl_lint_pass`. Fields: ported by the fill lane. */
export class DurationSuboptimalUnits implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/duration_suboptimal_units.rs:62 new (lane lint-files)
  static new(tcx: TyCtxt, conf: Conf): DurationSuboptimalUnits {
    return unported("clippy_lints::duration_suboptimal_units::DurationSuboptimalUnits::new");
  }

  name(): string {
    return DurationSuboptimalUnits_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return DurationSuboptimalUnits_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return DurationSuboptimalUnits_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for DurationSuboptimalUnits (duration_suboptimal_units.rs:75)
// stub: src/tools/clippy/clippy_lints/src/duration_suboptimal_units.rs:76 check_expr (lane lint-files)
DurationSuboptimalUnits.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::duration_suboptimal_units::DurationSuboptimalUnits::check_expr");
};
