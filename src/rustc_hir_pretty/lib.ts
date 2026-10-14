// Port of compiler/rustc_hir_pretty/src/lib.rs
//! HIR pretty-printing is layered on top of AST pretty-printing. A number of
//! the definitions in this file have equivalents in `rustc_ast_pretty`.

// tidy-alphabetical-start
// #![recursion_limit = "256"]
// tidy-alphabetical-end

// ==== lane hir-pretty-a: lib.rs:1..1305 ====
//
// PORT: `State` follows the `PrintState` contract (decision 2026-10-12, rustc_ast_pretty/pprust/state.ts): it
// extends the abstract class `PrintState`; the `Deref<Target = pp::Printer>` is the field `s` (`self.word(..)` is
// `this.s.word(..)`); the field `comments` is `comments_` and the field `attrs` is `attrs_` (they clash with the
// methods of the same name). The first `impl<'a> State<'a>` block, the `Deref`/`DerefMut` impls and the
// `impl PrintState for State` are the class body; the later `impl<'a> State<'a>` blocks are declared on
// `interface State` (class/interface merging in this module) and assigned to `State.prototype` in upstream order.
//
// PORT: inherent methods of `State` whose names are also `PrintState` methods get a trailing `_`:
// `print_attr_item_`, `bclose_maybe_open_`, `bclose_` (here) and `print_path_`, `print_path_segment_`,
// `print_generic_args_` (lane hir-pretty-b). Upstream, `PrintState`'s provided methods (`print_mac_common`,
// `print_mac_def`, `print_attribute_inline`, ...) call the trait's `print_path`/`bclose`/`print_attr_item`, while
// `State`'s own code calls the inherent ones; in TS one prototype chain cannot hold both under one name, so the
// inherent ones are renamed (the convention of hir-types decision 2 / middle-hir decision 2).

import { display_ExternAbi, type ExternAbi, ExternAbi as ExternAbiNs } from "../rustc_abi/extern_abi.ts";
import { ast } from "../rustc_ast/lib.ts";
import { DUMMY_NODE_ID } from "../rustc_ast/node_id.ts";
import { type ExprPrecedence, ExprPrecedence_discriminant } from "../rustc_ast/util/parser.ts";
import { Mutability, Pinnedness } from "../rustc_ast_ir/lib.ts";
import { pp, pprust } from "../rustc_ast_pretty/lib.ts";
import { type Attribute, type AttrItem, print_attribute_AttributeKind } from "../rustc_attr_ir/lib.ts";
import type { ConstArg, ConstArgExprField, GenericArg, GenericBound, GenericParam, ImplicitSelfKind, Node, PatKind, PreciseCapturingArg, RangeEnd, Term, TyPatKind } from "../rustc_hir/lib.ts";
import type { HirTyCtxt } from "../rustc_hir/intravisit.ts";
import type { SourceMap } from "../rustc_span/source_map.ts";
import { DUMMY_SP, type FileName, Span, type Spanned } from "../rustc_span/lib.ts";
import { display_Ident, Ident, kw, sym, type Symbol } from "../rustc_span/symbol.ts";
import { assert, panic, unreachable, unwrap } from "../std/panic.ts";
import type { Str } from "../std/str.ts";
import { display_LitKind } from "../rustc_ast/util/literal.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import { format_debug, PLAIN } from "../std/fmt.ts";
import { slice_from, slice_to } from "../std/slice.ts";
import * as parser from "../rustc_ast/util/parser.ts";
import * as hir from "../rustc_hir/lib.ts";

type BoxMarker = pp.BoxMarker;
type Breaks = pp.Breaks;
const Breaks = pp.Breaks;
// use rustc_ast_pretty::pp::Breaks::{Consistent, Inconsistent};
const Inconsistent: Breaks = pp.Breaks.Inconsistent;
type Comments = pprust.Comments;
const Comments = pprust.Comments;
type PrintState = pprust.PrintState;
const PrintState = pprust.PrintState;
type MacHeader = pprust.state.MacHeader;

// rustc: compiler/rustc_hir_pretty/src/lib.rs:29 id_to_string
export function id_to_string(cx: HirTyCtxt, hir_id: HirId): string {
  return to_string(HirTyCtxt_as_PpAnn(cx), (s) => s.print_node(cx.hir_node(hir_id)));
}

export type AnnNode =
  | { readonly $: "Name"; _0: Symbol }
  | { readonly $: "Block"; _0: hir.Block }
  | { readonly $: "Item"; _0: hir.Item }
  | { readonly $: "SubItem"; _0: HirId }
  | { readonly $: "Expr"; _0: hir.Expr }
  | { readonly $: "Pat"; _0: hir.Pat }
  | { readonly $: "TyPat"; _0: hir.TyPat }
  | { readonly $: "Arm"; _0: hir.Arm };

export type Nested =
  | { readonly $: "Item"; _0: hir.ItemId }
  | { readonly $: "TraitItem"; _0: hir.TraitItemId }
  | { readonly $: "ImplItem"; _0: hir.ImplItemId }
  | { readonly $: "ForeignItem"; _0: hir.ForeignItemId }
  | { readonly $: "Body"; _0: hir.BodyId }
  | { readonly $: "BodyParamPat"; _0: hir.BodyId; _1: number };

// PORT: `trait PpAnn` (all methods provided) -> a class; implementors `extend` it and override (as
// rustc_ast_pretty's `PpAnn`).
export class PpAnn {
  // rustc: compiler/rustc_hir_pretty/src/lib.rs:54 nested
  nested(_state: State, _nested: Nested): void {}
  // rustc: compiler/rustc_hir_pretty/src/lib.rs:55 pre
  pre(_state: State, _node: AnnNode): void {}
  // rustc: compiler/rustc_hir_pretty/src/lib.rs:56 post
  post(_state: State, _node: AnnNode): void {}
}

// impl PpAnn for &dyn rustc_hir::intravisit::HirTyCtxt<'_>
// PORT: the impl on `&dyn HirTyCtxt` is the class `HirTyCtxtPpAnn` wrapping the `HirTyCtxt` view;
// `HirTyCtxt_as_PpAnn(cx)` is the coercion `&cx as &dyn PpAnn` (like middle-hir's `TyCtxt_as_HirTyCtxt`).
class HirTyCtxtPpAnn extends PpAnn {
  constructor(public cx: HirTyCtxt) {
    super();
  }

  // rustc: compiler/rustc_hir_pretty/src/lib.rs:60 nested
  override nested(state: State, nested: Nested): void {
    switch (nested.$) {
      case "Item":
        return state.print_item(this.cx.hir_item(nested._0));
      case "TraitItem":
        return state.print_trait_item(this.cx.hir_trait_item(nested._0));
      case "ImplItem":
        return state.print_impl_item(this.cx.hir_impl_item(nested._0));
      case "ForeignItem":
        return state.print_foreign_item(this.cx.hir_foreign_item(nested._0));
      case "Body":
        return state.print_expr(this.cx.hir_body(nested._0).value);
      case "BodyParamPat":
        return state.print_pat(unwrap(this.cx.hir_body(nested._0).params[nested._1]).pat);
    }
  }
}

/** `&cx as &dyn PpAnn` for a `cx: &dyn HirTyCtxt`. */
export function HirTyCtxt_as_PpAnn(cx: HirTyCtxt): PpAnn {
  return new HirTyCtxtPpAnn(cx);
}

export class State extends PrintState {
  constructor(
    public s: pp.Printer,
    // PORT: field `comments` is `comments_` (it clashes with the `comments()` method).
    public comments_: Comments | undefined,
    // PORT: field `attrs` is `attrs_` (it clashes with the `attrs()` method).
    public attrs_: (id: HirId) => readonly Attribute[],
    public ann: PpAnn,
  ) {
    super();
  }

  // impl<'a> State<'a>

  // rustc: compiler/rustc_hir_pretty/src/lib.rs:80 attrs
  attrs(id: HirId): readonly Attribute[] {
    return this.attrs_(id);
  }

  // rustc: compiler/rustc_hir_pretty/src/lib.rs:84 precedence
  precedence(expr: hir.Expr): ExprPrecedence {
    const has_attr = (id: HirId): boolean => this.attrs(id).length !== 0;
    return expr.precedence(has_attr);
  }

  // rustc: compiler/rustc_hir_pretty/src/lib.rs:89 print_attrs
  print_attrs(attrs: readonly Attribute[]): void {
    if (attrs.length === 0) {
      return;
    }

    for (const attr of attrs) {
      this.print_attribute_as_style(attr, "Outer");
    }
    this.s.hardbreak_if_not_bol();
  }

  /// Print a single attribute as if it has style `style`, disregarding the
  /// actual style of the attribute.
  // rustc: compiler/rustc_hir_pretty/src/lib.rs:102 print_attribute_as_style
  print_attribute_as_style(attr: Attribute, style: ast.AttrStyle): void {
    if (attr.$ === "Unparsed") {
      const unparsed = attr._0;
      this.maybe_print_comment(Span.lo(unparsed.span));
      switch (style) {
        case "Inner":
          this.s.word("#![");
          break;
        case "Outer":
          this.s.word("#[");
          break;
      }
      this.print_attr_item_(unparsed, unparsed.span);
      this.s.word("]");
      this.s.hardbreak();
    } else if (attr._0.$ === "DocComment") {
      const { kind, comment } = attr._0;
      this.s.word(pprust.state.doc_comment_to_string(kind, style, comment));
      this.s.hardbreak();
    } else {
      const pa = attr._0;
      switch (style) {
        case "Inner":
          this.s.word("#![attr = ");
          break;
        case "Outer":
          this.s.word("#[attr = ");
          break;
      }
      // PORT: `pa.print_attribute(self)` takes `&mut Printer` (the `Deref` of `State`).
      print_attribute_AttributeKind.print_attribute(pa, this.s);
      this.s.word("]");
      this.s.hardbreak();
    }
  }

  // PORT: renamed `print_attr_item_` (see the header comment: `PrintState::print_attr_item` is a different fn).
  // rustc: compiler/rustc_hir_pretty/src/lib.rs:132 print_attr_item
  print_attr_item_(item: AttrItem, span: Span): void {
    const ib = this.s.ibox(0);
    const path = new ast.Path(
      span,
      item.path.segments.map((i) => new ast.PathSegment(new Ident(i, DUMMY_SP), DUMMY_NODE_ID, undefined)),
    );

    const args = item.args;
    switch (args.$) {
      case "Delimited": {
        const { delim, tokens } = args._0;
        const header: MacHeader = { $: "Path", _0: path };
        this.print_mac_common(header, false, undefined, delim, undefined, tokens, true, span);
        break;
      }
      case "Empty": {
        // `PrintState::print_path(self, &path, false, 0)`
        this.print_path(path, false, 0);
        break;
      }
      case "Eq": {
        const expr = args.expr;
        // `PrintState::print_path(self, &path, false, 0)`
        this.print_path(path, false, 0);
        this.s.space();
        this.s.word_space("=");
        const token_str = this.meta_item_lit_to_string(expr);
        this.s.word(token_str);
        break;
      }
    }
    this.s.end(ib);
  }

  // rustc: compiler/rustc_hir_pretty/src/lib.rs:173 print_node
  print_node(node: Node): void {
    switch (node.$) {
      case "Param":
        return this.print_param(node._0);
      case "Item":
        return this.print_item(node._0);
      case "ForeignItem":
        return this.print_foreign_item(node._0);
      case "TraitItem":
        return this.print_trait_item(node._0);
      case "ImplItem":
        return this.print_impl_item(node._0);
      case "Variant":
        return this.print_variant(node._0);
      case "AnonConst":
        return this.print_anon_const(node._0);
      case "ConstBlock":
        return this.print_inline_const(node._0);
      case "ConstArg":
        return this.print_const_arg(node._0);
      case "Expr":
        return this.print_expr(node._0);
      case "ExprField":
        return this.print_expr_field(node._0);
      // FIXME(mgca): proper printing for struct exprs
      case "ConstArgExprField":
        return this.s.word("/* STRUCT EXPR */");
      case "Stmt":
        return this.print_stmt(node._0);
      case "PathSegment":
        return this.print_path_segment_(node._0);
      case "Ty":
        return this.print_type(node._0);
      case "AssocItemConstraint":
        return this.print_assoc_item_constraint(node._0);
      case "TraitRef":
        return this.print_trait_ref(node._0);
      case "OpaqueTy":
        return panic("cannot print Node::OpaqueTy");
      case "Pat":
        return this.print_pat(node._0);
      case "TyPat":
        return this.print_ty_pat(node._0);
      case "PatField":
        return this.print_patfield(node._0);
      case "PatExpr":
        return this.print_pat_expr(node._0);
      case "Arm":
        return this.print_arm(node._0);
      case "Infer":
        return this.s.word("_");
      case "PreciseCapturingNonLifetimeArg": {
        const param = node._0;
        return this.print_ident(param.ident);
      }
      case "Block": {
        const a = node._0;
        // Containing cbox, will be closed by print-block at `}`.
        const cb = this.s.cbox(INDENT_UNIT);
        // Head-ibox, will be closed by print-block after `{`.
        const ib = this.s.ibox(0);
        this.print_block(a, cb, ib);
        return;
      }
      case "Lifetime":
        return this.print_lifetime(node._0);
      case "GenericParam":
        return panic("cannot print Node::GenericParam");
      case "Field":
        return panic("cannot print Node::Field");
      // These cases do not carry enough information in the
      // `hir_map` to reconstruct their full structure for pretty
      // printing.
      case "Ctor":
        return panic("cannot print isolated Ctor");
      case "LetStmt":
        return this.print_local_decl(node._0);
      case "Crate":
        return panic("cannot print Crate");
      case "WherePredicate":
        return this.print_where_predicate(node._0);
      case "NestedUseTree":
        return this.print_use_tree(node._0);
      case "TestBinderForall":
        return panic("cannot print Node::TestBinderForall");
      case "TestBinderExists":
        return panic("cannot print Node::TestBinderExists");
      case "TestBinderBoundTypeConstraint": {
        return panic("cannot print Node::TestBinderBoundTypeConstraint");
      }
      case "Synthetic":
        return unreachable();
      case "Err":
        return this.s.word("/*ERROR*/");
    }
  }

  // rustc: compiler/rustc_hir_pretty/src/lib.rs:229 print_generic_arg
  print_generic_arg(generic_arg: GenericArg, elide_lifetimes: boolean): void {
    if (generic_arg.$ === "Lifetime" && !elide_lifetimes) {
      this.print_lifetime(generic_arg._0);
    } else if (generic_arg.$ === "Lifetime") {
      // nothing
    } else if (generic_arg.$ === "Type") {
      this.print_type(generic_arg._0.as_unambig_ty());
    } else if (generic_arg.$ === "Const") {
      this.print_const_arg(generic_arg._0.as_unambig_ct());
    } else {
      // GenericArg::Infer(_inf)
      this.s.word("_");
    }
  }

  // impl std::ops::Deref for State<'_>
  // rustc: compiler/rustc_hir_pretty/src/lib.rs:242 deref
  deref(): pp.Printer {
    return this.s;
  }

  // impl std::ops::DerefMut for State<'_>
  // rustc: compiler/rustc_hir_pretty/src/lib.rs:248 deref_mut
  deref_mut(): pp.Printer {
    return this.s;
  }

  // impl<'a> PrintState<'a> for State<'a>

  // rustc: compiler/rustc_hir_pretty/src/lib.rs:254 comments
  comments(): Comments | undefined {
    return this.comments_;
  }

  // rustc: compiler/rustc_hir_pretty/src/lib.rs:258 comments_mut
  comments_mut(): Comments | undefined {
    return this.comments_;
  }

  // rustc: compiler/rustc_hir_pretty/src/lib.rs:262 ann_post
  ann_post(ident: Ident): void {
    this.ann.post(this, { $: "Name", _0: ident.name });
  }

  // rustc: compiler/rustc_hir_pretty/src/lib.rs:266 print_generic_args
  print_generic_args(_: ast.GenericArgs, _colons_before_params: boolean): void {
    panic("AST generic args printed by HIR pretty-printer");
  }

  // PORT: an associated fn (`Self::cond_needs_par`) of the later `impl<'a> State<'a>` block, placed in the class
  // body (PORTING §8) because statics cannot be added through `interface State`.
  // Does `expr` need parentheses when printed in a condition position?
  //
  // These cases need parens due to the parse error observed in #26461: `if return {}`
  // parses as the erroneous construct `if (return {})`, not `if (return) {}`.
  // rustc: compiler/rustc_hir_pretty/src/lib.rs:1289 cond_needs_par
  static cond_needs_par(expr: hir.Expr): boolean {
    switch (expr.kind.$) {
      case "Break":
      case "Closure":
      case "Ret":
        return true;
      default:
        return contains_exterior_struct_lit(expr);
    }
  }
}

const INDENT_UNIT: number = 4;

/// Requires you to pass an input filename and reader so that
/// it can scan the input text for comments to copy forward.
// rustc: compiler/rustc_hir_pretty/src/lib.rs:275 print_crate
export function print_crate(
  sm: SourceMap,
  krate: hir.Mod,
  filename: FileName,
  input: Str,
  attrs: (id: HirId) => readonly Attribute[],
  ann: PpAnn,
): string {
  const s = new State(pp.Printer.new(), Comments.new(sm, filename, input), attrs, ann);

  // Print all attributes, regardless of actual style, as inner attributes
  // since this is the crate root with nothing above it to print outer
  // attributes.
  for (const attr of s.attrs(hir.CRATE_HIR_ID)) {
    s.print_attribute_as_style(attr, "Inner");
  }

  // When printing the AST, we sometimes need to inject `#[no_std]` here.
  // Since you can't compile the HIR, it's not necessary.

  s.print_mod(krate);
  s.print_remaining_comments();
  return s.s.eof();
}

// rustc: compiler/rustc_hir_pretty/src/lib.rs:305 to_string
function to_string(ann: PpAnn, f: (s: State) => void): string {
  const printer = new State(pp.Printer.new(), undefined, (_) => [], ann);
  f(printer);
  return printer.s.eof();
}

// rustc: compiler/rustc_hir_pretty/src/lib.rs:314 attribute_to_string
export function attribute_to_string(ann: PpAnn, attr: Attribute): string {
  return to_string(ann, (s) => s.print_attribute_as_style(attr, "Outer"));
}

// rustc: compiler/rustc_hir_pretty/src/lib.rs:318 ty_to_string
export function ty_to_string(ann: PpAnn, ty: hir.Ty): string {
  return to_string(ann, (s) => s.print_type(ty));
}

// rustc: compiler/rustc_hir_pretty/src/lib.rs:322 qpath_to_string
export function qpath_to_string(ann: PpAnn, segment: hir.QPath): string {
  return to_string(ann, (s) => s.print_qpath(segment, false));
}

// rustc: compiler/rustc_hir_pretty/src/lib.rs:326 pat_to_string
export function pat_to_string(ann: PpAnn, pat: hir.Pat): string {
  return to_string(ann, (s) => s.print_pat(pat));
}

// rustc: compiler/rustc_hir_pretty/src/lib.rs:330 expr_to_string
export function expr_to_string(ann: PpAnn, pat: hir.Expr): string {
  return to_string(ann, (s) => s.print_expr(pat));
}

// rustc: compiler/rustc_hir_pretty/src/lib.rs:334 item_to_string
export function item_to_string(ann: PpAnn, pat: hir.Item): string {
  return to_string(ann, (s) => s.print_item(pat));
}

// impl<'a> State<'a>
export interface State {
  bclose_maybe_open_(span: Span, cb: BoxMarker | undefined): void;
  bclose_(span: Span, cb: BoxMarker): void;
  commasep_cmnt<T>(b: Breaks, elts: readonly T[], op: (s: State, elt: T) => void, get_span: (elt: T) => Span): void;
  commasep_exprs(b: Breaks, exprs: readonly hir.Expr[]): void;
  print_mod(_mod: hir.Mod): void;
  print_opt_lifetime(lifetime: hir.Lifetime): void;
  print_type(ty: hir.Ty): void;
  print_unsafe_binder(unsafe_binder: hir.UnsafeBinderTy): void;
  print_foreign_item(item: hir.ForeignItem): void;
  print_associated_const(ident: Ident, generics: hir.Generics, ty: hir.Ty, default_: hir.ConstItemRhs | undefined): void;
  print_associated_type(
    ident: Ident,
    generics: hir.Generics,
    bounds: hir.GenericBounds | undefined,
    ty: hir.Ty | undefined,
  ): void;
  print_item(item: hir.Item): void;
  print_use_tree(tree: hir.UseTree): void;
  print_trait_ref(t: hir.TraitRef): void;
  print_formal_generic_params(generic_params: readonly hir.GenericParam[]): void;
  print_poly_trait_ref(t: hir.PolyTraitRef): void;
  print_enum_def(name: Symbol, generics: hir.Generics, enum_def: hir.EnumDef, span: Span): void;
  print_variants(variants: readonly hir.Variant[], span: Span, cb: BoxMarker, ib: BoxMarker): void;
  print_defaultness(defaultness: hir.Defaultness): void;
  print_struct(
    name: Symbol,
    generics: hir.Generics,
    struct_def: hir.VariantData,
    span: Span,
    print_finalizer: boolean,
    cb: BoxMarker,
    ib: BoxMarker,
  ): void;
  print_variant(v: hir.Variant): void;
  print_method_sig(
    ident: Ident,
    m: hir.FnSig,
    generics: hir.Generics,
    arg_idents: readonly (Ident | undefined)[],
    body_id: hir.BodyId | undefined,
  ): void;
  print_trait_item(ti: hir.TraitItem): void;
  print_impl_item(ii: hir.ImplItem): void;
  print_local(
    super_: boolean,
    init: hir.Expr | undefined,
    els: hir.Block | undefined,
    decl: (this_: State) => void,
  ): void;
  print_stmt(st: hir.Stmt): void;
  print_block(blk: hir.Block, cb: BoxMarker, ib: BoxMarker): void;
  print_block_unclosed(blk: hir.Block, ib: BoxMarker): void;
  print_block_maybe_unclosed(blk: hir.Block, cb: BoxMarker | undefined, ib: BoxMarker): void;
  print_else(els: hir.Expr | undefined): void;
  print_if(test: hir.Expr, blk: hir.Expr, elseopt: hir.Expr | undefined): void;
  print_anon_const(constant: hir.AnonConst): void;
  print_const_item_rhs(ct_rhs: hir.ConstItemRhs): void;
  print_const_arg(const_arg: ConstArg): void;
  print_const_struct(qpath: hir.QPath, fields: readonly ConstArgExprField[]): void;
  print_const_ctor(qpath: hir.QPath, args: readonly ConstArg[]): void;
  print_call_post(args: readonly hir.Expr[]): void;
  print_expr_as_cond(expr: hir.Expr): void;
  print_expr_cond_paren(expr: hir.Expr, needs_par: boolean): void;
  print_let(pat: hir.Pat, ty: hir.Ty | undefined, init: hir.Expr): void;
  print_expr_vec(exprs: readonly hir.Expr[]): void;
}

// PORT: renamed `bclose_maybe_open_` (see the header comment: `PrintState::bclose_maybe_open` is a different fn).
// rustc: compiler/rustc_hir_pretty/src/lib.rs:339 bclose_maybe_open
State.prototype.bclose_maybe_open_ = function (this: State, span: Span, cb: BoxMarker | undefined): void {
  this.maybe_print_comment(Span.hi(span));
  this.break_offset_if_not_bol(1, -INDENT_UNIT);
  this.s.word("}");
  if (cb !== undefined) {
    this.s.end(cb);
  }
};

// PORT: renamed `bclose_` (see the header comment: `PrintState::bclose` is a different fn).
// rustc: compiler/rustc_hir_pretty/src/lib.rs:348 bclose
State.prototype.bclose_ = function (this: State, span: Span, cb: BoxMarker): void {
  this.bclose_maybe_open_(span, cb);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:352 commasep_cmnt
State.prototype.commasep_cmnt = function <T>(
  this: State,
  b: Breaks,
  elts: readonly T[],
  op: (s: State, elt: T) => void,
  get_span: (elt: T) => Span,
): void {
  const rb = this.s.rbox(0, b);
  const len = elts.length;
  let i = 0;
  for (const elt of elts) {
    this.maybe_print_comment(Span.hi(get_span(elt)));
    op(this, elt);
    i += 1;
    if (i < len) {
      this.s.word(",");
      this.maybe_print_trailing_comment(get_span(elt), Span.hi(get_span(elts[i]!)));
      this.s.space_if_not_bol();
    }
  }
  this.s.end(rb);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:373 commasep_exprs
State.prototype.commasep_exprs = function (this: State, b: Breaks, exprs: readonly hir.Expr[]): void {
  this.commasep_cmnt(
    b,
    exprs,
    (s, e) => s.print_expr(e),
    (e) => e.span,
  );
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:377 print_mod
State.prototype.print_mod = function (this: State, _mod: hir.Mod): void {
  for (const item_id of _mod.item_ids) {
    this.ann.nested(this, { $: "Item", _0: item_id });
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:383 print_opt_lifetime
State.prototype.print_opt_lifetime = function (this: State, lifetime: hir.Lifetime): void {
  if (!lifetime.is_elided()) {
    this.print_lifetime(lifetime);
    this.s.nbsp();
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:390 print_type
State.prototype.print_type = function (this: State, ty: hir.Ty): void {
  this.maybe_print_comment(Span.lo(ty.span));
  const ib = this.s.ibox(0);
  const kind = ty.kind;
  switch (kind.$) {
    case "Slice": {
      const ty = kind._0;
      this.s.word("[");
      this.print_type(ty);
      this.s.word("]");
      break;
    }
    case "Ptr": {
      const [ty, mutbl] = [kind._0, kind._1];
      this.s.word("*");
      this.print_mutability(mutbl, true);
      this.print_type(ty);
      break;
    }
    case "Ref": {
      const [lifetime, ty, mutbl] = [kind._0, kind._1, kind._2];
      this.s.word("&");
      this.print_opt_lifetime(lifetime);
      this.print_mutability(mutbl, false);
      this.print_type(ty);
      break;
    }
    case "Never": {
      this.s.word("!");
      break;
    }
    case "Tup": {
      const elts = kind._0;
      this.s.popen();
      this.commasep(Inconsistent, elts, (s, ty) => s.print_type(ty));
      if (elts.length === 1) {
        this.s.word(",");
      }
      this.s.pclose();
      break;
    }
    case "FnPtr": {
      const f = kind._0;
      this.print_ty_fn(f.abi, f.safety, f.decl, undefined, f.generic_params, f.param_idents);
      break;
    }
    case "UnsafeBinder": {
      const unsafe_binder = kind._0;
      this.print_unsafe_binder(unsafe_binder);
      break;
    }
    case "OpaqueDef":
      this.s.word("/*impl Trait*/");
      break;
    case "TraitAscription": {
      const bounds = kind._0;
      this.print_bounds("impl", bounds);
      break;
    }
    case "Path": {
      const qpath = kind._0;
      this.print_qpath(qpath, false);
      break;
    }
    case "TraitObject": {
      const [bounds, lifetime] = [kind._0, kind._1];
      const syntax = lifetime.tag();
      switch (syntax) {
        case "Dyn":
          this.s.word_nbsp("dyn");
          break;
        case "None":
          break;
      }
      let first = true;
      for (const bound of bounds) {
        if (first) {
          first = false;
        } else {
          this.s.nbsp();
          this.s.word_space("+");
        }
        this.print_poly_trait_ref(bound);
      }
      // PORT: `lifetime.is_elided()` auto-derefs the `TaggedRef` to its pointer.
      if (!lifetime.pointer().is_elided()) {
        this.s.nbsp();
        this.s.word_space("+");
        this.print_lifetime(lifetime.pointer());
      }
      break;
    }
    case "Array": {
      const [ty, length] = [kind._0, kind._1];
      this.s.word("[");
      this.print_type(ty);
      this.s.word("; ");
      this.print_const_arg(length);
      this.s.word("]");
      break;
    }
    case "Err": {
      this.s.popen();
      this.s.word("/*ERROR*/");
      this.s.pclose();
      break;
    }
    case "Infer":
    case "InferDelegation": {
      this.s.word("_");
      break;
    }
    case "Pat": {
      const [ty, pat] = [kind._0, kind._1];
      this.print_type(ty);
      this.s.word(" is ");
      this.print_ty_pat(pat);
      break;
    }
    case "FieldOf": {
      const [ty, { variant, field }] = [kind._0, kind._1];
      this.s.word("field_of!(");
      this.print_type(ty);
      this.s.word(", ");
      if (variant !== undefined) {
        this.print_ident(variant);
        this.s.word(".");
      }
      this.print_ident(field);
      this.s.word(")");
      break;
    }
    case "View": {
      const [ty, fields] = [kind._0, kind._1];
      this.s.word("view_type!(");
      this.print_type(ty);
      this.s.word(".{");
      if (fields.length !== 0) {
        this.s.space();
        this.commasep(Breaks.Inconsistent, fields, (s, f) => s.print_ident(f));
        this.s.space();
      }
      this.s.word("})");
      break;
    }
  }
  this.s.end(ib);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:500 print_unsafe_binder
State.prototype.print_unsafe_binder = function (this: State, unsafe_binder: hir.UnsafeBinderTy): void {
  const ib = this.s.ibox(INDENT_UNIT);
  this.s.word("unsafe");
  this.print_generic_params(unsafe_binder.generic_params);
  this.s.nbsp();
  this.print_type(unsafe_binder.inner_ty);
  this.s.end(ib);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:509 print_foreign_item
State.prototype.print_foreign_item = function (this: State, item: hir.ForeignItem): void {
  this.s.hardbreak_if_not_bol();
  this.maybe_print_comment(Span.lo(item.span));
  this.print_attrs(this.attrs(item.hir_id()));
  const kind = item.kind;
  switch (kind.$) {
    case "Fn": {
      const [sig, arg_idents, generics] = [kind._0, kind._1, kind._2];
      const [cb, ib] = this.head("");
      this.print_fn(sig.header, item.ident.name, generics, sig.decl, arg_idents, undefined);
      this.s.end(ib);
      this.s.word(";");
      this.s.end(cb);
      break;
    }
    case "Static": {
      const [t, m, safety] = [kind._0, kind._1, kind._2];
      this.print_safety(safety);
      const [cb, ib] = this.head("static");
      if (Mutability.is_mut(m)) {
        this.s.word_space("mut");
      }
      this.print_ident(item.ident);
      this.s.word_space(":");
      this.print_type(t);
      this.s.word(";");
      this.s.end(ib);
      this.s.end(cb);
      break;
    }
    case "Type": {
      const [cb, ib] = this.head("type");
      this.print_ident(item.ident);
      this.s.word(";");
      this.s.end(ib);
      this.s.end(cb);
      break;
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:551 print_associated_const
State.prototype.print_associated_const = function (
  this: State,
  ident: Ident,
  generics: hir.Generics,
  ty: hir.Ty,
  default_: hir.ConstItemRhs | undefined,
): void {
  this.s.word_space("const");
  this.print_ident(ident);
  this.print_generic_params(generics.params);
  this.s.word_space(":");
  this.print_type(ty);
  if (default_ !== undefined) {
    const ct_rhs = default_;
    this.s.space();
    this.s.word_space("=");
    this.print_const_item_rhs(ct_rhs);
  }
  this.print_where_clause(generics);
  this.s.word(";");
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:572 print_associated_type
State.prototype.print_associated_type = function (
  this: State,
  ident: Ident,
  generics: hir.Generics,
  bounds: hir.GenericBounds | undefined,
  ty: hir.Ty | undefined,
): void {
  this.s.word_space("type");
  this.print_ident(ident);
  this.print_generic_params(generics.params);
  if (bounds !== undefined) {
    this.print_bounds(":", bounds);
  }
  this.print_where_clause(generics);
  if (ty !== undefined) {
    this.s.space();
    this.s.word_space("=");
    this.print_type(ty);
  }
  this.s.word(";");
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:594 print_item
State.prototype.print_item = function (this: State, item: hir.Item): void {
  this.s.hardbreak_if_not_bol();
  this.maybe_print_comment(Span.lo(item.span));
  const attrs = this.attrs(item.hir_id());
  this.print_attrs(attrs);
  this.ann.pre(this, { $: "Item", _0: item });
  const kind = item.kind;
  switch (kind.$) {
    case "ExternCrate": {
      const [orig_name, ident] = [kind._0, kind._1];
      const [cb, ib] = this.head("extern crate");
      if (orig_name !== undefined) {
        this.print_name(orig_name);
        this.s.space();
        this.s.word("as");
        this.s.space();
      }
      this.print_ident(ident);
      this.s.word(";");
      this.s.end(ib);
      this.s.end(cb);
      break;
    }
    case "Use": {
      const tree = kind._0;
      const [cb, ib] = this.head("use");

      this.print_use_tree(tree);
      this.s.word(";");
      this.s.end(ib);
      this.s.end(cb);
      break;
    }
    case "Static": {
      const [m, ident, ty, expr] = [kind._0, kind._1, kind._2, kind._3];
      const [cb, ib] = this.head("static");
      if (Mutability.is_mut(m)) {
        this.s.word_space("mut");
      }
      this.print_ident(ident);
      this.s.word_space(":");
      this.print_type(ty);
      this.s.space();
      this.s.end(ib);

      this.s.word_space("=");
      this.ann.nested(this, { $: "Body", _0: expr });
      this.s.word(";");
      this.s.end(cb);
      break;
    }
    case "Const": {
      const [ident, generics, ty, rhs] = [kind._0, kind._1, kind._2, kind._3];
      const [cb, ib] = this.head("const");
      this.print_ident(ident);
      this.print_generic_params(generics.params);
      this.s.word_space(":");
      this.print_type(ty);
      this.s.space();
      this.s.end(ib);

      this.s.word_space("=");
      this.print_const_item_rhs(rhs);
      this.print_where_clause(generics);
      this.s.word(";");
      this.s.end(cb);
      break;
    }
    case "Fn": {
      const { ident, sig, generics, body } = kind;
      const [cb, ib] = this.head("");
      this.print_fn(sig.header, ident.name, generics, sig.decl, [], body);
      this.s.word(" ");
      this.s.end(ib);
      this.s.end(cb);
      this.ann.nested(this, { $: "Body", _0: body });
      break;
    }
    case "Macro": {
      const [ident, macro_def] = [kind._0, kind._1];
      this.print_mac_def(macro_def, ident, item.span, (_) => {});
      break;
    }
    case "Mod": {
      const [ident, mod_] = [kind._0, kind._1];
      const [cb, ib] = this.head("mod");
      this.print_ident(ident);
      this.s.nbsp();
      this.bopen(ib);
      this.print_mod(mod_);
      this.bclose_(item.span, cb);
      break;
    }
    case "ForeignMod": {
      const { abi, items } = kind;
      const [cb, ib] = this.head("extern");
      this.s.word_nbsp(display_ExternAbi(abi));
      this.bopen(ib);
      for (const foreign_item of items) {
        this.ann.nested(this, { $: "ForeignItem", _0: foreign_item });
      }
      this.bclose_(item.span, cb);
      break;
    }
    case "GlobalAsm": {
      const { asm } = kind;
      const [cb, ib] = this.head("global_asm!");
      this.print_inline_asm(asm);
      this.s.word(";");
      this.s.end(cb);
      this.s.end(ib);
      break;
    }
    case "TyAlias": {
      const [ident, generics, ty] = [kind._0, kind._1, kind._2];
      const [cb, ib] = this.head("type");
      this.print_ident(ident);
      this.print_generic_params(generics.params);
      this.s.end(ib);

      this.print_where_clause(generics);
      this.s.space();
      this.s.word_space("=");
      this.print_type(ty);
      this.s.word(";");
      this.s.end(cb);
      break;
    }
    case "Enum": {
      const [ident, generics, enum_def] = [kind._0, kind._1, kind._2];
      this.print_enum_def(ident.name, generics, enum_def, item.span);
      break;
    }
    case "Struct": {
      const [ident, generics, struct_def] = [kind._0, kind._1, kind._2];
      const [cb, ib] = this.head("struct");
      this.print_struct(ident.name, generics, struct_def, item.span, true, cb, ib);
      break;
    }
    case "Union": {
      const [ident, generics, struct_def] = [kind._0, kind._1, kind._2];
      const [cb, ib] = this.head("union");
      this.print_struct(ident.name, generics, struct_def, item.span, true, cb, ib);
      break;
    }
    case "Impl": {
      const { generics, of_trait, self_ty, items, constness } = kind._0;
      const [cb, ib] = this.head("");

      const impl_generics = (this_: State): void => {
        this_.s.word_nbsp("impl");
        if (generics.params.length !== 0) {
          this_.print_generic_params(generics.params);
          this_.s.space();
        }
      };

      if (of_trait === undefined) {
        if (constness.$ === "Const" && constness.always === false) {
          this.s.word_nbsp("const");
        }
        impl_generics(this);
      } else {
        const { safety, polarity, defaultness, trait_ref } = of_trait;
        this.print_defaultness(defaultness);
        this.print_safety(safety);

        impl_generics(this);

        if (constness.$ === "Const" && constness.always === false) {
          this.s.word_nbsp("const");
        }

        if (polarity.$ === "Negative") {
          this.s.word("!");
        }

        this.print_trait_ref(trait_ref);
        this.s.space();
        this.s.word_space("for");
      }

      this.print_type(self_ty);
      this.print_where_clause(generics);

      this.s.space();
      this.bopen(ib);
      for (const impl_item of items) {
        this.ann.nested(this, { $: "ImplItem", _0: impl_item });
      }
      this.bclose_(item.span, cb);
      break;
    }
    case "Trait": {
      const { impl_restriction, constness, is_auto, safety, ident, generics, bounds, items: trait_items } = kind;
      const [cb, ib] = this.head("");
      this.print_impl_restriction(impl_restriction);
      this.print_constness(constness);
      this.print_is_auto(is_auto);
      this.print_safety(safety);
      this.s.word_nbsp("trait");
      this.print_ident(ident);
      this.print_generic_params(generics.params);
      this.print_bounds(":", bounds);
      this.print_where_clause(generics);
      this.s.word(" ");
      this.bopen(ib);
      for (const trait_item of trait_items) {
        this.ann.nested(this, { $: "TraitItem", _0: trait_item });
      }
      this.bclose_(item.span, cb);
      break;
    }
    case "TraitAlias": {
      const [constness, ident, generics, bounds] = [kind._0, kind._1, kind._2, kind._3];
      const [cb, ib] = this.head("");
      this.print_constness(constness);
      this.s.word_nbsp("trait");
      this.print_ident(ident);
      this.print_generic_params(generics.params);
      this.s.nbsp();
      this.print_bounds("=", bounds);
      this.print_where_clause(generics);
      this.s.word(";");
      this.s.end(ib);
      this.s.end(cb);
      break;
    }
    case "TestBinderConstraints": {
      this.s.word("test_binder_constraints!(/* pretty-printing not supported */)");
      break;
    }
  }
  this.ann.post(this, { $: "Item", _0: item });
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:813 print_use_tree
State.prototype.print_use_tree = function (this: State, tree: hir.UseTree): void {
  const { prefix, kind } = tree;
  this.print_path_(prefix, false);
  switch (kind.$) {
    case "Single": {
      const ident = kind._0;
      if (!unwrap(tree.prefix.segments[tree.prefix.segments.length - 1]).ident.eq(ident)) {
        this.s.space();
        this.s.word_space("as");
        this.print_ident(ident);
      }
      break;
    }
    case "Glob":
      this.s.word("::*");
      break;
    case "Nested": {
      const { items } = kind;
      this.s.word("::{");
      for (const [item, ,] of items) {
        this.print_use_tree(item);
        this.s.word(",");
      }
      this.s.word("}");
      break;
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:836 print_trait_ref
State.prototype.print_trait_ref = function (this: State, t: hir.TraitRef): void {
  this.print_path_(t.path, false);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:840 print_formal_generic_params
State.prototype.print_formal_generic_params = function (
  this: State,
  generic_params: readonly hir.GenericParam[],
): void {
  if (generic_params.length !== 0) {
    this.s.word("for");
    this.print_generic_params(generic_params);
    this.s.nbsp();
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:848 print_poly_trait_ref
State.prototype.print_poly_trait_ref = function (this: State, t: hir.PolyTraitRef): void {
  const { constness, polarity } = t.modifiers;
  switch (constness.$) {
    case "Never":
      break;
    case "Always":
      this.s.word("const");
      break;
    case "Maybe":
      this.s.word("[const]");
      break;
  }
  switch (polarity.$) {
    case "Positive":
      break;
    case "Negative":
      this.s.word("!");
      break;
    case "Maybe":
      this.s.word("?");
      break;
  }
  this.print_formal_generic_params(t.bound_generic_params);
  this.print_trait_ref(t.trait_ref);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:864 print_enum_def
State.prototype.print_enum_def = function (
  this: State,
  name: Symbol,
  generics: hir.Generics,
  enum_def: hir.EnumDef,
  span: Span,
): void {
  const [cb, ib] = this.head("enum");
  this.print_name(name);
  this.print_generic_params(generics.params);
  this.print_where_clause(generics);
  this.s.space();
  this.print_variants(enum_def.variants, span, cb, ib);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:879 print_variants
State.prototype.print_variants = function (
  this: State,
  variants: readonly hir.Variant[],
  span: Span,
  cb: BoxMarker,
  ib: BoxMarker,
): void {
  this.bopen(ib);
  for (const v of variants) {
    this.s.space_if_not_bol();
    this.maybe_print_comment(Span.lo(v.span));
    this.print_attrs(this.attrs(v.hir_id));
    const ib = this.s.ibox(INDENT_UNIT);
    this.print_variant(v);
    this.s.word(",");
    this.s.end(ib);
    this.maybe_print_trailing_comment(v.span, undefined);
  }
  this.bclose_(span, cb);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:900 print_defaultness
State.prototype.print_defaultness = function (this: State, defaultness: hir.Defaultness): void {
  switch (defaultness.$) {
    case "Default":
      this.s.word_nbsp("default");
      break;
    case "Final":
      break;
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:907 print_struct
State.prototype.print_struct = function (
  this: State,
  name: Symbol,
  generics: hir.Generics,
  struct_def: hir.VariantData,
  span: Span,
  print_finalizer: boolean,
  cb: BoxMarker,
  ib: BoxMarker,
): void {
  this.print_name(name);
  this.print_generic_params(generics.params);
  switch (struct_def.$) {
    case "Tuple":
    case "Unit": {
      if (struct_def.$ === "Tuple") {
        this.s.popen();
        this.commasep(Inconsistent, hir.VariantData.fields(struct_def), (s, field) => {
          s.maybe_print_comment(Span.lo(field.span));
          s.print_attrs(s.attrs(field.hir_id));
          s.print_mut_restriction(field.mut_restriction);
          s.print_type(field.ty);
        });
        this.s.pclose();
      }
      this.print_where_clause(generics);
      if (print_finalizer) {
        this.s.word(";");
      }
      this.s.end(ib);
      this.s.end(cb);
      break;
    }
    case "Struct": {
      this.print_where_clause(generics);
      this.s.nbsp();
      this.bopen(ib);
      this.s.hardbreak_if_not_bol();

      for (const field of hir.VariantData.fields(struct_def)) {
        this.s.hardbreak_if_not_bol();
        this.maybe_print_comment(Span.lo(field.span));
        this.print_attrs(this.attrs(field.hir_id));
        this.print_mut_restriction(field.mut_restriction);
        this.print_ident(field.ident);
        this.s.word_nbsp(":");
        this.print_type(field.ty);
        this.s.word(",");
      }

      this.bclose_(span, cb);
      break;
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:960 print_variant
State.prototype.print_variant = function (this: State, v: hir.Variant): void {
  const [cb, ib] = this.head("");
  const generics = hir.Generics.empty();
  this.print_struct(v.ident.name, generics, v.data, v.span, false, cb, ib);
  if (v.disr_expr !== undefined) {
    const d = v.disr_expr;
    this.s.space();
    this.s.word_space("=");
    this.print_anon_const(d);
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:971 print_method_sig
State.prototype.print_method_sig = function (
  this: State,
  ident: Ident,
  m: hir.FnSig,
  generics: hir.Generics,
  arg_idents: readonly (Ident | undefined)[],
  body_id: hir.BodyId | undefined,
): void {
  this.print_fn(m.header, ident.name, generics, m.decl, arg_idents, body_id);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:982 print_trait_item
State.prototype.print_trait_item = function (this: State, ti: hir.TraitItem): void {
  this.ann.pre(this, { $: "SubItem", _0: ti.hir_id() });
  this.s.hardbreak_if_not_bol();
  this.maybe_print_comment(Span.lo(ti.span));
  this.print_attrs(this.attrs(ti.hir_id()));
  const kind = ti.kind;
  if (kind.$ === "Const") {
    const [ty, default_] = [kind._0, kind._1];
    this.print_associated_const(ti.ident, ti.generics, ty, default_);
  } else if (kind.$ === "Fn" && kind._1.$ === "Required") {
    const [sig, arg_idents] = [kind._0, kind._1._0];
    this.print_method_sig(ti.ident, sig, ti.generics, arg_idents, undefined);
    this.s.word(";");
  } else if (kind.$ === "Fn" && kind._1.$ === "Provided") {
    const [sig, body] = [kind._0, kind._1._0];
    const [cb, ib] = this.head("");
    this.print_method_sig(ti.ident, sig, ti.generics, [], body);
    this.s.nbsp();
    this.s.end(ib);
    this.s.end(cb);
    this.ann.nested(this, { $: "Body", _0: body });
  } else if (kind.$ === "Type") {
    const [bounds, default_] = [kind._0, kind._1];
    this.print_associated_type(ti.ident, ti.generics, bounds, default_);
  }
  this.ann.post(this, { $: "SubItem", _0: ti.hir_id() });
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1010 print_impl_item
State.prototype.print_impl_item = function (this: State, ii: hir.ImplItem): void {
  this.ann.pre(this, { $: "SubItem", _0: ii.hir_id() });
  this.s.hardbreak_if_not_bol();
  this.maybe_print_comment(Span.lo(ii.span));
  this.print_attrs(this.attrs(ii.hir_id()));

  const kind = ii.kind;
  switch (kind.$) {
    case "Const": {
      const [ty, expr] = [kind._0, kind._1];
      this.print_associated_const(ii.ident, ii.generics, ty, expr);
      break;
    }
    case "Fn": {
      const [sig, body] = [kind._0, kind._1];
      const [cb, ib] = this.head("");
      this.print_method_sig(ii.ident, sig, ii.generics, [], body);
      this.s.nbsp();
      this.s.end(ib);
      this.s.end(cb);
      this.ann.nested(this, { $: "Body", _0: body });
      break;
    }
    case "Type": {
      const ty = kind._0;
      this.print_associated_type(ii.ident, ii.generics, undefined, ty);
      break;
    }
  }
  this.ann.post(this, { $: "SubItem", _0: ii.hir_id() });
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1035 print_local
State.prototype.print_local = function (
  this: State,
  super_: boolean,
  init: hir.Expr | undefined,
  els: hir.Block | undefined,
  decl: (this_: State) => void,
): void {
  this.s.space_if_not_bol();
  const ibm1 = this.s.ibox(INDENT_UNIT);
  if (super_) {
    this.s.word_nbsp("super");
  }
  this.s.word_nbsp("let");

  const ibm2 = this.s.ibox(INDENT_UNIT);
  decl(this);
  this.s.end(ibm2);

  if (init !== undefined) {
    this.s.nbsp();
    this.s.word_space("=");
    this.print_expr(init);
  }

  if (els !== undefined) {
    this.s.nbsp();
    this.s.word_space("else");
    // containing cbox, will be closed by print-block at `}`
    const cb = this.s.cbox(0);
    // head-box, will be closed by print-block after `{`
    const ib = this.s.ibox(0);
    this.print_block(els, cb, ib);
  }

  this.s.end(ibm1);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1072 print_stmt
State.prototype.print_stmt = function (this: State, st: hir.Stmt): void {
  this.maybe_print_comment(Span.lo(st.span));
  const kind = st.kind;
  switch (kind.$) {
    case "Let": {
      const loc = kind._0;
      this.print_local(loc.super_ !== undefined, loc.init, loc.els, (this_) => {
        this_.print_local_decl(loc);
      });
      break;
    }
    case "Item": {
      const item = kind._0;
      this.ann.nested(this, { $: "Item", _0: item });
      break;
    }
    case "Expr": {
      const expr = kind._0;
      this.s.space_if_not_bol();
      this.print_expr(expr);
      break;
    }
    case "Semi": {
      const expr = kind._0;
      this.s.space_if_not_bol();
      this.print_expr(expr);
      this.s.word(";");
      break;
    }
  }
  if (stmt_ends_with_semi(st.kind)) {
    this.s.word(";");
  }
  this.maybe_print_trailing_comment(st.span, undefined);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1097 print_block
State.prototype.print_block = function (this: State, blk: hir.Block, cb: BoxMarker, ib: BoxMarker): void {
  this.print_block_maybe_unclosed(blk, cb, ib);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1101 print_block_unclosed
State.prototype.print_block_unclosed = function (this: State, blk: hir.Block, ib: BoxMarker): void {
  this.print_block_maybe_unclosed(blk, undefined, ib);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1105 print_block_maybe_unclosed
State.prototype.print_block_maybe_unclosed = function (
  this: State,
  blk: hir.Block,
  cb: BoxMarker | undefined,
  ib: BoxMarker,
): void {
  switch (blk.rules.$) {
    case "UnsafeBlock":
      this.s.word_space("unsafe");
      break;
    case "DefaultBlock":
      break;
  }
  this.maybe_print_comment(Span.lo(blk.span));
  this.ann.pre(this, { $: "Block", _0: blk });
  this.bopen(ib);

  for (const st of blk.stmts) {
    this.print_stmt(st);
  }
  if (blk.expr !== undefined) {
    const expr = blk.expr;
    this.s.space_if_not_bol();
    this.print_expr(expr);
    this.maybe_print_trailing_comment(expr.span, Span.hi(blk.span));
  }
  this.bclose_maybe_open_(blk.span, cb);
  this.ann.post(this, { $: "Block", _0: blk });
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1131 print_else
State.prototype.print_else = function (this: State, els: hir.Expr | undefined): void {
  if (els !== undefined) {
    const els_inner = els;
    const kind = els_inner.kind;
    // Another `else if` block.
    if (kind.$ === "If" && kind._1.kind.$ === "Block" && kind._1.kind._1 === undefined) {
      const [i, t, e] = [kind._0, kind._1.kind._0, kind._2];
      const cb = this.s.cbox(0);
      const ib = this.s.ibox(0);
      this.s.word(" else if ");
      this.print_expr_as_cond(i);
      this.s.space();
      this.print_block(t, cb, ib);
      this.print_else(e);
    }
    // Final `else` block.
    else if (kind.$ === "Block" && kind._1 === undefined) {
      const b = kind._0;
      const cb = this.s.cbox(0);
      const ib = this.s.ibox(0);
      this.s.word(" else ");
      this.print_block(b, cb, ib);
    }
    // Constraints would be great here!
    else {
      panic("print_if saw if with weird alternative");
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1159 print_if
State.prototype.print_if = function (
  this: State,
  test: hir.Expr,
  blk: hir.Expr,
  elseopt: hir.Expr | undefined,
): void {
  const kind = blk.kind;
  if (kind.$ === "Block" && kind._1 === undefined) {
    const blk = kind._0;
    const cb = this.s.cbox(0);
    const ib = this.s.ibox(0);
    this.s.word_nbsp("if");
    this.print_expr_as_cond(test);
    this.s.space();
    this.print_block(blk, cb, ib);
    this.print_else(elseopt);
  } else {
    panic("non-block then expr");
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1179 print_anon_const
State.prototype.print_anon_const = function (this: State, constant: hir.AnonConst): void {
  this.ann.nested(this, { $: "Body", _0: constant.body });
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1183 print_const_item_rhs
State.prototype.print_const_item_rhs = function (this: State, ct_rhs: hir.ConstItemRhs): void {
  switch (ct_rhs.$) {
    case "Body": {
      const body_id = ct_rhs._0;
      this.ann.nested(this, { $: "Body", _0: body_id });
      break;
    }
    case "Direct": {
      const const_arg = ct_rhs._0;
      this.print_const_arg(const_arg);
      break;
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1190 print_const_arg
State.prototype.print_const_arg = function (this: State, const_arg: ConstArg): void {
  const kind = const_arg.kind;
  switch (kind.$) {
    case "Tup": {
      const exprs = kind._0;
      this.s.popen();
      this.commasep_cmnt(
        Inconsistent,
        exprs,
        (s, arg) => s.print_const_arg(arg),
        (arg) => arg.span,
      );
      this.s.pclose();
      break;
    }
    case "Struct": {
      const [qpath, fields] = [kind._0, kind._1];
      this.print_const_struct(qpath, fields);
      break;
    }
    case "TupleCall": {
      const [qpath, args] = [kind._0, kind._1];
      this.print_const_ctor(qpath, args);
      break;
    }
    case "Array":
      this.s.word("/* ARRAY EXPR */");
      break;
    case "Path": {
      const qpath = kind._0;
      this.print_qpath(qpath, true);
      break;
    }
    case "Anon": {
      const anon = kind._0;
      this.print_anon_const(anon);
      break;
    }
    case "Error":
      this.s.word("/*ERROR*/");
      break;
    case "Infer":
      this.s.word("_");
      break;
    case "Literal": {
      const { lit, negated } = kind;
      if (negated) {
        this.s.word("-");
      }
      const span = const_arg.span;
      const spanned: Spanned<typeof lit> = { span, node: lit };
      this.print_literal(spanned);
      break;
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1219 print_const_struct
State.prototype.print_const_struct = function (
  this: State,
  qpath: hir.QPath,
  fields: readonly ConstArgExprField[],
): void {
  this.print_qpath(qpath, true);
  this.s.word(" ");
  this.s.word("{");
  if (fields.length !== 0) {
    this.s.nbsp();
  }
  this.commasep(Inconsistent, fields, (s, field) => {
    s.s.word(field.field.as_str());
    s.s.word(":");
    s.s.nbsp();
    s.print_const_arg(field.expr);
  });
  this.s.word("}");
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1235 print_const_ctor
State.prototype.print_const_ctor = function (this: State, qpath: hir.QPath, args: readonly ConstArg[]): void {
  this.print_qpath(qpath, true);
  this.s.word("(");
  this.commasep(Inconsistent, args, (s, arg) => {
    s.print_const_arg(arg);
  });
  this.s.word(")");
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1244 print_call_post
State.prototype.print_call_post = function (this: State, args: readonly hir.Expr[]): void {
  this.s.popen();
  this.commasep_exprs(Inconsistent, args);
  this.s.pclose();
};

/// Prints an expr using syntax that's acceptable in a condition position, such as the `cond` in
/// `if cond { ... }`.
// rustc: compiler/rustc_hir_pretty/src/lib.rs:1252 print_expr_as_cond
State.prototype.print_expr_as_cond = function (this: State, expr: hir.Expr): void {
  this.print_expr_cond_paren(expr, State.cond_needs_par(expr));
};

/// Prints `expr` or `(expr)` when `needs_par` holds.
// rustc: compiler/rustc_hir_pretty/src/lib.rs:1257 print_expr_cond_paren
State.prototype.print_expr_cond_paren = function (this: State, expr: hir.Expr, needs_par: boolean): void {
  if (needs_par) {
    this.s.popen();
  }
  if (expr.kind.$ === "DropTemps") {
    const actual_expr = expr.kind._0;
    this.print_expr(actual_expr);
  } else {
    this.print_expr(expr);
  }
  if (needs_par) {
    this.s.pclose();
  }
};

/// Print a `let pat = expr` expression.
// rustc: compiler/rustc_hir_pretty/src/lib.rs:1272 print_let
State.prototype.print_let = function (this: State, pat: hir.Pat, ty: hir.Ty | undefined, init: hir.Expr): void {
  this.s.word_space("let");
  this.print_pat(pat);
  if (ty !== undefined) {
    this.s.word_space(":");
    this.print_type(ty);
  }
  this.s.space();
  this.s.word_space("=");
  const npals = (): boolean => parser.needs_par_as_let_scrutinee(this.precedence(init));
  this.print_expr_cond_paren(init, State.cond_needs_par(init) || npals());
};

// `cond_needs_par` (lib.rs:1289) is the static `State.cond_needs_par` in the class body above.

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1298 print_expr_vec
State.prototype.print_expr_vec = function (this: State, exprs: readonly hir.Expr[]): void {
  const ib = this.s.ibox(INDENT_UNIT);
  this.s.word("[");
  this.commasep_exprs(Inconsistent, exprs);
  this.s.word("]");
  this.s.end(ib);
};

// ==== lane hir-pretty-b: lib.rs:1306..end ====
// (merge-w15a: this region's import block and its `BoxMarker` / `Breaks` aliases are merged into the block at the top.)


// PORT: `ExprPrecedence: PartialOrd` (derived) compares by discriminant.
function lt(a: ExprPrecedence, b: ExprPrecedence): boolean {
  return ExprPrecedence_discriminant[a] < ExprPrecedence_discriminant[b];
}
function le(a: ExprPrecedence, b: ExprPrecedence): boolean {
  return ExprPrecedence_discriminant[a] <= ExprPrecedence_discriminant[b];
}

// impl<'a> State<'a> (continued: lib.rs:1306..2689)
// PORT: inherent methods whose names clash with a `PrintState` method (which `PrintState`'s own methods call on
// `self`) are suffixed `_`: `print_path_`, `print_path_segment_`, `print_generic_args_`. Upstream's
// `self.print_path(..)` resolves to the inherent method; `PrintState::print_path(self, ..)` is the trait's.
export interface State {
  print_inline_const(constant: hir.ConstBlock): void;
  print_expr_repeat(element: hir.Expr, count: hir.ConstArg): void;
  print_expr_struct(qpath: hir.QPath, fields: readonly hir.ExprField[], wth: hir.StructTailExpr): void;
  print_expr_field(field: hir.ExprField): void;
  print_expr_tup(exprs: readonly hir.Expr[]): void;
  print_expr_call(func: hir.Expr, args: readonly hir.Expr[]): void;
  print_expr_method_call(segment: hir.PathSegment, receiver: hir.Expr, args: readonly hir.Expr[]): void;
  print_expr_binary(op: ast.BinOpKind, lhs: hir.Expr, rhs: hir.Expr): void;
  print_expr_unary(op: ast.UnOp, expr: hir.Expr): void;
  print_expr_addr_of(kind: ast.BorrowKind, mutability: Mutability, expr: hir.Expr): void;
  print_literal(lit: hir.Lit): void;
  print_inline_asm(asm: hir.InlineAsm): void;
  print_expr(expr: hir.Expr): void;
  print_local_decl(loc: hir.LetStmt): void;
  print_name(name: Symbol): void;
  print_path_<R>(path: hir.Path<R>, colons_before_params: boolean): void;
  print_path_segment_(segment: hir.PathSegment): void;
  print_qpath(qpath: hir.QPath, colons_before_params: boolean): void;
  print_generic_args_(generic_args: hir.GenericArgs, colons_before_params: boolean): void;
  print_assoc_item_constraint(constraint: hir.AssocItemConstraint): void;
  print_pat_expr(expr: hir.PatExpr): void;
  print_ty_pat(pat: hir.TyPat): void;
  print_pat(pat: hir.Pat): void;
  print_patfield(field: hir.PatField): void;
  print_param(arg: hir.Param): void;
  print_implicit_self(implicit_self_kind: ImplicitSelfKind): void;
  print_arm(arm: hir.Arm): void;
  print_fn(
    header: hir.FnHeader,
    name: Symbol | undefined,
    generics: hir.Generics,
    decl: hir.FnDecl,
    arg_idents: readonly (Ident | undefined)[],
    body_id: hir.BodyId | undefined,
  ): void;
  print_closure_params(decl: hir.FnDecl, body_id: hir.BodyId): void;
  print_capture_clause(capture_clause: ast.CaptureBy): void;
  print_closure_binder(binder: hir.ClosureBinder, generic_params: readonly GenericParam[]): void;
  print_bounds(prefix: string, bounds: Iterable<GenericBound>): void;
  print_precise_capturing_arg(arg: PreciseCapturingArg): void;
  print_generic_params(generic_params: readonly GenericParam[]): void;
  print_generic_param(param: GenericParam): void;
  print_lifetime(lifetime: hir.Lifetime): void;
  print_where_clause(generics: hir.Generics): void;
  print_where_predicate(predicate: hir.WherePredicate): void;
  print_mutability(mutbl: Mutability, print_const: boolean): void;
  print_fn_output(decl: hir.FnDecl): void;
  print_ty_fn(
    abi: ExternAbi,
    safety: hir.Safety,
    decl: hir.FnDecl,
    name: Symbol | undefined,
    generic_params: readonly hir.GenericParam[],
    arg_idents: readonly (Ident | undefined)[],
  ): void;
  print_fn_header_info(header: hir.FnHeader): void;
  print_constness(s: hir.Constness): void;
  print_safety(s: hir.Safety): void;
  print_is_auto(s: ast.IsAuto): void;
  print_restriction(k: hir.RestrictionKind, prefix: string): void;
  print_mut_restriction(r: hir.MutRestriction): void;
  print_impl_restriction(r: hir.ImplRestriction): void;
}

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1306 print_inline_const
State.prototype.print_inline_const = function (this: State, constant: hir.ConstBlock): void {
  const ib = this.s.ibox(INDENT_UNIT);
  this.s.word_space("const");
  this.ann.nested(this, { $: "Body", _0: constant.body });
  this.s.end(ib);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1313 print_expr_repeat
State.prototype.print_expr_repeat = function (this: State, element: hir.Expr, count: hir.ConstArg): void {
  const ib = this.s.ibox(INDENT_UNIT);
  this.s.word("[");
  this.print_expr(element);
  this.s.word_space(";");
  this.print_const_arg(count);
  this.s.word("]");
  this.s.end(ib);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1323 print_expr_struct
State.prototype.print_expr_struct = function (
  this: State,
  qpath: hir.QPath,
  fields: readonly hir.ExprField[],
  wth: hir.StructTailExpr,
): void {
  this.print_qpath(qpath, true);
  this.s.nbsp();
  this.s.word_space("{");
  this.commasep_cmnt(
    Breaks.Consistent,
    fields,
    (s, field) => s.print_expr_field(field),
    (f) => f.span,
  );
  switch (wth.$) {
    case "Base": {
      const expr = wth._0;
      const ib = this.s.ibox(INDENT_UNIT);
      if (fields.length !== 0) {
        this.s.word(",");
        this.s.space();
      }
      this.s.word("..");
      this.print_expr(expr);
      this.s.end(ib);
      break;
    }
    case "DefaultFields": {
      const ib = this.s.ibox(INDENT_UNIT);
      if (fields.length !== 0) {
        this.s.word(",");
        this.s.space();
      }
      this.s.word("..");
      this.s.end(ib);
      break;
    }
    case "None":
      break;
    case "NoneWithError":
      break;
  }
  this.s.space();
  this.s.word("}");
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1360 print_expr_field
State.prototype.print_expr_field = function (this: State, field: hir.ExprField): void {
  const cb = this.s.cbox(INDENT_UNIT);
  this.print_attrs(this.attrs(field.hir_id));
  if (!field.is_shorthand) {
    this.print_ident(field.ident);
    this.s.word_space(":");
  }
  this.print_expr(field.expr);
  this.s.end(cb);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1371 print_expr_tup
State.prototype.print_expr_tup = function (this: State, exprs: readonly hir.Expr[]): void {
  this.s.popen();
  this.commasep_exprs(Breaks.Inconsistent, exprs);
  if (exprs.length === 1) {
    this.s.word(",");
  }
  this.s.pclose();
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1380 print_expr_call
State.prototype.print_expr_call = function (this: State, func: hir.Expr, args: readonly hir.Expr[]): void {
  let needs_paren: boolean;
  switch (func.kind.$) {
    case "Field":
      needs_paren = true;
      break;
    default:
      needs_paren = lt(this.precedence(func), "Unambiguous");
      break;
  }

  this.print_expr_cond_paren(func, needs_paren);
  this.print_call_post(args);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1390 print_expr_method_call
State.prototype.print_expr_method_call = function (
  this: State,
  segment: hir.PathSegment,
  receiver: hir.Expr,
  args: readonly hir.Expr[],
): void {
  const base_args = args;
  this.print_expr_cond_paren(receiver, lt(this.precedence(receiver), "Unambiguous"));
  this.s.word(".");
  this.print_ident(segment.ident);

  const generic_args = segment.args_();
  if (generic_args.args.length !== 0 || generic_args.constraints.length !== 0) {
    this.print_generic_args_(generic_args, true);
  }

  this.print_call_post(base_args);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1412 print_expr_binary
State.prototype.print_expr_binary = function (this: State, op: ast.BinOpKind, lhs: hir.Expr, rhs: hir.Expr): void {
  const binop_prec = ast.BinOpKind.precedence(op);
  const left_prec = this.precedence(lhs);
  const right_prec = this.precedence(rhs);

  let left_needs_paren: boolean;
  let right_needs_paren: boolean;
  switch (ast.BinOpKind.fixity(op)) {
    case "Left":
      [left_needs_paren, right_needs_paren] = [lt(left_prec, binop_prec), le(right_prec, binop_prec)];
      break;
    case "Right":
      [left_needs_paren, right_needs_paren] = [le(left_prec, binop_prec), lt(right_prec, binop_prec)];
      break;
    case "None":
      [left_needs_paren, right_needs_paren] = [le(left_prec, binop_prec), le(right_prec, binop_prec)];
      break;
  }

  // These cases need parens: `x as i32 < y` has the parser thinking that `i32 < y` is
  // the beginning of a path type. It starts trying to parse `x as (i32 < y ...` instead
  // of `(x as i32) < ...`. We need to convince it _not_ to do that.
  if (lhs.kind.$ === "Cast" && (op === "Lt" || op === "Shl")) {
    left_needs_paren = true;
  } else if (lhs.kind.$ === "Let" && !parser.needs_par_as_let_scrutinee(binop_prec)) {
    left_needs_paren = true;
  }

  this.print_expr_cond_paren(lhs, left_needs_paren);
  this.s.space();
  this.s.word_space(ast.BinOpKind.as_str(op));
  this.print_expr_cond_paren(rhs, right_needs_paren);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1442 print_expr_unary
State.prototype.print_expr_unary = function (this: State, op: ast.UnOp, expr: hir.Expr): void {
  this.s.word(ast.UnOp.as_str(op));
  this.print_expr_cond_paren(expr, lt(this.precedence(expr), "Prefix"));
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1447 print_expr_addr_of
State.prototype.print_expr_addr_of = function (
  this: State,
  kind: ast.BorrowKind,
  mutability: Mutability,
  expr: hir.Expr,
): void {
  this.s.word("&");
  switch (kind) {
    case "Ref":
      this.print_mutability(mutability, false);
      break;
    case "Raw":
      this.s.word_nbsp("raw");
      this.print_mutability(mutability, true);
      break;
    case "Pin":
      this.s.word_nbsp("pin");
      this.print_mutability(mutability, true);
      break;
  }
  this.print_expr_cond_paren(expr, lt(this.precedence(expr), "Prefix"));
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1468 print_literal
State.prototype.print_literal = function (this: State, lit: hir.Lit): void {
  this.maybe_print_comment(Span.lo(lit.span));
  this.s.word(display_LitKind(lit.node));
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1473 print_inline_asm
State.prototype.print_inline_asm = function (this: State, asm: hir.InlineAsm): void {
  type AsmArg =
    | { readonly $: "Template"; _0: string }
    | { readonly $: "Operand"; _0: hir.InlineAsmOperand }
    | { readonly $: "Options"; _0: ast.InlineAsmOptions };

  const args: AsmArg[] = [{ $: "Template", _0: ast.InlineAsmTemplatePiece.to_string(asm.template) }];
  for (const [o, _] of asm.operands) args.push({ $: "Operand", _0: o });
  if (!ast.InlineAsmOptions.is_empty(asm.options)) {
    args.push({ $: "Options", _0: asm.options });
  }

  this.s.popen();
  this.commasep(Breaks.Consistent, args, (s, arg) => {
    switch (arg.$) {
      case "Template": {
        const template = arg._0;
        s.print_string(template, ast.StrStyle.Cooked);
        break;
      }
      case "Operand": {
        const op = arg._0;
        switch (op.$) {
          case "In": {
            const { reg, expr } = op;
            s.s.word("in");
            s.s.popen();
            s.s.word(hir.display_InlineAsmRegOrRegClass(reg));
            s.s.pclose();
            s.s.space();
            s.print_expr(expr);
            break;
          }
          case "Out": {
            const { reg, late, expr } = op;
            s.s.word(late ? "lateout" : "out");
            s.s.popen();
            s.s.word(hir.display_InlineAsmRegOrRegClass(reg));
            s.s.pclose();
            s.s.space();
            if (expr !== undefined) {
              s.print_expr(expr);
            } else {
              s.s.word("_");
            }
            break;
          }
          case "InOut": {
            const { reg, late, expr } = op;
            s.s.word(late ? "inlateout" : "inout");
            s.s.popen();
            s.s.word(hir.display_InlineAsmRegOrRegClass(reg));
            s.s.pclose();
            s.s.space();
            s.print_expr(expr);
            break;
          }
          case "SplitInOut": {
            const { reg, late, in_expr, out_expr } = op;
            s.s.word(late ? "inlateout" : "inout");
            s.s.popen();
            s.s.word(hir.display_InlineAsmRegOrRegClass(reg));
            s.s.pclose();
            s.s.space();
            s.print_expr(in_expr);
            s.s.space();
            s.s.word_space("=>");
            if (out_expr !== undefined) {
              s.print_expr(out_expr);
            } else {
              s.s.word("_");
            }
            break;
          }
          case "Const": {
            const { anon_const } = op;
            s.s.word("const");
            s.s.space();
            // Not using `print_inline_const` to avoid additional `const { ... }`
            s.ann.nested(s, { $: "Body", _0: anon_const.body });
            break;
          }
          case "SymFn": {
            const { expr } = op;
            s.s.word("sym_fn");
            s.s.space();
            s.print_expr(expr);
            break;
          }
          case "SymStatic": {
            const { path } = op;
            s.s.word("sym_static");
            s.s.space();
            s.print_qpath(path, true);
            break;
          }
          case "Label": {
            const { block } = op;
            const [cb, ib] = s.head("label");
            s.print_block(block, cb, ib);
            break;
          }
        }
        break;
      }
      case "Options": {
        const opts = arg._0;
        s.s.word("options");
        s.s.popen();
        s.commasep(Breaks.Inconsistent, ast.InlineAsmOptions.human_readable_names(opts), (s, opt) => {
          s.s.word(opt);
        });
        s.s.pclose();
        break;
      }
    }
  });
  this.s.pclose();
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1564 print_expr
State.prototype.print_expr = function (this: State, expr: hir.Expr): void {
  this.maybe_print_comment(Span.lo(expr.span));
  this.print_attrs(this.attrs(expr.hir_id));
  const ib = this.s.ibox(INDENT_UNIT);
  this.ann.pre(this, { $: "Expr", _0: expr });
  const kind = expr.kind;
  switch (kind.$) {
    case "Array": {
      const exprs = kind._0;
      this.print_expr_vec(exprs);
      break;
    }
    case "ConstBlock": {
      const anon_const = kind._0;
      this.print_inline_const(anon_const);
      break;
    }
    case "Repeat": {
      const element = kind._0;
      const count = kind._1;
      this.print_expr_repeat(element, count);
      break;
    }
    case "Struct": {
      const qpath = kind._0;
      const fields = kind._1;
      const wth = kind._2;
      this.print_expr_struct(qpath, fields, wth);
      break;
    }
    case "Tup": {
      const exprs = kind._0;
      this.print_expr_tup(exprs);
      break;
    }
    case "Call": {
      const func = kind._0;
      const args = kind._1;
      this.print_expr_call(func, args);
      break;
    }
    case "MethodCall": {
      const segment = kind._0;
      const receiver = kind._1;
      const args = kind._2;
      this.print_expr_method_call(segment, receiver, args);
      break;
    }
    case "Use": {
      const expr = kind._0;
      this.print_expr(expr);
      this.s.word(".use");
      break;
    }
    case "Binary": {
      const op = kind._0;
      const lhs = kind._1;
      const rhs = kind._2;
      this.print_expr_binary(op.node, lhs, rhs);
      break;
    }
    case "Unary": {
      const op = kind._0;
      const expr = kind._1;
      this.print_expr_unary(op, expr);
      break;
    }
    case "AddrOf": {
      const k = kind._0;
      const m = kind._1;
      const expr = kind._2;
      this.print_expr_addr_of(k, m, expr);
      break;
    }
    case "Lit": {
      const lit = kind._0;
      this.print_literal(lit);
      break;
    }
    case "Cast": {
      const expr = kind._0;
      const ty = kind._1;
      this.print_expr_cond_paren(expr, lt(this.precedence(expr), "Cast"));
      this.s.space();
      this.s.word_space("as");
      this.print_type(ty);
      break;
    }
    case "Type": {
      const expr = kind._0;
      const ty = kind._1;
      this.s.word("type_ascribe!(");
      const ib = this.s.ibox(0);
      this.print_expr(expr);

      this.s.word(",");
      this.s.space_if_not_bol();
      this.print_type(ty);

      this.s.end(ib);
      this.s.word(")");
      break;
    }
    case "DropTemps": {
      const init = kind._0;
      // Print `{`:
      const cb = this.s.cbox(0);
      const ib = this.s.ibox(0);
      this.bopen(ib);

      // Print `let _t = $init;`:
      const temp = Ident.with_dummy_span(sym._t);
      this.print_local(false, init, undefined, (this_) => this_.print_ident(temp));
      this.s.word(";");

      // Print `_t`:
      this.s.space_if_not_bol();
      this.print_ident(temp);

      // Print `}`:
      this.bclose_maybe_open_(expr.span, cb);
      break;
    }
    case "Let": {
      const { pat, ty, init } = kind._0;
      this.print_let(pat, ty, init);
      break;
    }
    case "If": {
      const test = kind._0;
      const blk = kind._1;
      const elseopt = kind._2;
      this.print_if(test, blk, elseopt);
      break;
    }
    case "Loop": {
      const blk = kind._0;
      const opt_label = kind._1;
      const cb = this.s.cbox(0);
      const ib = this.s.ibox(0);
      if (opt_label !== undefined) {
        const label = opt_label;
        this.print_ident(label.ident);
        this.s.word_space(":");
      }
      this.s.word_nbsp("loop");
      this.print_block(blk, cb, ib);
      break;
    }
    case "Match": {
      const expr = kind._0;
      const arms = kind._1;
      const cb = this.s.cbox(0);
      const ib = this.s.ibox(0);
      this.s.word_nbsp("match");
      this.print_expr_as_cond(expr);
      this.s.space();
      this.bopen(ib);
      for (const arm of arms) {
        this.print_arm(arm);
      }
      this.bclose_(expr.span, cb);
      break;
    }
    case "Closure": {
      const {
        binder,
        constness,
        capture_clause,
        bound_generic_params,
        fn_decl,
        body,
        fn_decl_span: _fn_decl_span,
        fn_arg_span: _fn_arg_span,
        kind: _kind,
        def_id: _def_id,
        explicit_captures: _explicit_captures,
      } = kind._0;
      this.print_closure_binder(binder, bound_generic_params);
      this.print_constness(constness);
      this.print_capture_clause(capture_clause);

      this.print_closure_params(fn_decl, body);
      this.s.space();

      // This is a bare expression.
      this.ann.nested(this, { $: "Body", _0: body });
      break;
    }
    case "Block": {
      const blk = kind._0;
      const opt_label = kind._1;
      if (opt_label !== undefined) {
        const label = opt_label;
        this.print_ident(label.ident);
        this.s.word_space(":");
      }
      // containing cbox, will be closed by print-block at `}`
      const cb = this.s.cbox(0);
      // head-box, will be closed by print-block after `{`
      const ib = this.s.ibox(0);
      this.print_block(blk, cb, ib);
      break;
    }
    case "Assign": {
      const lhs = kind._0;
      const rhs = kind._1;
      this.print_expr_cond_paren(lhs, le(this.precedence(lhs), "Assign"));
      this.s.space();
      this.s.word_space("=");
      this.print_expr_cond_paren(rhs, lt(this.precedence(rhs), "Assign"));
      break;
    }
    case "AssignOp": {
      const op = kind._0;
      const lhs = kind._1;
      const rhs = kind._2;
      this.print_expr_cond_paren(lhs, le(this.precedence(lhs), "Assign"));
      this.s.space();
      this.s.word_space(ast.AssignOpKind.as_str(op.node));
      this.print_expr_cond_paren(rhs, lt(this.precedence(rhs), "Assign"));
      break;
    }
    case "Field": {
      const expr = kind._0;
      const ident = kind._1;
      this.print_expr_cond_paren(expr, lt(this.precedence(expr), "Unambiguous"));
      this.s.word(".");
      this.print_ident(ident);
      break;
    }
    case "Index": {
      const expr = kind._0;
      const index = kind._1;
      this.print_expr_cond_paren(expr, lt(this.precedence(expr), "Unambiguous"));
      this.s.word("[");
      this.print_expr(index);
      this.s.word("]");
      break;
    }
    case "Path": {
      const qpath = kind._0;
      this.print_qpath(qpath, true);
      break;
    }
    case "Break": {
      const destination = kind._0;
      const opt_expr = kind._1;
      this.s.word("break");
      const label = destination.label;
      if (label !== undefined) {
        this.s.space();
        this.print_ident(label.ident);
      }
      if (opt_expr !== undefined) {
        const expr = opt_expr;
        this.s.space();
        this.print_expr_cond_paren(expr, lt(this.precedence(expr), "Jump"));
      }
      break;
    }
    case "Continue": {
      const destination = kind._0;
      this.s.word("continue");
      const label = destination.label;
      if (label !== undefined) {
        this.s.space();
        this.print_ident(label.ident);
      }
      break;
    }
    case "Ret": {
      const result = kind._0;
      this.s.word("return");
      if (result !== undefined) {
        const expr = result;
        this.s.word(" ");
        this.print_expr_cond_paren(expr, lt(this.precedence(expr), "Jump"));
      }
      break;
    }
    case "Become": {
      const result = kind._0;
      this.s.word("become");
      this.s.word(" ");
      this.print_expr_cond_paren(result, lt(this.precedence(result), "Jump"));
      break;
    }
    case "InlineAsm": {
      const asm = kind._0;
      this.s.word(`${ast.AsmMacro.macro_name(asm.asm_macro)}!`);
      this.print_inline_asm(asm);
      break;
    }
    case "OffsetOf": {
      const container = kind._0;
      const fields = kind._1;
      this.s.word("offset_of!(");
      this.print_type(container);
      this.s.word(",");
      this.s.space();

      if (fields.length !== 0) {
        const first = fields[0]!;
        const rest = fields.slice(1);
        this.print_ident(first);

        for (const field of rest) {
          this.s.word(".");
          this.print_ident(field);
        }
      }

      this.s.word(")");
      break;
    }
    case "UnsafeBinderCast": {
      const k = kind._0;
      const expr = kind._1;
      const ty = kind._2;
      switch (k) {
        case "Wrap":
          this.s.word("wrap_binder!(");
          break;
        case "Unwrap":
          this.s.word("unwrap_binder!(");
          break;
      }
      this.print_expr(expr);
      if (ty !== undefined) {
        this.s.word(",");
        this.s.space();
        this.print_type(ty);
      }
      this.s.word(")");
      break;
    }
    case "Yield": {
      const expr = kind._0;
      this.s.word_space("yield");
      this.print_expr_cond_paren(expr, lt(this.precedence(expr), "Jump"));
      break;
    }
    case "Err": {
      this.s.popen();
      this.s.word("/*ERROR*/");
      this.s.pclose();
      break;
    }
  }
  this.ann.post(this, { $: "Expr", _0: expr });
  this.s.end(ib);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1813 print_local_decl
State.prototype.print_local_decl = function (this: State, loc: hir.LetStmt): void {
  this.print_pat(loc.pat);
  const ty = loc.ty;
  if (ty !== undefined) {
    this.s.word_space(":");
    this.print_type(ty);
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1821 print_name
State.prototype.print_name = function (this: State, name: Symbol): void {
  this.print_ident(Ident.with_dummy_span(name));
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1825 print_path
State.prototype.print_path_ = function <R>(this: State, path: hir.Path<R>, colons_before_params: boolean): void {
  this.maybe_print_comment(Span.lo(path.span));

  for (let i = 0; i < path.segments.length; i++) {
    const segment = path.segments[i]!;
    if (i > 0) {
      this.s.word("::");
    }
    if (segment.ident.name !== kw.PathRoot) {
      this.print_ident(segment.ident);
      this.print_generic_args_(segment.args_(), colons_before_params);
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1839 print_path_segment
State.prototype.print_path_segment_ = function (this: State, segment: hir.PathSegment): void {
  if (segment.ident.name !== kw.PathRoot) {
    this.print_ident(segment.ident);
    this.print_generic_args_(segment.args_(), false);
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1846 print_qpath
State.prototype.print_qpath = function (this: State, qpath: hir.QPath, colons_before_params: boolean): void {
  switch (qpath.$) {
    case "Resolved": {
      const path = qpath._1;
      if (qpath._0 === undefined) {
        this.print_path_(path, colons_before_params);
        break;
      }
      const qself = qpath._0;
      this.s.word("<");
      this.print_type(qself);
      this.s.space();
      this.s.word_space("as");

      const segments = slice_to(path.segments, path.segments.length - 1);
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]!;
        if (i > 0) {
          this.s.word("::");
        }
        if (segment.ident.name !== kw.PathRoot) {
          this.print_ident(segment.ident);
          this.print_generic_args_(segment.args_(), colons_before_params);
        }
      }

      this.s.word(">");
      this.s.word("::");
      const item_segment = unwrap(path.segments[path.segments.length - 1]);
      this.print_ident(item_segment.ident);
      this.print_generic_args_(item_segment.args_(), colons_before_params);
      break;
    }
    case "TypeRelative": {
      const qself = qpath._0;
      const item_segment = qpath._1;
      // If we've got a compound-qualified-path, let's push an additional pair of angle
      // brackets, so that we pretty-print `<<A::B>::C>` as `<A::B>::C`, instead of just
      // `A::B::C` (since the latter could be ambiguous to the user)
      if (qself.kind.$ === "Path" && qself.kind._0.$ === "Resolved" && qself.kind._0._0 === undefined) {
        this.print_type(qself);
      } else {
        this.s.word("<");
        this.print_type(qself);
        this.s.word(">");
      }

      this.s.word("::");
      this.print_ident(item_segment.ident);
      this.print_generic_args_(item_segment.args_(), colons_before_params);
      break;
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1890 print_generic_args
State.prototype.print_generic_args_ = function (
  this: State,
  generic_args: hir.GenericArgs,
  colons_before_params: boolean,
): void {
  switch (generic_args.parenthesized) {
    case "No": {
      const start = colons_before_params ? "::<" : "<";
      // PORT: `Cell<bool>` -> a captured `let`.
      let empty = true;
      const start_or_comma = (this_: State): void => {
        if (empty) {
          empty = false;
          this_.s.word(start);
        } else {
          this_.s.word_space(",");
        }
      };

      let nonelided_generic_args: boolean = false;
      // PORT: `Iterator::all` stops at the first `false`; the closure's side effect on `nonelided_generic_args`
      // happens only up to there.
      let elide_lifetimes = true;
      for (const arg of generic_args.args) {
        let r: boolean;
        if (arg.$ === "Lifetime" && arg._0.is_elided()) {
          r = true;
        } else if (arg.$ === "Lifetime") {
          nonelided_generic_args = true;
          r = false;
        } else {
          nonelided_generic_args = true;
          r = true;
        }
        if (!r) {
          elide_lifetimes = false;
          break;
        }
      }

      if (nonelided_generic_args) {
        start_or_comma(this);
        this.commasep(Breaks.Inconsistent, generic_args.args, (s, generic_arg) =>
          s.print_generic_arg(generic_arg, elide_lifetimes),
        );
      }

      for (const constraint of generic_args.constraints) {
        start_or_comma(this);
        this.print_assoc_item_constraint(constraint);
      }

      if (!empty) {
        this.s.word(">");
      }
      break;
    }
    case "ParenSugar": {
      const [inputs, output] = unwrap(generic_args.paren_sugar_inputs_output());

      this.s.word("(");
      this.commasep(Breaks.Inconsistent, inputs, (s, ty) => s.print_type(ty));
      this.s.word(")");

      this.s.space_if_not_bol();
      this.s.word_space("->");
      this.print_type(output);
      break;
    }
    case "ReturnTypeNotation": {
      this.s.word("(..)");
      break;
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1954 print_assoc_item_constraint
State.prototype.print_assoc_item_constraint = function (this: State, constraint: hir.AssocItemConstraint): void {
  this.print_ident(constraint.ident);
  this.print_generic_args_(constraint.gen_args, false);
  this.s.space();
  const kind = constraint.kind;
  switch (kind.$) {
    case "Equality": {
      const term: Term = kind.term;
      this.s.word_space("=");
      switch (term.$) {
        case "Ty":
          this.print_type(term._0);
          break;
        case "Const":
          this.print_const_arg(term._0);
          break;
      }
      break;
    }
    case "Bound": {
      const bounds = kind.bounds;
      this.print_bounds(":", bounds);
      break;
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1972 print_pat_expr
State.prototype.print_pat_expr = function (this: State, expr: hir.PatExpr): void {
  const kind = expr.kind;
  switch (kind.$) {
    case "Lit": {
      const { lit, negated } = kind;
      if (negated) {
        this.s.word("-");
      }
      this.print_literal(lit);
      break;
    }
    case "Path": {
      const qpath = kind._0;
      this.print_qpath(qpath, true);
      break;
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1984 print_ty_pat
State.prototype.print_ty_pat = function (this: State, pat: hir.TyPat): void {
  this.maybe_print_comment(Span.lo(pat.span));
  this.ann.pre(this, { $: "TyPat", _0: pat });
  // Pat isn't normalized, but the beauty of it
  // is that it doesn't matter
  const kind: TyPatKind = pat.kind;
  switch (kind.$) {
    case "Range": {
      const begin = kind._0;
      const end = kind._1;
      this.print_const_arg(begin);
      this.s.word("..=");
      this.print_const_arg(end);
      break;
    }
    case "NotNull": {
      this.s.word_space("not");
      this.s.word("null");
      break;
    }
    case "Or": {
      const patterns = kind._0;
      this.s.popen();
      let first = true;
      for (const pat of patterns) {
        if (first) {
          first = false;
        } else {
          this.s.word(" | ");
        }
        this.print_ty_pat(pat);
      }
      this.s.pclose();
      break;
    }
    case "Err": {
      this.s.popen();
      this.s.word("/*ERROR*/");
      this.s.pclose();
      break;
    }
  }
  this.ann.post(this, { $: "TyPat", _0: pat });
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2021 print_pat
State.prototype.print_pat = function (this: State, pat: hir.Pat): void {
  this.maybe_print_comment(Span.lo(pat.span));
  this.ann.pre(this, { $: "Pat", _0: pat });
  // Pat isn't normalized, but the beauty of it is that it doesn't matter.
  const kind: PatKind = pat.kind;
  switch (kind.$) {
    // Printing `_` isn't ideal for a missing pattern, but it's easy and good enough.
    // E.g. `fn(u32)` gets printed as `fn(_: u32)`.
    case "Missing":
      this.s.word("_");
      break;
    case "Wild":
      this.s.word("_");
      break;
    case "Never":
      this.s.word("!");
      break;
    case "Binding": {
      const by_ref = kind._0._0;
      const mutbl = kind._0._1;
      const ident = kind._2;
      const sub = kind._3;
      if (Mutability.is_mut(mutbl)) {
        this.s.word_nbsp("mut");
      }
      if (by_ref.$ === "Yes") {
        const pinnedness = by_ref._0;
        const rmutbl = by_ref._1;
        this.s.word_nbsp("ref");
        if (Pinnedness.is_pinned(pinnedness)) {
          this.s.word_nbsp("pin");
        }
        if (Mutability.is_mut(rmutbl)) {
          this.s.word_nbsp("mut");
        } else if (Pinnedness.is_pinned(pinnedness)) {
          this.s.word_nbsp("const");
        }
      }
      this.print_ident(ident);
      if (sub !== undefined) {
        const p = sub;
        this.s.word("@");
        this.print_pat(p);
      }
      break;
    }
    case "TupleStruct": {
      const qpath = kind._0;
      const elts = kind._1;
      const ddpos_ = kind._2;
      this.print_qpath(qpath, true);
      this.s.popen();
      const ddpos = ddpos_.as_opt_usize();
      if (ddpos !== undefined) {
        this.commasep(Breaks.Inconsistent, slice_to(elts, ddpos), (s, p) => s.print_pat(p));
        if (ddpos !== 0) {
          this.s.word_space(",");
        }
        this.s.word("..");
        if (ddpos !== elts.length) {
          this.s.word(",");
          this.commasep(Breaks.Inconsistent, slice_from(elts, ddpos), (s, p) => s.print_pat(p));
        }
      } else {
        this.commasep(Breaks.Inconsistent, elts, (s, p) => s.print_pat(p));
      }
      this.s.pclose();
      break;
    }
    case "Struct": {
      const qpath = kind._0;
      const fields = kind._1;
      const etc = kind._2;
      this.print_qpath(qpath, true);
      this.s.nbsp();
      this.s.word("{");
      const empty = fields.length === 0 && etc === undefined;
      if (!empty) {
        this.s.space();
      }
      this.commasep_cmnt(
        Breaks.Consistent,
        fields,
        (s, f) => s.print_patfield(f),
        (f) => f.pat.span,
      );
      if (etc !== undefined) {
        if (fields.length !== 0) {
          this.s.word_space(",");
        }
        this.s.word("..");
      }
      if (!empty) {
        this.s.space();
      }
      this.s.word("}");
      break;
    }
    case "Or": {
      const pats = kind._0;
      this.strsep("|", true, Breaks.Inconsistent, pats, (s, p) => s.print_pat(p));
      break;
    }
    case "Tuple": {
      const elts = kind._0;
      const ddpos_ = kind._1;
      this.s.popen();
      const ddpos = ddpos_.as_opt_usize();
      if (ddpos !== undefined) {
        this.commasep(Breaks.Inconsistent, slice_to(elts, ddpos), (s, p) => s.print_pat(p));
        if (ddpos !== 0) {
          this.s.word_space(",");
        }
        this.s.word("..");
        if (ddpos !== elts.length) {
          this.s.word(",");
          this.commasep(Breaks.Inconsistent, slice_from(elts, ddpos), (s, p) => s.print_pat(p));
        }
      } else {
        this.commasep(Breaks.Inconsistent, elts, (s, p) => s.print_pat(p));
        if (elts.length === 1) {
          this.s.word(",");
        }
      }
      this.s.pclose();
      break;
    }
    case "Deref": {
      const inner = kind._0;
      this.s.word("deref!");
      this.s.popen();
      this.print_pat(inner);
      this.s.pclose();
      break;
    }
    case "Ref": {
      const inner = kind._0;
      const pinned = kind._1;
      const mutbl = kind._2;
      const is_range_inner = inner.kind.$ === "Range";
      this.s.word("&");
      if (Pinnedness.is_pinned(pinned)) {
        this.s.word("pin ");
        if (Mutability.is_not(mutbl)) {
          this.s.word("const ");
        }
      }
      this.s.word(Mutability.prefix_str(mutbl));
      if (is_range_inner) {
        this.s.popen();
      }
      this.print_pat(inner);
      if (is_range_inner) {
        this.s.pclose();
      }
      break;
    }
    case "Expr": {
      const e = kind._0;
      this.print_pat_expr(e);
      break;
    }
    case "Range": {
      const begin = kind._0;
      const end = kind._1;
      const end_kind: RangeEnd = kind._2;
      if (begin !== undefined) {
        const expr = begin;
        this.print_pat_expr(expr);
      }
      switch (end_kind) {
        case "Included":
          this.s.word("...");
          break;
        case "Excluded":
          this.s.word("..");
          break;
      }
      if (end !== undefined) {
        const expr = end;
        this.print_pat_expr(expr);
      }
      break;
    }
    case "Slice": {
      const before = kind._0;
      const slice = kind._1;
      const after = kind._2;
      this.s.word("[");
      this.commasep(Breaks.Inconsistent, before, (s, p) => s.print_pat(p));
      if (slice !== undefined) {
        const p = slice;
        if (before.length !== 0) {
          this.s.word_space(",");
        }
        if (p.kind.$ === "Wild") {
          // Print nothing.
        } else {
          this.print_pat(p);
        }
        this.s.word("..");
        if (after.length !== 0) {
          this.s.word_space(",");
        }
      }
      this.commasep(Breaks.Inconsistent, after, (s, p) => s.print_pat(p));
      this.s.word("]");
      break;
    }
    case "Guard": {
      const inner = kind._0;
      const cond = kind._1;
      this.print_pat(inner);
      this.s.space();
      this.s.word_space("if");
      this.print_expr(cond);
      break;
    }
    case "Err": {
      this.s.popen();
      this.s.word("/*ERROR*/");
      this.s.pclose();
      break;
    }
  }
  this.ann.post(this, { $: "Pat", _0: pat });
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2185 print_patfield
State.prototype.print_patfield = function (this: State, field: hir.PatField): void {
  if (this.attrs(field.hir_id).length === 0) {
    this.s.space();
  }
  const cb = this.s.cbox(INDENT_UNIT);
  this.print_attrs(this.attrs(field.hir_id));
  if (!field.is_shorthand) {
    this.print_ident(field.ident);
    this.s.word_nbsp(":");
  }
  this.print_pat(field.pat);
  this.s.end(cb);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2199 print_param
State.prototype.print_param = function (this: State, arg: hir.Param): void {
  this.print_attrs(this.attrs(arg.hir_id));
  this.print_pat(arg.pat);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2204 print_implicit_self
State.prototype.print_implicit_self = function (this: State, implicit_self_kind: ImplicitSelfKind): void {
  switch (implicit_self_kind) {
    case "Imm": {
      this.s.word("self");
      break;
    }
    case "Mut": {
      this.print_mutability("Mut", false);
      this.s.word("self");
      break;
    }
    case "RefImm": {
      this.s.word("&");
      this.s.word("self");
      break;
    }
    case "RefMut": {
      this.s.word("&");
      this.print_mutability("Mut", false);
      this.s.word("self");
      break;
    }
    case "None":
      unreachable();
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2226 print_arm
State.prototype.print_arm = function (this: State, arm: hir.Arm): void {
  // I have no idea why this check is necessary, but here it
  // is :(
  if (this.attrs(arm.hir_id).length === 0) {
    this.s.space();
  }
  const cb = this.s.cbox(INDENT_UNIT);
  this.ann.pre(this, { $: "Arm", _0: arm });
  const ib = this.s.ibox(0);
  this.print_attrs(this.attrs(arm.hir_id));
  this.print_pat(arm.pat);
  this.s.space();
  if (arm.guard !== undefined) {
    const g = arm.guard;
    this.s.word_space("if");
    this.print_expr(g);
    this.s.space();
  }
  this.s.word_space("=>");

  const body_kind = arm.body.kind;
  switch (body_kind.$) {
    case "Block": {
      const blk = body_kind._0;
      const opt_label = body_kind._1;
      if (opt_label !== undefined) {
        const label = opt_label;
        this.print_ident(label.ident);
        this.s.word_space(":");
      }
      this.print_block_unclosed(blk, ib);

      // If it is a user-provided unsafe block, print a comma after it
      if (blk.rules.$ === "UnsafeBlock" && blk.rules._0 === "UserProvided") {
        this.s.word(",");
      }
      break;
    }
    default: {
      this.s.end(ib);
      this.print_expr(arm.body);
      this.s.word(",");
      break;
    }
  }
  this.ann.post(this, { $: "Arm", _0: arm });
  this.s.end(cb);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2269 print_fn
State.prototype.print_fn = function (
  this: State,
  header: hir.FnHeader,
  name: Symbol | undefined,
  generics: hir.Generics,
  decl: hir.FnDecl,
  arg_idents: readonly (Ident | undefined)[],
  body_id: hir.BodyId | undefined,
): void {
  this.print_fn_header_info(header);

  if (name !== undefined) {
    this.s.nbsp();
    this.print_name(name);
  }
  this.print_generic_params(generics.params);

  this.s.popen();
  // Make sure we aren't supplied *both* `arg_idents` and `body_id`.
  assert(arg_idents.length === 0 || body_id === undefined, "assertion failed: arg_idents.is_empty() || body_id.is_none()");
  let i = 0;
  const print_arg = (s: State, ty: hir.Ty | undefined): void => {
    if (i === decl.splatted()) {
      s.s.word("#[rustc_splat]");
    }
    if (i === 0 && hir.ImplicitSelfKind.has_implicit_self(decl.implicit_self())) {
      s.print_implicit_self(decl.implicit_self());
    } else {
      // PORT: `arg_idents.get(i)` is `Option<&Option<Ident>>`: the bounds check, then the inner `Option`.
      if (i < arg_idents.length) {
        const arg_ident = arg_idents[i];
        if (arg_ident !== undefined) {
          s.s.word(display_Ident(arg_ident));
          s.s.word(":");
          s.s.space();
        }
      } else if (body_id !== undefined) {
        s.ann.nested(s, { $: "BodyParamPat", _0: body_id, _1: i });
        s.s.word(":");
        s.s.space();
      }
      if (ty !== undefined) {
        s.print_type(ty);
      }
    }
    i += 1;
  };
  this.commasep(Breaks.Inconsistent, decl.inputs, (s, ty) => {
    const ib = s.s.ibox(INDENT_UNIT);
    print_arg(s, ty);
    s.s.end(ib);
  });
  if (decl.c_variadic()) {
    if (decl.inputs.length !== 0) {
      this.s.word(", ");
    }
    print_arg(this, undefined);
    this.s.word("...");
  }
  this.s.pclose();

  this.print_fn_output(decl);
  this.print_where_clause(generics);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2332 print_closure_params
State.prototype.print_closure_params = function (this: State, decl: hir.FnDecl, body_id: hir.BodyId): void {
  this.s.word("|");
  let i = 0;
  this.commasep(Breaks.Inconsistent, decl.inputs, (s, ty) => {
    const ib = s.s.ibox(INDENT_UNIT);

    s.ann.nested(s, { $: "BodyParamPat", _0: body_id, _1: i });
    i += 1;

    if (ty.kind.$ === "Infer") {
      // Print nothing.
    } else {
      s.s.word(":");
      s.s.space();
      s.print_type(ty);
    }
    s.s.end(ib);
  });
  this.s.word("|");

  const output = decl.output;
  switch (output.$) {
    case "Return": {
      const ty = output._0;
      this.s.space_if_not_bol();
      this.s.word_space("->");
      this.print_type(ty);
      this.maybe_print_comment(Span.lo(ty.span));
      break;
    }
    case "DefaultReturn":
      break;
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2363 print_capture_clause
State.prototype.print_capture_clause = function (this: State, capture_clause: ast.CaptureBy): void {
  switch (capture_clause.$) {
    case "Value":
      this.s.word_space("move");
      break;
    case "Use":
      this.s.word_space("use");
      break;
    case "Ref":
      break;
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2371 print_closure_binder
State.prototype.print_closure_binder = function (
  this: State,
  binder: hir.ClosureBinder,
  generic_params_: readonly GenericParam[],
): void {
  const generic_params = generic_params_.filter(
    (p) => p.kind.$ === "Lifetime" && p.kind.kind.$ === "Explicit",
  );

  switch (binder.$) {
    case "Default":
      break;
    // We need to distinguish `|...| {}` from `for<> |...| {}` as `for<>` adds additional
    // restrictions.
    case "For": {
      if (generic_params.length === 0) {
        this.s.word("for<>");
        break;
      }
      this.s.word("for");
      this.s.word("<");

      this.commasep(Breaks.Inconsistent, generic_params, (s, param) => s.print_generic_param(param));

      this.s.word(">");
      this.s.nbsp();
      break;
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2408 print_bounds
State.prototype.print_bounds = function (this: State, prefix: string, bounds: Iterable<GenericBound>): void {
  let first = true;
  for (const bound of bounds) {
    if (first) {
      this.s.word(prefix);
    }
    if (!(first && prefix === "")) {
      this.s.nbsp();
    }
    if (first) {
      first = false;
    } else {
      this.s.word_space("+");
    }

    switch (bound.$) {
      case "Trait": {
        const tref = bound._0;
        this.print_poly_trait_ref(tref);
        break;
      }
      case "Outlives": {
        const lt = bound._0;
        this.print_lifetime(lt);
        break;
      }
      case "Use": {
        const args = bound._0;
        this.s.word("use <");

        this.commasep(Breaks.Inconsistent, args, (s, arg) => s.print_precise_capturing_arg(arg));

        this.s.word(">");
        break;
      }
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2447 print_precise_capturing_arg
State.prototype.print_precise_capturing_arg = function (this: State, arg: PreciseCapturingArg): void {
  switch (arg.$) {
    case "Lifetime":
      this.print_lifetime(arg._0);
      break;
    case "Param":
      this.print_ident(arg._0.ident);
      break;
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2454 print_generic_params
State.prototype.print_generic_params = function (this: State, generic_params: readonly GenericParam[]): void {
  const is_lifetime_elided = (generic_param: GenericParam): boolean =>
    generic_param.kind.$ === "Lifetime" && generic_param.kind.kind.$ === "Elided";

  // We don't want to show elided lifetimes as they are compiler-inserted and not
  // expressible in surface level Rust.
  if (generic_params.length !== 0 && !generic_params.every(is_lifetime_elided)) {
    this.s.word("<");

    this.commasep(
      Breaks.Inconsistent,
      generic_params.filter((gp) => !is_lifetime_elided(gp)),
      (s, param) => s.print_generic_param(param),
    );

    this.s.word(">");
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2477 print_generic_param
State.prototype.print_generic_param = function (this: State, param: GenericParam): void {
  if (param.kind.$ === "Const") {
    this.s.word_space("const");
  }

  this.print_ident(hir.ParamName.ident(param.name));

  const kind = param.kind;
  switch (kind.$) {
    case "Lifetime":
      break;
    case "Type": {
      const default_ = kind.default;
      if (default_ !== undefined) {
        this.s.space();
        this.s.word_space("=");
        this.print_type(default_);
      }
      break;
    }
    case "Const": {
      const ty = kind.ty;
      const default_ = kind.default;
      this.s.word_space(":");
      this.print_type(ty);
      if (default_ !== undefined) {
        this.s.space();
        this.s.word_space("=");
        this.print_const_arg(default_);
      }
      break;
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2505 print_lifetime
State.prototype.print_lifetime = function (this: State, lifetime: hir.Lifetime): void {
  this.print_ident(lifetime.ident);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2509 print_where_clause
State.prototype.print_where_clause = function (this: State, generics: hir.Generics): void {
  if (generics.predicates.length === 0) {
    return;
  }

  this.s.space();
  this.s.word_space("where");

  for (let i = 0; i < generics.predicates.length; i++) {
    const predicate = generics.predicates[i]!;
    if (i !== 0) {
      this.s.word_space(",");
    }
    this.print_where_predicate(predicate);
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2525 print_where_predicate
State.prototype.print_where_predicate = function (this: State, predicate: hir.WherePredicate): void {
  this.print_attrs(this.attrs(predicate.hir_id));
  const kind = predicate.kind;
  switch (kind.$) {
    case "BoundPredicate": {
      const { bound_generic_params, bounded_ty, bounds } = kind._0;
      this.print_formal_generic_params(bound_generic_params);
      this.print_type(bounded_ty);
      this.print_bounds(":", bounds);
      break;
    }
    case "RegionPredicate": {
      const { lifetime, bounds } = kind._0;
      this.print_lifetime(lifetime);
      this.s.word(":");

      for (let i = 0; i < bounds.length; i++) {
        const bound = bounds[i]!;
        switch (bound.$) {
          case "Outlives": {
            const lt = bound._0;
            this.print_lifetime(lt);
            break;
          }
          default:
            panic(`unexpected bound on lifetime param: ${format_debug(bound, hir.debug_GenericBound, PLAIN)}`);
        }

        if (i !== 0) {
          this.s.word(":");
        }
      }
      break;
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2562 print_mutability
State.prototype.print_mutability = function (this: State, mutbl: Mutability, print_const: boolean): void {
  switch (mutbl) {
    case "Mut":
      this.s.word_nbsp("mut");
      break;
    case "Not": {
      if (print_const) {
        this.s.word_nbsp("const");
      }
      break;
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2573 print_fn_output
State.prototype.print_fn_output = function (this: State, decl: hir.FnDecl): void {
  const output = decl.output;
  switch (output.$) {
    case "Return": {
      const ty = output._0;
      this.s.space_if_not_bol();
      const ib = this.s.ibox(INDENT_UNIT);
      this.s.word_space("->");
      this.print_type(ty);
      this.s.end(ib);

      if (decl.output.$ === "Return") {
        const output = decl.output._0;
        this.maybe_print_comment(Span.lo(output.span));
      }
      break;
    }
    case "DefaultReturn":
      break;
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2590 print_ty_fn
State.prototype.print_ty_fn = function (
  this: State,
  abi: ExternAbi,
  safety: hir.Safety,
  decl: hir.FnDecl,
  name: Symbol | undefined,
  generic_params: readonly hir.GenericParam[],
  arg_idents: readonly (Ident | undefined)[],
): void {
  const ib = this.s.ibox(INDENT_UNIT);
  this.print_formal_generic_params(generic_params);
  const generics = hir.Generics.empty();
  this.print_fn(
    new hir.FnHeader(hir.HeaderSafety.from(safety), hir.Constness.NotConst, hir.IsAsync.NotAsync, abi),
    name,
    generics,
    decl,
    arg_idents,
    undefined,
  );
  this.s.end(ib);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2618 print_fn_header_info
State.prototype.print_fn_header_info = function (this: State, header: hir.FnHeader): void {
  this.print_constness(header.constness);

  let safety: hir.Safety;
  switch (header.safety.$) {
    case "SafeTargetFeatures":
      this.s.word_nbsp("#[target_feature]");
      safety = "Safe";
      break;
    case "Normal":
      safety = header.safety._0;
      break;
  }

  switch (header.asyncness.$) {
    case "NotAsync":
      break;
    case "Async":
      this.s.word_nbsp("async");
      break;
  }

  this.print_safety(safety);

  if (!ExternAbiNs.eq(header.abi, ExternAbiNs.Rust)) {
    this.s.word_nbsp("extern");
    this.s.word_nbsp(display_ExternAbi(header.abi));
  }

  this.s.word("fn");
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2644 print_constness
State.prototype.print_constness = function (this: State, s: hir.Constness): void {
  switch (s.$) {
    case "NotConst":
      break;
    case "Const":
      if (!s.always) {
        this.s.word_nbsp("const");
      } else {
        /* printed as an attribute */
      }
      break;
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2652 print_safety
State.prototype.print_safety = function (this: State, s: hir.Safety): void {
  switch (s) {
    case "Safe":
      break;
    case "Unsafe":
      this.s.word_nbsp("unsafe");
      break;
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2659 print_is_auto
State.prototype.print_is_auto = function (this: State, s: ast.IsAuto): void {
  switch (s) {
    case "Yes":
      this.s.word_nbsp("auto");
      break;
    case "No":
      break;
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2666 print_restriction
State.prototype.print_restriction = function (this: State, k: hir.RestrictionKind, prefix: string): void {
  switch (k.$) {
    case "Unrestricted":
      break;
    case "Restricted": {
      const path = k._0;
      this.s.word(prefix);
      this.s.word_nbsp("(in");
      this.print_path_(path, false);
      this.s.word_nbsp(")");
      break;
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2682 print_mut_restriction
State.prototype.print_mut_restriction = function (this: State, r: hir.MutRestriction): void {
  this.print_restriction(r.kind, "mut");
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2686 print_impl_restriction
State.prototype.print_impl_restriction = function (this: State, r: hir.ImplRestriction): void {
  this.print_restriction(r.kind, "impl");
};

/// Does this expression require a semicolon to be treated
/// as a statement? The negation of this: 'can this expression
/// be used as a statement without a semicolon' -- is used
/// as an early-bail-out in the parser so that, for instance,
///     if true {...} else {...}
///      |x| 5
/// isn't parsed as (if true {...} else {...} | x) | 5
//
// Duplicated from `parse::classify`, but adapted for the HIR.
// rustc: compiler/rustc_hir_pretty/src/lib.rs:2700 expr_requires_semi_to_be_stmt
export function expr_requires_semi_to_be_stmt(e: hir.Expr): boolean {
  return !(e.kind.$ === "If" || e.kind.$ === "Match" || e.kind.$ === "Block" || e.kind.$ === "Loop");
}

/// This statement requires a semicolon after it.
/// note that in one case (stmt_semi), we've already
/// seen the semicolon, and thus don't need another.
// rustc: compiler/rustc_hir_pretty/src/lib.rs:2713 stmt_ends_with_semi
export function stmt_ends_with_semi(stmt: hir.StmtKind): boolean {
  switch (stmt.$) {
    case "Let":
      return true;
    case "Item":
      return false;
    case "Expr":
      return expr_requires_semi_to_be_stmt(stmt._0);
    case "Semi":
      return false;
  }
}

/// Expressions that syntactically contain an "exterior" struct literal, i.e., not surrounded by any
/// parens or other delimiters, e.g., `X { y: 1 }`, `X { y: 1 }.method()`, `foo == X { y: 1 }` and
/// `X { y: 1 } == foo` all do, but `(X { y: 1 }) == foo` does not.
// rustc: compiler/rustc_hir_pretty/src/lib.rs:2725 contains_exterior_struct_lit
export function contains_exterior_struct_lit(value: hir.Expr): boolean {
  const kind = value.kind;
  switch (kind.$) {
    case "Struct":
      return true;

    case "Assign":
    case "AssignOp":
    case "Binary": {
      const lhs = kind.$ === "AssignOp" || kind.$ === "Binary" ? kind._1 : kind._0;
      const rhs = kind.$ === "AssignOp" || kind.$ === "Binary" ? kind._2 : kind._1;
      // `X { y: 1 } + X { y: 2 }`
      return contains_exterior_struct_lit(lhs) || contains_exterior_struct_lit(rhs);
    }
    case "Unary":
    case "Cast":
    case "Type":
    case "Field":
    case "Index": {
      const x = kind.$ === "Unary" ? kind._1 : kind._0;
      // `&X { y: 1 }, X { y: 1 }.y`
      return contains_exterior_struct_lit(x);
    }

    case "MethodCall": {
      const receiver = kind._1;
      // `X { y: 1 }.bar(...)`
      return contains_exterior_struct_lit(receiver);
    }

    default:
      return false;
  }
}
