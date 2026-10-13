// Port of compiler/rustc_builtin_macros/src/derive.rs
import { ast, clone_Path } from "../rustc_ast/lib.ts";
import type { ErrorGuaranteed } from "../rustc_errors/lib.ts";
import { AttributeTemplate } from "../rustc_attr_parsing/template.ts";
import * as validate_attr from "../rustc_attr_parsing/validate_attr.ts";
import {
  Annotatable,
  clone_Annotatable,
  type DeriveResolution,
  type ExpandResult,
  type ExtCtxt,
  type MultiItemModifier,
} from "../rustc_expand/base.ts";
import { is_ident } from "../rustc_lexer/lib.ts";
import type { Session } from "../rustc_session/session.ts";
import { Span } from "../rustc_span/lib.ts";
import { Ident, sym, Symbol } from "../rustc_span/symbol.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { cfg_eval } from "./cfg_eval.ts";
import * as diagnostics from "./diagnostics.ts";

export class Expander implements MultiItemModifier {
  constructor(public is_const: boolean) {}

  // rustc: compiler/rustc_builtin_macros/src/derive.rs:18 expand
  expand(
    ecx: ExtCtxt,
    span: Span,
    meta_item: ast.MetaItem,
    item: Annotatable,
    _: boolean,
  ): ExpandResult<Annotatable[], Annotatable> {
    const sess_ = ecx.sess;
    if (report_bad_target(sess_, item, span).$ === "Err") {
      // We don't want to pass inappropriate targets to derive macros to avoid
      // follow up errors, all other errors below are recoverable.
      return { $: "Ready", _0: [item] };
    }

    const [sess, features] = [ecx.sess, ecx.ecfg.features];
    const result = ecx.resolver.resolve_derives(ecx.current_expansion.id, ecx.force_mode, () => {
      // PORT: `AttributeTemplate { list: Some(..), ..Default::default() }` written out.
      const template = new AttributeTemplate(false, ["Trait1, Trait2, ..."], [], undefined, undefined);
      validate_attr.check_builtin_meta_item(sess.psess, meta_item, ast.AttrStyle.Outer, sym.derive, template, true);

      let resolutions: DeriveResolution[];
      if (meta_item.kind.$ === "List") {
        const list = meta_item.kind._0;
        resolutions = [];
        for (const meta_item_inner of list) {
          switch (meta_item_inner.$) {
            case "MetaItem": {
              const meta = meta_item_inner._0;
              // Reject `#[derive(Debug = "value", Debug(abc))]`, but recover the
              // paths.
              report_path_args(sess, meta);
              resolutions.push({
                path: clone_Path(meta.path),
                item: dummy_annotatable(),
                exts: undefined,
                is_const: this.is_const,
              });
              break;
            }
            case "Lit": {
              const lit = meta_item_inner._0;
              // Reject `#[derive("Debug")]`.
              report_unexpected_meta_item_lit(sess, lit);
              break;
            }
          }
        }
      } else {
        resolutions = [];
      }

      // Do not configure or clone items unless necessary.
      if (resolutions.length >= 1) {
        const [first, ...others] = resolutions as [DeriveResolution, ...DeriveResolution[]];
        first.item = cfg_eval(sess, features, clone_Annotatable(item), ecx.current_expansion.lint_node_id);
        for (const other of others) {
          other.item = clone_Annotatable(first.item);
        }
      }

      return resolutions;
    });

    switch (result.$) {
      case "Ok":
        return { $: "Ready", _0: [item] };
      case "Err":
        return { $: "Retry", _0: item };
    }
  }
}

// The cheapest `Annotatable` to construct.
// rustc: compiler/rustc_builtin_macros/src/derive.rs:95 dummy_annotatable
function dummy_annotatable(): Annotatable {
  return {
    $: "GenericParam",
    _0: new ast.GenericParam(ast.DUMMY_NODE_ID, Ident.dummy(), [], [], false, ast.GenericParamKind.Lifetime, undefined),
  };
}

// rustc: compiler/rustc_builtin_macros/src/derive.rs:107 report_bad_target
function report_bad_target(sess: Session, item: Annotatable, span: Span): Result<undefined, ErrorGuaranteed> {
  let item_kind: ast.ItemKind | undefined;
  switch (item.$) {
    case "Item":
      item_kind = item._0.kind;
      break;
    case "Stmt": {
      const stmt = item._0;
      item_kind = stmt.kind.$ === "Item" ? stmt.kind._0.kind : undefined;
      break;
    }
    default:
      item_kind = undefined;
  }

  const bad_target = !(
    item_kind !== undefined &&
    (item_kind.$ === "Struct" || item_kind.$ === "Enum" || item_kind.$ === "Union")
  );
  if (bad_target) {
    return Err(sess.dcx().emit_err(diagnostics.BadDeriveTarget_diagnostic({ span, item: Annotatable.span(item) })));
  }
  return Ok(undefined);
}

// rustc: compiler/rustc_builtin_macros/src/derive.rs:129 report_unexpected_meta_item_lit
function report_unexpected_meta_item_lit(sess: Session, lit: ast.MetaItemLit): void {
  let help: diagnostics.BadDeriveLitHelp;
  if (lit.kind.$ === "Str" && lit.kind._1.$ === "Cooked" && is_ident(Symbol.as_str(lit.symbol))) {
    help = { $: "StrLit", sym: lit.symbol };
  } else {
    help = diagnostics.BadDeriveLitHelp.Other;
  }
  sess.dcx().emit_err(diagnostics.BadDeriveLit_diagnostic({ span: lit.span, help }));
}

// rustc: compiler/rustc_builtin_macros/src/derive.rs:141 report_path_args
function report_path_args(sess: Session, meta: ast.MetaItem): void {
  const span = Span.with_lo(meta.span, Span.hi(meta.path.span));

  switch (meta.kind.$) {
    case "Word":
      break;
    case "List":
      sess.dcx().emit_err(diagnostics.DerivePathArgsList_diagnostic({ span }));
      break;
    case "NameValue":
      sess.dcx().emit_err(diagnostics.DerivePathArgsValue_diagnostic({ span }));
      break;
  }
}
