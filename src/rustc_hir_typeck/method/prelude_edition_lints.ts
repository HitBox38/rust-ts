// Port of compiler/rustc_hir_typeck/src/method/prelude_edition_lints.rs. Lanes: typeck-method (the lint fns :156 and
// :273, on the success path of every method / fully-qualified call), typeck-fnsugg-a (the rest: the three
// `impl Diagnostic`s and `trait_path_or_bare_name` / `trait_path` / `adjust_expr`).
//
// Every fn of this file is declared in ../decls.ts under `// method/prelude_edition_lints.rs:<line>`.
// PORT: `impl Diagnostic for X` is `X_into_diag(self, dcx, level)` plus `X_diagnostic(self)`, the `Diagnostic` trait object
// passed to `emit_node_span_lint` (the generated-derive naming). `AmbiguousTraitAssocFunc` (a struct local to
// `lint_fully_qualified_call_from_2018`) and its impl stay local to that fn.
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./prelude_edition_lints.gen.ts";
import { join_path_idents } from "../../rustc_ast/lib.ts";
import { Mutability } from "../../rustc_ast_ir/lib.ts";
import { Applicability, Diag, type DiagCtxtHandle, type Level } from "../../rustc_errors/lib.ts";
import type { Diagnostic } from "../../rustc_errors/diagnostic.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import { debug_ItemKind } from "../../rustc_hir/hir.gen.ts";
import type { HirId } from "../../rustc_hir_id/lib.ts";
import { display_DefPathData } from "../../rustc_hir_id/definitions.ts";
import { ARRAY_INTO_ITER, BOXED_SLICE_INTO_ITER } from "../../rustc_lint/lib.ts";
import type { Lint } from "../../rustc_lint_defs/lib.ts";
import { RUST_2021_PRELUDE_COLLISIONS, RUST_2024_PRELUDE_COLLISIONS } from "../../rustc_lint_defs/builtin.gen.ts";
import { EvaluationResult } from "../../rustc_middle/traits/select.ts";
import { AssocItem } from "../../rustc_middle/ty/assoc.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../../rustc_middle/ty/generics.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { DUMMY_SP, debug_SpanSnippetError, Span } from "../../rustc_span/lib.ts";
import { type DefId, DefId_eq } from "../../rustc_span/def_id.ts";
import { span_bug } from "../../rustc_span/macros.ts";
import { display_Ident, type Ident, kw, STDLIB_STABLE_CRATES, Symbol, sym } from "../../rustc_span/symbol.ts";
import { format_debug, PLAIN } from "../../std/fmt.ts";
import { unreachable, unwrap } from "../../std/panic.ts";
import { ok, unwrap_result } from "../../std/result.ts";
import { FnCtxt } from "../decls.ts";
import type { AmbiguousTraitMethod, AmbiguousTraitMethodCall } from "./prelude_edition_lints.gen.ts";
import type { Pick } from "./probe.gen.ts";

// impl<'a, 'b, 'tcx> Diagnostic<'a> for AmbiguousTraitMethodCall<'b, 'tcx> {
// rustc: compiler/rustc_hir_typeck/src/method/prelude_edition_lints.rs:28 into_diag
export function AmbiguousTraitMethodCall_into_diag(self: AmbiguousTraitMethodCall, dcx: DiagCtxtHandle, level: Level): Diag {
  const { segment_name, self_expr_span, pick, tcx, edition } = self;
  const lint = Diag.new(dcx, level, `trait method \`${Symbol.as_str(segment_name)}\` will become ambiguous in Rust ${edition}`);
  const derefs = "*".repeat(pick.autoderefs);

  let autoref: string;
  const adj = pick.autoref_or_ptr_adjustment;
  if (adj !== undefined && adj.$ === "Autoref") {
    autoref = Mutability.ref_prefix_str(adj.mutbl);
  } else if (adj === undefined || adj.$ === "ToConstPtr") {
    autoref = "";
  } else {
    switch (adj._0) {
      case "Mut":
        autoref = "Pin<&mut ";
        break;
      case "Not":
        autoref = "Pin<&";
        break;
    }
  }
  const r = tcx.sess.source_map().span_to_snippet(self_expr_span);
  if (r.$ === "Ok") {
    const self_expr = r._0.toString();
    let self_adjusted: string;
    if (pick.autoref_or_ptr_adjustment?.$ === "ToConstPtr") {
      self_adjusted = `${derefs}${self_expr} as *const _`;
    } else {
      self_adjusted = `${autoref}${derefs}${self_expr}`;
    }

    if (pick.autoref_or_ptr_adjustment?.$ === "ReborrowPin") {
      self_adjusted += ">";
    }

    lint.span_suggestion(self_expr_span, "disambiguate the method call", `(${self_adjusted})`, Applicability.MachineApplicable);
  } else {
    let self_adjusted: string;
    if (pick.autoref_or_ptr_adjustment?.$ === "ToConstPtr") {
      self_adjusted = `${derefs}(...) as *const _`;
    } else {
      self_adjusted = `${autoref}${derefs}...`;
    }
    lint.span_help(self_expr_span, `disambiguate the method call with \`(${self_adjusted})\``);
  }
  return lint;
}
// }

/** `AmbiguousTraitMethodCall` as a `Diagnostic` trait object. */
export function AmbiguousTraitMethodCall_diagnostic(self: AmbiguousTraitMethodCall): Diagnostic {
  return { into_diag: (dcx, level) => AmbiguousTraitMethodCall_into_diag(self, dcx, level) };
}

// impl<'a, 'c, 'tcx, 'fnctx> Diagnostic<'a> for AmbiguousTraitMethod<'c, 'tcx, 'fnctx> {
// rustc: compiler/rustc_hir_typeck/src/method/prelude_edition_lints.rs:95 into_diag
export function AmbiguousTraitMethod_into_diag(self: AmbiguousTraitMethod, dcx: DiagCtxtHandle, level: Level): Diag {
  const { segment, call_expr, self_expr, pick, args, edition, span, this: this_ } = self;
  const lint = Diag.new(dcx, level, `trait method \`${Symbol.as_str(segment.ident.name)}\` will become ambiguous in Rust ${edition}`);

  const sp = call_expr.span;
  const trait_name = this_.trait_path_or_bare_name(span, call_expr.hir_id, AssocItem.container_id(pick.item, this_.tcx));

  const [self_adjusted, precise] = this_.adjust_expr(pick, self_expr, sp);
  if (precise) {
    const args_ = args.reduce((string, arg) => {
      const span = Span.find_ancestor_inside(arg.span, sp) ?? DUMMY_SP;
      return string + `, ${unwrap_result(this_.sess().source_map().span_to_snippet(span), debug_SpanSnippetError).toString()}`;
    }, "");

    let turbofish: string;
    const seg_args = segment.args;
    const args_snippet = seg_args === undefined ? undefined : ok(this_.sess().source_map().span_to_snippet(seg_args.span_ext));
    if (args_snippet !== undefined) {
      // Keep turbofish.
      turbofish = `::${args_snippet.toString()}`;
    } else {
      turbofish = "";
    }
    lint.span_suggestion(
      sp,
      "disambiguate the associated function",
      `${trait_name}::${Symbol.as_str(segment.ident.name)}${turbofish}(${self_adjusted}${args_})`,
      Applicability.MachineApplicable,
    );
  } else {
    lint.span_help(sp, `disambiguate the associated function with \`${trait_name}::${display_Ident(segment.ident)}(...)\``);
  }
  return lint;
}
// }

/** `AmbiguousTraitMethod` as a `Diagnostic` trait object. */
export function AmbiguousTraitMethod_diagnostic(self: AmbiguousTraitMethod): Diagnostic {
  return { into_diag: (dcx, level) => AmbiguousTraitMethod_into_diag(self, dcx, level) };
}

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {
// rustc: compiler/rustc_hir_typeck/src/method/prelude_edition_lints.rs:156 lint_edition_dependent_dot_call
FnCtxt.prototype.lint_edition_dependent_dot_call = function (this: FnCtxt, self_ty: Ty, segment: hir.PathSegment, span: Span, call_expr: hir.Expr, self_expr: hir.Expr, pick: Pick, args: readonly hir.Expr[]): void {
  // debug!(
  //     "lookup(method_name={}, self_ty={:?}, call_expr={:?}, self_expr={:?})",
  //     segment.ident, self_ty, call_expr, self_expr
  // );

  let prelude_or_array_lint: Lint;
  let edition: string;
  const name = segment.ident.name;
  let k;
  if (
    // `try_into` was added to the prelude in Rust 2021.
    name === sym.try_into &&
    !Span.at_least_rust_2021(span)
  ) {
    [prelude_or_array_lint, edition] = [RUST_2021_PRELUDE_COLLISIONS, "2021"];
  } else if (
    // `Future::poll` was added to the prelude in Rust 2024.
    name === sym.poll &&
    // We check that the self type is `Pin<&mut _>` to avoid false positives for this common name.
    !Span.at_least_rust_2024(span) &&
    (k = self_ty.kind()).$ === "Adt" &&
    this.tcx.is_lang_item(k._0.did(), "Pin") &&
    (() => {
      const ak = unwrap(GenericArg.as_type(k._1[0]!)).kind();
      return ak.$ === "Ref" && ak._2 === "Mut";
    })()
  ) {
    [prelude_or_array_lint, edition] = [RUST_2024_PRELUDE_COLLISIONS, "2024"];
  } else if (
    // `IntoFuture::into_future` was added to the prelude in Rust 2024.
    name === sym.into_future &&
    !Span.at_least_rust_2024(span)
  ) {
    [prelude_or_array_lint, edition] = [RUST_2024_PRELUDE_COLLISIONS, "2024"];
  } else if (name === sym.into_iter) {
    // `into_iter` wasn't added to the prelude,
    // but `[T; N].into_iter()` doesn't resolve to IntoIterator::into_iter
    // before Rust 2021, which results in the same problem.
    // It is only a problem for arrays.
    const boxed = self_ty.boxed_ty();
    if (self_ty.kind().$ === "Array" && !Span.at_least_rust_2021(span)) {
      // In this case, it wasn't really a prelude addition that was the problem.
      // Instead, the problem is that the array-into_iter hack will no longer
      // apply in Rust 2021.
      [prelude_or_array_lint, edition] = [ARRAY_INTO_ITER, "2021"];
    } else if (boxed !== undefined && boxed.is_slice() && !Span.at_least_rust_2024(span)) {
      // In this case, it wasn't really a prelude addition that was the problem.
      // Instead, the problem is that the boxed-slice-into_iter hack will no
      // longer apply in Rust 2024.
      [prelude_or_array_lint, edition] = [BOXED_SLICE_INTO_ITER, "2024"];
    } else {
      return;
    }
  } else {
    return;
  }

  // No need to lint if method came from std/core, as that will now be in the prelude
  if (STDLIB_STABLE_CRATES.includes(this.tcx.crate_name(pick.item.def_id.krate))) {
    return;
  }

  if (pick.kind.$ === "InherentImplPick" || pick.kind.$ === "ObjectPick") {
    // avoid repeatedly adding unneeded `&*`s
    if (pick.autoderefs === 1 && pick.autoref_or_ptr_adjustment?.$ === "Autoref" && self_ty.kind().$ === "Ref") {
      return;
    }

    // if it's an inherent `self` method (not `&self` or `&mut self`), it will take
    // precedence over the `TryInto` impl, and thus won't break in 2021 edition
    if (pick.autoderefs === 0 && pick.autoref_or_ptr_adjustment === undefined) {
      return;
    }

    // Inherent impls only require not relying on autoref and autoderef in order to
    // ensure that the trait implementation won't be used
    const lint: AmbiguousTraitMethodCall = {
      segment_name: segment.ident.name,
      self_expr_span: self_expr.span,
      pick,
      tcx: this.tcx,
      edition,
    };
    this.tcx.emit_node_span_lint(prelude_or_array_lint, self_expr.hir_id, self_expr.span, AmbiguousTraitMethodCall_diagnostic(lint));
  } else {
    // trait implementations require full disambiguation to not clash with the new prelude
    // additions (i.e. convert from dot-call to fully-qualified call)
    const lint: AmbiguousTraitMethod = {
      segment,
      call_expr,
      self_expr,
      pick,
      args,
      edition,
      span,
      this: this,
    };
    this.tcx.emit_node_span_lint(prelude_or_array_lint, call_expr.hir_id, call_expr.span, AmbiguousTraitMethod_diagnostic(lint));
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/prelude_edition_lints.rs:273 lint_fully_qualified_call_from_2018
FnCtxt.prototype.lint_fully_qualified_call_from_2018 = function (this: FnCtxt, span: Span, method_name: Ident, self_ty: Ty, self_ty_span: Span, expr_id: HirId, pick: Pick): void {
  // struct AmbiguousTraitAssocFunc<'a, 'fnctx, 'tcx> {
  //     method_name: Symbol, this: &'a FnCtxt<'fnctx, 'tcx>, pick: &'a Pick<'tcx>, span: Span, expr_id: hir::HirId,
  //     self_ty_span: Span, self_ty: Ty<'tcx>,
  // }
  interface AmbiguousTraitAssocFunc {
    method_name: Symbol;
    this: FnCtxt;
    pick: Pick;
    span: Span;
    expr_id: HirId;
    self_ty_span: Span;
    self_ty: Ty;
  }
  // impl<'a, 'b, 'fnctx, 'tcx> Diagnostic<'a> for AmbiguousTraitAssocFunc<'b, 'fnctx, 'tcx> {
  // rustc: compiler/rustc_hir_typeck/src/method/prelude_edition_lints.rs:293 into_diag
  const AmbiguousTraitAssocFunc_into_diag = (self: AmbiguousTraitAssocFunc, dcx: DiagCtxtHandle, level: Level): Diag => {
    const { method_name, this: this_, pick, span, expr_id, self_ty_span, self_ty } = self;
    const lint = Diag.new(dcx, level, `trait-associated function \`${Symbol.as_str(method_name)}\` will become ambiguous in Rust 2021`);

    // "type" refers to either a type or, more likely, a trait from which
    // the associated function or method is from.
    const container_id = AssocItem.container_id(pick.item, this_.tcx);
    const trait_path = this_.trait_path_or_bare_name(span, expr_id, container_id);
    const trait_generics = this_.tcx.generics_of(container_id) as Generics;

    let trait_name: string;
    if (trait_generics.own_params.length <= (trait_generics.has_self ? 1 : 0)) {
      trait_name = trait_path;
    } else {
      const counts = trait_generics.own_counts();
      trait_name = `${trait_path}<${[
        ...Array<string>(counts.lifetimes).fill("'_"),
        ...Array<string>(counts.types + counts.consts - (trait_generics.has_self ? 1 : 0)).fill("_"),
      ].join(", ")}>`;
    }

    const found_span = Span.find_ancestor_inside(self_ty_span, span);
    const snippet = found_span === undefined ? undefined : ok(this_.sess().source_map().span_to_snippet(found_span));
    let self_ty_name = snippet !== undefined ? snippet.toString() : display_Ty(self_ty);

    // Get the number of generics the self type has (if an Adt) unless we can determine that
    // the user has written the self type with generics already which we (naively) do by looking
    // for a "<" in `self_ty_name`.
    if (!self_ty_name.includes("<")) {
      const k = self_ty.kind();
      if (k.$ === "Adt") {
        const generics = this_.tcx.generics_of(k._0.did()) as Generics;
        if (!generics.is_own_empty()) {
          const counts = generics.own_counts();
          self_ty_name += `<${[...Array<string>(counts.lifetimes).fill("'_"), ...Array<string>(counts.types + counts.consts).fill("_")].join(", ")}>`;
        }
      }
    }
    lint.span_suggestion(
      span,
      "disambiguate the associated function",
      `<${self_ty_name} as ${trait_name}>::${Symbol.as_str(method_name)}`,
      Applicability.MachineApplicable,
    );
    return lint;
  };
  // }

  // Rust 2021 and later is already using the new prelude
  if (Span.at_least_rust_2021(span)) {
    return;
  }

  // These are the fully qualified methods added to prelude in Rust 2021
  if (!(method_name.name === sym.try_into || method_name.name === sym.try_from || method_name.name === sym.from_iter)) {
    return;
  }

  // No need to lint if method came from std/core, as that will now be in the prelude
  if (STDLIB_STABLE_CRATES.includes(this.tcx.crate_name(pick.item.def_id.krate))) {
    return;
  }

  // For from_iter, check if the type actually implements FromIterator.
  // If we know it does not, we don't need to warn.
  if (method_name.name === sym.from_iter) {
    const trait_def_id = this.tcx.get_diagnostic_item(sym.FromIterator);
    if (trait_def_id !== undefined) {
      const any_type = this.infcx.next_ty_var(span);
      if (!EvaluationResult.may_apply(this.infcx.type_implements_trait(trait_def_id, [self_ty, any_type], this.param_env))) {
        return;
      }
    }
  }

  // No need to lint if this is an inherent method called on a specific type, like `Vec::foo(...)`,
  // since such methods take precedence over trait methods.
  if (pick.kind.$ === "InherentImplPick") {
    return;
  }

  const lint: AmbiguousTraitAssocFunc = {
    method_name: method_name.name,
    this: this,
    pick,
    span,
    expr_id,
    self_ty_span,
    self_ty,
  };
  this.tcx.emit_node_span_lint(RUST_2021_PRELUDE_COLLISIONS, expr_id, span, { into_diag: (dcx, level) => AmbiguousTraitAssocFunc_into_diag(lint, dcx, level) });
};

// rustc: compiler/rustc_hir_typeck/src/method/prelude_edition_lints.rs:416 trait_path_or_bare_name
FnCtxt.prototype.trait_path_or_bare_name = function (this: FnCtxt, span: Span, expr_hir_id: HirId, trait_def_id: DefId): string {
  const path = this.trait_path(span, expr_hir_id, trait_def_id);
  if (path !== undefined) return path;
  const key = this.tcx.def_key(trait_def_id);
  return display_DefPathData(key.disambiguated_data.data);
};

// rustc: compiler/rustc_hir_typeck/src/method/prelude_edition_lints.rs:428 trait_path
FnCtxt.prototype.trait_path = function (this: FnCtxt, span: Span, expr_hir_id: HirId, trait_def_id: DefId): string | undefined {
  const applicable_traits = this.tcx.in_scope_traits(expr_hir_id);
  if (applicable_traits === undefined) return undefined;
  const applicable_trait = applicable_traits.find((t) => DefId_eq(t.def_id, trait_def_id));
  if (applicable_trait === undefined) return undefined;
  if (applicable_trait.import_ids.length === 0) {
    // The trait was declared within the module, we only need to use its name.
    return undefined;
  }

  const import_items: hir.Item[] = applicable_trait.import_ids.map((import_id) => this.tcx.hir_expect_item(import_id));

  // Find an identifier with which this trait was imported (note that `_` doesn't count).
  for (const item of import_items) {
    const kind = item.expect_use().kind;
    switch (kind.$) {
      case "Single": {
        const ident = kind._0;
        if (ident.name !== kw.Underscore) {
          return Symbol.as_str(ident.name);
        }
        break;
      }
      case "Glob":
        return undefined; // Glob import, so just use its name.
      case "Nested":
        return unreachable();
    }
  }

  // All that is left is `_`! We need to use the full path. It doesn't matter which one we
  // pick, so just take the first one.
  const first = import_items[0]!;
  if (first.kind.$ === "Use") {
    const tree = first.kind._0;
    return join_path_idents(tree.prefix.segments.map((seg) => seg.ident));
  } else {
    return span_bug(span, `unexpected item kind, expected a use: ${format_debug(first.kind, debug_ItemKind, PLAIN)}`);
  }
};

/// Creates a string version of the `expr` that includes explicit adjustments.
/// Returns the string and also a bool indicating whether this is a *precise*
/// suggestion.
// rustc: compiler/rustc_hir_typeck/src/method/prelude_edition_lints.rs:470 adjust_expr
FnCtxt.prototype.adjust_expr = function (this: FnCtxt, pick: Pick, expr: hir.Expr, outer: Span): [string, boolean] {
  const derefs = "*".repeat(pick.autoderefs);

  let autoref: string;
  const adj = pick.autoref_or_ptr_adjustment;
  if (adj !== undefined && adj.$ === "Autoref") {
    autoref = Mutability.ref_prefix_str(adj.mutbl);
  } else if (adj === undefined || adj.$ === "ToConstPtr") {
    autoref = "";
  } else {
    switch (adj._0) {
      case "Mut":
        autoref = "Pin<&mut ";
        break;
      case "Not":
        autoref = "Pin<&";
        break;
    }
  }

  const inside = Span.find_ancestor_inside(expr.span, outer);
  const expr_text_ = inside === undefined ? undefined : ok(this.sess().source_map().span_to_snippet(inside));
  const [expr_text, precise] = expr_text_ !== undefined ? [expr_text_.toString(), true] : ["(..)", false];

  let adjusted_text: string;
  if (pick.autoref_or_ptr_adjustment?.$ === "ToConstPtr") {
    adjusted_text = `${derefs}${expr_text} as *const _`;
  } else {
    adjusted_text = `${autoref}${derefs}${expr_text}`;
  }

  if (pick.autoref_or_ptr_adjustment?.$ === "ReborrowPin") {
    adjusted_text += ">";
  }

  return [adjusted_text, precise];
};
// }
