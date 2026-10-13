// Stub of compiler/rustc_lint/src/internal.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (internal.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { DefaultHashTypes, QueryStability, TyTyKind, TypeIr, LintPassImpl, BadOptAccess, SpanUseEqCtxt, SymbolInternStringLiteral, ImplicitSysrootCrateImport, BadUseOfFindAttr, RustcMustMatchExhaustively, MissingGenericTypeVisitableDerive } from "./internal.lints.gen.ts";

export * from "./internal.lints.gen.ts";

// impl LateLintPass for QueryStability (internal.rs:92)
unported_methods(QueryStability.prototype, "rustc_lint::internal::QueryStability", ["check_expr"]);
// impl LateLintPass for TyTyKind (internal.rs:221)
unported_methods(TyTyKind.prototype, "rustc_lint::internal::TyTyKind", ["check_path", "check_ty"]);
// impl LateLintPass for TypeIr (internal.rs:393)
unported_methods(TypeIr.prototype, "rustc_lint::internal::TypeIr", ["check_expr", "check_item", "check_path"]);
// impl EarlyLintPass for LintPassImpl (internal.rs:516)
unported_methods(LintPassImpl.prototype, "rustc_lint::internal::LintPassImpl", ["check_item"]);
// impl LateLintPass for SpanUseEqCtxt (internal.rs:582)
unported_methods(SpanUseEqCtxt.prototype, "rustc_lint::internal::SpanUseEqCtxt", ["check_expr"]);
// impl LateLintPass for SymbolInternStringLiteral (internal.rs:618)
unported_methods(SymbolInternStringLiteral.prototype, "rustc_lint::internal::SymbolInternStringLiteral", ["check_expr"]);
// impl EarlyLintPass for ImplicitSysrootCrateImport (internal.rs:660)
unported_methods(ImplicitSysrootCrateImport.prototype, "rustc_lint::internal::ImplicitSysrootCrateImport", ["check_item"]);
// impl EarlyLintPass for BadUseOfFindAttr (internal.rs:693)
unported_methods(BadUseOfFindAttr.prototype, "rustc_lint::internal::BadUseOfFindAttr", ["check_arm"]);
// impl LateLintPass for RustcMustMatchExhaustively (internal.rs:818)
unported_methods(RustcMustMatchExhaustively.prototype, "rustc_lint::internal::RustcMustMatchExhaustively", ["check_expr", "check_stmt"]);
// impl LateLintPass for MissingGenericTypeVisitableDerive (internal.rs:896)
unported_methods(MissingGenericTypeVisitableDerive.prototype, "rustc_lint::internal::MissingGenericTypeVisitableDerive", ["check_item"]);
