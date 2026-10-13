//! Some lints that are only useful in the compiler or crates that use compiler internals, such as
//! Clippy.
// compiler/rustc_lint/src/internal.rs. The lint statics and `declare_lint_pass!` expansions are generated
// (internal.lints.gen.ts). The early passes (`InternalCombinedEarlyLintPass`, registered with `-Zunstable-options`:
// LintPassImpl, ImplicitSysrootCrateImport, BadUseOfFindAttr) are ported; the late passes (M3) are still
// `unported` placeholders (rust_ts/stubs.ts).
import type { ast } from "../rustc_ast/lib.ts";
import { SyntaxContext } from "../rustc_span/hygiene.ts";
import { Span } from "../rustc_span/lib.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import type { EarlyContext } from "./context.ts";
import {
  AttributeKindInFindAttr_diagnostic,
  ImplicitSysrootCrateImportDiag_diagnostic,
  LintPassByHand_diagnostic,
} from "./diagnostics.gen.ts";
import {
  BAD_USE_OF_FIND_ATTR,
  BadOptAccess,
  BadUseOfFindAttr,
  DefaultHashTypes,
  IMPLICIT_SYSROOT_CRATE_IMPORT,
  ImplicitSysrootCrateImport,
  LINT_PASS_IMPL_WITHOUT_MACRO,
  LintPassImpl,
  MissingGenericTypeVisitableDerive,
  QueryStability,
  RustcMustMatchExhaustively,
  SpanUseEqCtxt,
  SymbolInternStringLiteral,
  TyTyKind,
  TypeIr,
} from "./internal.lints.gen.ts";
import type { EarlyLintPass } from "./passes.ts";

export * from "./internal.lints.gen.ts";

declare module "./internal.lints.gen.ts" {
  interface LintPassImpl extends EarlyLintPass {}
  interface ImplicitSysrootCrateImport extends EarlyLintPass {}
  interface BadUseOfFindAttr extends EarlyLintPass {}
}

// impl LateLintPass for DefaultHashTypes (internal.rs:42)
// PORT: placeholder missing from lane lint-early-a's stub (its generator skipped `impl LateLintPass<'_>`).
unported_methods(DefaultHashTypes.prototype, "rustc_lint::internal::DefaultHashTypes", ["check_path"]);
// impl LateLintPass for QueryStability (internal.rs:92)
unported_methods(QueryStability.prototype, "rustc_lint::internal::QueryStability", ["check_expr"]);
// impl LateLintPass for TyTyKind (internal.rs:221)
unported_methods(TyTyKind.prototype, "rustc_lint::internal::TyTyKind", ["check_path", "check_ty"]);
// impl LateLintPass for TypeIr (internal.rs:393)
unported_methods(TypeIr.prototype, "rustc_lint::internal::TypeIr", ["check_expr", "check_item", "check_path"]);

// impl EarlyLintPass for LintPassImpl
// rustc: compiler/rustc_lint/src/internal.rs:517 check_item
LintPassImpl.prototype.check_item = function (this: LintPassImpl, cx: EarlyContext, item: ast.Item): void {
  if (item.kind.$ === "Impl" && item.kind._0.of_trait !== undefined) {
    const of_trait = item.kind._0.of_trait;
    const segments = of_trait.trait_ref.path.segments;
    const last = segments[segments.length - 1];
    if (last !== undefined && last.ident.name === sym.LintPass) {
      const expn_data = SyntaxContext.outer_expn_data(Span.ctxt(of_trait.trait_ref.path.span));
      const call_site = expn_data.call_site;
      const call_site_kind = SyntaxContext.outer_expn_data(Span.ctxt(call_site)).kind;
      if (
        !(expn_data.kind.$ === "Macro" && expn_data.kind._0 === "Bang" && expn_data.kind._1 === sym.impl_lint_pass) &&
        !(call_site_kind.$ === "Macro" && call_site_kind._0 === "Bang" && call_site_kind._1 === sym.declare_lint_pass)
      ) {
        cx.emit_span_lint(LINT_PASS_IMPL_WITHOUT_MACRO, of_trait.trait_ref.path.span, LintPassByHand_diagnostic({}));
      }
    }
  }
};

// impl LateLintPass for BadOptAccess (internal.rs:549)
// PORT: placeholder missing from lane lint-early-a's stub (its generator skipped `impl LateLintPass<'_>`).
unported_methods(BadOptAccess.prototype, "rustc_lint::internal::BadOptAccess", ["check_expr"]);
// impl LateLintPass for SpanUseEqCtxt (internal.rs:582)
unported_methods(SpanUseEqCtxt.prototype, "rustc_lint::internal::SpanUseEqCtxt", ["check_expr"]);
// impl LateLintPass for SymbolInternStringLiteral (internal.rs:618)
unported_methods(SymbolInternStringLiteral.prototype, "rustc_lint::internal::SymbolInternStringLiteral", ["check_expr"]);

// impl EarlyLintPass for ImplicitSysrootCrateImport
// rustc: compiler/rustc_lint/src/internal.rs:661 check_item
ImplicitSysrootCrateImport.prototype.check_item = function (this: ImplicitSysrootCrateImport, cx: EarlyContext, item: ast.Item): void {
  // rustc: compiler/rustc_lint/src/internal.rs:662 is_whitelisted
  function is_whitelisted(crate_name: string): boolean {
    // Whitelist of allowed crates.
    return (
      crate_name.startsWith("rustc_") ||
      ["test", "self", "core", "alloc", "std", "proc_macro", "tikv_jemalloc_sys"].includes(crate_name)
    );
  }

  if (item.kind.$ === "ExternCrate") {
    const original_name = item.kind._0;
    const imported_name = item.kind._1;
    const name = Symbol.as_str(original_name ?? imported_name.name);
    const externs = cx.builder.sess().opts.externs;
    if (externs.get(name) === undefined && !is_whitelisted(name)) {
      cx.emit_span_lint(IMPLICIT_SYSROOT_CRATE_IMPORT, item.span, ImplicitSysrootCrateImportDiag_diagnostic({ name }));
    }
  }
};

// impl EarlyLintPass for BadUseOfFindAttr
// rustc: compiler/rustc_lint/src/internal.rs:694 check_arm
BadUseOfFindAttr.prototype.check_arm = function (this: BadUseOfFindAttr, cx: EarlyContext, arm: ast.Arm): void {
  // rustc: compiler/rustc_lint/src/internal.rs:695 path_contains_attribute_kind
  function path_contains_attribute_kind(cx: EarlyContext, path: ast.Path): void {
    for (const segment of path.segments) {
      if (Symbol.as_str(segment.ident.name) === "AttributeKind") {
        cx.emit_span_lint(BAD_USE_OF_FIND_ATTR, segment.span(), AttributeKindInFindAttr_diagnostic({}));
      }
    }
  }

  // rustc: compiler/rustc_lint/src/internal.rs:707 find_attr_kind_in_pat
  function find_attr_kind_in_pat(cx: EarlyContext, pat: ast.Pat): void {
    const k = pat.kind;
    switch (k.$) {
      case "Struct": {
        const [path, fields] = [k._1, k._2];
        path_contains_attribute_kind(cx, path);
        for (const field of fields) {
          find_attr_kind_in_pat(cx, field.pat);
        }
        break;
      }
      case "TupleStruct": {
        const [path, fields] = [k._1, k._2];
        path_contains_attribute_kind(cx, path);
        for (const field of fields) {
          find_attr_kind_in_pat(cx, field);
        }
        break;
      }
      case "Or":
        for (const pat of k._0) {
          find_attr_kind_in_pat(cx, pat);
        }
        break;
      case "Path":
        path_contains_attribute_kind(cx, k._1);
        break;
      case "Tuple":
        for (const pat of k._0) {
          find_attr_kind_in_pat(cx, pat);
        }
        break;
      case "Deref":
        find_attr_kind_in_pat(cx, k._0);
        break;
      case "Ref":
        // PORT: as upstream, this recurses on `pat` itself (not the subpattern).
        find_attr_kind_in_pat(cx, pat);
        break;
      case "Slice":
        for (const pat of k._0) {
          find_attr_kind_in_pat(cx, pat);
        }
        break;

      case "Guard":
        find_attr_kind_in_pat(cx, k._0);
        break;
      case "Paren":
        find_attr_kind_in_pat(cx, k._0);
        break;
      case "Expr":
      case "Range":
      case "MacCall":
      case "Rest":
      case "Missing":
      case "Err":
      case "Ident":
      case "Never":
      case "Wild":
        break;
    }
  }

  const expn_data = Span.source_callee(arm.span);
  if (expn_data !== undefined && expn_data.kind.$ === "Macro" && Symbol.as_str(expn_data.kind._1) === "find_attr") {
    find_attr_kind_in_pat(cx, arm.pat);
  }
};

// impl LateLintPass for RustcMustMatchExhaustively (internal.rs:818)
unported_methods(RustcMustMatchExhaustively.prototype, "rustc_lint::internal::RustcMustMatchExhaustively", ["check_expr", "check_stmt"]);
// impl LateLintPass for MissingGenericTypeVisitableDerive (internal.rs:896)
unported_methods(MissingGenericTypeVisitableDerive.prototype, "rustc_lint::internal::MissingGenericTypeVisitableDerive", ["check_item"]);
