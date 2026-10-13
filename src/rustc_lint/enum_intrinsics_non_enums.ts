// Stub of compiler/rustc_lint/src/enum_intrinsics_non_enums.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (enum_intrinsics_non_enums.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { EnumIntrinsicsNonEnums } from "./enum_intrinsics_non_enums.lints.gen.ts";

export * from "./enum_intrinsics_non_enums.lints.gen.ts";

// impl LateLintPass for EnumIntrinsicsNonEnums (enum_intrinsics_non_enums.rs:71)
unported_methods(EnumIntrinsicsNonEnums.prototype, "rustc_lint::enum_intrinsics_non_enums::EnumIntrinsicsNonEnums", ["check_expr"]);
