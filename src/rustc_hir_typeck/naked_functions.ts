// Port of compiler/rustc_hir_typeck/src/naked_functions.rs (lane typeck-euv).
//
//! Checks validity of naked functions.
//
// `ItemKind` is generated (naked_functions.gen.ts); `CheckParameters` / `CheckInlineAssembly` are hand classes
// (types.sets.json `hand`) extending rustc_hir intravisit's `Visitor`.
// Init order: top-level code here touches only ./decls.ts, this file's .gen.ts and other crates.
export * from "./naked_functions.gen.ts";
import { BindingMode, BindingMode_eq } from "../rustc_ast/lib.ts";
import * as hir from "../rustc_hir/lib.ts";
import { type HirId, HirIdSet } from "../rustc_hir_id/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { span_bug } from "../rustc_span/macros.ts";
import { NakedFunctionsAsmBlock_diagnostic, NakedFunctionsMustNakedAsm_diagnostic, NoPatterns_diagnostic, ParamsNotAllowed_diagnostic } from "./diagnostics.ts";
import type { ItemKind } from "./naked_functions.gen.ts";

/// Naked fns can only have trivial binding patterns in arguments,
/// may not actually use those arguments, and the body must consist of just
/// a single asm statement.
// rustc: compiler/rustc_hir_typeck/src/naked_functions.rs:18 typeck_naked_fn
export function typeck_naked_fn(tcx: TyCtxt, def_id: LocalDefId, body: hir.Body): void {
  // debug_assert!(find_attr!(tcx, def_id, Naked(..)));
  check_no_patterns(tcx, body.params);
  check_no_parameters_use(tcx, body);
  check_asm(tcx, def_id, body);
}

/// Checks that parameters don't use patterns. Mirrors the checks for function declarations.
// rustc: compiler/rustc_hir_typeck/src/naked_functions.rs:30 check_no_patterns
export function check_no_patterns(tcx: TyCtxt, params: readonly hir.Param[]): void {
  for (const param of params) {
    const kind = param.pat.kind;
    if (kind.$ === "Wild" || (kind.$ === "Binding" && BindingMode_eq(kind._0, BindingMode.NONE) && kind._3 === undefined)) {
      // ok
    } else {
      tcx.dcx().emit_err(NoPatterns_diagnostic({ span: param.pat.span }));
    }
  }
}

/// Checks that function parameters aren't used in the function body.
// rustc: compiler/rustc_hir_typeck/src/naked_functions.rs:42 check_no_parameters_use
export function check_no_parameters_use(tcx: TyCtxt, body: hir.Body): void {
  const params = new HirIdSet();
  for (const param of body.params) {
    param.pat.each_binding((_binding_mode, hir_id, _span, _ident) => {
      params.add(hir_id);
    });
  }
  new CheckParameters(tcx, params).visit_body(body);
}

// rustc-type: compiler/rustc_hir_typeck/src/naked_functions.rs:52 CheckParameters
// PORT: hand class (types.sets.json `hand`): `impl Visitor for CheckParameters` overrides intravisit's `visit_expr`.
export class CheckParameters extends hir.intravisit.Visitor {
  constructor(
    public tcx: TyCtxt,
    public params: HirIdSet,
  ) {
    super();
  }

  // ---- impl<'tcx> Visitor<'tcx> for CheckParameters<'tcx> (:57) ----

  // rustc: compiler/rustc_hir_typeck/src/naked_functions.rs:58 visit_expr
  override visit_expr(expr: hir.Expr): undefined {
    if (expr.kind.$ === "Path" && expr.kind._0.$ === "Resolved" && expr.kind._0._1.res.$ === "Local") {
      const var_hir_id: HirId = expr.kind._0._1.res._0;
      if (this.params.has(var_hir_id)) {
        this.tcx.dcx().emit_err(ParamsNotAllowed_diagnostic({ span: expr.span }));
        return;
      }
    }
    hir.intravisit.walk_expr(this, expr);
  }
}

/// Checks that function body contains a single inline assembly block.
// rustc: compiler/rustc_hir_typeck/src/naked_functions.rs:74 check_asm
export function check_asm(tcx: TyCtxt, def_id: LocalDefId, body: hir.Body): void {
  const this_ = new CheckInlineAssembly([]);
  this_.visit_body(body);
  if (this_.items.length === 1 && (this_.items[0]![0] === "NakedAsm" || this_.items[0]![0] === "Err")) {
    // Ok.
  } else {
    let must_show_error = false;
    let has_naked_asm = false;
    let has_err = false;
    const multiple_asms: Span[] = [];
    const non_asms: Span[] = [];
    for (const [kind, span] of this_.items) {
      switch (kind) {
        case "NakedAsm":
          if (has_naked_asm) {
            must_show_error = true;
            multiple_asms.push(span);
          } else {
            has_naked_asm = true;
          }
          break;
        case "InlineAsm":
          has_err = true;

          tcx.dcx().emit_err(NakedFunctionsMustNakedAsm_diagnostic({ span }));
          break;
        case "NonAsm":
          must_show_error = true;
          non_asms.push(span);
          break;
        case "Err":
          has_err = true;
          break;
      }
    }

    // If the naked function only contains a single asm block and a non-zero number of
    // errors, then don't show an additional error. This allows for appending/prepending
    // `compile_error!("...")` statements and reduces error noise.
    if (must_show_error || !has_err) {
      tcx.dcx().emit_err(
        NakedFunctionsAsmBlock_diagnostic({
          span: tcx.def_span(def_id),
          multiple_asms,
          non_asms,
        }),
      );
    }
  }
}

// rustc-type: compiler/rustc_hir_typeck/src/naked_functions.rs:118 CheckInlineAssembly
// PORT: hand class (types.sets.json `hand`): `impl Visitor for CheckInlineAssembly` overrides `visit_stmt` / `visit_expr`.
export class CheckInlineAssembly extends hir.intravisit.Visitor {
  constructor(public items: [ItemKind, Span][]) {
    super();
  }

  // ---- impl CheckInlineAssembly (:130) ----

  // rustc: compiler/rustc_hir_typeck/src/naked_functions.rs:131 check_expr
  check_expr(expr: hir.Expr, span: Span): void {
    switch (expr.kind.$) {
      case "ConstBlock":
      case "Array":
      case "Call":
      case "MethodCall":
      case "Use":
      case "Tup":
      case "Binary":
      case "Unary":
      case "Lit":
      case "Cast":
      case "Type":
      case "UnsafeBinderCast":
      case "Loop":
      case "Match":
      case "If":
      case "Closure":
      case "Assign":
      case "AssignOp":
      case "Field":
      case "Index":
      case "Path":
      case "AddrOf":
      case "Let":
      case "Break":
      case "Continue":
      case "Ret":
      case "OffsetOf":
      case "Become":
      case "Struct":
      case "Repeat":
      case "Yield":
        this.items.push(["NonAsm", span]);
        break;

      case "InlineAsm": {
        const asm = expr.kind._0;
        switch (asm.asm_macro) {
          case "Asm":
            this.items.push(["InlineAsm", span]);
            break;
          case "NakedAsm":
            this.items.push(["NakedAsm", span]);
            break;
          case "GlobalAsm":
            span_bug(span, "`global_asm!` is not allowed in this position");
        }
        break;
      }

      case "DropTemps":
      case "Block":
        hir.intravisit.walk_expr(this, expr);
        break;

      case "Err":
        this.items.push(["Err", span]);
        break;
    }
  }

  // ---- impl<'tcx> Visitor<'tcx> for CheckInlineAssembly (:190) ----

  // rustc: compiler/rustc_hir_typeck/src/naked_functions.rs:191 visit_stmt
  override visit_stmt(stmt: hir.Stmt): undefined {
    switch (stmt.kind.$) {
      case "Item":
        break;
      case "Let":
        this.items.push(["NonAsm", stmt.span]);
        break;
      case "Expr":
      case "Semi": {
        const expr = stmt.kind._0;
        this.check_expr(expr, stmt.span);
        break;
      }
    }
  }

  // rustc: compiler/rustc_hir_typeck/src/naked_functions.rs:203 visit_expr
  override visit_expr(expr: hir.Expr): undefined {
    this.check_expr(expr, expr.span);
  }
}
