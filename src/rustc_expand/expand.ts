// Port of compiler/rustc_expand/src/expand.rs
//
// PORT: `macro_rules! ast_fragments` is written out as its single expansion (the invocation at
// expand.rs:175): `AstFragment` (tagged union) with its inherent fns on the companion const,
// `AstFragmentKind` (string union) with its inherent fns on its companion, and the
// `impl MacResult for ParserAnyMacro` as `ParserAnyMacro_MacResult` (for mbe/macro_rules.ts to install).
// The fns of the macro body whose names are metavariables (`fn $make_ast`) carry the marker of the
// invocation line that supplies the name (`fn make_expr;` at :179), which is what coverage.ts counts;
// the `one fn visit_expr;` / `many fn flat_map_stmt; fn visit_stmt();` invocation lines carry their
// markers on the `mut_visit_with` / `visit_with` arms they drive.
//
// PORT: `trait InvocationCollectorNode` (with its supertraits `HasAttrs + HasNodeId + DeclaredIdents`
// and the extra bounds of `flat_map_node` (`OutputTy: Default`) and `visit_node` (`OutputTy: Into<Node>`,
// `DummyAstNode`)) is a table of fns per node type (PORTING §5: "pass function tables when dispatch
// depends on the type"): `IC_Item`, `IC_TraitItem`, ... below. `self` is the first parameter; the
// associated items (`Self::KIND`, `Node::descr()`, `Node::from_item`) are table members called on the
// table. Provided fns live in `InvocationCollectorNode_provided` (PORTING §8).
//
// PORT: `&mut Node` hooks get the node object and replace it in place (`*node = x` ->
// `replace_in_place(node, x)`, see the mut_visit.ts header); `mem::replace(node, dummy)` is
// `mem_replace` below. `AstNodeWrapper::from_mut` follows the write-through rule of
// docs/handoff/fix-w456.md: the wrapper is never rebound, every store goes through it.
import { mut_visit, visit } from "../rustc_ast/lib.ts";
import {
  type Arm,
  type AssocItem,
  type AssocItemKind,
  AstNodeWrapper,
  AttrArgs,
  type AttrVec,
  type Attribute,
  CRATE_NODE_ID,
  type Crate,
  DUMMY_NODE_ID,
  Delegation,
  type DelegationMac,
  type DelegationSource,
  Expr,
  type ExprField,
  type FieldDef,
  type ForeignItem,
  type ForeignItemKind,
  type GenericParam,
  HasAttrs,
  HasNodeId,
  Item,
  ItemKind,
  type MacCall,
  MetaItem,
  type MetaItemInner,
  NodeId,
  type Param,
  Pat,
  type PatField,
  PatKind,
  type Path,
  PathSegment,
  Stmt,
  type StmtKind,
  Ty,
  TyKind,
  type UseTree,
  type Variant,
  type WherePredicate,
  clone_Attribute,
  clone_Block,
  clone_Path,
  clone_QSelf,
  clone_Visibility,
  node_id,
  Safety,
  token,
} from "../rustc_ast/lib.ts";
import type { HasAttrs as HasAttrsT, HasNodeId as HasNodeIdT } from "../rustc_ast/ast_traits.ts";
import { CfgEntry as CfgEntry_, clone_CfgEntry } from "../rustc_ast/attr/data_structures.ts";
import { clone_TokenStream, type TokenStream } from "../rustc_ast/tokenstream.ts";
import { pprust } from "../rustc_ast_pretty/lib.ts";
import { Target } from "../rustc_attr_ir/target.ts";
import { EvalConfigResult } from "../rustc_attr_parsing/attributes/cfg.ts";
import {
  AttributeParser,
  AttributeSafety,
  CFG_TEMPLATE,
  eval_config_entry,
  is_builtin_attr,
  parse_cfg,
  type ShouldEmit,
  validate_attr,
} from "../rustc_attr_parsing/lib.ts";
import { AllowExprMetavar } from "../rustc_attr_parsing/parser.ts";
import type { Diag, ErrorGuaranteed, PResult } from "../rustc_errors/lib.ts";
import { is_builtin_attr_name } from "../rustc_feature/builtin_attrs.ts";
import type { Features } from "../rustc_feature/lib.ts";
import { MacroKinds } from "../rustc_hir/def.ts";
import { UNUSED_ATTRIBUTES, UNUSED_DOC_COMMENTS } from "../rustc_lint_defs/builtin.gen.ts";
import {
  fake_token_stream_for_crate,
  fake_token_stream_for_foreign_item,
  fake_token_stream_for_item,
  parser as rustc_parse_parser,
} from "../rustc_parse/lib.ts";
import type { Parser } from "../rustc_parse/parser/mod.ts";
import { feature_err } from "../rustc_session/diagnostics.ts";
import { ExpnKind, LocalExpnId, SyntaxContext } from "../rustc_span/hygiene.ts";
import { DUMMY_SP, FileName, Span } from "../rustc_span/lib.ts";
import { Ident, Symbol, sym } from "../rustc_span/symbol.ts";
import { Limit, Limit_div, Limit_mul } from "../rustc_structures/limit.ts";
import { PLAIN } from "../std/fmt.ts";
import { field_mut, type MutRef, replace_in_place } from "../std/mut_ref.ts";
import { assert_eq, panic, unported, unreachable, unwrap } from "../std/panic.ts";
import { path_parent } from "../std/path.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import {
  Annotatable,
  type DeriveResolution,
  DummyResult,
  type ExpandResult,
  clone_ExpansionData,
  type ExpansionData,
  type ExtCtxt,
  type MacResult,
  ModuleData,
  type SyntaxExtension,
  SyntaxExtensionKind,
} from "./base.ts";
import { StripUnconfigured } from "./config.ts";
import * as diagnostics from "./diagnostics.ts";
import { DirOwnership, mod_dir_path, mod_file_path_from_attr, parse_external_mod } from "./module.ts";
import { PlaceholderExpander, placeholder } from "./placeholders.ts";

const { TokenKind: TK } = token;

import { annotate_err_with_kind } from "./mbe/diagnostics.ts";

const { token_descr } = rustc_parse_parser;
type MutVisitor = mut_visit.MutVisitor;
type Visitor<R> = visit.Visitor<R>;
type AssocCtxt = visit.AssocCtxt;
const AssocCtxt = visit.AssocCtxt;
const {
  walk_block,
  walk_crate,
  walk_expr,
  walk_flat_map_arm,
  walk_flat_map_assoc_item,
  walk_flat_map_expr_field,
  walk_flat_map_field_def,
  walk_flat_map_foreign_item,
  walk_flat_map_generic_param,
  walk_flat_map_item,
  walk_flat_map_param,
  walk_flat_map_pat_field,
  walk_flat_map_stmt,
  walk_flat_map_variant,
  walk_flat_map_where_predicate,
  walk_pat,
  walk_ty,
} = mut_visit;
const { try_visit } = visit;

// ---- Expansion of `ast_fragments!` (expand.rs:51) for the invocation at expand.rs:175 ----

/// A fragment of AST that can be produced by a single macro expansion.
/// Can also serve as an input and intermediate result for macro expansion operations.
// PORT: `SmallVec<[T; 1]>` -> `T[]`, `Box<T>` -> `T`.
export type AstFragment =
  | { readonly $: "OptExpr"; _0: Expr | undefined }
  | { readonly $: "MethodReceiverExpr"; _0: Expr }
  | { readonly $: "Expr"; _0: Expr }
  | { readonly $: "Pat"; _0: Pat }
  | { readonly $: "Ty"; _0: Ty }
  | { readonly $: "Stmts"; _0: Stmt[] }
  | { readonly $: "Items"; _0: Item[] }
  | { readonly $: "TraitItems"; _0: AssocItem[] }
  | { readonly $: "ImplItems"; _0: AssocItem[] }
  | { readonly $: "TraitImplItems"; _0: AssocItem[] }
  | { readonly $: "ForeignItems"; _0: ForeignItem[] }
  | { readonly $: "Arms"; _0: Arm[] }
  | { readonly $: "ExprFields"; _0: ExprField[] }
  | { readonly $: "PatFields"; _0: PatField[] }
  | { readonly $: "GenericParams"; _0: GenericParam[] }
  | { readonly $: "Params"; _0: Param[] }
  | { readonly $: "FieldDefs"; _0: FieldDef[] }
  | { readonly $: "Variants"; _0: Variant[] }
  | { readonly $: "WherePredicates"; _0: WherePredicate[] }
  | { readonly $: "Crate"; _0: Crate };

/// "Discriminant" of an AST fragment.
// #[derive(Copy, Clone, Debug, PartialEq, Eq)]
export type AstFragmentKind =
  | "OptExpr"
  | "MethodReceiverExpr"
  | "Expr"
  | "Pat"
  | "Ty"
  | "Stmts"
  | "Items"
  | "TraitItems"
  | "ImplItems"
  | "TraitImplItems"
  | "ForeignItems"
  | "Arms"
  | "ExprFields"
  | "PatFields"
  | "GenericParams"
  | "Params"
  | "FieldDefs"
  | "Variants"
  | "WherePredicates"
  | "Crate";
/** `#[derive(Debug)]` */
export const debug_AstFragmentKind = (v: AstFragmentKind): string => v;

// PORT: `Option<T>.map(AstFragment::$Kind)` of `make_from`.
function map_fragment<T>(v: T | undefined, f: (v: T) => AstFragment): AstFragment | undefined {
  return v === undefined ? undefined : f(v);
}

/** `impl AstFragmentKind` of the macro expansion (the companion is completed below, after expand.rs:273). */
const AstFragmentKind_ast_fragments = {
  // rustc: compiler/rustc_expand/src/expand.rs:82 name
  name(self: AstFragmentKind): string {
    switch (self) {
      case "OptExpr":
        return "expression";
      case "MethodReceiverExpr":
        return "expression";
      case "Expr":
        return "expression";
      case "Pat":
        return "pattern";
      case "Ty":
        return "type";
      case "Stmts":
        return "statement";
      case "Items":
        return "item";
      case "TraitItems":
        return "trait item";
      case "ImplItems":
        return "impl item";
      case "TraitImplItems":
        return "impl item";
      case "ForeignItems":
        return "foreign item";
      case "Arms":
        return "match arm";
      case "ExprFields":
        return "field expression";
      case "PatFields":
        return "field pattern";
      case "GenericParams":
        return "generic parameter";
      case "Params":
        return "function parameter";
      case "FieldDefs":
        return "field";
      case "Variants":
        return "variant";
      case "WherePredicates":
        return "where predicate";
      case "Crate":
        return "crate";
    }
  },

  // rustc: compiler/rustc_expand/src/expand.rs:90 make_from
  make_from(self: AstFragmentKind, result: MacResult): AstFragment | undefined {
    switch (self) {
      case "OptExpr":
        // PORT: `result.make_expr().map(Some).map(AstFragment::OptExpr)`.
        return map_fragment(result.make_expr(), (e) => ({ $: "OptExpr", _0: e }));
      case "MethodReceiverExpr":
        return map_fragment(result.make_expr(), (e) => ({ $: "MethodReceiverExpr", _0: e }));
      case "Expr":
        return map_fragment(result.make_expr(), (ast) => ({ $: "Expr", _0: ast }));
      case "Pat":
        return map_fragment(result.make_pat(), (ast) => ({ $: "Pat", _0: ast }));
      case "Ty":
        return map_fragment(result.make_ty(), (ast) => ({ $: "Ty", _0: ast }));
      case "Stmts":
        return map_fragment(result.make_stmts(), (ast) => ({ $: "Stmts", _0: ast }));
      case "Items":
        return map_fragment(result.make_items(), (ast) => ({ $: "Items", _0: ast }));
      case "TraitItems":
        return map_fragment(result.make_trait_items(), (ast) => ({ $: "TraitItems", _0: ast }));
      case "ImplItems":
        return map_fragment(result.make_impl_items(), (ast) => ({ $: "ImplItems", _0: ast }));
      case "TraitImplItems":
        return map_fragment(result.make_trait_impl_items(), (ast) => ({ $: "TraitImplItems", _0: ast }));
      case "ForeignItems":
        return map_fragment(result.make_foreign_items(), (ast) => ({ $: "ForeignItems", _0: ast }));
      case "Arms":
        return map_fragment(result.make_arms(), (ast) => ({ $: "Arms", _0: ast }));
      case "ExprFields":
        return map_fragment(result.make_expr_fields(), (ast) => ({ $: "ExprFields", _0: ast }));
      case "PatFields":
        return map_fragment(result.make_pat_fields(), (ast) => ({ $: "PatFields", _0: ast }));
      case "GenericParams":
        return map_fragment(result.make_generic_params(), (ast) => ({ $: "GenericParams", _0: ast }));
      case "Params":
        return map_fragment(result.make_params(), (ast) => ({ $: "Params", _0: ast }));
      case "FieldDefs":
        return map_fragment(result.make_field_defs(), (ast) => ({ $: "FieldDefs", _0: ast }));
      case "Variants":
        return map_fragment(result.make_variants(), (ast) => ({ $: "Variants", _0: ast }));
      case "WherePredicates":
        return map_fragment(result.make_where_predicates(), (ast) => ({ $: "WherePredicates", _0: ast }));
      case "Crate":
        return map_fragment(result.make_crate(), (ast) => ({ $: "Crate", _0: ast }));
    }
  },
};

// PORT: a copy of mut_visit.ts's private `flat_map_in_place` (the `FlatMapInPlace` impl of
// rustc_data_structures/src/flat_map_in_place.rs, which carries the marker there); root: export one
// shared copy (see docs/handoff/expand-core.md).
function flat_map_in_place<T>(self: T[], f: (e: T) => Iterable<T>): void {
  let read_i = 0;
  let write_i = 0;
  try {
    while (read_i < self.length) {
      // Move the read_i'th item out of the vector and map it to an iterator.
      const e = self[read_i]!;
      const iter = f(e);
      read_i += 1;

      for (const e of iter) {
        if (write_i < read_i) {
          self[write_i] = e;
          write_i += 1;
        } else {
          // If this is reached we ran out of space in the middle of the vector.
          // However, the vector is in a valid state here, so we just do a somewhat
          // inefficient insert.
          self.splice(write_i, 0, e);

          read_i += 1;
          write_i += 1;
        }
      }
    }

    // `write_i` tracks the number of actually written new items.
    self.length = write_i;
  } catch (err) {
    // Leak all elements in case of panic.
    self.length = 0;
    throw err;
  }
}

/** `impl AstFragment` (methods on the companion, PORTING §8). */
export const AstFragment = {
  // rustc: compiler/rustc_expand/src/expand.rs:102 add_placeholders
  add_placeholders(self: AstFragment, placeholders: readonly NodeId[]): void {
    if (placeholders.length === 0) {
      return;
    }
    // PORT: `ast.extend(placeholders.iter().flat_map(|id| placeholder($Kind, *id, None).$make_ast()))`
    // for each `many` kind.
    switch (self.$) {
      case "Stmts":
        for (const id of placeholders) self._0.push(...AstFragment.make_stmts(placeholder("Stmts", id, undefined)));
        break;
      case "Items":
        for (const id of placeholders) self._0.push(...AstFragment.make_items(placeholder("Items", id, undefined)));
        break;
      case "TraitItems":
        for (const id of placeholders) {
          self._0.push(...AstFragment.make_trait_items(placeholder("TraitItems", id, undefined)));
        }
        break;
      case "ImplItems":
        for (const id of placeholders) {
          self._0.push(...AstFragment.make_impl_items(placeholder("ImplItems", id, undefined)));
        }
        break;
      case "TraitImplItems":
        for (const id of placeholders) {
          self._0.push(...AstFragment.make_trait_impl_items(placeholder("TraitImplItems", id, undefined)));
        }
        break;
      case "ForeignItems":
        for (const id of placeholders) {
          self._0.push(...AstFragment.make_foreign_items(placeholder("ForeignItems", id, undefined)));
        }
        break;
      case "Arms":
        for (const id of placeholders) self._0.push(...AstFragment.make_arms(placeholder("Arms", id, undefined)));
        break;
      case "ExprFields":
        for (const id of placeholders) {
          self._0.push(...AstFragment.make_expr_fields(placeholder("ExprFields", id, undefined)));
        }
        break;
      case "PatFields":
        for (const id of placeholders) {
          self._0.push(...AstFragment.make_pat_fields(placeholder("PatFields", id, undefined)));
        }
        break;
      case "GenericParams":
        for (const id of placeholders) {
          self._0.push(...AstFragment.make_generic_params(placeholder("GenericParams", id, undefined)));
        }
        break;
      case "Params":
        for (const id of placeholders) self._0.push(...AstFragment.make_params(placeholder("Params", id, undefined)));
        break;
      case "FieldDefs":
        for (const id of placeholders) {
          self._0.push(...AstFragment.make_field_defs(placeholder("FieldDefs", id, undefined)));
        }
        break;
      case "Variants":
        for (const id of placeholders) {
          self._0.push(...AstFragment.make_variants(placeholder("Variants", id, undefined)));
        }
        break;
      case "WherePredicates":
        for (const id of placeholders) {
          self._0.push(...AstFragment.make_where_predicates(placeholder("WherePredicates", id, undefined)));
        }
        break;
      default:
        panic("unexpected AST fragment kind");
    }
  },

  // rustc: compiler/rustc_expand/src/expand.rs:115 make_opt_expr
  make_opt_expr(self: AstFragment): Expr | undefined {
    switch (self.$) {
      case "OptExpr":
        return self._0;
      default:
        return panic("AstFragment::make_opt_expr called on the wrong kind of fragment");
    }
  },

  // rustc: compiler/rustc_expand/src/expand.rs:122 make_method_receiver_expr
  make_method_receiver_expr(self: AstFragment): Expr {
    switch (self.$) {
      case "MethodReceiverExpr":
        return self._0;
      default:
        return panic("AstFragment::make_method_receiver_expr called on the wrong kind of fragment");
    }
  },

  // `$(pub fn $make_ast(self) -> $AstTy { .. })*` (expand.rs:129):
  // rustc: compiler/rustc_expand/src/expand.rs:179 make_expr
  make_expr(self: AstFragment): Expr {
    return self.$ === "Expr" ? self._0 : panic("AstFragment::make_expr called on the wrong kind of fragment");
  },
  // rustc: compiler/rustc_expand/src/expand.rs:184 make_pat
  make_pat(self: AstFragment): Pat {
    return self.$ === "Pat" ? self._0 : panic("AstFragment::make_pat called on the wrong kind of fragment");
  },
  // rustc: compiler/rustc_expand/src/expand.rs:189 make_ty
  make_ty(self: AstFragment): Ty {
    return self.$ === "Ty" ? self._0 : panic("AstFragment::make_ty called on the wrong kind of fragment");
  },
  // rustc: compiler/rustc_expand/src/expand.rs:194 make_stmts
  make_stmts(self: AstFragment): Stmt[] {
    return self.$ === "Stmts" ? self._0 : panic("AstFragment::make_stmts called on the wrong kind of fragment");
  },
  // rustc: compiler/rustc_expand/src/expand.rs:199 make_items
  make_items(self: AstFragment): Item[] {
    return self.$ === "Items" ? self._0 : panic("AstFragment::make_items called on the wrong kind of fragment");
  },
  // rustc: compiler/rustc_expand/src/expand.rs:204 make_trait_items
  make_trait_items(self: AstFragment): AssocItem[] {
    return self.$ === "TraitItems"
      ? self._0
      : panic("AstFragment::make_trait_items called on the wrong kind of fragment");
  },
  // rustc: compiler/rustc_expand/src/expand.rs:209 make_impl_items
  make_impl_items(self: AstFragment): AssocItem[] {
    return self.$ === "ImplItems"
      ? self._0
      : panic("AstFragment::make_impl_items called on the wrong kind of fragment");
  },
  // rustc: compiler/rustc_expand/src/expand.rs:214 make_trait_impl_items
  make_trait_impl_items(self: AstFragment): AssocItem[] {
    return self.$ === "TraitImplItems"
      ? self._0
      : panic("AstFragment::make_trait_impl_items called on the wrong kind of fragment");
  },
  // rustc: compiler/rustc_expand/src/expand.rs:219 make_foreign_items
  make_foreign_items(self: AstFragment): ForeignItem[] {
    return self.$ === "ForeignItems"
      ? self._0
      : panic("AstFragment::make_foreign_items called on the wrong kind of fragment");
  },
  // rustc: compiler/rustc_expand/src/expand.rs:224 make_arms
  make_arms(self: AstFragment): Arm[] {
    return self.$ === "Arms" ? self._0 : panic("AstFragment::make_arms called on the wrong kind of fragment");
  },
  // rustc: compiler/rustc_expand/src/expand.rs:229 make_expr_fields
  make_expr_fields(self: AstFragment): ExprField[] {
    return self.$ === "ExprFields"
      ? self._0
      : panic("AstFragment::make_expr_fields called on the wrong kind of fragment");
  },
  // rustc: compiler/rustc_expand/src/expand.rs:234 make_pat_fields
  make_pat_fields(self: AstFragment): PatField[] {
    return self.$ === "PatFields"
      ? self._0
      : panic("AstFragment::make_pat_fields called on the wrong kind of fragment");
  },
  // rustc: compiler/rustc_expand/src/expand.rs:239 make_generic_params
  make_generic_params(self: AstFragment): GenericParam[] {
    return self.$ === "GenericParams"
      ? self._0
      : panic("AstFragment::make_generic_params called on the wrong kind of fragment");
  },
  // rustc: compiler/rustc_expand/src/expand.rs:244 make_params
  make_params(self: AstFragment): Param[] {
    return self.$ === "Params" ? self._0 : panic("AstFragment::make_params called on the wrong kind of fragment");
  },
  // rustc: compiler/rustc_expand/src/expand.rs:249 make_field_defs
  make_field_defs(self: AstFragment): FieldDef[] {
    return self.$ === "FieldDefs"
      ? self._0
      : panic("AstFragment::make_field_defs called on the wrong kind of fragment");
  },
  // rustc: compiler/rustc_expand/src/expand.rs:254 make_variants
  make_variants(self: AstFragment): Variant[] {
    return self.$ === "Variants"
      ? self._0
      : panic("AstFragment::make_variants called on the wrong kind of fragment");
  },
  // rustc: compiler/rustc_expand/src/expand.rs:259 make_where_predicates
  make_where_predicates(self: AstFragment): WherePredicate[] {
    return self.$ === "WherePredicates"
      ? self._0
      : panic("AstFragment::make_where_predicates called on the wrong kind of fragment");
  },
  // rustc: compiler/rustc_expand/src/expand.rs:264 make_crate
  make_crate(self: AstFragment): Crate {
    return self.$ === "Crate" ? self._0 : panic("AstFragment::make_crate called on the wrong kind of fragment");
  },

  // rustc: compiler/rustc_expand/src/expand.rs:136 make_ast
  make_ast<O>(self: AstFragment, T: { fragment_to_output(fragment: AstFragment): O }): O {
    return T.fragment_to_output(self);
  },

  // rustc: compiler/rustc_expand/src/expand.rs:140 mut_visit_with
  mut_visit_with(self: AstFragment, vis: MutVisitor): void {
    switch (self.$) {
      case "OptExpr": {
        // PORT: `if let Some(expr) = opt_expr.take() { *opt_expr = vis.filter_map_expr(expr) }`.
        const expr = self._0;
        if (expr !== undefined) {
          self._0 = undefined;
          self._0 = vis.filter_map_expr(expr);
        }
        break;
      }
      case "MethodReceiverExpr":
        vis.visit_method_receiver_expr(self._0);
        break;
      // rustc: compiler/rustc_expand/src/expand.rs:178 visit_expr
      case "Expr":
        vis.visit_expr(self._0);
        break;
      // rustc: compiler/rustc_expand/src/expand.rs:183 visit_pat
      case "Pat":
        vis.visit_pat(self._0);
        break;
      // rustc: compiler/rustc_expand/src/expand.rs:188 visit_ty
      case "Ty":
        vis.visit_ty(self._0);
        break;
      // rustc: compiler/rustc_expand/src/expand.rs:263 visit_crate
      case "Crate":
        vis.visit_crate(self._0);
        break;
      // expand.rs:193 `fn flat_map_stmt;` (the line's marker, on its last fn, is on the `visit_with` arm)
      case "Stmts":
        flat_map_in_place(self._0, (ast) => vis.flat_map_stmt(ast));
        break;
      // expand.rs:198 `fn flat_map_item;` (the line's marker, on its last fn, is on the `visit_with` arm)
      case "Items":
        flat_map_in_place(self._0, (ast) => vis.flat_map_item(ast));
        break;
      // expand.rs:203 `fn flat_map_assoc_item;` (the line's marker, on its last fn, is on the `visit_with` arm)
      case "TraitItems":
        flat_map_in_place(self._0, (ast) => vis.flat_map_assoc_item(ast, AssocCtxt.Trait));
        break;
      // expand.rs:208 `fn flat_map_assoc_item;` (the line's marker, on its last fn, is on the `visit_with` arm)
      case "ImplItems":
        flat_map_in_place(self._0, (ast) => vis.flat_map_assoc_item(ast, { $: "Impl", of_trait: false }));
        break;
      // expand.rs:213 `fn flat_map_assoc_item;` (the line's marker, on its last fn, is on the `visit_with` arm)
      case "TraitImplItems":
        flat_map_in_place(self._0, (ast) => vis.flat_map_assoc_item(ast, { $: "Impl", of_trait: true }));
        break;
      // expand.rs:218 `fn flat_map_foreign_item;` (the line's marker, on its last fn, is on the `visit_with` arm)
      case "ForeignItems":
        flat_map_in_place(self._0, (ast) => vis.flat_map_foreign_item(ast));
        break;
      // expand.rs:223 `fn flat_map_arm;` (the line's marker, on its last fn, is on the `visit_with` arm)
      case "Arms":
        flat_map_in_place(self._0, (ast) => vis.flat_map_arm(ast));
        break;
      // expand.rs:228 `fn flat_map_expr_field;` (the line's marker, on its last fn, is on the `visit_with` arm)
      case "ExprFields":
        flat_map_in_place(self._0, (ast) => vis.flat_map_expr_field(ast));
        break;
      // expand.rs:233 `fn flat_map_pat_field;` (the line's marker, on its last fn, is on the `visit_with` arm)
      case "PatFields":
        flat_map_in_place(self._0, (ast) => vis.flat_map_pat_field(ast));
        break;
      // expand.rs:238 `fn flat_map_generic_param;` (the line's marker, on its last fn, is on the `visit_with` arm)
      case "GenericParams":
        flat_map_in_place(self._0, (ast) => vis.flat_map_generic_param(ast));
        break;
      // expand.rs:243 `fn flat_map_param;` (the line's marker, on its last fn, is on the `visit_with` arm)
      case "Params":
        flat_map_in_place(self._0, (ast) => vis.flat_map_param(ast));
        break;
      // expand.rs:248 `fn flat_map_field_def;` (the line's marker, on its last fn, is on the `visit_with` arm)
      case "FieldDefs":
        flat_map_in_place(self._0, (ast) => vis.flat_map_field_def(ast));
        break;
      // expand.rs:253 `fn flat_map_variant;` (the line's marker, on its last fn, is on the `visit_with` arm)
      case "Variants":
        flat_map_in_place(self._0, (ast) => vis.flat_map_variant(ast));
        break;
      // expand.rs:258 `fn flat_map_where_predicate;` (the line's marker, on its last fn, is on the `visit_with` arm)
      case "WherePredicates":
        flat_map_in_place(self._0, (ast) => vis.flat_map_where_predicate(ast));
        break;
    }
  },

  // rustc: compiler/rustc_expand/src/expand.rs:154 visit_with
  visit_with<R>(self: AstFragment, visitor: Visitor<R>): R {
    let r: R | undefined;
    switch (self.$) {
      case "OptExpr":
        if (self._0 !== undefined) {
          if ((r = try_visit(visitor.Result, visitor.visit_expr(self._0))) !== undefined) return r;
        }
        break;
      case "MethodReceiverExpr":
        if ((r = try_visit(visitor.Result, visitor.visit_method_receiver_expr(self._0))) !== undefined) return r;
        break;
      case "Expr":
        if ((r = try_visit(visitor.Result, visitor.visit_expr(self._0))) !== undefined) return r;
        break;
      case "Pat":
        if ((r = try_visit(visitor.Result, visitor.visit_pat(self._0))) !== undefined) return r;
        break;
      case "Ty":
        if ((r = try_visit(visitor.Result, visitor.visit_ty(self._0))) !== undefined) return r;
        break;
      case "Crate":
        if ((r = try_visit(visitor.Result, visitor.visit_crate(self._0))) !== undefined) return r;
        break;
      // PORT: `walk_list!(visitor, $visit_ast_elt, &ast[..], $($args)*)` expanded inline.
      // rustc: compiler/rustc_expand/src/expand.rs:193 visit_stmt
      case "Stmts":
        for (const elem of self._0) {
          if ((r = try_visit(visitor.Result, visitor.visit_stmt(elem))) !== undefined) return r;
        }
        break;
      // rustc: compiler/rustc_expand/src/expand.rs:198 visit_item
      case "Items":
        for (const elem of self._0) {
          if ((r = try_visit(visitor.Result, visitor.visit_item(elem))) !== undefined) return r;
        }
        break;
      // rustc: compiler/rustc_expand/src/expand.rs:203 visit_assoc_item
      case "TraitItems":
        for (const elem of self._0) {
          if ((r = try_visit(visitor.Result, visitor.visit_assoc_item(elem, AssocCtxt.Trait))) !== undefined) return r;
        }
        break;
      // rustc: compiler/rustc_expand/src/expand.rs:208 visit_assoc_item
      case "ImplItems":
        for (const elem of self._0) {
          if ((r = try_visit(visitor.Result, visitor.visit_assoc_item(elem, { $: "Impl", of_trait: false }))) !== undefined) {
            return r;
          }
        }
        break;
      // rustc: compiler/rustc_expand/src/expand.rs:213 visit_assoc_item
      case "TraitImplItems":
        for (const elem of self._0) {
          if ((r = try_visit(visitor.Result, visitor.visit_assoc_item(elem, { $: "Impl", of_trait: true }))) !== undefined) {
            return r;
          }
        }
        break;
      // rustc: compiler/rustc_expand/src/expand.rs:218 visit_foreign_item
      case "ForeignItems":
        for (const elem of self._0) {
          if ((r = try_visit(visitor.Result, visitor.visit_foreign_item(elem))) !== undefined) return r;
        }
        break;
      // rustc: compiler/rustc_expand/src/expand.rs:223 visit_arm
      case "Arms":
        for (const elem of self._0) {
          if ((r = try_visit(visitor.Result, visitor.visit_arm(elem))) !== undefined) return r;
        }
        break;
      // rustc: compiler/rustc_expand/src/expand.rs:228 visit_expr_field
      case "ExprFields":
        for (const elem of self._0) {
          if ((r = try_visit(visitor.Result, visitor.visit_expr_field(elem))) !== undefined) return r;
        }
        break;
      // rustc: compiler/rustc_expand/src/expand.rs:233 visit_pat_field
      case "PatFields":
        for (const elem of self._0) {
          if ((r = try_visit(visitor.Result, visitor.visit_pat_field(elem))) !== undefined) return r;
        }
        break;
      // rustc: compiler/rustc_expand/src/expand.rs:238 visit_generic_param
      case "GenericParams":
        for (const elem of self._0) {
          if ((r = try_visit(visitor.Result, visitor.visit_generic_param(elem))) !== undefined) return r;
        }
        break;
      // rustc: compiler/rustc_expand/src/expand.rs:243 visit_param
      case "Params":
        for (const elem of self._0) {
          if ((r = try_visit(visitor.Result, visitor.visit_param(elem))) !== undefined) return r;
        }
        break;
      // rustc: compiler/rustc_expand/src/expand.rs:248 visit_field_def
      case "FieldDefs":
        for (const elem of self._0) {
          if ((r = try_visit(visitor.Result, visitor.visit_field_def(elem))) !== undefined) return r;
        }
        break;
      // rustc: compiler/rustc_expand/src/expand.rs:253 visit_variant
      case "Variants":
        for (const elem of self._0) {
          if ((r = try_visit(visitor.Result, visitor.visit_variant(elem))) !== undefined) return r;
        }
        break;
      // rustc: compiler/rustc_expand/src/expand.rs:258 visit_where_predicate
      case "WherePredicates":
        for (const elem of self._0) {
          if ((r = try_visit(visitor.Result, visitor.visit_where_predicate(elem))) !== undefined) return r;
        }
        break;
    }
    return visitor.Result.output();
  },
};

/** The receiver of `impl MacResult for crate::mbe::macro_rules::ParserAnyMacro` (`ParserAnyMacro::make`). */
export interface ParserAnyMacroMake {
  make(kind: AstFragmentKind): AstFragment;
}

// `impl<'a, 'b> MacResult for crate::mbe::macro_rules::ParserAnyMacro<'a, 'b>` (expand.rs:166).
// PORT: the impl's fns are `fn $make_ast` (metavariable names: no coverage markers), so they carry
// `rustc-macro:` comments; mbe/macro_rules.ts installs this table on `ParserAnyMacro` (its owner).
export const ParserAnyMacro_MacResult = {
  // rustc-macro: compiler/rustc_expand/src/expand.rs:167 make_expr
  make_expr(this: ParserAnyMacroMake): Expr | undefined {
    return AstFragment.make_expr(this.make("Expr"));
  },
  // rustc-macro: compiler/rustc_expand/src/expand.rs:167 make_pat
  make_pat(this: ParserAnyMacroMake): Pat | undefined {
    return AstFragment.make_pat(this.make("Pat"));
  },
  // rustc-macro: compiler/rustc_expand/src/expand.rs:167 make_ty
  make_ty(this: ParserAnyMacroMake): Ty | undefined {
    return AstFragment.make_ty(this.make("Ty"));
  },
  // rustc-macro: compiler/rustc_expand/src/expand.rs:167 make_stmts
  make_stmts(this: ParserAnyMacroMake): Stmt[] | undefined {
    return AstFragment.make_stmts(this.make("Stmts"));
  },
  // rustc-macro: compiler/rustc_expand/src/expand.rs:167 make_items
  make_items(this: ParserAnyMacroMake): Item[] | undefined {
    return AstFragment.make_items(this.make("Items"));
  },
  // rustc-macro: compiler/rustc_expand/src/expand.rs:167 make_trait_items
  make_trait_items(this: ParserAnyMacroMake): AssocItem[] | undefined {
    return AstFragment.make_trait_items(this.make("TraitItems"));
  },
  // rustc-macro: compiler/rustc_expand/src/expand.rs:167 make_impl_items
  make_impl_items(this: ParserAnyMacroMake): AssocItem[] | undefined {
    return AstFragment.make_impl_items(this.make("ImplItems"));
  },
  // rustc-macro: compiler/rustc_expand/src/expand.rs:167 make_trait_impl_items
  make_trait_impl_items(this: ParserAnyMacroMake): AssocItem[] | undefined {
    return AstFragment.make_trait_impl_items(this.make("TraitImplItems"));
  },
  // rustc-macro: compiler/rustc_expand/src/expand.rs:167 make_foreign_items
  make_foreign_items(this: ParserAnyMacroMake): ForeignItem[] | undefined {
    return AstFragment.make_foreign_items(this.make("ForeignItems"));
  },
  // rustc-macro: compiler/rustc_expand/src/expand.rs:167 make_arms
  make_arms(this: ParserAnyMacroMake): Arm[] | undefined {
    return AstFragment.make_arms(this.make("Arms"));
  },
  // rustc-macro: compiler/rustc_expand/src/expand.rs:167 make_expr_fields
  make_expr_fields(this: ParserAnyMacroMake): ExprField[] | undefined {
    return AstFragment.make_expr_fields(this.make("ExprFields"));
  },
  // rustc-macro: compiler/rustc_expand/src/expand.rs:167 make_pat_fields
  make_pat_fields(this: ParserAnyMacroMake): PatField[] | undefined {
    return AstFragment.make_pat_fields(this.make("PatFields"));
  },
  // rustc-macro: compiler/rustc_expand/src/expand.rs:167 make_generic_params
  make_generic_params(this: ParserAnyMacroMake): GenericParam[] | undefined {
    return AstFragment.make_generic_params(this.make("GenericParams"));
  },
  // rustc-macro: compiler/rustc_expand/src/expand.rs:167 make_params
  make_params(this: ParserAnyMacroMake): Param[] | undefined {
    return AstFragment.make_params(this.make("Params"));
  },
  // rustc-macro: compiler/rustc_expand/src/expand.rs:167 make_field_defs
  make_field_defs(this: ParserAnyMacroMake): FieldDef[] | undefined {
    return AstFragment.make_field_defs(this.make("FieldDefs"));
  },
  // rustc-macro: compiler/rustc_expand/src/expand.rs:167 make_variants
  make_variants(this: ParserAnyMacroMake): Variant[] | undefined {
    return AstFragment.make_variants(this.make("Variants"));
  },
  // rustc-macro: compiler/rustc_expand/src/expand.rs:167 make_where_predicates
  make_where_predicates(this: ParserAnyMacroMake): WherePredicate[] | undefined {
    return AstFragment.make_where_predicates(this.make("WherePredicates"));
  },
  // rustc-macro: compiler/rustc_expand/src/expand.rs:167 make_crate
  make_crate(this: ParserAnyMacroMake): Crate | undefined {
    return AstFragment.make_crate(this.make("Crate"));
  },
};

// ---- end of the `ast_fragments!` expansion ----

export type SupportsMacroExpansion = { readonly $: "No" } | { readonly $: "Yes"; supports_inner_attrs: boolean };
/** Unit variants of `SupportsMacroExpansion`, shared frozen singletons. */
export const SupportsMacroExpansion = {
  No: Object.freeze({ $: "No" as const }),
};

/** `impl AstFragmentKind` (both impl blocks; methods on the companion, PORTING §8). */
export const AstFragmentKind = {
  ...AstFragmentKind_ast_fragments,

  // rustc: compiler/rustc_expand/src/expand.rs:274 dummy
  dummy(self: AstFragmentKind, span: Span, guar: ErrorGuaranteed): AstFragment {
    return unwrap(AstFragmentKind.make_from(self, DummyResult.any(span, guar)), "couldn't create a dummy AST fragment");
  },

  // rustc: compiler/rustc_expand/src/expand.rs:278 supports_macro_expansion
  supports_macro_expansion(self: AstFragmentKind): SupportsMacroExpansion {
    switch (self) {
      case "OptExpr":
      case "Expr":
      case "MethodReceiverExpr":
      case "Stmts":
      case "Ty":
      case "Pat":
        return { $: "Yes", supports_inner_attrs: false };
      case "Items":
      case "TraitItems":
      case "ImplItems":
      case "TraitImplItems":
      case "ForeignItems":
      case "Crate":
        return { $: "Yes", supports_inner_attrs: true };
      case "Arms":
      case "ExprFields":
      case "PatFields":
      case "GenericParams":
      case "Params":
      case "FieldDefs":
      case "Variants":
      case "WherePredicates":
        return SupportsMacroExpansion.No;
    }
  },

  // rustc: compiler/rustc_expand/src/expand.rs:303 expect_from_annotatables
  expect_from_annotatables(self: AstFragmentKind, items_: Iterable<Annotatable>): AstFragment {
    // PORT: `items.map(f).collect()` -> `collect_map`; `items.next()` -> `iter_next`.
    const items = iter(items_);
    switch (self) {
      case "Arms":
        return { $: "Arms", _0: collect_map(items, Annotatable.expect_arm) };
      case "ExprFields":
        return { $: "ExprFields", _0: collect_map(items, Annotatable.expect_expr_field) };
      case "PatFields":
        return { $: "PatFields", _0: collect_map(items, Annotatable.expect_pat_field) };
      case "GenericParams":
        return { $: "GenericParams", _0: collect_map(items, Annotatable.expect_generic_param) };
      case "Params":
        return { $: "Params", _0: collect_map(items, Annotatable.expect_param) };
      case "FieldDefs":
        return { $: "FieldDefs", _0: collect_map(items, Annotatable.expect_field_def) };
      case "Variants":
        return { $: "Variants", _0: collect_map(items, Annotatable.expect_variant) };
      case "WherePredicates":
        return { $: "WherePredicates", _0: collect_map(items, Annotatable.expect_where_predicate) };
      case "Items":
        return { $: "Items", _0: collect_map(items, Annotatable.expect_item) };
      case "ImplItems":
        return { $: "ImplItems", _0: collect_map(items, Annotatable.expect_impl_item) };
      case "TraitImplItems":
        return { $: "TraitImplItems", _0: collect_map(items, Annotatable.expect_impl_item) };
      case "TraitItems":
        return { $: "TraitItems", _0: collect_map(items, Annotatable.expect_trait_item) };
      case "ForeignItems":
        return { $: "ForeignItems", _0: collect_map(items, Annotatable.expect_foreign_item) };
      case "Stmts":
        return { $: "Stmts", _0: collect_map(items, Annotatable.expect_stmt) };
      case "Expr":
        return { $: "Expr", _0: Annotatable.expect_expr(unwrap(iter_next(items), "expected exactly one expression")) };
      case "MethodReceiverExpr":
        return {
          $: "MethodReceiverExpr",
          _0: Annotatable.expect_expr(unwrap(iter_next(items), "expected exactly one expression")),
        };
      case "OptExpr": {
        const item = iter_next(items);
        return { $: "OptExpr", _0: item === undefined ? undefined : Annotatable.expect_expr(item) };
      }
      case "Crate":
        return { $: "Crate", _0: Annotatable.expect_crate(unwrap(iter_next(items), "expected exactly one crate")) };
      case "Pat":
      case "Ty":
        return panic("patterns and types aren't annotatable");
    }
  },
};

// PORT: iterator helpers for `expect_from_annotatables` (`IntoIterator` + `Iterator::{next, map, collect}`).
function iter<T>(items: Iterable<T>): Iterator<T> {
  return items[globalThis.Symbol.iterator]();
}
function iter_next<T>(it: Iterator<T>): T | undefined {
  const n = it.next();
  return n.done === true ? undefined : n.value;
}
function collect_map<T, U>(it: Iterator<T>, f: (v: T) => U): U[] {
  const out: U[] = [];
  for (let n = it.next(); n.done !== true; n = it.next()) out.push(f(n.value));
  return out;
}

export type InvocationKind =
  | { readonly $: "Bang"; mac: MacCall; span: Span }
  | {
      readonly $: "Attr";
      attr: Attribute;
      /// Re-insertion position for inert attributes.
      pos: number;
      item: Annotatable;
      /// Required for resolving derive helper attributes.
      derives: Path[];
    }
  | { readonly $: "Derive"; path: Path; is_const: boolean; item: Annotatable }
  | {
      readonly $: "GlobDelegation";
      item: AssocItem;
      /// Whether this is a trait impl or an inherent impl
      of_trait: boolean;
    };

/** `impl InvocationKind` (methods on the companion, PORTING §8). */
export const InvocationKind = {
  // rustc: compiler/rustc_expand/src/expand.rs:402 placeholder_visibility
  placeholder_visibility(self: InvocationKind): import("../rustc_ast/lib.ts").Visibility | undefined {
    // HACK: For unnamed fields placeholders should have the same visibility as the actual
    // fields because for tuple structs/variants resolve determines visibilities of their
    // constructor using these field visibilities before attributes on them are expanded.
    // The assumption is that the attribute expansion cannot change field visibilities,
    // and it holds because only inert attributes are supported in this position.
    if ((self.$ === "Attr" || self.$ === "Derive") && self.item.$ === "FieldDef" && self.item._0.ident === undefined) {
      return clone_Visibility(self.item._0.vis);
    }
    return undefined;
  },
};

// PORT: struct with inherent methods -> class; `impl Invocation` (expand.rs:420) is in the class body.
export class Invocation {
  constructor(
    public kind: InvocationKind,
    public fragment_kind: AstFragmentKind,
    public expansion_data: ExpansionData,
  ) {}

  // rustc: compiler/rustc_expand/src/expand.rs:421 span
  span(): Span {
    const kind = this.kind;
    switch (kind.$) {
      case "Bang":
        return kind.span;
      case "Attr":
        return kind.attr.span;
      case "Derive":
        return kind.path.span;
      case "GlobDelegation":
        return kind.item.span;
    }
  }

  // rustc: compiler/rustc_expand/src/expand.rs:430 span_mut
  span_mut(): MutRef<Span> {
    const kind = this.kind;
    switch (kind.$) {
      case "Bang":
        return field_mut(kind, "span");
      case "Attr":
        return field_mut(kind.attr, "span");
      case "Derive":
        return field_mut(kind.path, "span");
      case "GlobDelegation":
        return field_mut(kind.item, "span");
    }
  }
}

/** An entry of the invocation queues: `(Invocation, Option<Arc<SyntaxExtension>>)`. */
type InvocationEntry = [Invocation, SyntaxExtension | undefined];

export class MacroExpander {
  constructor(
    public cx: ExtCtxt,
    public monotonic: boolean, // cf. `cx.monotonic_expander()`
  ) {}

  // rustc: compiler/rustc_expand/src/expand.rs:446 new
  static new(cx: ExtCtxt, monotonic: boolean): MacroExpander {
    return new MacroExpander(cx, monotonic);
  }

  // rustc: compiler/rustc_expand/src/expand.rs:450 expand_crate
  expand_crate(krate_: Crate): Crate {
    const name = this.cx.source_map().span_to_filename(krate_.spans.inner_span);
    let file_path: string;
    if (name.$ === "Real") {
      file_path = unwrap(name._0.into_local_path(), "attempting to resolve a file path in an external file");
    } else {
      // PORT: `PathBuf::from(other.prefer_local_unconditionally().to_string())`.
      file_path = FileName.prefer_local_unconditionally(name).to_string();
    }
    // PORT: `file_path.parent().unwrap_or(&file_path).to_owned()`.
    const dir_path = path_parent(file_path) ?? file_path;
    this.cx.root_path = dir_path;
    this.cx.current_expansion.module = new ModuleData([Ident.with_dummy_span(this.cx.ecfg.crate_name)], [file_path], dir_path);
    const krate = AstFragment.make_crate(this.fully_expand_fragment({ $: "Crate", _0: krate_ }));
    assert_eq(krate.id, CRATE_NODE_ID, (v) => node_id.debug_NodeId(v, PLAIN));
    this.cx.trace_macros_diag();
    return krate;
  }

  /// Recursively expand all macro invocations in this AST fragment.
  // rustc: compiler/rustc_expand/src/expand.rs:471 fully_expand_fragment
  fully_expand_fragment(input_fragment: AstFragment): AstFragment {
    const orig_expansion_data = clone_ExpansionData(this.cx.current_expansion);
    const orig_force_mode = this.cx.force_mode;

    // Collect all macro invocations and replace them with placeholders.
    const collected = this.collect_invocations(input_fragment, []);
    const fragment_with_placeholders = collected[0];
    let invocations = collected[1];

    // Optimization: if we resolve all imports now,
    // we'll be able to immediately resolve most of imported macros.
    this.resolve_imports();

    // Resolve paths in all invocations and produce output expanded fragments for them, but
    // do not insert them into our input AST fragment yet, only store in `expanded_fragments`.
    // The output fragments also go through expansion recursively until no invocations are left.
    // Unresolved macros produce dummy outputs as a recovery measure.
    invocations.reverse();
    const expanded_fragments: [LocalExpnId, AstFragment][][] = [];
    let expanded_fragments_len = 0;
    let undetermined_invocations: InvocationEntry[] = [];
    let progress = false;
    let force = !this.monotonic;
    for (;;) {
      const popped = invocations.pop();
      if (popped === undefined) {
        this.resolve_imports();
        if (undetermined_invocations.length === 0) {
          break;
        }
        invocations = undetermined_invocations;
        undetermined_invocations = [];
        force = !progress;
        progress = false;
        if (force && this.monotonic) {
          this.cx.dcx().span_delayed_bug(
            invocations[invocations.length - 1]![0].span(),
            "expansion entered force mode without producing any errors",
          );
        }
        continue;
      }
      const [invoc, ext_] = popped;

      let ext: SyntaxExtension;
      if (ext_ !== undefined) {
        ext = ext_;
      } else {
        const eager_expansion_root = this.monotonic ? invoc.expansion_data.id : orig_expansion_data.id;
        const res = this.cx.resolver.resolve_macro_invocation(invoc, eager_expansion_root, force);
        if (res.$ === "Ok") {
          ext = res._0;
        } else {
          // Cannot resolve, will retry this invocation later.
          undetermined_invocations.push([invoc, undefined]);
          continue;
        }
      }

      const { depth: invoc_depth, id: expn_id } = invoc.expansion_data;
      const depth = invoc_depth - orig_expansion_data.depth;
      this.cx.current_expansion = clone_ExpansionData(invoc.expansion_data);
      this.cx.force_mode = force;

      const fragment_kind = invoc.fragment_kind;
      const result = this.expand_invoc(invoc, ext.kind);
      switch (result.$) {
        case "Ready": {
          const fragment = result._0;
          const derive_invocations: InvocationEntry[] = [];
          const derives = this.cx.resolver.take_derive_resolutions(expn_id);
          // PORT: `.map(|derives| ..).unwrap_or_default()`.
          const derive_placeholders: NodeId[] =
            derives === undefined
              ? []
              : derives.map(({ path, item, exts: _, is_const }: DeriveResolution) => {
                  // FIXME: Consider using the derive resolutions (`_exts`)
                  // instead of enqueuing the derives to be resolved again later.
                  // Note that this can result in duplicate diagnostics.
                  const expn_id = LocalExpnId.fresh_empty();
                  // PORT: `ExpansionData { id: expn_id, clone_ExpansionData(..self.cx.current_expansion) }`.
                  const expansion_data = clone_ExpansionData(this.cx.current_expansion);
                  expansion_data.id = expn_id;
                  derive_invocations.push([
                    new Invocation({ $: "Derive", path, item, is_const }, fragment_kind, expansion_data),
                    undefined,
                  ]);
                  return NodeId.placeholder_from_expn_id(expn_id);
                });

          const [expanded_fragment, collected_invocations] = this.collect_invocations(fragment, derive_placeholders);
          // We choose to expand any derive invocations associated with this macro
          // invocation *before* any macro invocations collected from the output
          // fragment.
          derive_invocations.push(...collected_invocations);

          progress = true;
          if (expanded_fragments.length < depth) {
            expanded_fragments.push([]);
          }
          expanded_fragments[depth - 1]!.push([expn_id, expanded_fragment]);
          expanded_fragments_len += 1;
          invocations.push(...derive_invocations.reverse());
          break;
        }
        case "Retry": {
          const invoc = result._0;
          if (force) {
            this.cx.dcx().span_bug(invoc.span(), "expansion entered force mode but is still stuck");
          } else {
            // Cannot expand, will retry this invocation later.
            undetermined_invocations.push([invoc, ext]);
          }
          break;
        }
      }
    }

    this.cx.current_expansion = orig_expansion_data;
    this.cx.force_mode = orig_force_mode;

    // Finally incorporate all the expanded macros into the input AST fragment.
    const placeholder_expander = PlaceholderExpander.with_capacity(expanded_fragments_len);
    for (let fragments = expanded_fragments.pop(); fragments !== undefined; fragments = expanded_fragments.pop()) {
      for (const [expn_id, expanded_fragment] of fragments.reverse()) {
        placeholder_expander.add(NodeId.placeholder_from_expn_id(expn_id), expanded_fragment);
      }
    }
    AstFragment.mut_visit_with(fragment_with_placeholders, placeholder_expander);
    return fragment_with_placeholders;
  }

  // rustc: compiler/rustc_expand/src/expand.rs:616 resolve_imports
  resolve_imports(): void {
    if (this.monotonic) {
      this.cx.resolver.resolve_imports();
    }
  }

  /// Collects all macro invocations reachable at this time in this AST fragment, and replace
  /// them with "placeholders" - dummy macro invocations with specially crafted `NodeId`s.
  /// Then call into resolver that builds a skeleton ("reduced graph") of the fragment and
  /// prepares data for resolving paths of macro invocations.
  // rustc: compiler/rustc_expand/src/expand.rs:626 collect_invocations
  collect_invocations(fragment: AstFragment, extra_placeholders: readonly NodeId[]): [AstFragment, InvocationEntry[]] {
    // Resolve `$crate`s in the fragment for pretty-printing.
    this.cx.resolver.resolve_dollar_crates();

    let invocations: InvocationEntry[];
    {
      const collector = new InvocationCollector(
        // Non-derive macro invocations cannot see the results of cfg expansion - they
        // will either be removed along with the item, or invoked before the cfg/cfg_attr
        // attribute is expanded. Therefore, we don't need to configure the tokens
        // Derive macros *can* see the results of cfg-expansion - they are handled
        // specially in `fully_expand_fragment`
        this.cx,
        [],
        this.monotonic,
      );
      AstFragment.mut_visit_with(fragment, collector);
      AstFragment.add_placeholders(fragment, extra_placeholders);
      invocations = collector.invocations;
    }

    if (this.monotonic) {
      this.cx.resolver.visit_ast_fragment_with_placeholders(this.cx.current_expansion.id, fragment);

      if (this.cx.sess.opts.incremental !== undefined) {
        for (const [invoc] of invocations) {
          const expn_id = invoc.expansion_data.id;
          const parent_def = this.cx.resolver.invocation_parent(expn_id);
          const span = invoc.span_mut();
          span.value = Span.with_parent(span.value, parent_def);
        }
      }
    }

    return [fragment, invocations];
  }

  // rustc: compiler/rustc_expand/src/expand.rs:668 error_recursion_limit_reached
  error_recursion_limit_reached(): ErrorGuaranteed {
    const expn_data = LocalExpnId.expn_data(this.cx.current_expansion.id);
    const limit = this.cx.ecfg.recursion_limit;
    const suggested_limit = limit._0 === 0 ? Limit.new(2) : Limit_mul(limit, 2);

    const guar = this.cx.dcx().emit_err(
      diagnostics.RecursionLimitReached_diagnostic({
        span: expn_data.call_site,
        descr: ExpnKind.descr(expn_data.kind),
        suggested_limit,
        crate_name: this.cx.ecfg.crate_name,
      }),
    );

    this.cx.macro_error_and_trace_macros_diag();
    return guar;
  }

  /// A macro's expansion does not fit in this fragment kind.
  /// For example, a non-type macro in a type position.
  // rustc: compiler/rustc_expand/src/expand.rs:688 error_wrong_fragment_kind
  error_wrong_fragment_kind(kind: AstFragmentKind, mac: MacCall, span: Span): ErrorGuaranteed {
    const name = pprust.path_to_string(mac.path);
    const guar = this.cx.dcx().emit_err(diagnostics.WrongFragmentKind_diagnostic({ span, kind: AstFragmentKind.name(kind), name }));
    this.cx.macro_error_and_trace_macros_diag();
    return guar;
  }

  // rustc: compiler/rustc_expand/src/expand.rs:700 expand_invoc
  expand_invoc(invoc: Invocation, ext: SyntaxExtensionKind): ExpandResult<AstFragment, Invocation> {
    const recursion_limit = this.cx.reduced_recursion_limit !== undefined ? this.cx.reduced_recursion_limit[0] : this.cx.ecfg.recursion_limit;

    if (!recursion_limit.value_within_limit(this.cx.current_expansion.depth)) {
      const guar = this.cx.reduced_recursion_limit !== undefined ? this.cx.reduced_recursion_limit[1] : this.error_recursion_limit_reached();

      // Reduce the recursion limit by half each time it triggers.
      this.cx.reduced_recursion_limit = [Limit_div(recursion_limit, 2), guar];

      return { $: "Ready", _0: AstFragmentKind.dummy(invoc.fragment_kind, invoc.span(), guar) };
    }

    const macro_stats = this.cx.sess.opts.unstable_opts.macro_stats;

    const [fragment_kind, span] = [invoc.fragment_kind, invoc.span()];
    const kind = invoc.kind;
    let fragment: AstFragment;
    switch (kind.$) {
      case "Bang": {
        const { mac, span } = kind;
        let expander;
        if (ext.$ === "Bang") {
          const expander = ext._0;
          const r = expander.expand(this.cx, span, clone_TokenStream(mac.args.tokens));
          if (r.$ === "Ok") {
            const tok_result = r._0;
            const fragment_ = this.parse_ast_fragment(tok_result, fragment_kind, mac.path, span);
            if (macro_stats) {
              update_bang_macro_stats(this.cx, fragment_kind, span, mac, fragment_);
            }
            fragment = fragment_;
          } else {
            const guar = r._0;
            return { $: "Ready", _0: AstFragmentKind.dummy(fragment_kind, span, guar) };
          }
        } else if ((expander = SyntaxExtensionKind.as_legacy_bang(ext)) !== undefined) {
          const r = expander.expand(this.cx, span, clone_TokenStream(mac.args.tokens));
          let tok_result: MacResult;
          if (r.$ === "Ready") {
            tok_result = r._0;
          } else {
            // retry the original
            return { $: "Retry", _0: new Invocation({ $: "Bang", mac, span }, invoc.fragment_kind, invoc.expansion_data) };
          }
          const fragment_ = AstFragmentKind.make_from(fragment_kind, tok_result);
          if (fragment_ !== undefined) {
            if (macro_stats) {
              update_bang_macro_stats(this.cx, fragment_kind, span, mac, fragment_);
            }
            fragment = fragment_;
          } else {
            const guar = this.error_wrong_fragment_kind(fragment_kind, mac, span);
            fragment = AstFragmentKind.dummy(fragment_kind, span, guar);
          }
        } else {
          return unreachable();
        }
        break;
      }
      case "Attr": {
        const { attr, pos, item, derives } = kind;
        let expander;
        if ((expander = SyntaxExtensionKind.as_attr(ext)) !== undefined) {
          this.gate_proc_macro_attr_item(span, item);
          let tokens: TokenStream;
          if (item.$ === "Crate") {
            // FIXME: Collect tokens and use them instead of generating
            // fake ones. These are unstable, so it needs to be
            // fixed prior to stabilization
            // Fake tokens when we are invoking an inner attribute, and
            // we are invoking it on an out-of-line module or crate.
            tokens = fake_token_stream_for_crate(this.cx.sess.psess, item._0);
          } else if (
            item.$ === "Item" &&
            attr.style === "Inner" &&
            item._0.kind.$ === "Mod" &&
            (item._0.kind._2.$ === "Unloaded" || (item._0.kind._2.$ === "Loaded" && item._0.kind._2._1.$ === "No"))
          ) {
            tokens = fake_token_stream_for_item(this.cx.sess.psess, item._0, attr);
          } else if (item.$ === "Item" && item._0.tokens === undefined) {
            tokens = fake_token_stream_for_item(this.cx.sess.psess, item._0, undefined);
          } else if (item.$ === "Item" && item._0.kind.$ === "Fn" && item._0.kind._0.eii_impl !== undefined) {
            // When a function has EII implementations attached (via `eii_impl`),
            // use fake tokens so the pretty-printer re-emits the EII attribute
            // (e.g. `#[hello]`) in the token stream. Without this, the EII
            // attribute is lost during the token roundtrip performed by
            // `AttrProcMacro` expanders like `contracts::requires/ensures`,
            // breaking the EII link on the resulting re-parsed item.
            tokens = fake_token_stream_for_item(this.cx.sess.psess, item._0, undefined);
          } else if (item.$ === "ForeignItem" && item._0.tokens === undefined) {
            tokens = fake_token_stream_for_foreign_item(this.cx.sess.psess, item._0);
          } else {
            tokens = Annotatable.to_tokens(item);
          }
          const attr_item = attr.get_normal_item();
          const safety = attr_item.unsafety;
          if (attr_item.args.$ === "Eq") {
            this.cx.dcx().emit_err(diagnostics.UnsupportedKeyValue_diagnostic({ span }));
          }
          const inner_tokens = AttrArgs.inner_tokens(attr_item.args);
          const r = expander.expand_with_safety(this.cx, safety, span, inner_tokens, tokens);
          if (r.$ === "Ok") {
            const tok_result = r._0;
            const fragment_ = this.parse_ast_fragment(tok_result, fragment_kind, attr_item.path, span);
            if (macro_stats) {
              update_attr_macro_stats(this.cx, fragment_kind, span, attr_item.path, attr, item, fragment_);
            }
            fragment = fragment_;
          } else {
            const guar = r._0;
            return { $: "Ready", _0: AstFragmentKind.dummy(fragment_kind, span, guar) };
          }
        } else if (ext.$ === "LegacyAttr") {
          const expander = ext._0;
          this.gate_proc_macro_attr_item(span, item);
          // `LegacyAttr` is only used for builtin attribute macros, which have their
          // safety checked by `check_builtin_meta_item`, so we don't need to check
          // `unsafety` here.
          const r = validate_attr.parse_meta(this.cx.sess.psess, attr);
          if (r.$ === "Ok") {
            const meta = r._0;
            const item_clone = macro_stats ? clone_Annotatable_for_stats(item) : undefined;
            const er = expander.expand(this.cx, span, meta, item, false);
            let items: Annotatable[];
            if (er.$ === "Ready") {
              items = er._0;
            } else {
              const item = er._0;
              // Reassemble the original invocation for retrying.
              return {
                $: "Retry",
                _0: new Invocation({ $: "Attr", attr, pos, item, derives }, invoc.fragment_kind, invoc.expansion_data),
              };
            }
            if ((fragment_kind === "Expr" || fragment_kind === "MethodReceiverExpr") && items.length === 0) {
              const guar = this.cx.dcx().emit_err(diagnostics.RemoveExprNotSupported_diagnostic({ span }));
              fragment = AstFragmentKind.dummy(fragment_kind, span, guar);
            } else {
              const fragment_ = AstFragmentKind.expect_from_annotatables(fragment_kind, items);
              if (macro_stats) {
                update_attr_macro_stats(this.cx, fragment_kind, span, meta.path, attr, unwrap(item_clone), fragment_);
              }
              fragment = fragment_;
            }
          } else {
            const err = r._0;
            err.emit();
            fragment = AstFragmentKind.expect_from_annotatables(fragment_kind, [item]);
          }
        } else if (ext.$ === "NonMacroAttr") {
          // `-Zmacro-stats` ignores these because they don't do any real expansion.
          this.cx.expanded_inert_attrs.mark(attr);
          Annotatable.visit_attrs(item, (attrs) => {
            attrs.splice(pos, 0, attr);
          });
          fragment = AstFragmentKind.expect_from_annotatables(fragment_kind, [item]);
        } else {
          return unreachable();
        }
        break;
      }
      case "Derive": {
        const { path, item, is_const } = kind;
        if (ext.$ === "Derive" || ext.$ === "LegacyDerive") {
          const expander = ext._0;
          // The `MetaItem` representing the trait to derive can't
          // have an unsafe around it (as of now).
          const meta = new MetaItem(Safety.Default, path, { $: "Word" }, span);
          const er = expander.expand(this.cx, span, meta, item, is_const);
          let items: Annotatable[];
          if (er.$ === "Ready") {
            items = er._0;
          } else {
            const item = er._0;
            // Reassemble the original invocation for retrying.
            return {
              $: "Retry",
              _0: new Invocation({ $: "Derive", path: meta.path, item, is_const }, invoc.fragment_kind, invoc.expansion_data),
            };
          }
          const fragment_ = AstFragmentKind.expect_from_annotatables(fragment_kind, items);
          if (macro_stats) {
            update_derive_macro_stats(this.cx, fragment_kind, span, meta.path, fragment_);
          }
          fragment = fragment_;
        } else if (ext.$ === "MacroRules" && MacroKinds.contains(ext._0.kinds(), MacroKinds.DERIVE)) {
          const expander = ext._0;
          if (is_const) {
            const guar = this.cx.dcx().span_err(span, "macro `derive` does not support const derives");
            return { $: "Ready", _0: AstFragmentKind.dummy(fragment_kind, span, guar) };
          }
          const body = Annotatable.to_tokens(item);
          const r = expander.expand_derive(this.cx, span, body);
          if (r.$ === "Ok") {
            const tok_result = r._0;
            const fragment_ = this.parse_ast_fragment(tok_result, fragment_kind, path, span);
            if (macro_stats) {
              update_derive_macro_stats(this.cx, fragment_kind, span, path, fragment_);
            }
            fragment = fragment_;
          } else {
            const guar = r._0;
            return { $: "Ready", _0: AstFragmentKind.dummy(fragment_kind, span, guar) };
          }
        } else {
          return unreachable();
        }
        break;
      }
      case "GlobDelegation": {
        const { item, of_trait } = kind;
        if (item.kind.$ !== "DelegationMac") return unreachable();
        const deleg = item.kind._0;
        let suffixes: [Ident, Ident | undefined][];
        if (ext.$ === "GlobDelegation") {
          const expander = ext._0;
          const er = expander.expand(this.cx);
          if (er.$ === "Ready") {
            suffixes = er._0;
          } else {
            // Reassemble the original invocation for retrying.
            return {
              $: "Retry",
              _0: new Invocation({ $: "GlobDelegation", item, of_trait }, invoc.fragment_kind, invoc.expansion_data),
            };
          }
        } else if (ext.$ === "Bang") {
          const msg = "expanded a dummy glob delegation";
          const guar = this.cx.dcx().span_delayed_bug(span, msg);
          return { $: "Ready", _0: AstFragmentKind.dummy(fragment_kind, span, guar) };
        } else {
          return unreachable();
        }

        // type Node = AstNodeWrapper<Box<ast::AssocItem>, ImplItemTag>;
        const single_delegations = build_single_delegations(IC_ImplItem, this.cx, deleg, item, suffixes, item.span, DelegationSource_Glob);
        // `-Zmacro-stats` ignores these because they don't seem important.
        fragment = AstFragmentKind.expect_from_annotatables(
          fragment_kind,
          map_iter(single_delegations, (item): Annotatable => ({ $: "AssocItem", _0: item, _1: { $: "Impl", of_trait } })),
        );
        break;
      }
    }
    return { $: "Ready", _0: fragment };
  }

  // rustc: compiler/rustc_expand/src/expand.rs:1017 gate_proc_macro_attr_item
  gate_proc_macro_attr_item(span: Span, item: Annotatable): void {
    let kind: string;
    switch (item.$) {
      case "Item":
      case "AssocItem":
      case "ForeignItem":
      case "Crate":
        return;
      case "Stmt":
        // Attributes are stable on item statements,
        // but unstable on all other kinds of statements
        if (item._0.is_item()) {
          return;
        }
        kind = "statements";
        break;
      case "Expr":
        kind = "expressions";
        break;
      case "Arm":
      case "ExprField":
      case "PatField":
      case "GenericParam":
      case "Param":
      case "FieldDef":
      case "Variant":
      case "WherePredicate":
        return panic("unexpected annotatable");
    }
    if (this.cx.ecfg.features.proc_macro_hygiene()) {
      return;
    }
    feature_err(this.cx.sess, sym.proc_macro_hygiene, span, `macro attributes on ${kind} are unstable`).emit();
  }

  // rustc: compiler/rustc_expand/src/expand.rs:1053 parse_ast_fragment
  parse_ast_fragment(toks: TokenStream, kind: AstFragmentKind, path: Path, span: Span): AstFragment {
    const parser = this.cx.new_parser_from_tts(toks);
    const r = parse_ast_fragment(parser, kind);
    if (r.$ === "Ok") {
      const fragment = r._0;
      ensure_complete_parse(parser, path, AstFragmentKind.name(kind), span);
      return fragment;
    } else {
      const err = r._0;
      if (err.deref().span.is_dummy()) {
        err.span(span);
      }
      annotate_err_with_kind(err, kind, span);
      const guar = err.emit_err();
      this.cx.macro_error_and_trace_macros_diag();
      return AstFragmentKind.dummy(kind, span, guar);
    }
  }
}

// PORT: `crate::stats::update_{bang,attr,derive}_macro_stats` (`-Zmacro-stats`): stats.rs is not
// assigned yet; reached only with `-Zmacro-stats`.
function update_bang_macro_stats(_ecx: ExtCtxt, _fragment_kind: AstFragmentKind, _span: Span, _mac: MacCall, _fragment: AstFragment): void {
  unported("rustc_expand::stats::update_bang_macro_stats");
}
function update_attr_macro_stats(
  _ecx: ExtCtxt,
  _fragment_kind: AstFragmentKind,
  _span: Span,
  _path: Path,
  _attr: Attribute,
  _item: Annotatable,
  _fragment: AstFragment,
): void {
  unported("rustc_expand::stats::update_attr_macro_stats");
}
function update_derive_macro_stats(_ecx: ExtCtxt, _fragment_kind: AstFragmentKind, _span: Span, _path: Path, _fragment: AstFragment): void {
  unported("rustc_expand::stats::update_derive_macro_stats");
}
// PORT: `item.clone()` for `-Zmacro-stats` only (`macro_stats.then(|| item.clone())`).
function clone_Annotatable_for_stats(_item: Annotatable): Annotatable {
  return unported("rustc_expand::stats (Annotatable::clone for -Zmacro-stats)");
}

// rustc: compiler/rustc_expand/src/expand.rs:1079 parse_ast_fragment
export function parse_ast_fragment(this_: Parser, kind: AstFragmentKind): PResult<AstFragment> {
  let fragment: AstFragment;
  switch (kind) {
    case "Items": {
      const items: Item[] = [];
      for (;;) {
        const r = this_.parse_item("No", "Yes");
        if (r.$ === "Err") return r;
        const item = r._0;
        if (item === undefined) break;
        items.push(item);
      }
      fragment = { $: "Items", _0: items };
      break;
    }
    case "TraitItems": {
      const items: AssocItem[] = [];
      for (;;) {
        const r = this_.parse_trait_item("No");
        if (r.$ === "Err") return r;
        const item = r._0;
        if (item === undefined) break;
        // PORT: `items.extend(item)` of an `Option`.
        if (item._0 !== undefined) items.push(item._0);
      }
      fragment = { $: "TraitItems", _0: items };
      break;
    }
    case "ImplItems": {
      const items: AssocItem[] = [];
      for (;;) {
        const r = this_.parse_impl_item("No");
        if (r.$ === "Err") return r;
        const item = r._0;
        if (item === undefined) break;
        if (item._0 !== undefined) items.push(item._0);
      }
      fragment = { $: "ImplItems", _0: items };
      break;
    }
    case "TraitImplItems": {
      const items: AssocItem[] = [];
      for (;;) {
        const r = this_.parse_impl_item("No");
        if (r.$ === "Err") return r;
        const item = r._0;
        if (item === undefined) break;
        if (item._0 !== undefined) items.push(item._0);
      }
      fragment = { $: "TraitImplItems", _0: items };
      break;
    }
    case "ForeignItems": {
      const items: ForeignItem[] = [];
      for (;;) {
        const r = this_.parse_foreign_item("No");
        if (r.$ === "Err") return r;
        const item = r._0;
        if (item === undefined) break;
        if (item._0 !== undefined) items.push(item._0);
      }
      fragment = { $: "ForeignItems", _0: items };
      break;
    }
    case "Stmts": {
      const stmts: Stmt[] = [];
      // Won't make progress on a `}`.
      while (!this_.token.eq(TK.Eof) && !this_.token.eq(TK.CloseBrace)) {
        const r = this_.parse_full_stmt("Yes");
        if (r.$ === "Err") return r;
        stmts.push(r._0);
      }
      fragment = { $: "Stmts", _0: stmts };
      break;
    }
    case "Expr": {
      const r = this_.parse_expr();
      if (r.$ === "Err") return r;
      fragment = { $: "Expr", _0: r._0 };
      break;
    }
    case "MethodReceiverExpr": {
      const r = this_.parse_expr();
      if (r.$ === "Err") return r;
      fragment = { $: "MethodReceiverExpr", _0: r._0 };
      break;
    }
    case "OptExpr": {
      if (!this_.token.eq(TK.Eof)) {
        const r = this_.parse_expr();
        if (r.$ === "Err") return r;
        fragment = { $: "OptExpr", _0: r._0 };
      } else {
        fragment = { $: "OptExpr", _0: undefined };
      }
      break;
    }
    case "Ty": {
      const r = this_.parse_ty();
      if (r.$ === "Err") return r;
      fragment = { $: "Ty", _0: r._0 };
      break;
    }
    case "Pat": {
      const r = this_.parse_pat_allow_top_guard(undefined, "No", "Yes", "LikelyTuple");
      if (r.$ === "Err") return r;
      fragment = { $: "Pat", _0: r._0 };
      break;
    }
    case "Crate": {
      const r = this_.parse_crate_mod();
      if (r.$ === "Err") return r;
      fragment = { $: "Crate", _0: r._0 };
      break;
    }
    case "Arms":
    case "ExprFields":
    case "PatFields":
    case "GenericParams":
    case "Params":
    case "FieldDefs":
    case "Variants":
    case "WherePredicates":
      return panic("unexpected AST fragment kind");
  }
  return Ok(fragment);
}

// rustc: compiler/rustc_expand/src/expand.rs:1155 ensure_complete_parse
export function ensure_complete_parse(parser: Parser, macro_path: Path, kind_name: string, span: Span): void {
  if (!parser.token.eq(TK.Eof)) {
    const descr = token_descr(parser.token);
    // Avoid emitting backtrace info twice.
    const def_site_span = Span.with_ctxt(parser.token.span, SyntaxContext.root());

    const semi_span = parser.psess.source_map().next_point(span);
    const snippet = parser.psess.source_map().span_to_snippet(semi_span);
    let add_semicolon: Span | undefined;
    if (snippet.$ === "Ok" && snippet._0.toString() !== ";" && kind_name === "expression") {
      add_semicolon = Span.shrink_to_hi(span);
    } else {
      add_semicolon = undefined;
    }

    const expands_to_match_arm = kind_name === "pattern" && parser.token.eq(TK.FatArrow);

    parser.dcx().emit_err(
      diagnostics.IncompleteParse_diagnostic({
        span: def_site_span,
        descr,
        label_span: span,
        macro_path: pprust.path_to_string(macro_path),
        kind_name,
        expands_to_match_arm,
        add_semicolon,
      }),
    );
  }
}

/// Wraps a call to `walk_*` / `walk_flat_map_*`
/// for an AST node that supports attributes
/// (see the `Annotatable` enum)
/// This method assigns a `NodeId`, and sets that `NodeId`
/// as our current 'lint node id'. If a macro call is found
/// inside this AST node, we will use this AST node's `NodeId`
/// to emit lints associated with that macro (allowing
/// `#[allow]` / `#[deny]` to be applied close to
/// the macro invocation).
///
/// Do *not* call this for a macro AST node
/// (e.g. `ExprKind::MacCall`) - we cannot emit lints
/// at these AST nodes, since they are removed and
/// replaced with the result of macro expansion.
///
/// All other `NodeId`s are assigned by `visit_id`.
/// * `self` is the 'self' parameter for the current method,
/// * `id` is a mutable reference to the `NodeId` field
///    of the current AST node.
/// * `closure` is a closure that executes the
///   `walk_*` / `walk_flat_map_*` method
///   for the current AST node.
// PORT: `macro_rules! assign_id` (expand.rs:1210) -> a function; `$id` is a `MutRef` built by the
// caller (`node_id_mut()` has no side effects, so building it before `next_node_id()` is unobservable).
function assign_id<R>(self_: InvocationCollector, id: MutRef<NodeId>, closure: () => R): R {
  const old_id = self_.cx.current_expansion.lint_node_id;
  if (self_.monotonic) {
    // debug_assert_eq!(*$id, ast::DUMMY_NODE_ID);
    const new_id = self_.cx.resolver.next_node_id();
    id.value = new_id;
    self_.cx.current_expansion.lint_node_id = new_id;
  }
  const ret = closure();
  self_.cx.current_expansion.lint_node_id = old_id;
  return ret;
}

type AddSemicolon = "Yes" | "No";
const AddSemicolon = { Yes: "Yes", No: "No" } as const;

/// A trait implemented for all `AstFragment` nodes and providing all pieces
/// of functionality used by `InvocationCollector`.
// rustc-trait: compiler/rustc_expand/src/expand.rs:1232 InvocationCollectorNode
// PORT: `trait InvocationCollectorNode: HasAttrs + HasNodeId + Sized + DeclaredIdents` -> the table
// type of one impl; `Node` is `Self`, `OutputTy` is `Self::OutputTy` (default `SmallVec<[Self; 1]>`),
// `IK` is `Self::ItemKind` (default `ItemKind`).
interface InvocationCollectorNode<Node, OutputTy, IK = ItemKind> extends HasAttrsT<Node>, HasNodeIdT<Node>, DeclaredIdents<Node> {
  readonly KIND: AstFragmentKind;
  // rustc: compiler/rustc_expand/src/expand.rs:1236 to_annotatable
  to_annotatable(self: Node): Annotatable;
  // rustc: compiler/rustc_expand/src/expand.rs:1237 fragment_to_output
  fragment_to_output(fragment: AstFragment): OutputTy;
  descr(): string; // (provided)
  walk_flat_map(self: Node, collector: InvocationCollector): OutputTy; // (provided)
  walk(self: Node, collector: InvocationCollector): void; // (provided)
  is_mac_call(self: Node): boolean; // (provided)
  take_mac_call(self: Node): [MacCall, AttrVec, AddSemicolon]; // (provided)
  delegation(self: Node): [DelegationMac, Item<IK>] | undefined; // (provided)
  delegation_item_kind(deleg: Delegation): IK; // (provided)
  from_item(item: Item<IK>): Node; // (provided)
  flatten_outputs(outputs: Iterable<OutputTy>): OutputTy; // (provided)
  pre_flat_map_node_collect_attr(cfg: StripUnconfigured, attr: Attribute): void; // (provided)
  // PORT: `_output: &mut Self::OutputTy`: every impl edits a `SmallVec` in place, so the value is passed.
  post_flat_map_node_collect_bang(output: OutputTy, add_semicolon: AddSemicolon): void; // (provided)
  wrap_flat_map_node_walk_flat_map(
    node: Node,
    collector: InvocationCollector,
    walk_flat_map: (node: Node, collector: InvocationCollector) => OutputTy,
  ): Result<OutputTy, Node>; // (provided)
  expand_cfg_false(self: Node, collector: InvocationCollector, pos: number, span: Span): void; // (provided)

  // rustc: compiler/rustc_expand/src/expand.rs:1284 as_target
  as_target(self: Node): Target;
}

/** The bound `Node::OutputTy: Default` of `flat_map_node`. */
interface OutputTyDefault<OutputTy> {
  /** `<Self::OutputTy as Default>::default()` */
  OutputTy_default(): OutputTy;
}
/** The bounds `Node::OutputTy: Into<Node>` and `Node: DummyAstNode` of `visit_node`. */
interface OutputTyInto<Node, OutputTy> extends DummyAstNode<Node> {
  /** `<Self::OutputTy as Into<Self>>::into` */
  OutputTy_into(output: OutputTy): Node;
}

// PORT: the provided fns of `InvocationCollectorNode` (PORTING §8); `this` is the impl's table.
// biome-ignore lint/suspicious/noExplicitAny: the provided fns are shared by every impl table.
type AnyNode = InvocationCollectorNode<any, any, any>;
const InvocationCollectorNode_provided = {
  // rustc: compiler/rustc_expand/src/expand.rs:1238 descr
  descr(): string {
    return unreachable();
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1241 walk_flat_map
  walk_flat_map(_self: unknown, _collector: InvocationCollector): never {
    return unreachable();
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1244 walk
  walk(_self: unknown, _collector: InvocationCollector): void {
    unreachable();
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1247 is_mac_call
  is_mac_call(_self: unknown): boolean {
    return false;
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1250 take_mac_call
  take_mac_call(_self: unknown): [MacCall, AttrVec, AddSemicolon] {
    return unreachable();
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1253 delegation
  delegation(_self: unknown): undefined {
    return undefined;
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1256 delegation_item_kind
  delegation_item_kind(_deleg: Delegation): never {
    return unreachable();
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1259 from_item
  from_item(_item: unknown): never {
    return unreachable();
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1262 flatten_outputs
  flatten_outputs(_outputs: Iterable<unknown>): never {
    return unreachable();
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1265 pre_flat_map_node_collect_attr
  pre_flat_map_node_collect_attr(_cfg: StripUnconfigured, _attr: Attribute): void {},
  // rustc: compiler/rustc_expand/src/expand.rs:1266 post_flat_map_node_collect_bang
  post_flat_map_node_collect_bang(_output: unknown, _add_semicolon: AddSemicolon): void {},
  // rustc: compiler/rustc_expand/src/expand.rs:1268 wrap_flat_map_node_walk_flat_map
  wrap_flat_map_node_walk_flat_map<Node, OutputTy>(
    node: Node,
    collector: InvocationCollector,
    walk_flat_map: (node: Node, collector: InvocationCollector) => OutputTy,
  ): Result<OutputTy, Node> {
    return Ok(walk_flat_map(node, collector));
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1275 expand_cfg_false
  expand_cfg_false(this: AnyNode, _self: unknown, collector: InvocationCollector, _pos: number, span: Span): void {
    collector.cx.dcx().emit_err(diagnostics.RemoveNodeNotSupported_diagnostic({ span, descr: this.descr() }));
  },
};

// rustc-trait: compiler/rustc_expand/src/expand.rs:1287 DeclaredIdents
export interface DeclaredIdents<T> {
  /// All of the identifiers (items) declared by this node.
  /// This is an approximation and should only be used for diagnostics.
  declared_idents(self: T): Ident[]; // (provided)
}
const DeclaredIdents_provided = {
  // rustc: compiler/rustc_expand/src/expand.rs:1290 declared_idents
  declared_idents(_self: unknown): Ident[] {
    return [];
  },
};

// PORT: `macro_rules! declared_idents` (expand.rs:1295) and its invocation: the impls that use the
// default "empty" list of idents (`AstNodeWrapper<Box<AssocItem>, *Tag>`, `Box<ForeignItem>`, `Variant`,
// `WherePredicate`, `FieldDef`, `PatField`, `ExprField`, `Param`, `GenericParam`, `Arm`, `Stmt`, `Crate`,
// `Ty`, `Pat`, `Expr`, `AstNodeWrapper<Box<Expr>, OptExprTag>`, `AstNodeWrapper<Expr, MethodReceiverTag>`)
// spread `DeclaredIdents_provided` into their tables below.

const IC_Item: InvocationCollectorNode<Item, Item[]> & OutputTyDefault<Item[]> = {
  ...InvocationCollectorNode_provided,
  ...HasAttrs.Item,
  ...HasNodeId.Item,
  declared_idents: Item_declared_idents,
  KIND: "Items",
  // rustc: compiler/rustc_expand/src/expand.rs:1326 to_annotatable
  to_annotatable(self: Item): Annotatable {
    return { $: "Item", _0: self };
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1329 fragment_to_output
  fragment_to_output(fragment: AstFragment): Item[] {
    return AstFragment.make_items(fragment);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1332 walk_flat_map
  walk_flat_map(self: Item, collector: InvocationCollector): Item[] {
    return walk_flat_map_item(collector, self);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1335 is_mac_call
  is_mac_call(self: Item): boolean {
    return self.kind.$ === "MacCall";
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1338 take_mac_call
  take_mac_call(self: Item): [MacCall, AttrVec, AddSemicolon] {
    switch (self.kind.$) {
      case "MacCall":
        return [self.kind._0, self.attrs, AddSemicolon.No];
      default:
        return unreachable();
    }
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1344 delegation
  delegation(self: Item): [DelegationMac, Item] | undefined {
    switch (self.kind.$) {
      case "DelegationMac":
        return [self.kind._0, self];
      default:
        return undefined;
    }
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1350 delegation_item_kind
  delegation_item_kind(deleg: Delegation): ItemKind {
    return { $: "Delegation", _0: deleg };
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1353 from_item
  from_item(item: Item): Item {
    return item;
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1356 flatten_outputs
  flatten_outputs(items: Iterable<Item[]>): Item[] {
    return flatten_collect(items);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1359 wrap_flat_map_node_walk_flat_map
  wrap_flat_map_node_walk_flat_map(
    node: Item,
    collector: InvocationCollector,
    walk_flat_map: (node: Item, collector: InvocationCollector) => Item[],
  ): Result<Item[], Item> {
    if (node.kind.$ !== "Mod") {
      return Ok(walk_flat_map(node, collector));
    }

    // `let ItemKind::Mod(_, ident, ref mut mod_kind) = node.kind`
    const node_kind = node.kind;
    const ident = node_kind._1;
    const mod_kind = node_kind._2;
    const ecx = collector.cx;
    let file_path: string | undefined;
    let dir_path: string;
    let dir_ownership: DirOwnership;
    switch (mod_kind.$) {
      case "Loaded": {
        const inline = mod_kind._1;
        // Inline `mod foo { ... }`, but we still need to push directories.
        [dir_path, dir_ownership] = mod_dir_path(
          ecx.sess,
          ident,
          node.attrs,
          ecx.current_expansion.module,
          ecx.current_expansion.dir_ownership,
          inline,
        );
        // If the module was parsed from an external file, recover its path.
        // This lets `parse_external_mod` catch cycles if it's self-referential.
        switch (inline.$) {
          case "Yes":
            file_path = undefined;
            break;
          case "No":
            file_path = mod_file_path_from_attr(ecx.sess, node.attrs, ecx.current_expansion.module.dir_path);
            break;
        }
        break;
      }
      case "Unloaded": {
        // We have an outline `mod foo;` so we need to parse the file.
        const old_attrs_len = node.attrs.length;
        const parsed = parse_external_mod(
          ecx.sess,
          ident,
          node.span,
          ecx.current_expansion.module,
          ecx.current_expansion.dir_ownership,
          node.attrs,
        );
        const { items, spans, had_parse_error } = parsed;

        if (ecx.lint_store !== undefined) {
          ecx.lint_store.pre_expansion_lint(
            ecx.sess,
            ecx.ecfg.features,
            ecx.resolver.registered_lint_tools(),
            ecx.current_expansion.lint_node_id,
            node.attrs,
            items,
            ident.name,
          );
        }

        // `*mod_kind = ModKind::Loaded(items, Inline::No { had_parse_error }, spans);`
        // PORT: module.ts returns `had_parse_error: Result<(), ErrorGuaranteed>` as `Result<undefined, ..>`;
        // a stored `()` is `null` (ast.ts `Inline::No`, codegen convention), so `Ok(())` is rebuilt as `Ok(null)`.
        const had_parse_error_: Result<null, ErrorGuaranteed> = had_parse_error.$ === "Ok" ? Ok(null) : had_parse_error;
        node_kind._2 = { $: "Loaded", _0: items, _1: { $: "No", had_parse_error: had_parse_error_ }, _2: spans };
        if (node.attrs.length > old_attrs_len) {
          // If we loaded an out-of-line module and added some inner attributes,
          // then we need to re-configure it and re-collect attributes for
          // resolution and expansion.
          return Err(node);
        }
        [file_path, dir_path, dir_ownership] = [parsed.file_path, parsed.dir_path, parsed.dir_ownership];
        break;
      }
    }

    // Set the module info before we flat map.
    const module = ecx.current_expansion.module.with_dir_path(dir_path);
    module.mod_path.push(ident);
    if (file_path !== undefined) {
      module.file_path_stack.push(file_path);
    }

    const orig_module = ecx.current_expansion.module;
    ecx.current_expansion.module = module;
    const orig_dir_ownership = ecx.current_expansion.dir_ownership;
    ecx.current_expansion.dir_ownership = dir_ownership;

    const res = Ok(walk_flat_map(node, collector));

    collector.cx.current_expansion.dir_ownership = orig_dir_ownership;
    collector.cx.current_expansion.module = orig_module;
    return res;
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1453 as_target
  as_target(self: Item): Target {
    return Target.from_ast_item(self);
  },
  OutputTy_default: () => [],
};

// `impl DeclaredIdents for Box<ast::Item>`
// rustc: compiler/rustc_expand/src/expand.rs:1459 declared_idents
function Item_declared_idents(self: Item): Ident[] {
  if (self.kind.$ === "Use") {
    const ut = self.kind._0;
    // rustc: compiler/rustc_expand/src/expand.rs:1461 collect_use_tree_leaves
    function collect_use_tree_leaves(ut: UseTree, idents: Ident[]): void {
      switch (ut.kind.$) {
        case "Glob":
          break;
        case "Simple":
          idents.push(ut.ident());
          break;
        case "Nested":
          for (const tree of ut.kind.items) {
            collect_use_tree_leaves(tree.inner, idents);
          }
          break;
      }
    }
    const idents: Ident[] = [];
    collect_use_tree_leaves(ut, idents);
    return idents;
  } else {
    // `self.kind.ident().into_iter().collect()`
    const ident = ItemKind.ident(self.kind);
    return ident === undefined ? [] : [ident];
  }
}

// PORT: `items.flatten().collect()` of `flatten_outputs` (lazy: each output is produced while flattening).
function flatten_collect<T>(items: Iterable<T[]>): T[] {
  const out: T[] = [];
  for (const output of items) out.push(...output);
  return out;
}

// PORT: `Iterator::map` over a lazy iterator.
function* map_iter<T, U>(it: Iterable<T>, f: (v: T) => U): Generator<U, void, undefined> {
  for (const v of it) yield f(v);
}

// struct TraitItemTag;
type TraitItemTag = { readonly __tag: "TraitItemTag" };
const TraitItemTag: TraitItemTag = Object.freeze({ __tag: "TraitItemTag" as const });
type TraitItemNode = AstNodeWrapper<AssocItem, TraitItemTag>;
const IC_TraitItem: InvocationCollectorNode<TraitItemNode, AssocItem[], AssocItemKind> & OutputTyDefault<AssocItem[]> = {
  ...InvocationCollectorNode_provided,
  ...HasAttrs.AstNodeWrapper<AssocItem, TraitItemTag>(HasAttrs.AssocItem),
  ...HasNodeId.AstNodeWrapper<AssocItem, TraitItemTag>(HasNodeId.AssocItem),
  ...DeclaredIdents_provided,
  KIND: "TraitItems",
  // rustc: compiler/rustc_expand/src/expand.rs:1486 to_annotatable
  to_annotatable(self: TraitItemNode): Annotatable {
    return { $: "AssocItem", _0: self.wrapped, _1: AssocCtxt_Trait };
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1489 fragment_to_output
  fragment_to_output(fragment: AstFragment): AssocItem[] {
    return AstFragment.make_trait_items(fragment);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1492 walk_flat_map
  walk_flat_map(self: TraitItemNode, collector: InvocationCollector): AssocItem[] {
    return walk_flat_map_assoc_item(collector, self.wrapped, AssocCtxt_Trait);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1495 is_mac_call
  is_mac_call(self: TraitItemNode): boolean {
    return self.wrapped.kind.$ === "MacCall";
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1498 take_mac_call
  take_mac_call(self: TraitItemNode): [MacCall, AttrVec, AddSemicolon] {
    const item = self.wrapped;
    switch (item.kind.$) {
      case "MacCall":
        return [item.kind._0, item.attrs, AddSemicolon.No];
      default:
        return unreachable();
    }
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1505 delegation
  delegation(self: TraitItemNode): [DelegationMac, AssocItem] | undefined {
    switch (self.wrapped.kind.$) {
      case "DelegationMac":
        return [self.wrapped.kind._0, self.wrapped];
      default:
        return undefined;
    }
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1511 delegation_item_kind
  delegation_item_kind(deleg: Delegation): AssocItemKind {
    return { $: "Delegation", _0: deleg };
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1514 from_item
  from_item(item: AssocItem): TraitItemNode {
    return AstNodeWrapper.new(item, TraitItemTag);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1517 flatten_outputs
  flatten_outputs(items: Iterable<AssocItem[]>): AssocItem[] {
    return flatten_collect(items);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1520 as_target
  as_target(self: TraitItemNode): Target {
    return Target.from_assoc_item_kind(self.wrapped.kind, AssocCtxt_Trait);
  },
  OutputTy_default: () => [],
};

// struct ImplItemTag;
type ImplItemTag = { readonly __tag: "ImplItemTag" };
const ImplItemTag: ImplItemTag = Object.freeze({ __tag: "ImplItemTag" as const });
type ImplItemNode = AstNodeWrapper<AssocItem, ImplItemTag>;
const IC_ImplItem: InvocationCollectorNode<ImplItemNode, AssocItem[], AssocItemKind> & OutputTyDefault<AssocItem[]> = {
  ...InvocationCollectorNode_provided,
  ...HasAttrs.AstNodeWrapper<AssocItem, ImplItemTag>(HasAttrs.AssocItem),
  ...HasNodeId.AstNodeWrapper<AssocItem, ImplItemTag>(HasNodeId.AssocItem),
  ...DeclaredIdents_provided,
  KIND: "ImplItems",
  // rustc: compiler/rustc_expand/src/expand.rs:1530 to_annotatable
  to_annotatable(self: ImplItemNode): Annotatable {
    return { $: "AssocItem", _0: self.wrapped, _1: { $: "Impl", of_trait: false } };
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1533 fragment_to_output
  fragment_to_output(fragment: AstFragment): AssocItem[] {
    return AstFragment.make_impl_items(fragment);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1536 walk_flat_map
  walk_flat_map(self: ImplItemNode, collector: InvocationCollector): AssocItem[] {
    return walk_flat_map_assoc_item(collector, self.wrapped, { $: "Impl", of_trait: false });
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1539 is_mac_call
  is_mac_call(self: ImplItemNode): boolean {
    return self.wrapped.kind.$ === "MacCall";
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1542 take_mac_call
  take_mac_call(self: ImplItemNode): [MacCall, AttrVec, AddSemicolon] {
    const item = self.wrapped;
    switch (item.kind.$) {
      case "MacCall":
        return [item.kind._0, item.attrs, AddSemicolon.No];
      default:
        return unreachable();
    }
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1549 delegation
  delegation(self: ImplItemNode): [DelegationMac, AssocItem] | undefined {
    switch (self.wrapped.kind.$) {
      case "DelegationMac":
        return [self.wrapped.kind._0, self.wrapped];
      default:
        return undefined;
    }
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1555 delegation_item_kind
  delegation_item_kind(deleg: Delegation): AssocItemKind {
    return { $: "Delegation", _0: deleg };
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1558 from_item
  from_item(item: AssocItem): ImplItemNode {
    return AstNodeWrapper.new(item, ImplItemTag);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1561 flatten_outputs
  flatten_outputs(items: Iterable<AssocItem[]>): AssocItem[] {
    return flatten_collect(items);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1564 as_target
  as_target(self: ImplItemNode): Target {
    return Target.from_assoc_item_kind(self.wrapped.kind, { $: "Impl", of_trait: false });
  },
  OutputTy_default: () => [],
};

// struct TraitImplItemTag;
type TraitImplItemTag = { readonly __tag: "TraitImplItemTag" };
const TraitImplItemTag: TraitImplItemTag = Object.freeze({ __tag: "TraitImplItemTag" as const });
type TraitImplItemNode = AstNodeWrapper<AssocItem, TraitImplItemTag>;
const IC_TraitImplItem: InvocationCollectorNode<TraitImplItemNode, AssocItem[], AssocItemKind> & OutputTyDefault<AssocItem[]> = {
  ...InvocationCollectorNode_provided,
  ...HasAttrs.AstNodeWrapper<AssocItem, TraitImplItemTag>(HasAttrs.AssocItem),
  ...HasNodeId.AstNodeWrapper<AssocItem, TraitImplItemTag>(HasNodeId.AssocItem),
  ...DeclaredIdents_provided,
  KIND: "TraitImplItems",
  // rustc: compiler/rustc_expand/src/expand.rs:1574 to_annotatable
  to_annotatable(self: TraitImplItemNode): Annotatable {
    return { $: "AssocItem", _0: self.wrapped, _1: { $: "Impl", of_trait: true } };
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1577 fragment_to_output
  fragment_to_output(fragment: AstFragment): AssocItem[] {
    return AstFragment.make_trait_impl_items(fragment);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1580 walk_flat_map
  walk_flat_map(self: TraitImplItemNode, collector: InvocationCollector): AssocItem[] {
    return walk_flat_map_assoc_item(collector, self.wrapped, { $: "Impl", of_trait: true });
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1583 is_mac_call
  is_mac_call(self: TraitImplItemNode): boolean {
    return self.wrapped.kind.$ === "MacCall";
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1586 take_mac_call
  take_mac_call(self: TraitImplItemNode): [MacCall, AttrVec, AddSemicolon] {
    const item = self.wrapped;
    switch (item.kind.$) {
      case "MacCall":
        return [item.kind._0, item.attrs, AddSemicolon.No];
      default:
        return unreachable();
    }
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1593 delegation
  delegation(self: TraitImplItemNode): [DelegationMac, AssocItem] | undefined {
    switch (self.wrapped.kind.$) {
      case "DelegationMac":
        return [self.wrapped.kind._0, self.wrapped];
      default:
        return undefined;
    }
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1599 delegation_item_kind
  delegation_item_kind(deleg: Delegation): AssocItemKind {
    return { $: "Delegation", _0: deleg };
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1602 from_item
  from_item(item: AssocItem): TraitImplItemNode {
    return AstNodeWrapper.new(item, TraitImplItemTag);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1605 flatten_outputs
  flatten_outputs(items: Iterable<AssocItem[]>): AssocItem[] {
    return flatten_collect(items);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1608 as_target
  as_target(self: TraitImplItemNode): Target {
    return Target.from_assoc_item_kind(self.wrapped.kind, { $: "Impl", of_trait: true });
  },
  OutputTy_default: () => [],
};

const IC_ForeignItem: InvocationCollectorNode<ForeignItem, ForeignItem[], ForeignItemKind> & OutputTyDefault<ForeignItem[]> = {
  ...InvocationCollectorNode_provided,
  ...HasAttrs.ForeignItem,
  ...HasNodeId.ForeignItem,
  ...DeclaredIdents_provided,
  KIND: "ForeignItems",
  // rustc: compiler/rustc_expand/src/expand.rs:1615 to_annotatable
  to_annotatable(self: ForeignItem): Annotatable {
    return { $: "ForeignItem", _0: self };
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1618 fragment_to_output
  fragment_to_output(fragment: AstFragment): ForeignItem[] {
    return AstFragment.make_foreign_items(fragment);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1621 walk_flat_map
  walk_flat_map(self: ForeignItem, collector: InvocationCollector): ForeignItem[] {
    return walk_flat_map_foreign_item(collector, self);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1624 is_mac_call
  is_mac_call(self: ForeignItem): boolean {
    return self.kind.$ === "MacCall";
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1627 take_mac_call
  take_mac_call(self: ForeignItem): [MacCall, AttrVec, AddSemicolon] {
    switch (self.kind.$) {
      case "MacCall":
        return [self.kind._0, self.attrs, AddSemicolon.No];
      default:
        return unreachable();
    }
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1633 as_target
  as_target(self: ForeignItem): Target {
    switch (self.kind.$) {
      case "Static":
        return Target.ForeignStatic;
      case "Fn":
        return Target.ForeignFn;
      case "TyAlias":
        return Target.ForeignTy;
      case "MacCall":
        return Target.MacroCall;
    }
  },
  OutputTy_default: () => [],
};

const IC_Variant: InvocationCollectorNode<Variant, Variant[]> & OutputTyDefault<Variant[]> = {
  ...InvocationCollectorNode_provided,
  ...HasAttrs.Variant,
  ...HasNodeId.Variant,
  ...DeclaredIdents_provided,
  KIND: "Variants",
  // rustc: compiler/rustc_expand/src/expand.rs:1645 to_annotatable
  to_annotatable(self: Variant): Annotatable {
    return { $: "Variant", _0: self };
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1648 fragment_to_output
  fragment_to_output(fragment: AstFragment): Variant[] {
    return AstFragment.make_variants(fragment);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1651 walk_flat_map
  walk_flat_map(self: Variant, collector: InvocationCollector): Variant[] {
    return walk_flat_map_variant(collector, self);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1654 as_target
  as_target(_self: Variant): Target {
    return Target.Variant;
  },
  OutputTy_default: () => [],
};

const IC_WherePredicate: InvocationCollectorNode<WherePredicate, WherePredicate[]> & OutputTyDefault<WherePredicate[]> = {
  ...InvocationCollectorNode_provided,
  ...HasAttrs.WherePredicate,
  ...HasNodeId.WherePredicate,
  ...DeclaredIdents_provided,
  KIND: "WherePredicates",
  // rustc: compiler/rustc_expand/src/expand.rs:1661 to_annotatable
  to_annotatable(self: WherePredicate): Annotatable {
    return { $: "WherePredicate", _0: self };
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1664 fragment_to_output
  fragment_to_output(fragment: AstFragment): WherePredicate[] {
    return AstFragment.make_where_predicates(fragment);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1667 walk_flat_map
  walk_flat_map(self: WherePredicate, collector: InvocationCollector): WherePredicate[] {
    return walk_flat_map_where_predicate(collector, self);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1670 as_target
  as_target(_self: WherePredicate): Target {
    return Target.WherePredicate;
  },
  OutputTy_default: () => [],
};

const IC_FieldDef: InvocationCollectorNode<FieldDef, FieldDef[]> & OutputTyDefault<FieldDef[]> = {
  ...InvocationCollectorNode_provided,
  ...HasAttrs.FieldDef,
  ...HasNodeId.FieldDef,
  ...DeclaredIdents_provided,
  KIND: "FieldDefs",
  // rustc: compiler/rustc_expand/src/expand.rs:1677 to_annotatable
  to_annotatable(self: FieldDef): Annotatable {
    return { $: "FieldDef", _0: self };
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1680 fragment_to_output
  fragment_to_output(fragment: AstFragment): FieldDef[] {
    return AstFragment.make_field_defs(fragment);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1683 walk_flat_map
  walk_flat_map(self: FieldDef, collector: InvocationCollector): FieldDef[] {
    return walk_flat_map_field_def(collector, self);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1686 as_target
  as_target(_self: FieldDef): Target {
    return Target.Field;
  },
  OutputTy_default: () => [],
};

const IC_PatField: InvocationCollectorNode<PatField, PatField[]> & OutputTyDefault<PatField[]> = {
  ...InvocationCollectorNode_provided,
  ...HasAttrs.PatField,
  ...HasNodeId.PatField,
  ...DeclaredIdents_provided,
  KIND: "PatFields",
  // rustc: compiler/rustc_expand/src/expand.rs:1693 to_annotatable
  to_annotatable(self: PatField): Annotatable {
    return { $: "PatField", _0: self };
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1696 fragment_to_output
  fragment_to_output(fragment: AstFragment): PatField[] {
    return AstFragment.make_pat_fields(fragment);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1699 walk_flat_map
  walk_flat_map(self: PatField, collector: InvocationCollector): PatField[] {
    return walk_flat_map_pat_field(collector, self);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1702 as_target
  as_target(_self: PatField): Target {
    return Target.PatField;
  },
  OutputTy_default: () => [],
};

const IC_ExprField: InvocationCollectorNode<ExprField, ExprField[]> & OutputTyDefault<ExprField[]> = {
  ...InvocationCollectorNode_provided,
  ...HasAttrs.ExprField,
  ...HasNodeId.ExprField,
  ...DeclaredIdents_provided,
  KIND: "ExprFields",
  // rustc: compiler/rustc_expand/src/expand.rs:1709 to_annotatable
  to_annotatable(self: ExprField): Annotatable {
    return { $: "ExprField", _0: self };
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1712 fragment_to_output
  fragment_to_output(fragment: AstFragment): ExprField[] {
    return AstFragment.make_expr_fields(fragment);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1715 walk_flat_map
  walk_flat_map(self: ExprField, collector: InvocationCollector): ExprField[] {
    return walk_flat_map_expr_field(collector, self);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1718 as_target
  as_target(_self: ExprField): Target {
    return Target.ExprField;
  },
  OutputTy_default: () => [],
};

const IC_Param: InvocationCollectorNode<Param, Param[]> & OutputTyDefault<Param[]> = {
  ...InvocationCollectorNode_provided,
  ...HasAttrs.Param,
  ...HasNodeId.Param,
  ...DeclaredIdents_provided,
  KIND: "Params",
  // rustc: compiler/rustc_expand/src/expand.rs:1725 to_annotatable
  to_annotatable(self: Param): Annotatable {
    return { $: "Param", _0: self };
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1728 fragment_to_output
  fragment_to_output(fragment: AstFragment): Param[] {
    return AstFragment.make_params(fragment);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1731 walk_flat_map
  walk_flat_map(self: Param, collector: InvocationCollector): Param[] {
    return walk_flat_map_param(collector, self);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1734 as_target
  as_target(_self: Param): Target {
    return Target.Param;
  },
  OutputTy_default: () => [],
};

const IC_GenericParam: InvocationCollectorNode<GenericParam, GenericParam[]> & OutputTyDefault<GenericParam[]> = {
  ...InvocationCollectorNode_provided,
  ...HasAttrs.GenericParam,
  ...HasNodeId.GenericParam,
  ...DeclaredIdents_provided,
  KIND: "GenericParams",
  // rustc: compiler/rustc_expand/src/expand.rs:1741 to_annotatable
  to_annotatable(self: GenericParam): Annotatable {
    return { $: "GenericParam", _0: self };
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1744 fragment_to_output
  fragment_to_output(fragment: AstFragment): GenericParam[] {
    return AstFragment.make_generic_params(fragment);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1747 walk_flat_map
  walk_flat_map(self: GenericParam, collector: InvocationCollector): GenericParam[] {
    return walk_flat_map_generic_param(collector, self);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1750 as_target
  as_target(self: GenericParam): Target {
    switch (self.kind.$) {
      case "Lifetime":
        return Target.LifetimeParam;
      case "Type":
        return Target.TypeParam;
      case "Const":
        return Target.ConstParam;
    }
  },
  OutputTy_default: () => [],
};

const IC_Arm: InvocationCollectorNode<Arm, Arm[]> & OutputTyDefault<Arm[]> = {
  ...InvocationCollectorNode_provided,
  ...HasAttrs.Arm,
  ...HasNodeId.Arm,
  ...DeclaredIdents_provided,
  KIND: "Arms",
  // rustc: compiler/rustc_expand/src/expand.rs:1761 to_annotatable
  to_annotatable(self: Arm): Annotatable {
    return { $: "Arm", _0: self };
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1764 fragment_to_output
  fragment_to_output(fragment: AstFragment): Arm[] {
    return AstFragment.make_arms(fragment);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1767 walk_flat_map
  walk_flat_map(self: Arm, collector: InvocationCollector): Arm[] {
    return walk_flat_map_arm(collector, self);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1770 as_target
  as_target(_self: Arm): Target {
    return Target.Arm;
  },
  OutputTy_default: () => [],
};

const IC_Stmt: InvocationCollectorNode<Stmt, Stmt[]> & OutputTyDefault<Stmt[]> = {
  ...InvocationCollectorNode_provided,
  ...HasAttrs.Stmt,
  // PORT: `HasAttrs.Stmt.SUPPORTS_CUSTOM_INNER_ATTRS` is a getter (ast_traits.ts); the spread copies its value.
  ...HasNodeId.Stmt,
  ...DeclaredIdents_provided,
  KIND: "Stmts",
  // rustc: compiler/rustc_expand/src/expand.rs:1777 to_annotatable
  to_annotatable(self: Stmt): Annotatable {
    return { $: "Stmt", _0: self };
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1780 fragment_to_output
  fragment_to_output(fragment: AstFragment): Stmt[] {
    return AstFragment.make_stmts(fragment);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1783 walk_flat_map
  walk_flat_map(self: Stmt, collector: InvocationCollector): Stmt[] {
    return walk_flat_map_stmt(collector, self);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1786 is_mac_call
  is_mac_call(self: Stmt): boolean {
    const kind = self.kind;
    switch (kind.$) {
      case "MacCall":
        return true;
      case "Item":
        return kind._0.kind.$ === "MacCall";
      case "Semi":
        return kind._0.kind.$ === "MacCall";
      case "Expr":
        return unreachable();
      case "Let":
      case "Empty":
        return false;
    }
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1795 take_mac_call
  take_mac_call(self: Stmt): [MacCall, AttrVec, AddSemicolon] {
    // We pull macro invocations (both attributes and fn-like macro calls) out of their
    // `StmtKind`s and treat them as statement macro invocations, not as items or expressions.
    let add_semicolon: boolean;
    let mac: MacCall;
    let attrs: AttrVec;
    const kind: StmtKind = self.kind;
    switch (kind.$) {
      case "MacCall": {
        const { mac: mac_, style, attrs: attrs_ } = kind._0;
        [add_semicolon, mac, attrs] = [style === "Semicolon", mac_, attrs_];
        break;
      }
      case "Item": {
        const item = kind._0;
        if (item.kind.$ !== "MacCall") return unreachable();
        const mac_ = item.kind._0;
        [add_semicolon, mac, attrs] = [mac_.args.need_semicolon(), mac_, item.attrs];
        break;
      }
      case "Semi": {
        const expr = kind._0;
        if (expr.kind.$ !== "MacCall") return unreachable();
        const mac_ = expr.kind._0;
        [add_semicolon, mac, attrs] = [mac_.args.need_semicolon(), mac_, expr.attrs];
        break;
      }
      default:
        return unreachable();
    }
    return [mac, attrs, add_semicolon ? AddSemicolon.Yes : AddSemicolon.No];
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1819 delegation
  delegation(self: Stmt): [DelegationMac, Item] | undefined {
    const kind = self.kind;
    switch (kind.$) {
      case "Item": {
        const item = kind._0;
        switch (item.kind.$) {
          case "DelegationMac":
            return [item.kind._0, item];
          default:
            return undefined;
        }
      }
      default:
        return undefined;
    }
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1828 delegation_item_kind
  delegation_item_kind(deleg: Delegation): ItemKind {
    return { $: "Delegation", _0: deleg };
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1831 from_item
  from_item(item: Item): Stmt {
    return new Stmt(DUMMY_NODE_ID, { $: "Item", _0: item }, item.span);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1834 flatten_outputs
  flatten_outputs(items: Iterable<Stmt[]>): Stmt[] {
    return flatten_collect(items);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1837 post_flat_map_node_collect_bang
  post_flat_map_node_collect_bang(stmts: Stmt[], add_semicolon: AddSemicolon): void {
    // If this is a macro invocation with a semicolon, then apply that
    // semicolon to the final statement produced by expansion.
    if (add_semicolon === "Yes") {
      const stmt = stmts.pop();
      if (stmt !== undefined) {
        stmts.push(stmt.add_trailing_semicolon());
      }
    }
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1846 as_target
  as_target(_self: Stmt): Target {
    return Target.Statement;
  },
  OutputTy_default: () => [],
};

const IC_Crate: InvocationCollectorNode<Crate, Crate> & OutputTyInto<Crate, Crate> = {
  ...InvocationCollectorNode_provided,
  ...HasAttrs.Crate,
  ...HasNodeId.Crate,
  ...DeclaredIdents_provided,
  KIND: "Crate",
  // rustc: compiler/rustc_expand/src/expand.rs:1854 to_annotatable
  to_annotatable(self: Crate): Annotatable {
    return { $: "Crate", _0: self };
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1857 fragment_to_output
  fragment_to_output(fragment: AstFragment): Crate {
    return AstFragment.make_crate(fragment);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1860 walk
  walk(self: Crate, collector: InvocationCollector): void {
    walk_crate(collector, self);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1863 expand_cfg_false
  expand_cfg_false(self: Crate, collector: InvocationCollector, pos: number, _span: Span): void {
    // Attributes above `cfg(FALSE)` are left in place, because we may want to configure
    // some global crate properties even on fully unconfigured crates.
    truncate(self.attrs, pos);
    // Standard prelude imports are left in the crate for backward compatibility.
    truncate(self.items, collector.cx.num_standard_library_imports);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1875 as_target
  as_target(_self: Crate): Target {
    return Target.Crate;
  },
  dummy: Crate_dummy,
  OutputTy_into: (output: Crate): Crate => output,
};

// PORT: `Vec::truncate`.
function truncate<T>(v: T[], len: number): void {
  if (len < v.length) v.length = len;
}

const IC_Ty: InvocationCollectorNode<Ty, Ty> & OutputTyInto<Ty, Ty> = {
  ...InvocationCollectorNode_provided,
  ...HasAttrs.Ty,
  ...HasNodeId.Ty,
  ...DeclaredIdents_provided,
  KIND: "Ty",
  // rustc: compiler/rustc_expand/src/expand.rs:1883 to_annotatable
  to_annotatable(_self: Ty): Annotatable {
    return unreachable();
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1886 fragment_to_output
  fragment_to_output(fragment: AstFragment): Ty {
    return AstFragment.make_ty(fragment);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1889 walk
  walk(self: Ty, collector: InvocationCollector): void {
    // Save the pre-expanded name of this `ImplTrait`, so that later when defining
    // an APIT we use a name that doesn't have any placeholder fragments in it.
    if (self.kind.$ === "ImplTrait") {
      // HACK: pprust breaks strings with newlines when the type
      // gets too long. We don't want these to show up in compiler
      // output or built artifacts, so replace them here...
      // Perhaps we should instead format APITs more robustly.
      const name = Symbol.intern(pprust.ty_to_string(self).replaceAll("\n", " "));
      collector.cx.resolver.insert_impl_trait_name(self.id, name);
    }
    walk_ty(collector, self);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1902 is_mac_call
  is_mac_call(self: Ty): boolean {
    return self.kind.$ === "MacCall";
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1905 take_mac_call
  take_mac_call(self: Ty): [MacCall, AttrVec, AddSemicolon] {
    switch (self.kind.$) {
      case "MacCall":
        return [self.kind._0, [], AddSemicolon.No];
      default:
        return unreachable();
    }
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1911 as_target
  as_target(_self: Ty): Target {
    // This is only used for attribute parsing, which are not allowed on types.
    return unreachable();
  },
  dummy: Ty_dummy,
  // PORT: `Box<Ty>: Into<Ty>` (`Box<T>` is `T`).
  OutputTy_into: (output: Ty): Ty => output,
};

const IC_Pat: InvocationCollectorNode<Pat, Pat> & OutputTyInto<Pat, Pat> = {
  ...InvocationCollectorNode_provided,
  ...HasAttrs.Pat,
  ...HasNodeId.Pat,
  ...DeclaredIdents_provided,
  KIND: "Pat",
  // rustc: compiler/rustc_expand/src/expand.rs:1920 to_annotatable
  to_annotatable(_self: Pat): Annotatable {
    return unreachable();
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1923 fragment_to_output
  fragment_to_output(fragment: AstFragment): Pat {
    return AstFragment.make_pat(fragment);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1926 walk
  walk(self: Pat, collector: InvocationCollector): void {
    walk_pat(collector, self);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1929 is_mac_call
  is_mac_call(self: Pat): boolean {
    return self.kind.$ === "MacCall";
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1932 take_mac_call
  take_mac_call(self: Pat): [MacCall, AttrVec, AddSemicolon] {
    switch (self.kind.$) {
      case "MacCall":
        return [self.kind._0, [], AddSemicolon.No];
      default:
        return unreachable();
    }
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1938 as_target
  as_target(_self: Pat): Target {
    // PORT: `unimplemented!()` -> its panic text.
    return panic("not implemented");
  },
  dummy: Pat_dummy,
  // PORT: `Box<Pat>: Into<Pat>` (`Box<T>` is `T`).
  OutputTy_into: (output: Pat): Pat => output,
};

const IC_Expr: InvocationCollectorNode<Expr, Expr> & OutputTyInto<Expr, Expr> = {
  ...InvocationCollectorNode_provided,
  ...HasAttrs.Expr,
  ...HasNodeId.Expr,
  ...DeclaredIdents_provided,
  KIND: "Expr",
  // rustc: compiler/rustc_expand/src/expand.rs:1946 to_annotatable
  to_annotatable(self: Expr): Annotatable {
    return { $: "Expr", _0: self };
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1949 fragment_to_output
  fragment_to_output(fragment: AstFragment): Expr {
    return AstFragment.make_expr(fragment);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1952 descr
  descr(): string {
    return "an expression";
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1955 walk
  walk(self: Expr, collector: InvocationCollector): void {
    walk_expr(collector, self);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1958 is_mac_call
  is_mac_call(self: Expr): boolean {
    return self.kind.$ === "MacCall";
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1961 take_mac_call
  take_mac_call(self: Expr): [MacCall, AttrVec, AddSemicolon] {
    switch (self.kind.$) {
      case "MacCall":
        return [self.kind._0, self.attrs, AddSemicolon.No];
      default:
        return unreachable();
    }
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1967 as_target
  as_target(_self: Expr): Target {
    return Target.Expression;
  },
  dummy: Expr_dummy,
  // PORT: `Box<Expr>: Into<Expr>` (`Box<T>` is `T`).
  OutputTy_into: (output: Expr): Expr => output,
};

// struct OptExprTag;
type OptExprTag = { readonly __tag: "OptExprTag" };
const OptExprTag: OptExprTag = Object.freeze({ __tag: "OptExprTag" as const });
type OptExprNode = AstNodeWrapper<Expr, OptExprTag>;
const IC_OptExpr: InvocationCollectorNode<OptExprNode, Expr | undefined> & OutputTyDefault<Expr | undefined> = {
  ...InvocationCollectorNode_provided,
  ...HasAttrs.AstNodeWrapper<Expr, OptExprTag>(HasAttrs.Expr),
  ...HasNodeId.AstNodeWrapper<Expr, OptExprTag>(HasNodeId.Expr),
  ...DeclaredIdents_provided,
  KIND: "OptExpr",
  // rustc: compiler/rustc_expand/src/expand.rs:1976 to_annotatable
  to_annotatable(self: OptExprNode): Annotatable {
    return { $: "Expr", _0: self.wrapped };
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1979 fragment_to_output
  fragment_to_output(fragment: AstFragment): Expr | undefined {
    return AstFragment.make_opt_expr(fragment);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1982 walk_flat_map
  walk_flat_map(self: OptExprNode, collector: InvocationCollector): Expr | undefined {
    walk_expr(collector, self.wrapped);
    return self.wrapped;
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1986 is_mac_call
  is_mac_call(self: OptExprNode): boolean {
    return self.wrapped.kind.$ === "MacCall";
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1989 take_mac_call
  take_mac_call(self: OptExprNode): [MacCall, AttrVec, AddSemicolon] {
    const node = self.wrapped;
    switch (node.kind.$) {
      case "MacCall":
        return [node.kind._0, node.attrs, AddSemicolon.No];
      default:
        return unreachable();
    }
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1996 pre_flat_map_node_collect_attr
  pre_flat_map_node_collect_attr(cfg: StripUnconfigured, attr: Attribute): void {
    cfg.maybe_emit_expr_attr_err(attr);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:1999 as_target
  as_target(_self: OptExprNode): Target {
    return Target.Expression;
  },
  OutputTy_default: () => undefined,
};

/// This struct is a hack to workaround unstable of `stmt_expr_attributes`.
/// It can be removed once that feature is stabilized.
type MethodReceiverTag = { readonly __tag: "MethodReceiverTag" };
const MethodReceiverTag: MethodReceiverTag = Object.freeze({ __tag: "MethodReceiverTag" as const });
type MethodReceiverNode = AstNodeWrapper<Expr, MethodReceiverTag>;

const IC_MethodReceiver: InvocationCollectorNode<MethodReceiverNode, MethodReceiverNode> &
  OutputTyInto<MethodReceiverNode, MethodReceiverNode> = {
  ...InvocationCollectorNode_provided,
  ...HasAttrs.AstNodeWrapper<Expr, MethodReceiverTag>(HasAttrs.Expr),
  ...HasNodeId.AstNodeWrapper<Expr, MethodReceiverTag>(HasNodeId.Expr),
  ...DeclaredIdents_provided,
  KIND: "MethodReceiverExpr",
  // rustc: compiler/rustc_expand/src/expand.rs:2011 descr
  descr(): string {
    return "an expression";
  },
  // rustc: compiler/rustc_expand/src/expand.rs:2014 to_annotatable
  to_annotatable(self: MethodReceiverNode): Annotatable {
    return { $: "Expr", _0: self.wrapped };
  },
  // rustc: compiler/rustc_expand/src/expand.rs:2017 fragment_to_output
  fragment_to_output(fragment: AstFragment): MethodReceiverNode {
    return AstNodeWrapper.new(AstFragment.make_method_receiver_expr(fragment), MethodReceiverTag);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:2020 walk
  walk(self: MethodReceiverNode, collector: InvocationCollector): void {
    walk_expr(collector, self.wrapped);
  },
  // rustc: compiler/rustc_expand/src/expand.rs:2023 is_mac_call
  is_mac_call(self: MethodReceiverNode): boolean {
    return self.wrapped.kind.$ === "MacCall";
  },
  // rustc: compiler/rustc_expand/src/expand.rs:2026 take_mac_call
  take_mac_call(self: MethodReceiverNode): [MacCall, AttrVec, AddSemicolon] {
    const node = self.wrapped;
    switch (node.kind.$) {
      case "MacCall":
        return [node.kind._0, node.attrs, AddSemicolon.No];
      default:
        return unreachable();
    }
  },
  // rustc: compiler/rustc_expand/src/expand.rs:2033 as_target
  as_target(_self: MethodReceiverNode): Target {
    return Target.Expression;
  },
  dummy: MethodReceiver_dummy,
  // PORT: `AstNodeWrapper<Box<Expr>, Tag>: Into<AstNodeWrapper<Expr, Tag>>` (ast_traits.rs:340 `from`).
  OutputTy_into: (output: MethodReceiverNode): MethodReceiverNode => AstNodeWrapper.from(output),
};

const AssocCtxt_Trait: AssocCtxt = { $: "Trait" };
const DelegationSource_Glob: DelegationSource = { $: "Glob" };

// rustc: compiler/rustc_expand/src/expand.rs:2038 build_single_delegations
// PORT: returns a lazy iterator as upstream (`impl Iterator`); the `suffixes.is_empty()` check runs
// at call time, the per-suffix items are built as the caller pulls them.
function build_single_delegations<Node, O, IK>(
  _Node: InvocationCollectorNode<Node, O, IK>,
  ecx: ExtCtxt,
  deleg: DelegationMac,
  item: Item<IK>,
  suffixes: readonly [Ident, Ident | undefined][],
  item_span: Span,
  source: DelegationSource,
): Iterable<Item<IK>> {
  // debug_assert_ne!(source, DelegationSource::Single);

  const from_glob = source.$ === "Glob";

  if (suffixes.length === 0) {
    // Report an error for now, to avoid keeping stem for resolution and
    // stability checks.
    const kind = from_glob ? "glob" : "list";
    ecx.dcx().emit_err(diagnostics.EmptyDelegationMac_diagnostic({ span: item.span, kind }));
  }

  return map_iter(suffixes, ([ident, rename]) => {
    const path = clone_Path(deleg.prefix);
    path.segments.push(new PathSegment(ident, DUMMY_NODE_ID, undefined));

    return new Item<IK>(
      item.attrs.map(clone_Attribute),
      DUMMY_NODE_ID,
      from_glob ? item_span : ident.span,
      clone_Visibility(item.vis),
      _Node.delegation_item_kind(
        new Delegation(
          DUMMY_NODE_ID,
          deleg.qself === undefined ? undefined : clone_QSelf(deleg.qself),
          path,
          rename ?? ident,
          rename,
          deleg.body === undefined ? undefined : clone_Block(deleg.body),
          source,
        ),
      ),
      undefined,
    );
  });
}

/// Required for `visit_node` obtained an owned `Node` from `&mut Node`.
// rustc-trait: compiler/rustc_expand/src/expand.rs:2081 DummyAstNode
interface DummyAstNode<T> {
  // rustc: compiler/rustc_expand/src/expand.rs:2082 dummy
  dummy(): T;
}

// `impl DummyAstNode for ast::Crate`
// rustc: compiler/rustc_expand/src/expand.rs:2086 dummy
function Crate_dummy(): Crate {
  return {
    attrs: [],
    items: [],
    spans: { inner_span: DUMMY_SP, inject_use_span: DUMMY_SP },
    id: DUMMY_NODE_ID,
    is_placeholder: false,
  };
}

// `impl DummyAstNode for ast::Ty`
// rustc: compiler/rustc_expand/src/expand.rs:2098 dummy
function Ty_dummy(): Ty {
  return new Ty(DUMMY_NODE_ID, TyKind.Dummy, DUMMY_SP);
}

// `impl DummyAstNode for ast::Pat`
// rustc: compiler/rustc_expand/src/expand.rs:2104 dummy
function Pat_dummy(): Pat {
  return new Pat(DUMMY_NODE_ID, PatKind.Wild, DUMMY_SP);
}

// `impl DummyAstNode for ast::Expr`
// rustc: compiler/rustc_expand/src/expand.rs:2110 dummy
function Expr_dummy(): Expr {
  return Expr.dummy();
}

// `impl DummyAstNode for AstNodeWrapper<ast::Expr, MethodReceiverTag>`
// rustc: compiler/rustc_expand/src/expand.rs:2116 dummy
function MethodReceiver_dummy(): MethodReceiverNode {
  return AstNodeWrapper.new(Expr.dummy(), MethodReceiverTag);
}

/**
 * PORT: `mem::replace(node, src)` for a `&mut Node` that is a node object (or an `AstNodeWrapper`
 * from `from_mut`, whose `wrapped` writes through): moves `node`'s contents into a fresh object of
 * the same class, which is returned, and replaces `node` in place with `src`.
 */
function mem_replace<T extends object>(node: T, src: T): T {
  if (node instanceof AstNodeWrapper) {
    const w = node as AstNodeWrapper<object, unknown>;
    const s = src as AstNodeWrapper<object, unknown>;
    return AstNodeWrapper.new(mem_replace(w.wrapped, s.wrapped), w.tag) as T;
  }
  const old = Object.create(Object.getPrototypeOf(node)) as T;
  Object.assign(old, node);
  replace_in_place(node, src);
  return old;
}

export class InvocationCollector extends mut_visit.MutVisitor {
  constructor(
    public cx: ExtCtxt,
    public invocations: InvocationEntry[],
    public monotonic: boolean,
  ) {
    super();
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2128 cfg
  cfg(): StripUnconfigured {
    return new StripUnconfigured(this.cx.sess, this.cx.ecfg.features, false, this.cx.current_expansion.lint_node_id);
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2137 collect
  collect(fragment_kind: AstFragmentKind, kind: InvocationKind): AstFragment {
    const expn_id = LocalExpnId.fresh_empty();
    if (kind.$ === "GlobDelegation") {
      // In resolver we need to know which invocation ids are delegations early,
      // before their `ExpnData` is filled.
      this.cx.resolver.register_glob_delegation(expn_id);
    }
    const vis = InvocationKind.placeholder_visibility(kind);
    // PORT: `ExpansionData { id: expn_id, depth: self.cx.current_expansion.depth + 1,
    // ..self.cx.current_expansion.clone() }`.
    const depth = this.cx.current_expansion.depth + 1;
    const expansion_data = clone_ExpansionData(this.cx.current_expansion);
    expansion_data.id = expn_id;
    expansion_data.depth = depth;
    this.invocations.push([new Invocation(kind, fragment_kind, expansion_data), undefined]);
    return placeholder(fragment_kind, NodeId.placeholder_from_expn_id(expn_id), vis);
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2160 collect_bang
  collect_bang(mac: MacCall, kind: AstFragmentKind): AstFragment {
    // cache the macro call span so that it can be
    // easily adjusted for incremental compilation
    const span = mac.span();
    return this.collect(kind, { $: "Bang", mac, span });
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2167 collect_attr
  collect_attr([attr, pos, derives]: [Attribute, number, Path[]], item: Annotatable, kind: AstFragmentKind): AstFragment {
    return this.collect(kind, { $: "Attr", attr, pos, item, derives });
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2176 collect_glob_delegation
  collect_glob_delegation(item: AssocItem, of_trait: boolean, kind: AstFragmentKind): AstFragment {
    return this.collect(kind, { $: "GlobDelegation", item, of_trait });
  }

  /// If `item` is an attribute invocation, remove the attribute and return it together with
  /// its position and derives following it. We have to collect the derives in order to resolve
  /// legacy derive helpers (helpers written before derives that introduce them).
  // rustc: compiler/rustc_expand/src/expand.rs:2188 take_first_attr
  take_first_attr<T>(item: T, T_: HasAttrsT<T>): [Attribute, number, Path[]] | undefined {
    let attr: [Attribute, number, Path[]] | undefined = undefined;

    let cfg_pos: number | undefined = undefined;
    let attr_pos: number | undefined = undefined;
    const item_attrs = T_.attrs(item);
    for (let pos = 0; pos < item_attrs.length; pos++) {
      const attr = item_attrs[pos]!;
      if (attr.kind.$ === "Normal" && !this.cx.expanded_inert_attrs.is_marked(attr)) {
        const name = attr.name();
        if (name === sym.cfg || name === sym.cfg_attr) {
          cfg_pos = pos; // a cfg attr found, no need to search anymore
          break;
        } else if (attr_pos === undefined && !(name !== undefined && is_builtin_attr_name(name))) {
          attr_pos = pos; // a non-cfg attr found, still may find a cfg attr
        }
      }
    }

    T_.visit_attrs(item, (attrs) => {
      if (cfg_pos !== undefined) {
        const pos = cfg_pos;
        attr = [vec_remove(attrs, pos), pos, []];
      } else if (attr_pos !== undefined) {
        const pos = attr_pos;
        const attr_ = vec_remove(attrs, pos);
        const following_derives: Path[] = [];
        for (const a of attrs.slice(pos)) {
          if (!a.has_name(sym.derive)) continue;
          for (const meta_item_inner of a.meta_item_list() ?? []) {
            const p = derive_path(meta_item_inner);
            if (p !== undefined) following_derives.push(p);
          }
        }

        attr = [attr_, pos, following_derives];
      } else {
        return;
      }
    });

    return attr;
  }

  // Run attributes through the attribute parser
  // since they will not be detected after macro expansion.
  // rustc: compiler/rustc_expand/src/expand.rs:2242 check_attributes
  check_attributes(attrs: readonly Attribute[], call: MacCall): void {
    // use SyntheticAttr::*;
    let span: Span | undefined = undefined;
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i]!;
      validate_attr.check_attr(this.cx.sess.psess, attr);
      AttributeParser.parse_limited_all(
        this.cx.sess,
        [attr],
        undefined,
        Target.MacroCall,
        call.span(),
        this.cx.current_expansion.lint_node_id,
        this.cx.ecfg.features,
        SHOULD_EMIT_ERRORS_AND_LINTS,
        this.cx.resolver.registered_attr_tools(),
      );

      const current_span: Span = span !== undefined ? Span.to(span, attr.span) : attr.span;
      span = current_span;

      // `attrs.peek().is_some_and(|next_attr| next_attr.doc_str().is_some())`
      if (i + 1 < attrs.length && attrs[i + 1]!.doc_str() !== undefined) {
        continue;
      }

      const kind = attr.kind;
      if (kind.$ === "Normal" ? kind._0.item.name() === sym.doc : kind.$ === "DocComment") {
        this.cx.sess.psess.buffer_lint(
          UNUSED_DOC_COMMENTS,
          current_span,
          this.cx.current_expansion.lint_node_id,
          diagnostics.MacroCallUnusedDocComment_diagnostic({ span: attr.span }),
        );
        continue;
      }

      switch (kind.$) {
        case "Normal":
          if (is_builtin_attr(kind._0.item) && !AttributeParser.is_parsed_attribute(attr.path())) {
            const attr_name = unwrap(attr.name());
            this.cx.sess.psess.buffer_lint(
              UNUSED_ATTRIBUTES,
              attr.span,
              this.cx.current_expansion.lint_node_id,
              diagnostics.UnusedBuiltinAttribute_diagnostic({
                attr_name,
                macro_name: pprust.path_to_string(call.path),
                invoc_span: call.path.span,
                attr_span: attr.span,
              }),
            );
          }
          break;
        case "Synthetic":
          // `AttrKind::Synthetic(CfgTrace(_) | CfgAttrTrace(_)) => {}`
          switch (kind._0.$) {
            case "CfgTrace":
            case "CfgAttrTrace":
              break;
          }
          break;
        case "DocComment":
          unreachable(); // handled above
      }
    }
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2306 expand_cfg_true
  expand_cfg_true<N>(node: N, Node: InvocationCollectorNode<N, unknown, unknown>, attr: Attribute, pos: number): EvalConfigResult {
    const cfg = AttributeParser.parse_single(
      this.cfg().sess,
      attr,
      attr.span,
      this.cfg().lint_node_id,
      Node.as_target(node),
      this.cfg().features,
      SHOULD_EMIT_ERRORS_AND_LINTS,
      parse_cfg,
      CFG_TEMPLATE,
      AllowExprMetavar.Yes,
      AttributeSafety.Normal,
    );
    if (cfg === undefined) {
      // Cfg attribute was not parsable, give up
      return EvalConfigResult.True;
    }

    const res = eval_config_entry(this.cfg().sess, cfg);
    if (EvalConfigResult.as_bool(res)) {
      // A synthetic trace attribute left in AST in place of the original `cfg` attribute.
      // It can later be used by lints or other diagnostics.
      const trace_attr = attr.convert_normal_to_synthetic({ $: "CfgTrace", _0: cfg });
      Node.visit_attrs(node, (attrs) => {
        attrs.splice(pos, 0, trace_attr);
      });
    }

    return res;
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2340 expand_cfg_attr
  expand_cfg_attr<N>(node: N, N_: HasAttrsT<N>, attr: Attribute, pos: number): void {
    N_.visit_attrs(node, (attrs) => {
      // Repeated `insert` calls is inefficient, but the number of
      // insertions is almost always 0 or 1 in practice.
      const cfgs = this.cfg().expand_cfg_attr(attr, false);
      for (let i = cfgs.length - 1; i >= 0; i--) {
        attrs.splice(pos, 0, cfgs[i]!);
      }
    });
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2350 flat_map_node
  flat_map_node<N, O>(node_: N, Node: InvocationCollectorNode<N, O, unknown> & OutputTyDefault<O>): O {
    let node = node_;
    for (;;) {
      const first_attr = this.take_first_attr(node, Node);
      if (first_attr !== undefined) {
        const [attr, pos, derives] = first_attr;
        const name = attr.name();
        if (name === sym.cfg) {
          const res = this.expand_cfg_true(node, Node, attr, pos);
          switch (res.$) {
            case "True":
              continue;
            case "False": {
              const reason = res.reason;
              for (const ident of Node.declared_idents(node)) {
                this.cx.resolver.append_stripped_cfg_item(
                  this.cx.current_expansion.lint_node_id,
                  ident,
                  clone_CfgEntry(reason),
                  CfgEntry_.span(reason),
                );
              }
              break;
            }
          }

          return Node.OutputTy_default();
        } else if (name === sym.cfg_attr) {
          this.expand_cfg_attr(node, Node, attr, pos);
          continue;
        } else {
          Node.pre_flat_map_node_collect_attr(this.cfg(), attr);
          return AstFragment.make_ast(this.collect_attr([attr, pos, derives], Node.to_annotatable(node), Node.KIND), Node);
        }
      } else if (Node.is_mac_call(node)) {
        const [mac, attrs, add_semicolon] = Node.take_mac_call(node);
        this.check_attributes(attrs, mac);
        const res = AstFragment.make_ast(this.collect_bang(mac, Node.KIND), Node);
        Node.post_flat_map_node_collect_bang(res, add_semicolon);
        return res;
      }
      const delegation = Node.delegation(node);
      if (delegation !== undefined) {
        const [deleg, item] = delegation;
        if (deleg.suffixes.$ !== "List") {
          const traitless_qself = deleg.qself !== undefined && deleg.qself.position === 0;
          const ann = Node.to_annotatable(node);
          let item_: AssocItem;
          let of_trait: boolean;
          if (ann.$ === "AssocItem" && ann._1.$ === "Impl") {
            item_ = ann._0;
            of_trait = ann._1.of_trait;
          } else if (ann.$ === "Item" || ann.$ === "AssocItem" || ann.$ === "Stmt") {
            const span = Annotatable.span(ann);
            this.cx.dcx().emit_err(diagnostics.GlobDelegationOutsideImpls_diagnostic({ span }));
            return Node.OutputTy_default();
          } else {
            return unreachable();
          }
          if (traitless_qself) {
            const span = item_.span;
            this.cx.dcx().emit_err(diagnostics.GlobDelegationTraitlessQpath_diagnostic({ span }));
            return Node.OutputTy_default();
          }
          return AstFragment.make_ast(this.collect_glob_delegation(item_, of_trait, Node.KIND), Node);
        }
        const suffixes = deleg.suffixes._0;

        const single_delegations = build_single_delegations(Node, this.cx, deleg, item, suffixes, item.span, {
          $: "List",
          _0: LocalExpnId.fresh_empty(),
        });
        return Node.flatten_outputs(
          map_iter(single_delegations, (item) => {
            const node = Node.from_item(item);
            return assign_id(this, Node.node_id_mut(node), () => Node.walk_flat_map(node, this));
          }),
        );
      }
      const r = Node.wrap_flat_map_node_walk_flat_map(node, this, (node, this_) =>
        assign_id(this_, Node.node_id_mut(node), () => Node.walk_flat_map(node, this_)),
      );
      switch (r.$) {
        case "Ok":
          return r._0;
        case "Err":
          node = r._0;
          continue;
      }
    }
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2447 visit_node
  visit_node<N extends object, O>(node: N, Node: InvocationCollectorNode<N, O, unknown> & OutputTyInto<N, O>): void {
    for (;;) {
      const first_attr = this.take_first_attr(node, Node);
      if (first_attr !== undefined) {
        const [attr, pos, derives] = first_attr;
        const name = attr.name();
        if (name === sym.cfg) {
          const span = attr.span;
          if (EvalConfigResult.as_bool(this.expand_cfg_true(node, Node, attr, pos))) {
            continue;
          }

          Node.expand_cfg_false(node, this, pos, span);
          continue;
        } else if (name === sym.cfg_attr) {
          this.expand_cfg_attr(node, Node, attr, pos);
          continue;
        } else {
          const n = mem_replace(node, Node.dummy());
          replace_in_place(
            node,
            Node.OutputTy_into(
              AstFragment.make_ast(this.collect_attr([attr, pos, derives], Node.to_annotatable(n), Node.KIND), Node),
            ),
          );
        }
        return;
      } else if (Node.is_mac_call(node)) {
        const n = mem_replace(node, Node.dummy());
        const [mac, attrs] = Node.take_mac_call(n);
        this.check_attributes(attrs, mac);

        replace_in_place(node, Node.OutputTy_into(AstFragment.make_ast(this.collect_bang(mac, Node.KIND), Node)));
        return;
      } else if (Node.delegation(node) !== undefined) {
        return unreachable();
      } else {
        assign_id(this, Node.node_id_mut(node), () => Node.walk(node, this));
        return;
      }
    }
  }

  // ---- impl<'a, 'b> MutVisitor for InvocationCollector<'a, 'b> ----

  // rustc: compiler/rustc_expand/src/expand.rs:2492 flat_map_item
  override flat_map_item(node: Item): Item[] {
    return this.flat_map_node(node, IC_Item);
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2496 flat_map_assoc_item
  override flat_map_assoc_item(node: AssocItem, ctxt: AssocCtxt): AssocItem[] {
    switch (ctxt.$) {
      case "Trait":
        return this.flat_map_node(AstNodeWrapper.new(node, TraitItemTag), IC_TraitItem);
      case "Impl":
        if (!ctxt.of_trait) {
          return this.flat_map_node(AstNodeWrapper.new(node, ImplItemTag), IC_ImplItem);
        } else {
          return this.flat_map_node(AstNodeWrapper.new(node, TraitImplItemTag), IC_TraitImplItem);
        }
    }
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2512 flat_map_foreign_item
  override flat_map_foreign_item(node: ForeignItem): ForeignItem[] {
    return this.flat_map_node(node, IC_ForeignItem);
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2519 flat_map_variant
  override flat_map_variant(node: Variant): Variant[] {
    return this.flat_map_node(node, IC_Variant);
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2523 flat_map_where_predicate
  override flat_map_where_predicate(node: WherePredicate): WherePredicate[] {
    return this.flat_map_node(node, IC_WherePredicate);
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2530 flat_map_field_def
  override flat_map_field_def(node: FieldDef): FieldDef[] {
    return this.flat_map_node(node, IC_FieldDef);
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2534 flat_map_pat_field
  override flat_map_pat_field(node: PatField): PatField[] {
    return this.flat_map_node(node, IC_PatField);
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2538 flat_map_expr_field
  override flat_map_expr_field(node: ExprField): ExprField[] {
    return this.flat_map_node(node, IC_ExprField);
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2542 flat_map_param
  override flat_map_param(node: Param): Param[] {
    return this.flat_map_node(node, IC_Param);
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2546 flat_map_generic_param
  override flat_map_generic_param(node: GenericParam): GenericParam[] {
    return this.flat_map_node(node, IC_GenericParam);
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2553 flat_map_arm
  override flat_map_arm(node: Arm): Arm[] {
    return this.flat_map_node(node, IC_Arm);
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2557 flat_map_stmt
  override flat_map_stmt(node: Stmt): Stmt[] {
    // FIXME: invocations in semicolon-less expressions positions are expanded as expressions,
    // changing that requires some compatibility measures.
    if (node.is_expr()) {
      // The only way that we can end up with a `MacCall` expression statement,
      // (as opposed to a `StmtKind::MacCall`) is if we have a macro as the
      // trailing expression in a block (e.g. `fn foo() { my_macro!() }`).
      // Record this information, so that we can report a more specific
      // `SEMICOLON_IN_EXPRESSIONS_FROM_MACROS` lint if needed.
      // See #78991 for an investigation of treating macros in this position
      // as statements, rather than expressions, during parsing.
      const kind = node.kind;
      if (kind.$ === "Expr" && kind._0.kind.$ === "MacCall") {
        this.cx.current_expansion.is_trailing_mac = true;
        // Don't use `assign_id` for this statement - it may get removed
        // entirely due to a `#[cfg]` on the contained expression
        const res = walk_flat_map_stmt(this, node);
        this.cx.current_expansion.is_trailing_mac = false;
        return res;
      } else {
        return walk_flat_map_stmt(this, node);
      }
    }

    return this.flat_map_node(node, IC_Stmt);
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2586 visit_crate
  override visit_crate(node: Crate): void {
    this.visit_node(node, IC_Crate);
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2590 visit_ty
  override visit_ty(node: Ty): void {
    this.visit_node(node, IC_Ty);
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2594 visit_pat
  override visit_pat(node: Pat): void {
    this.visit_node(node, IC_Pat);
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2598 visit_expr
  override visit_expr(node: Expr): void {
    // FIXME: Feature gating is performed inconsistently between `Expr` and `OptExpr`.
    const attr = node.attrs[0];
    if (attr !== undefined) {
      this.cfg().maybe_emit_expr_attr_err(attr);
    }
    this.visit_node(node, IC_Expr);
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2606 visit_method_receiver_expr
  override visit_method_receiver_expr(node: Expr): void {
    this.visit_node(AstNodeWrapper.from_mut(node, MethodReceiverTag), IC_MethodReceiver);
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2610 filter_map_expr
  override filter_map_expr(node: Expr): Expr | undefined {
    return this.flat_map_node(AstNodeWrapper.new(node, OptExprTag), IC_OptExpr);
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2614 visit_block
  override visit_block(node: import("../rustc_ast/lib.ts").Block): void {
    const orig_dir_ownership = this.cx.current_expansion.dir_ownership;
    this.cx.current_expansion.dir_ownership = DirOwnership.UnownedViaBlock;
    walk_block(this, node);
    this.cx.current_expansion.dir_ownership = orig_dir_ownership;
  }

  // rustc: compiler/rustc_expand/src/expand.rs:2623 visit_id
  override visit_id(id: MutRef<NodeId>): void {
    // We may have already assigned a `NodeId`
    // by calling `assign_id`
    if (this.monotonic && id.value === DUMMY_NODE_ID) {
      id.value = this.cx.resolver.next_node_id();
    }
  }
}

// PORT: `ShouldEmit::ErrorsAndLints { recovery: Recovery::Allowed }`.
const SHOULD_EMIT_ERRORS_AND_LINTS: ShouldEmit = { $: "ErrorsAndLints", recovery: "Allowed" };

// PORT: `Vec::remove` (panics out of bounds like Rust; callers pass a valid index).
function vec_remove<T>(v: T[], index: number): T {
  if (index >= v.length) panic(`removal index (is ${index}) should be < len (is ${v.length})`);
  return v.splice(index, 1)[0]!;
}

// PORT: the `filter_map` closure of `take_first_attr`:
// `MetaItemInner::MetaItem(ast::MetaItem { kind: MetaItemKind::Word, path, .. }) => Some(path)`.
function derive_path(meta_item_inner: MetaItemInner): Path | undefined {
  if (meta_item_inner.$ === "MetaItem" && meta_item_inner._0.kind.$ === "Word") {
    return meta_item_inner._0.path;
  }
  return undefined;
}

export class ExpansionConfig {
  constructor(
    public crate_name: Symbol,
    public features: Features,
    public recursion_limit: Limit,
    public trace_mac: boolean,
    /// If false, strip `#[test]` nodes
    public should_test: boolean,
    /// If true, use verbose debugging for `proc_macro::Span`
    public span_debug: boolean,
    /// If true, show backtraces for proc-macro panics
    public proc_macro_backtrace: boolean,
  ) {}

  // rustc: compiler/rustc_expand/src/expand.rs:2646 default
  static default(crate_name: Symbol, features: Features): ExpansionConfig {
    return new ExpansionConfig(
      crate_name,
      features,
      // FIXME should this limit be configurable?
      Limit.new(1024),
      false,
      false,
      false,
      false,
    );
  }
}
