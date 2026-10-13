// Port of compiler/rustc_expand/src/config.rs
//! Conditional compilation stripping.
// (API surface published first; bodies follow in the next commit of lane expand-base.)
import type { AttrVec, Attribute, Expr, NodeId } from "../rustc_ast/lib.ts";
import type { HasAttrs, HasTokens } from "../rustc_ast/ast_traits.ts";
import type { EvalConfigResult, ShouldEmit } from "../rustc_attr_parsing/lib.ts";
import type { Features } from "../rustc_feature/lib.ts";
import type { Session } from "../rustc_session/session.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import { unported } from "../std/panic.ts";

/// A folder that strips out items that do not belong in the current configuration.
export class StripUnconfigured {
  constructor(
    public sess: Session,
    public features: Features | undefined,
    /// If `true`, perform cfg-stripping on attached tokens.
    /// This is only used for the input to derive macros,
    /// which needs eager expansion of `cfg` and `cfg_attr`
    public config_tokens: boolean,
    public lint_node_id: NodeId,
  ) {}

  /** `configure<T: HasTokens>` (supertrait `HasAttrs`): both impl tables. Edits `node` in place. */
  configure<T>(_node: T, _T_HasTokens: HasTokens<T>, _T_HasAttrs: HasAttrs<T>): T | undefined {
    return unported("rustc_expand::config::StripUnconfigured::configure (expand-base, in progress)");
  }
  expand_cfg_attr(_cfg_attr: Attribute, _recursive: boolean): Attribute[] {
    return unported("rustc_expand::config::StripUnconfigured::expand_cfg_attr (expand-base, in progress)");
  }
  cfg_true(_attr: Attribute, _emit_errors: ShouldEmit): EvalConfigResult {
    return unported("rustc_expand::config::StripUnconfigured::cfg_true (expand-base, in progress)");
  }
  maybe_emit_expr_attr_err(_attr: Attribute): void {
    return unported("rustc_expand::config::StripUnconfigured::maybe_emit_expr_attr_err (expand-base, in progress)");
  }
  configure_expr(_expr: Expr, _method_receiver: boolean): void {
    return unported("rustc_expand::config::StripUnconfigured::configure_expr (expand-base, in progress)");
  }
}

export function features(_sess: Session, _krate_attrs: readonly Attribute[], _crate_name: Symbol): Features {
  return unported("rustc_expand::config::features (expand-base, in progress)");
}

export function pre_configure_attrs(_sess: Session, _attrs: readonly Attribute[]): AttrVec {
  return unported("rustc_expand::config::pre_configure_attrs (expand-base, in progress)");
}
