// Port of compiler/rustc_ast_pretty/src/pprust/state/item.rs
//
// PORT: `impl<'a> State<'a>` defined in another file (PORTING §5 "Methods defined in another
// file"): the methods are declared on `State` via `declare module` and assigned to
// `State.prototype`. `rustc_ast_pretty/pprust/mod.ts` imports this module for its side effects,
// after `state.ts`.

import { ast } from "../../../rustc_ast/lib.ts";
import type { NodeId } from "../../../rustc_ast/node_id.ts";
import { DUMMY_SP, Span } from "../../../rustc_span/lib.ts";
import { type Ident, kw } from "../../../rustc_span/symbol.ts";
import { unwrap } from "../../../std/panic.ts";
import { type BoxMarker, Breaks } from "../../pp.ts";
import { INDENT_UNIT, State } from "../state.ts";
import { FixupContext } from "./fixup.ts";

// use crate::pp::Breaks::Inconsistent;
const Inconsistent: Breaks = Breaks.Inconsistent;

// PORT: the file-private `enum DelegationKind<'a>` (item.rs:10) -> a local `$`-tagged union; the
// borrowed slice `&'a [(Ident, Option<Ident>)]` is a readonly array.
type DelegationKind =
  | { readonly $: "Single" }
  | { readonly $: "List"; _0: readonly [Ident, Ident | undefined][] }
  | { readonly $: "Glob" };

// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:16 visibility_qualified
function visibility_qualified(vis: ast.Visibility, s: string): string {
  return `${State.to_string((s) => s.print_visibility(vis))}${s}`;
}

// PORT: `ast::Generics::default()` (`#[derive(Default)]`; `WhereClause` too).
function generics_default(): ast.Generics {
  return {
    params: [],
    where_clause: new ast.WhereClause(false, [], DUMMY_SP),
    span: DUMMY_SP,
  };
}

declare module "../state.ts" {
  interface State {
    print_foreign_mod(nmod: ast.ForeignMod, attrs: readonly ast.Attribute[]): void;
    print_foreign_item(item: ast.ForeignItem): void;
    print_item_const(
      ident: Ident,
      mutbl: ast.Mutability | undefined,
      generics: ast.Generics,
      ty: ast.Ty,
      body: ast.Expr | undefined,
      vis: ast.Visibility,
      safety: ast.Safety,
      defaultness: ast.Defaultness,
      define_opaque: readonly [NodeId, ast.Path][] | undefined,
      eii_impl: ast.EiiImpl | undefined,
    ): void;
    print_associated_type(
      ident: Ident,
      generics: ast.Generics,
      after_where_clause: ast.WhereClause,
      bounds: ast.GenericBounds,
      ty: ast.Ty | undefined,
      vis: ast.Visibility,
      defaultness: ast.Defaultness,
    ): void;
    print_item(item: ast.Item): void;
    print_enum_def(
      enum_definition: ast.EnumDef,
      generics: ast.Generics,
      ident: Ident,
      span: Span,
      visibility: ast.Visibility,
    ): void;
    print_visibility(vis: ast.Visibility): void;
    print_impl_restriction(impl_restriction: ast.ImplRestriction): void;
    print_mut_restriction(mut_restriction: ast.MutRestriction): void;
    print_defaultness(defaultness: ast.Defaultness): void;
    print_struct(
      struct_def: ast.VariantData,
      generics: ast.Generics,
      ident: Ident,
      span: Span,
      print_finalizer: boolean,
      cb: BoxMarker,
      ib: BoxMarker,
    ): void;
    print_variant(v: ast.Variant): void;
    print_assoc_item(item: ast.AssocItem): void;
    print_delegation(
      attrs: readonly ast.Attribute[],
      vis: ast.Visibility,
      qself: ast.QSelf | undefined,
      path: ast.Path,
      kind: DelegationKind,
      body: ast.Block | undefined,
    ): void;
    print_fn_full(vis: ast.Visibility, attrs: readonly ast.Attribute[], func: ast.Fn): void;
    print_eii_impl(eii: ast.EiiImpl): void;
    print_define_opaques(define_opaque: readonly [NodeId, ast.Path][] | undefined): void;
    print_contract(contract: ast.FnContract): void;
    print_fn(decl: ast.FnDecl, header: ast.FnHeader, ident: Ident | undefined, generics: ast.Generics): void;
    print_fn_params_and_ret(decl: ast.FnDecl, is_closure: boolean): void;
    print_where_clause(where_clause: ast.WhereClause): void;
    print_where_predicate(predicate: ast.WherePredicate): void;
    print_where_bound_predicate(where_bound_predicate: ast.WhereBoundPredicate): void;
    print_use_tree(tree: ast.UseTree): void;
  }
}

// impl<'a> State<'a>

// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:21 print_foreign_mod
State.prototype.print_foreign_mod = function (
  this: State,
  nmod: ast.ForeignMod,
  attrs: readonly ast.Attribute[],
): void {
  this.print_inner_attributes(attrs);
  for (const item of nmod.items) {
    this.print_foreign_item(item);
  }
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:28 print_foreign_item
State.prototype.print_foreign_item = function (this: State, item: ast.ForeignItem): void {
  const { id, span, attrs, kind, vis } = item;
  this.ann.pre(this, { $: "SubItem", _0: id });
  this.s.hardbreak_if_not_bol();
  this.maybe_print_comment(Span.lo(span));
  this.print_outer_attributes(attrs);
  switch (kind.$) {
    case "Fn": {
      const func = kind._0;
      this.print_fn_full(vis, attrs, func);
      break;
    }
    case "Static": {
      const { ident, ty, mutability, expr, safety, define_opaque, eii_impl } = kind._0;
      this.print_item_const(
        ident,
        mutability,
        generics_default(),
        ty,
        expr,
        vis,
        safety,
        ast.Defaultness.Implicit,
        define_opaque,
        eii_impl,
      );
      break;
    }
    case "TyAlias": {
      const { defaultness, ident, generics, after_where_clause, bounds, ty } = kind._0;
      this.print_associated_type(ident, generics, after_where_clause, bounds, ty, vis, defaultness);
      break;
    }
    case "MacCall": {
      const m = kind._0;
      this.print_mac(m);
      if (m.args.need_semicolon()) {
        this.s.word(";");
      }
      break;
    }
  }
  this.ann.post(this, { $: "SubItem", _0: id });
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:86 print_item_const
State.prototype.print_item_const = function (
  this: State,
  ident: Ident,
  mutbl: ast.Mutability | undefined,
  generics: ast.Generics,
  ty: ast.Ty,
  body: ast.Expr | undefined,
  vis: ast.Visibility,
  safety: ast.Safety,
  defaultness: ast.Defaultness,
  define_opaque: readonly [NodeId, ast.Path][] | undefined,
  eii_impl: ast.EiiImpl | undefined,
): void {
  this.print_define_opaques(define_opaque);
  if (eii_impl !== undefined) {
    this.print_eii_impl(eii_impl);
  }
  const [cb, ib] = this.head("");
  this.print_visibility(vis);
  this.print_safety(safety);
  this.print_defaultness(defaultness);
  let leading: string;
  switch (mutbl) {
    case undefined:
      leading = "const";
      break;
    case "Not":
      leading = "static";
      break;
    case "Mut":
      leading = "static mut";
      break;
  }
  this.s.word_space(leading);
  this.print_ident(ident);
  this.print_generic_params(generics.params);
  this.s.word_space(":");
  this.print_type(ty);
  if (body !== undefined) {
    this.s.space();
  }
  this.s.end(ib);
  if (body !== undefined) {
    this.s.word_space("=");
    this.print_expr(body, FixupContext.default());
  }
  this.print_where_clause(generics.where_clause);
  this.s.word(";");
  this.s.end(cb);
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:130 print_associated_type
State.prototype.print_associated_type = function (
  this: State,
  ident: Ident,
  generics: ast.Generics,
  after_where_clause: ast.WhereClause,
  bounds: ast.GenericBounds,
  ty: ast.Ty | undefined,
  vis: ast.Visibility,
  defaultness: ast.Defaultness,
): void {
  const [cb, ib] = this.head("");
  this.print_visibility(vis);
  this.print_defaultness(defaultness);
  this.s.word_space("type");
  this.print_ident(ident);
  this.print_generic_params(generics.params);
  if (bounds.length !== 0) {
    this.s.word_nbsp(":");
    this.print_type_bounds(bounds);
  }
  this.print_where_clause(generics.where_clause);
  if (ty !== undefined) {
    this.s.space();
    this.s.word_space("=");
    this.print_type(ty);
  }
  this.print_where_clause(after_where_clause);
  this.s.word(";");
  this.s.end(ib);
  this.s.end(cb);
};

/// Pretty-prints an item.
// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:163 print_item
State.prototype.print_item = function (this: State, item: ast.Item): void {
  if (this.is_sdylib_interface && Span.is_dummy(item.span)) {
    // Do not print prelude for interface files.
    return;
  }
  this.s.hardbreak_if_not_bol();
  this.maybe_print_comment(Span.lo(item.span));
  this.print_outer_attributes(item.attrs);
  this.ann.pre(this, { $: "Item", _0: item });
  const kind = item.kind;
  switch (kind.$) {
    case "ExternCrate": {
      const [orig_name, ident] = [kind._0, kind._1];
      const [cb, ib] = this.head(visibility_qualified(item.vis, "extern crate"));
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
      this.print_visibility(item.vis);
      this.s.word_nbsp("use");
      this.print_use_tree(tree);
      this.s.word(";");
      break;
    }
    case "Static": {
      const { ident, ty, safety, mutability: mutbl, expr: body, define_opaque, eii_impl } = kind._0;
      this.print_safety(safety);
      this.print_item_const(
        ident,
        mutbl,
        generics_default(),
        ty,
        body,
        item.vis,
        ast.Safety.Default,
        ast.Defaultness.Implicit,
        define_opaque,
        eii_impl,
      );
      break;
    }
    case "ConstBlock": {
      const { block } = kind._0;
      const ib = this.s.ibox(INDENT_UNIT);
      this.s.word("const");
      this.s.nbsp();
      {
        const cb = this.s.cbox(0);
        const ib = this.s.ibox(0);
        this.print_block_with_attrs(block, [], cb, ib);
      }
      this.s.end(ib);
      break;
    }
    case "Const": {
      const { defaultness, ident, generics, ty, body, define_opaque } = kind._0;
      this.print_item_const(
        ident,
        undefined,
        generics,
        ty,
        body,
        item.vis,
        ast.Safety.Default,
        defaultness,
        define_opaque,
        undefined,
      );
      break;
    }
    case "Fn": {
      const func = kind._0;
      this.print_fn_full(item.vis, item.attrs, func);
      break;
    }
    case "Mod": {
      const [safety, ident, mod_kind] = [kind._0, kind._1, kind._2];
      const [cb, ib] = this.head(
        State.to_string((s) => {
          s.print_visibility(item.vis);
          s.print_safety(safety);
          s.s.word("mod");
        }),
      );
      this.print_ident(ident);

      switch (mod_kind.$) {
        case "Loaded": {
          const items = mod_kind._0;
          this.s.nbsp();
          this.bopen(ib);
          this.print_inner_attributes(item.attrs);
          for (const item of items) {
            this.print_item(item);
          }
          const empty = item.attrs.length === 0 && items.length === 0;
          this.bclose(item.span, empty, cb);
          break;
        }
        case "Unloaded": {
          this.s.word(";");
          this.s.end(ib);
          this.s.end(cb);
          break;
        }
      }
      break;
    }
    case "ForeignMod": {
      const nmod = kind._0;
      const [cb, ib] = this.head(
        State.to_string((s) => {
          s.print_safety(nmod.safety);
          s.s.word("extern");
        }),
      );
      if (nmod.abi !== undefined) {
        const abi = nmod.abi;
        this.print_token_literal(abi.as_token_lit(), abi.span);
        this.s.nbsp();
      }
      this.bopen(ib);
      this.print_foreign_mod(nmod, item.attrs);
      const empty = item.attrs.length === 0 && nmod.items.length === 0;
      this.bclose(item.span, empty, cb);
      break;
    }
    case "GlobalAsm": {
      const asm = kind._0;
      // FIXME: Print `builtin # global_asm` once macro `global_asm` uses `builtin_syntax`.
      const [cb, ib] = this.head(visibility_qualified(item.vis, "global_asm!"));
      this.print_inline_asm(asm);
      this.s.word(";");
      this.s.end(ib);
      this.s.end(cb);
      break;
    }
    case "TyAlias": {
      const { defaultness, ident, generics, after_where_clause, bounds, ty } = kind._0;
      this.print_associated_type(ident, generics, after_where_clause, bounds, ty, item.vis, defaultness);
      break;
    }
    case "Enum": {
      const [ident, generics, enum_definition] = [kind._0, kind._1, kind._2];
      this.print_enum_def(enum_definition, generics, ident, item.span, item.vis);
      break;
    }
    case "Struct": {
      const [ident, generics, struct_def] = [kind._0, kind._1, kind._2];
      const [cb, ib] = this.head(visibility_qualified(item.vis, "struct"));
      this.print_struct(struct_def, generics, ident, item.span, true, cb, ib);
      break;
    }
    case "Union": {
      const [ident, generics, struct_def] = [kind._0, kind._1, kind._2];
      const [cb, ib] = this.head(visibility_qualified(item.vis, "union"));
      this.print_struct(struct_def, generics, ident, item.span, true, cb, ib);
      break;
    }
    case "Impl": {
      const { generics, of_trait, self_ty, items, constness } = kind._0;
      const [cb, ib] = this.head("");
      this.print_visibility(item.vis);

      const impl_generics = (this_: State): void => {
        this_.s.word("impl");

        if (generics.params.length === 0) {
          this_.s.nbsp();
        } else {
          this_.print_generic_params(generics.params);
          this_.s.space();
        }
      };

      if (of_trait !== undefined) {
        const { defaultness, safety, polarity, trait_ref } = of_trait;
        this.print_defaultness(defaultness);
        this.print_constness(constness);
        this.print_safety(safety);
        impl_generics(this);
        if (polarity.$ === "Negative") {
          this.s.word("!");
        }
        this.print_trait_ref(trait_ref);
        this.s.space();
        this.s.word_space("for");
      } else {
        this.print_constness(constness);
        impl_generics(this);
      }

      this.print_type(self_ty);
      this.print_where_clause(generics.where_clause);

      this.s.space();
      this.bopen(ib);
      this.print_inner_attributes(item.attrs);
      for (const impl_item of items) {
        this.print_assoc_item(impl_item);
      }
      const empty = item.attrs.length === 0 && items.length === 0;
      this.bclose(item.span, empty, cb);
      break;
    }
    case "Trait": {
      const { impl_restriction, constness, safety, is_auto, ident, generics, bounds, items } = kind._0;
      const [cb, ib] = this.head("");
      this.print_visibility(item.vis);
      this.print_impl_restriction(impl_restriction);
      this.print_constness(constness);
      this.print_safety(safety);
      this.print_is_auto(is_auto);
      this.s.word_nbsp("trait");
      this.print_ident(ident);
      this.print_generic_params(generics.params);
      if (bounds.length !== 0) {
        this.s.word_nbsp(":");
        this.print_type_bounds(bounds);
      }
      this.print_where_clause(generics.where_clause);
      this.s.word(" ");
      this.bopen(ib);
      this.print_inner_attributes(item.attrs);
      for (const trait_item of items) {
        this.print_assoc_item(trait_item);
      }
      const empty = item.attrs.length === 0 && items.length === 0;
      this.bclose(item.span, empty, cb);
      break;
    }
    case "TraitAlias": {
      const { constness, ident, generics, bounds } = kind._0;
      const [cb, ib] = this.head("");
      this.print_visibility(item.vis);
      this.print_constness(constness);
      this.s.word_nbsp("trait");
      this.print_ident(ident);
      this.print_generic_params(generics.params);
      this.s.nbsp();
      if (bounds.length !== 0) {
        this.s.word_nbsp("=");
        this.print_type_bounds(bounds);
      }
      this.print_where_clause(generics.where_clause);
      this.s.word(";");
      this.s.end(ib);
      this.s.end(cb);
      break;
    }
    case "MacCall": {
      const mac = kind._0;
      this.print_mac(mac);
      if (mac.args.need_semicolon()) {
        this.s.word(";");
      }
      break;
    }
    case "MacroDef": {
      const [ident, macro_def] = [kind._0, kind._1];
      this.print_mac_def(macro_def, ident, item.span, (state) => state.print_visibility(item.vis));
      break;
    }
    case "Delegation": {
      const deleg = kind._0;
      this.print_delegation(item.attrs, item.vis, deleg.qself, deleg.path, { $: "Single" }, deleg.body);
      break;
    }
    case "DelegationMac": {
      const deleg = kind._0;
      let dkind: DelegationKind;
      switch (deleg.suffixes.$) {
        case "List":
          dkind = { $: "List", _0: deleg.suffixes._0 };
          break;
        case "Glob":
          dkind = { $: "Glob" };
          break;
      }
      this.print_delegation(item.attrs, item.vis, deleg.qself, deleg.prefix, dkind, deleg.body);
      break;
    }
    case "TestBinderConstraints": {
      this.s.word("test_binder_constraints!(/* pretty-printing not supported */)");
      break;
    }
  }
  this.ann.post(this, { $: "Item", _0: item });
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:459 print_enum_def
State.prototype.print_enum_def = function (
  this: State,
  enum_definition: ast.EnumDef,
  generics: ast.Generics,
  ident: Ident,
  span: Span,
  visibility: ast.Visibility,
): void {
  const [cb, ib] = this.head(visibility_qualified(visibility, "enum"));
  this.print_ident(ident);
  this.print_generic_params(generics.params);
  this.print_where_clause(generics.where_clause);
  this.s.space();
  this.bopen(ib);
  for (const v of enum_definition.variants) {
    this.s.space_if_not_bol();
    this.maybe_print_comment(Span.lo(v.span));
    this.print_outer_attributes(v.attrs);
    const ib = this.s.ibox(0);
    this.print_variant(v);
    this.s.word(",");
    this.s.end(ib);
    this.maybe_print_trailing_comment(v.span, undefined);
  }
  const empty = enum_definition.variants.length === 0;
  this.bclose(span, empty, cb);
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:487 print_visibility
State.prototype.print_visibility = function (this: State, vis: ast.Visibility): void {
  const kind = vis.kind;
  switch (kind.$) {
    case "Public":
      this.s.word_nbsp("pub");
      break;
    case "Restricted": {
      const { path: path_, shorthand } = kind;
      const path = State.to_string((s) => s.print_path(path_, false, 0));
      if (shorthand && (path === "crate" || path === "self" || path === "super")) {
        this.s.word_nbsp(`pub(${path})`);
      } else {
        this.s.word_nbsp(`pub(in ${path})`);
      }
      break;
    }
    case "Inherited":
      break;
  }
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:502 print_impl_restriction
State.prototype.print_impl_restriction = function (this: State, impl_restriction: ast.ImplRestriction): void {
  const kind = impl_restriction.kind;
  switch (kind.$) {
    case "Restricted": {
      const { path: path_, shorthand } = kind;
      const path = State.to_string((s) => s.print_path(path_, false, 0));
      if (shorthand) {
        this.s.word_nbsp(`impl(${path})`);
      } else {
        this.s.word_nbsp(`impl(in ${path})`);
      }
      break;
    }
    case "Unrestricted":
      break;
  }
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:516 print_mut_restriction
State.prototype.print_mut_restriction = function (this: State, mut_restriction: ast.MutRestriction): void {
  const kind = mut_restriction.kind;
  switch (kind.$) {
    case "Restricted": {
      const { path: path_, shorthand } = kind;
      const path = State.to_string((s) => s.print_path(path_, false, 0));
      if (shorthand) {
        this.s.word_nbsp(`mut(${path})`);
      } else {
        this.s.word_nbsp(`mut(in ${path})`);
      }
      break;
    }
    case "Unrestricted":
      break;
  }
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:530 print_defaultness
State.prototype.print_defaultness = function (this: State, defaultness: ast.Defaultness): void {
  if (defaultness.$ === "Default") {
    this.s.word_nbsp("default");
  }
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:536 print_struct
State.prototype.print_struct = function (
  this: State,
  struct_def: ast.VariantData,
  generics: ast.Generics,
  ident: Ident,
  span: Span,
  print_finalizer: boolean,
  cb: BoxMarker,
  ib: BoxMarker,
): void {
  this.print_ident(ident);
  this.print_generic_params(generics.params);
  switch (struct_def.$) {
    case "Tuple":
    case "Unit": {
      if (struct_def.$ === "Tuple") {
        this.s.popen();
        this.commasep(Inconsistent, ast.VariantData.fields(struct_def), (s, field) => {
          s.maybe_print_comment(Span.lo(field.span));
          s.print_outer_attributes(field.attrs);
          s.print_visibility(field.vis);
          s.print_mut_restriction(field.mut_restriction());
          s.print_type(field.ty);
        });
        this.s.pclose();
      }
      this.print_where_clause(generics.where_clause);
      if (print_finalizer) {
        this.s.word(";");
      }
      this.s.end(ib);
      this.s.end(cb);
      break;
    }
    case "Struct": {
      const fields = struct_def.fields;
      this.print_where_clause(generics.where_clause);
      this.s.nbsp();
      this.bopen(ib);

      const empty = fields.length === 0;
      if (!empty) {
        this.s.hardbreak_if_not_bol();

        for (const field of fields) {
          this.s.hardbreak_if_not_bol();
          this.maybe_print_comment(Span.lo(field.span));
          this.print_outer_attributes(field.attrs);
          this.print_visibility(field.vis);
          this.print_mut_restriction(field.mut_restriction());
          this.print_ident(unwrap(field.ident));
          this.s.word_nbsp(":");
          this.print_type(field.ty);
          this.s.word(",");
        }
      }

      this.bclose(span, empty, cb);
      break;
    }
  }
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:595 print_variant
State.prototype.print_variant = function (this: State, v: ast.Variant): void {
  const [cb, ib] = this.head("");
  this.print_visibility(v.vis);
  const generics = generics_default();
  this.print_struct(v.data, generics, v.ident, v.span, false, cb, ib);
  if (v.disr_expr !== undefined) {
    const d = v.disr_expr;
    this.s.space();
    this.s.word_space("=");
    this.print_expr(d.value, FixupContext.default());
  }
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:607 print_assoc_item
State.prototype.print_assoc_item = function (this: State, item: ast.AssocItem): void {
  const { id, span, attrs, kind, vis } = item;
  this.ann.pre(this, { $: "SubItem", _0: id });
  this.s.hardbreak_if_not_bol();
  this.maybe_print_comment(Span.lo(span));
  this.print_outer_attributes(attrs);
  switch (kind.$) {
    case "Fn": {
      const func = kind._0;
      this.print_fn_full(vis, attrs, func);
      break;
    }
    case "Const": {
      const { defaultness, ident, generics, ty, body, define_opaque } = kind._0;
      this.print_item_const(
        ident,
        undefined,
        generics,
        ty,
        body,
        vis,
        ast.Safety.Default,
        defaultness,
        define_opaque,
        undefined,
      );
      break;
    }
    case "Type": {
      const { defaultness, ident, generics, after_where_clause, bounds, ty } = kind._0;
      this.print_associated_type(ident, generics, after_where_clause, bounds, ty, vis, defaultness);
      break;
    }
    case "MacCall": {
      const m = kind._0;
      this.print_mac(m);
      if (m.args.need_semicolon()) {
        this.s.word(";");
      }
      break;
    }
    case "Delegation": {
      const deleg = kind._0;
      this.print_delegation(item.attrs, vis, deleg.qself, deleg.path, { $: "Single" }, deleg.body);
      break;
    }
    case "DelegationMac": {
      const deleg = kind._0;
      let dkind: DelegationKind;
      switch (deleg.suffixes.$) {
        case "List":
          dkind = { $: "List", _0: deleg.suffixes._0 };
          break;
        case "Glob":
          dkind = { $: "Glob" };
          break;
      }
      this.print_delegation(item.attrs, vis, deleg.qself, deleg.prefix, dkind, deleg.body);
      break;
    }
  }
  this.ann.post(this, { $: "SubItem", _0: id });
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:685 print_delegation
State.prototype.print_delegation = function (
  this: State,
  attrs: readonly ast.Attribute[],
  vis: ast.Visibility,
  qself: ast.QSelf | undefined,
  path: ast.Path,
  kind: DelegationKind,
  body: ast.Block | undefined,
): void {
  const body_cb_ib: [ast.Block, [BoxMarker, BoxMarker]] | undefined =
    body === undefined ? undefined : [body, this.head("")];
  this.print_visibility(vis);
  this.s.word_nbsp("reuse");

  if (qself !== undefined) {
    this.print_qpath(path, qself, false);
  } else {
    this.print_path(path, false, 0);
  }
  switch (kind.$) {
    case "Single":
      break;
    case "List": {
      const suffixes = kind._0;
      this.s.word("::");
      this.s.word("{");
      for (let i = 0; i < suffixes.length; i++) {
        const [ident, rename] = suffixes[i]!;
        this.print_ident(ident);
        if (rename !== undefined) {
          this.s.nbsp();
          this.s.word_nbsp("as");
          this.print_ident(rename);
        }
        if (i !== suffixes.length - 1) {
          this.s.word_space(",");
        }
      }
      this.s.word("}");
      break;
    }
    case "Glob": {
      this.s.word("::");
      this.s.word("*");
      break;
    }
  }
  if (body_cb_ib !== undefined) {
    const [body, [cb, ib]] = body_cb_ib;
    this.s.nbsp();
    this.print_block_with_attrs(body, attrs, cb, ib);
  } else {
    this.s.word(";");
  }
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:734 print_fn_full
State.prototype.print_fn_full = function (
  this: State,
  vis: ast.Visibility,
  attrs: readonly ast.Attribute[],
  func: ast.Fn,
): void {
  const { defaultness, ident, generics, sig, contract, body, define_opaque, eii_impl } = func;

  this.print_define_opaques(define_opaque);

  if (eii_impl !== undefined) {
    this.print_eii_impl(eii_impl);
  }

  const body_cb_ib: [ast.Block, [BoxMarker, BoxMarker]] | undefined =
    body === undefined ? undefined : [body, this.head("")];

  this.print_visibility(vis);
  this.print_defaultness(defaultness);
  this.print_fn(sig.decl, sig.header, ident, generics);
  if (contract !== undefined) {
    this.s.nbsp();
    this.print_contract(contract);
  }
  if (body_cb_ib !== undefined) {
    const [body, [cb, ib]] = body_cb_ib;
    if (this.is_sdylib_interface) {
      this.s.word(";");
      this.s.end(ib); // end inner head-block
      this.s.end(cb); // end outer head-block
      return;
    }

    this.s.nbsp();
    this.print_block_with_attrs(body, attrs, cb, ib);
  } else {
    this.s.word(";");
  }
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:768 print_eii_impl
State.prototype.print_eii_impl = function (this: State, eii: ast.EiiImpl): void {
  this.s.word("#[");
  if (eii.impl_safety.$ === "Unsafe") {
    this.s.word("unsafe");
    this.s.popen();
  }
  this.print_path(eii.eii_macro_path, false, 0);
  if (eii.impl_safety.$ === "Unsafe") {
    this.s.pclose();
  }
  this.s.word("]");
  this.s.hardbreak();
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:782 print_define_opaques
State.prototype.print_define_opaques = function (
  this: State,
  define_opaque: readonly [NodeId, ast.Path][] | undefined,
): void {
  if (define_opaque !== undefined) {
    this.s.word("#[define_opaque(");
    for (let i = 0; i < define_opaque.length; i++) {
      const [, path] = define_opaque[i]!;
      if (i !== 0) {
        this.s.word_space(",");
      }

      this.print_path(path, false, 0);
    }
    this.s.word(")]");
  }
  this.s.hardbreak_if_not_bol();
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:797 print_contract
State.prototype.print_contract = function (this: State, contract: ast.FnContract): void {
  if (contract.requires !== undefined) {
    const pred = contract.requires;
    this.s.word("rustc_requires");
    this.s.popen();
    this.print_expr(pred, FixupContext.default());
    this.s.pclose();
  }
  if (contract.ensures !== undefined) {
    const pred = contract.ensures;
    this.s.word("rustc_ensures");
    this.s.popen();
    this.print_expr(pred, FixupContext.default());
    this.s.pclose();
  }
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:812 print_fn
State.prototype.print_fn = function (
  this: State,
  decl: ast.FnDecl,
  header: ast.FnHeader,
  ident: Ident | undefined,
  generics: ast.Generics,
): void {
  this.print_fn_header_info(header);
  if (ident !== undefined) {
    this.s.nbsp();
    this.print_ident(ident);
  }
  this.print_generic_params(generics.params);
  this.print_fn_params_and_ret(decl, false);
  this.print_where_clause(generics.where_clause);
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:829 print_fn_params_and_ret
State.prototype.print_fn_params_and_ret = function (this: State, decl: ast.FnDecl, is_closure: boolean): void {
  const [open, close] = is_closure ? ["|", "|"] : ["(", ")"];
  this.s.word(open);
  this.commasep(Inconsistent, decl.inputs, (s, param) => s.print_param(param, is_closure));
  this.s.word(close);
  this.print_fn_ret_ty(decl.output);
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:837 print_where_clause
State.prototype.print_where_clause = function (this: State, where_clause: ast.WhereClause): void {
  const { has_where_token, predicates } = where_clause;
  if (predicates.length === 0 && !has_where_token) {
    return;
  }

  this.s.space();
  this.s.word_space("where");

  for (let i = 0; i < predicates.length; i++) {
    const predicate = predicates[i]!;
    if (i !== 0) {
      this.s.word_space(",");
    }

    this.print_where_predicate(predicate);
  }
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:855 print_where_predicate
State.prototype.print_where_predicate = function (this: State, predicate: ast.WherePredicate): void {
  const { attrs, kind } = predicate;
  this.print_outer_attributes(attrs);
  switch (kind.$) {
    case "BoundPredicate": {
      const where_bound_predicate = kind._0;
      this.print_where_bound_predicate(where_bound_predicate);
      break;
    }
    case "RegionPredicate": {
      const { lifetime, bounds } = kind._0;
      this.print_lifetime(lifetime);
      this.s.word(":");
      if (bounds.length !== 0) {
        this.s.nbsp();
        this.print_lifetime_bounds(bounds);
      }
      break;
    }
  }
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:877 print_where_bound_predicate
State.prototype.print_where_bound_predicate = function (
  this: State,
  where_bound_predicate: ast.WhereBoundPredicate,
): void {
  this.print_formal_generic_params(where_bound_predicate.bound_generic_params);
  this.print_type(where_bound_predicate.bounded_ty);
  this.s.word(":");
  if (where_bound_predicate.bounds.length !== 0) {
    this.s.nbsp();
    this.print_type_bounds(where_bound_predicate.bounds);
  }
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/item.rs:890 print_use_tree
State.prototype.print_use_tree = function (this: State, tree: ast.UseTree): void {
  const kind = tree.kind;
  switch (kind.$) {
    case "Simple": {
      const rename = kind._0;
      this.print_path(tree.prefix, false, 0);
      if (rename !== undefined) {
        this.s.nbsp();
        this.s.word_nbsp("as");
        this.print_ident(rename);
      }
      break;
    }
    case "Glob": {
      if (tree.prefix.segments.length !== 0) {
        this.print_path(tree.prefix, false, 0);
        this.s.word("::");
      }
      this.s.word("*");
      break;
    }
    case "Nested": {
      const items = kind.items;
      if (tree.prefix.segments.length !== 0) {
        this.print_path(tree.prefix, false, 0);
        this.s.word("::");
      }
      if (items.length === 0) {
        this.s.word("{}");
      } else if (
        items.length === 1 &&
        !(() => {
          const seg = items[0]!.inner.prefix.segments[0];
          return seg !== undefined && seg.ident.name === kw.SelfLower;
        })()
      ) {
        const item = items[0]!;
        this.print_use_tree(item.inner);
      } else {
        const cb = this.s.cbox(INDENT_UNIT);
        this.s.word("{");
        this.s.zerobreak();
        const ib = this.s.ibox(0);
        for (let idx = 0; idx < items.length; idx++) {
          const use_tree = items[idx]!;
          const is_last = idx === items.length - 1;
          this.print_use_tree(use_tree.inner);
          if (!is_last) {
            this.s.word(",");
            if (use_tree.inner.kind.$ === "Nested") {
              this.s.hardbreak();
            } else {
              this.s.space();
            }
          }
        }
        this.s.end(ib);
        this.s.trailing_comma();
        this.s.offset(-INDENT_UNIT);
        this.s.word("}");
        this.s.end(cb);
      }
      break;
    }
  }
};
