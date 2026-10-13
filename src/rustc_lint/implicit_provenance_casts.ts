// Stub of compiler/rustc_lint/src/implicit_provenance_casts.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (implicit_provenance_casts.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { ImplicitProvenanceCasts } from "./implicit_provenance_casts.lints.gen.ts";

export * from "./implicit_provenance_casts.lints.gen.ts";

// impl LateLintPass for ImplicitProvenanceCasts (implicit_provenance_casts.rs:63)
unported_methods(ImplicitProvenanceCasts.prototype, "rustc_lint::implicit_provenance_casts::ImplicitProvenanceCasts", ["check_expr"]);
