// Port of compiler/rustc_builtin_macros/src/cfg_accessible.rs
//! Implementation of the `#[cfg_accessible(path)]` attribute macro.

import { ast } from "../rustc_ast/lib.ts";
import { AttributeTemplate, validate_attr } from "../rustc_attr_parsing/lib.ts";
import type { Annotatable, ExpandResult, ExtCtxt, MultiItemModifier } from "../rustc_expand/base.ts";
import type { Span } from "../rustc_span/lib.ts";
import { sym } from "../rustc_span/symbol.ts";
import * as diagnostics from "./diagnostics.ts";

// rustc: compiler/rustc_builtin_macros/src/cfg_accessible.rs:12 validate_input
function validate_input(ecx: ExtCtxt, mi: ast.MetaItem): ast.Path | undefined {
  // `use diagnostics::CfgAccessibleInvalid::*;`
  const list = mi.meta_item_list();
  if (list === undefined) {
    // None => {}
  } else if (list.length === 0) {
    ecx.dcx().emit_err(diagnostics.CfgAccessibleInvalid_diagnostic({ $: "UnspecifiedPath", _0: mi.span }));
  } else if (list.length >= 2) {
    const l = list[list.length - 1]!;
    ecx.dcx().emit_err(diagnostics.CfgAccessibleInvalid_diagnostic({ $: "MultiplePaths", _0: ast.MetaItemInner.span(l) }));
  } else {
    const nmi = list[0]!;
    const mi_ = ast.MetaItemInner.meta_item(nmi);
    if (mi_ === undefined) {
      ecx.dcx().emit_err(diagnostics.CfgAccessibleInvalid_diagnostic({ $: "LiteralPath", _0: ast.MetaItemInner.span(nmi) }));
    } else {
      if (!mi_.is_word()) {
        ecx.dcx().emit_err(diagnostics.CfgAccessibleInvalid_diagnostic({ $: "HasArguments", _0: mi_.span }));
      }
      return mi_.path;
    }
  }
  return undefined;
}

export class Expander implements MultiItemModifier {
  // rustc: compiler/rustc_builtin_macros/src/cfg_accessible.rs:38 expand
  expand(
    ecx: ExtCtxt,
    span: Span,
    meta_item: ast.MetaItem,
    item: Annotatable,
    _is_derive_const: boolean,
  ): ExpandResult<Annotatable[], Annotatable> {
    // `AttributeTemplate { list: Some(&["path"]), ..Default::default() }`
    const template = new AttributeTemplate(false, ["path"], [], undefined, undefined);
    validate_attr.check_builtin_meta_item(ecx.sess.psess, meta_item, ast.AttrStyle.Outer, sym.cfg_accessible, template, true);

    const path = validate_input(ecx, meta_item);
    if (path === undefined) {
      return { $: "Ready", _0: [] };
    }

    const r = ecx.resolver.cfg_accessible(ecx.current_expansion.id, path);
    if (r.$ === "Ok" && r._0 === true) {
      return { $: "Ready", _0: [item] };
    } else if (r.$ === "Ok") {
      return { $: "Ready", _0: [] };
    } else if (ecx.force_mode) {
      // Err(Indeterminate) if ecx.force_mode
      ecx.dcx().emit_err(diagnostics.CfgAccessibleIndeterminate_diagnostic({ span }));
      return { $: "Ready", _0: [item] };
    } else {
      return { $: "Retry", _0: item };
    }
  }
}
