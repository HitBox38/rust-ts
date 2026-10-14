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

import type { ExternAbi } from "../rustc_abi/extern_abi.ts";
import { display_ExternAbi } from "../rustc_abi/extern_abi.ts";
import { ast } from "../rustc_ast/lib.ts";
import { DUMMY_NODE_ID } from "../rustc_ast/node_id.ts";
import * as parser from "../rustc_ast/util/parser.ts";
import type { ExprPrecedence } from "../rustc_ast/util/parser.ts";
import { Mutability } from "../rustc_ast_ir/lib.ts";
import { pp, pprust } from "../rustc_ast_pretty/lib.ts";
import { type AttrItem, type Attribute, print_attribute_AttributeKind } from "../rustc_attr_ir/lib.ts";
import * as hir from "../rustc_hir/lib.ts";
import type {
  ConstArg,
  ConstArgExprField,
  GenericArg,
  HirId,
  Node,
} from "../rustc_hir/lib.ts";
import type { HirTyCtxt } from "../rustc_hir/intravisit.ts";
import type { SourceMap } from "../rustc_span/source_map.ts";
import { DUMMY_SP, type FileName, Span, type Spanned } from "../rustc_span/lib.ts";
import { Ident, type Symbol } from "../rustc_span/symbol.ts";
import { panic, unported, unreachable, unwrap } from "../std/panic.ts";
import type { Str } from "../std/str.ts";
import { unported_methods } from "../rust_ts/stubs.ts";

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

// ---- merge stand-ins for lane hir-pretty-b (DELETE THIS BLOCK AT MERGE) ----
// PORT: the methods and free fns of lib.rs:1306..end that the region above calls, with the signatures this region
// uses. Until lane hir-pretty-b's region is merged, each method is an `unported` placeholder on `State.prototype`
// (rust_ts/stubs.ts), and the two free fns stop as UNPORTED. hir-pretty-b's region assigns the real methods after
// this block (overwriting the placeholders); at merge delete this whole block, which also removes the duplicate
// `stmt_ends_with_semi` / `contains_exterior_struct_lit` declarations.
export interface State {
  print_inline_const(constant: hir.ConstBlock): void;
  print_expr_field(field: hir.ExprField): void;
  print_literal(lit: hir.Lit): void;
  print_inline_asm(asm: hir.InlineAsm): void;
  print_expr(expr: hir.Expr): void;
  print_local_decl(loc: hir.LetStmt): void;
  print_name(name: Symbol): void;
  print_path_<R>(path: hir.Path<R>, colons_before_params: boolean): void;
  print_path_segment_(segment: hir.PathSegment): void;
  print_qpath(qpath: hir.QPath, colons_before_params: boolean): void;
  print_assoc_item_constraint(constraint: hir.AssocItemConstraint): void;
  print_pat_expr(expr: hir.PatExpr): void;
  print_ty_pat(pat: hir.TyPat): void;
  print_pat(pat: hir.Pat): void;
  print_patfield(field: hir.PatField): void;
  print_param(arg: hir.Param): void;
  print_arm(arm: hir.Arm): void;
  print_fn(
    header: hir.FnHeader,
    name: Symbol | undefined,
    generics: hir.Generics,
    decl: hir.FnDecl,
    arg_idents: readonly (Ident | undefined)[],
    body_id: hir.BodyId | undefined,
  ): void;
  print_bounds(prefix: string, bounds: Iterable<hir.GenericBound>): void;
  print_generic_params(generic_params: readonly hir.GenericParam[]): void;
  print_lifetime(lifetime: hir.Lifetime): void;
  print_where_clause(generics: hir.Generics): void;
  print_where_predicate(predicate: hir.WherePredicate): void;
  print_mutability(mutbl: Mutability, print_const: boolean): void;
  print_ty_fn(
    abi: ExternAbi,
    safety: hir.Safety,
    decl: hir.FnDecl,
    name: Symbol | undefined,
    generic_params: readonly hir.GenericParam[],
    arg_idents: readonly (Ident | undefined)[],
  ): void;
  print_constness(s: hir.Constness): void;
  print_safety(s: hir.Safety): void;
  print_is_auto(s: ast.IsAuto): void;
  print_mut_restriction(r: hir.MutRestriction): void;
  print_impl_restriction(r: hir.ImplRestriction): void;
}
unported_methods(State.prototype, "rustc_hir_pretty::State", [
  "print_inline_const",
  "print_expr_field",
  "print_literal",
  "print_inline_asm",
  "print_expr",
  "print_local_decl",
  "print_name",
  "print_path_",
  "print_path_segment_",
  "print_qpath",
  "print_assoc_item_constraint",
  "print_pat_expr",
  "print_ty_pat",
  "print_pat",
  "print_patfield",
  "print_param",
  "print_arm",
  "print_fn",
  "print_bounds",
  "print_generic_params",
  "print_lifetime",
  "print_where_clause",
  "print_where_predicate",
  "print_mutability",
  "print_ty_fn",
  "print_constness",
  "print_safety",
  "print_is_auto",
  "print_mut_restriction",
  "print_impl_restriction",
]);
function stmt_ends_with_semi(_stmt: hir.StmtKind): boolean {
  return unported("rustc_hir_pretty::stmt_ends_with_semi (lane hir-pretty-b)");
}
function contains_exterior_struct_lit(_value: hir.Expr): boolean {
  return unported("rustc_hir_pretty::contains_exterior_struct_lit (lane hir-pretty-b)");
}
// ---- end of merge stand-ins ----

// ==== lane hir-pretty-b: lib.rs:1306..end ====
