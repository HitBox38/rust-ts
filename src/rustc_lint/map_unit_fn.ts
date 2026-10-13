// Stub of compiler/rustc_lint/src/map_unit_fn.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (map_unit_fn.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { MapUnitFn } from "./map_unit_fn.lints.gen.ts";

export * from "./map_unit_fn.lints.gen.ts";

// impl LateLintPass for MapUnitFn (map_unit_fn.rs:41)
unported_methods(MapUnitFn.prototype, "rustc_lint::map_unit_fn::MapUnitFn", ["check_stmt"]);
