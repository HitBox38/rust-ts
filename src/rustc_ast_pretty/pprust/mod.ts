// #[cfg(test)]
// mod tests;

import { type ast } from "../../rustc_ast/lib.ts";
import type { Token, TokenKind } from "../../rustc_ast/token.ts";
import type { TokenStream, TokenTree } from "../../rustc_ast/tokenstream.ts";

export * as state from "./state.ts";
import { State } from "./state.ts";
// PORT: `state/expr.rs` and `state/item.rs` extend `State` (PORTING §5); loaded for their side
// effects after `state.ts`.
import "./state/expr.ts";
import "./state/item.ts";
// pub use state::{AnnNode, Comments, PpAnn, PrintState, State, print_crate, print_crate_as_interface};
export { type AnnNode, Comments, PpAnn, PrintState, State, print_crate, print_crate_as_interface } from "./state.ts";

/// Print the token kind precisely, without converting `$crate` into its respective crate name.
// rustc: compiler/rustc_ast_pretty/src/pprust/mod.rs:15 token_kind_to_string
export function token_kind_to_string(tok: TokenKind): string {
  return State.new().token_kind_to_string(tok);
}

/// Print the token precisely, without converting `$crate` into its respective crate name.
// rustc: compiler/rustc_ast_pretty/src/pprust/mod.rs:20 token_to_string
export function token_to_string(token: Token): string {
  return State.new().token_to_string(token);
}

// rustc: compiler/rustc_ast_pretty/src/pprust/mod.rs:24 ty_to_string
export function ty_to_string(ty: ast.Ty): string {
  return State.new().ty_to_string(ty);
}

// rustc: compiler/rustc_ast_pretty/src/pprust/mod.rs:28 bounds_to_string
export function bounds_to_string(bounds: readonly ast.GenericBound[]): string {
  return State.new().bounds_to_string(bounds);
}

// rustc: compiler/rustc_ast_pretty/src/pprust/mod.rs:32 where_bound_predicate_to_string
export function where_bound_predicate_to_string(where_bound_predicate: ast.WhereBoundPredicate): string {
  return State.new().where_bound_predicate_to_string(where_bound_predicate);
}

/// # Panics
///
/// Panics if `pat.kind` is `PatKind::Missing`.
// rustc: compiler/rustc_ast_pretty/src/pprust/mod.rs:39 pat_to_string
export function pat_to_string(pat: ast.Pat): string {
  return State.new().pat_to_string(pat);
}

// rustc: compiler/rustc_ast_pretty/src/pprust/mod.rs:43 expr_to_string
export function expr_to_string(e: ast.Expr): string {
  return State.new().expr_to_string(e);
}

// rustc: compiler/rustc_ast_pretty/src/pprust/mod.rs:47 tt_to_string
export function tt_to_string(tt: TokenTree): string {
  return State.new().tt_to_string(tt);
}

// rustc: compiler/rustc_ast_pretty/src/pprust/mod.rs:51 tts_to_string
export function tts_to_string(tokens: TokenStream): string {
  return State.new().tts_to_string(tokens);
}

// rustc: compiler/rustc_ast_pretty/src/pprust/mod.rs:55 item_to_string
export function item_to_string(i: ast.Item): string {
  return State.new().item_to_string(i);
}

// rustc: compiler/rustc_ast_pretty/src/pprust/mod.rs:59 assoc_item_to_string
export function assoc_item_to_string(i: ast.AssocItem): string {
  return State.new().assoc_item_to_string(i);
}

// rustc: compiler/rustc_ast_pretty/src/pprust/mod.rs:63 foreign_item_to_string
export function foreign_item_to_string(i: ast.ForeignItem): string {
  return State.new().foreign_item_to_string(i);
}

// rustc: compiler/rustc_ast_pretty/src/pprust/mod.rs:67 stmt_to_string
export function stmt_to_string(s: ast.Stmt): string {
  return State.new().stmt_to_string(s);
}

// rustc: compiler/rustc_ast_pretty/src/pprust/mod.rs:71 path_to_string
export function path_to_string(p: ast.Path): string {
  return State.new().path_to_string(p);
}

// rustc: compiler/rustc_ast_pretty/src/pprust/mod.rs:75 path_segment_to_string
export function path_segment_to_string(p: ast.PathSegment): string {
  return State.new().path_segment_to_string(p);
}

// rustc: compiler/rustc_ast_pretty/src/pprust/mod.rs:79 vis_to_string
export function vis_to_string(v: ast.Visibility): string {
  return State.new().vis_to_string(v);
}

// rustc: compiler/rustc_ast_pretty/src/pprust/mod.rs:83 impl_restriction_to_string
export function impl_restriction_to_string(r: ast.ImplRestriction): string {
  return State.new().impl_restriction_to_string(r);
}

// rustc: compiler/rustc_ast_pretty/src/pprust/mod.rs:87 mut_restriction_to_string
export function mut_restriction_to_string(r: ast.MutRestriction): string {
  return State.new().mut_restriction_to_string(r);
}

// rustc: compiler/rustc_ast_pretty/src/pprust/mod.rs:91 meta_list_item_to_string
export function meta_list_item_to_string(li: ast.MetaItemInner): string {
  return State.new().meta_list_item_to_string(li);
}

// rustc: compiler/rustc_ast_pretty/src/pprust/mod.rs:95 attribute_to_string
export function attribute_to_string(attr: ast.Attribute): string {
  return State.new().attribute_to_string(attr);
}

// rustc: compiler/rustc_ast_pretty/src/pprust/mod.rs:99 to_string
export function to_string(f: (s: State) => void): string {
  return State.to_string(f);
}

/// Pretty prints a crate from its AST representation.
///
/// As the source text is not available, regular (non-doc) comments are not preserved.
/// Doc-comments can survive since they are represented in the AST.
/// To pretty-print a crate including its comments, use [`print_crate`] instead.
// rustc: compiler/rustc_ast_pretty/src/pprust/mod.rs:108 crate_to_string_for_macros
export function crate_to_string_for_macros(krate: ast.Crate): string {
  return State.to_string((s) => {
    s.print_inner_attributes(krate.attrs);
    for (const item of krate.items) {
      s.print_item(item);
    }
  });
}
