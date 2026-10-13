// Stub of compiler/rustc_lint/src/interior_mutable_consts.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (interior_mutable_consts.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { InteriorMutableConsts } from "./interior_mutable_consts.lints.gen.ts";

export * from "./interior_mutable_consts.lints.gen.ts";

// impl LateLintPass for InteriorMutableConsts (interior_mutable_consts.rs:54)
unported_methods(InteriorMutableConsts.prototype, "rustc_lint::interior_mutable_consts::InteriorMutableConsts", ["check_expr"]);
