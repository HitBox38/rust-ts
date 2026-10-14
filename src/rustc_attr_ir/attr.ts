// Port of compiler/rustc_attr_ir/src/attr.rs
// Types and derived Debug/Clone impls are generated into attr.gen.ts (tools/codegen/types.ts):
// `AttrArgs`, `AttrPath`, `AttrItem`, `HashIgnoredAttrId`, `Attribute` (the parsed-or-unparsed
// attribute that rustc_hir and later phases store; `hir::Attribute` at the pin is this type).
//
// PORT:
// - `Attribute` is a data enum without unit variants, so the generated module has no companion; its
//   inherent fns and the forwarding fns live on the `Attribute` const below (PORTING §8).
// - `impl AttributeExt for Attribute` follows rustc_ast/attr/mod.ts: a table of the trait's methods
//   (`AttributeExt_Attribute`, also `AttributeExt.Attribute` here) with the provided methods filled in by
//   `AttributeExt_provided`. rustc_ast does not export its `AttributeExt_provided`, so this module has a
//   copy of it (same code, no markers: the upstream fns are rustc_ast's). Root: export it from
//   rustc_ast/attr/mod.ts and use it here.
// - `AttrPath`'s `Display` is `display_AttrPath`, its `IntoDiagArg` `AttrPath_into_diag_arg`.
import { type attr, type DelimArgs, join_path_idents, type MetaItemInner, MetaItemKind, type MetaItemLit, type Path, tokenstream } from "../rustc_ast/lib.ts";
import type { AttrStyle } from "../rustc_ast/lib.ts";
import type { DocFragmentKind } from "../rustc_ast/token.ts";
import { type DiagArgValue, type PathBuf, String_into_diag_arg } from "../rustc_error_messages/lib.ts";
import { type AttrId, DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { Ident, sym, type Symbol } from "../rustc_span/symbol.ts";
import { PLAIN } from "../std/fmt.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { panic } from "../std/panic.ts";
import type { StableHashCtxt, StableHasher } from "../rustc_data_structures/stable_hash.ts";
import * as gen from "./attr.gen.ts";
import { type AttrItem, debug_Attribute } from "./attr.gen.ts";

export * from "./attr.gen.ts";

type AttributeExt<T> = attr.AttributeExt<T>;

export type AttrPath = gen.AttrPath;
export const AttrPath = gen.AttrPath as typeof gen.AttrPath & {
  from_ast: (path: Path, lower_span: (span: Span) => Span) => AttrPath;
};

// impl IntoDiagArg for AttrPath
// rustc: compiler/rustc_attr_ir/src/attr.rs:37 into_diag_arg
export function AttrPath_into_diag_arg(self: AttrPath, path: MutRef<PathBuf | undefined>): DiagArgValue {
  return String_into_diag_arg(display_AttrPath(self), path);
}

// rustc: compiler/rustc_attr_ir/src/attr.rs:43 from_ast
AttrPath.from_ast = function (path: Path, lower_span: (span: Span) => Span): AttrPath {
  return new gen.AttrPath(
    path.segments.map((i) => i.ident.name),
    lower_span(path.span),
  );
};

// impl fmt::Display for AttrPath
// rustc: compiler/rustc_attr_ir/src/attr.rs:57 fmt
export function display_AttrPath(self: AttrPath): string {
  return join_path_idents(self.segments.map((i) => new Ident(i, DUMMY_SP)));
}

// impl StableHash for HashIgnoredAttrId
// rustc: compiler/rustc_attr_ir/src/attr.rs:87 stable_hash
export function stable_hash_HashIgnoredAttrId(_self: gen.HashIgnoredAttrId, _hcx: StableHashCtxt, _hasher: StableHasher): void {
  /* we don't hash HashIgnoredAttrId, we ignore them */
}

export type Attribute = gen.Attribute;

type AttributeExtProvided = "has_name" | "has_any_name" | "path" | "is_proc_macro_attr";

// PORT: copy of rustc_ast/attr/mod.ts `AttributeExt_provided` (not exported there): the provided
// methods of `AttributeExt` (rustc_ast/src/attr/mod.rs:941 has_name, :948 has_any_name, :958 path,
// :975 is_proc_macro_attr). An impl lists its required methods (and any overrides).
function AttributeExt_provided<T>(
  impl: Omit<AttributeExt<T>, AttributeExtProvided> & Partial<Pick<AttributeExt<T>, AttributeExtProvided>>,
): AttributeExt<T> {
  const this_: AttributeExt<T> = {
    has_name(self: T, name: Symbol): boolean {
      const x = this_.name(self);
      return x !== undefined ? x === name : false;
    },
    has_any_name(self: T, names: readonly Symbol[]): boolean {
      return names.some((name) => this_.has_name(self, name));
    },
    path(self: T): Symbol[] {
      return this_.symbol_path(self) ?? [sym.doc];
    },
    is_proc_macro_attr(self: T): boolean {
      return [sym.proc_macro, sym.proc_macro_attribute, sym.proc_macro_derive].some((kind) => this_.has_name(self, kind));
    },
    ...impl,
  };
  return this_;
}

// rustc: compiler/rustc_attr_ir/src/attr.rs:109 get_normal_item
function get_normal_item(self: Attribute): AttrItem {
  switch (self.$) {
    case "Unparsed": {
      const normal = self._0;
      return normal;
    }
    default:
      return panic("unexpected parsed attribute");
  }
}

// rustc: compiler/rustc_attr_ir/src/attr.rs:116 value_lit
function value_lit(self: Attribute): MetaItemLit | undefined {
  switch (self.$) {
    case "Unparsed": {
      const n = self._0;
      if (n.args.$ === "Eq") {
        const expr = n.args.expr;
        return expr;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

// rustc: compiler/rustc_attr_ir/src/attr.rs:126 is_parsed_attr
function is_parsed_attr(self: Attribute): boolean {
  switch (self.$) {
    case "Parsed":
      return true;
    case "Unparsed":
      return false;
  }
}

// rustc: compiler/rustc_attr_ir/src/attr.rs:133 is_prefix_attr_for_suggestions
function is_prefix_attr_for_suggestions(self: Attribute): boolean {
  switch (self.$) {
    case "Unparsed": {
      const attr = self._0;
      return Span.desugaring_kind(attr.span) === undefined;
    }
    // Other parsed attributes that can appear on expressions originate from source and
    // should make suggestions treat the expression like a prefixed form.
    case "Parsed":
      return true;
  }
}

// impl AttributeExt for Attribute
const AttributeExt_Attribute: AttributeExt<Attribute> = AttributeExt_provided<Attribute>({
  // rustc: compiler/rustc_attr_ir/src/attr.rs:145 id
  id(self: Attribute): AttrId {
    switch (self.$) {
      case "Unparsed": {
        const u = self._0;
        return u.id.attr_id;
      }
      default:
        return panic("explicit panic");
    }
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:153 meta_item_list
  meta_item_list(self: Attribute): MetaItemInner[] | undefined {
    switch (self.$) {
      case "Unparsed": {
        const n = self._0;
        if (n.args.$ === "Delimited") {
          const d: DelimArgs = n.args._0;
          // `d.tokens.clone()`: a new stream sharing the token vector (`Arc`).
          return MetaItemKind.list_from_tokens(new tokenstream.TokenStream(d.tokens._0));
        }
        return undefined;
      }
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:166 value_str
  value_str(self: Attribute): Symbol | undefined {
    const x = value_lit(self);
    return x === undefined ? undefined : x.value_as_str();
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:171 value_span
  value_span(self: Attribute): Span | undefined {
    const i = value_lit(self);
    return i === undefined ? undefined : i.span;
  },

  /// For a single-segment attribute, returns its name; otherwise, returns `None`.
  // rustc: compiler/rustc_attr_ir/src/attr.rs:177 name
  name(self: Attribute): Symbol | undefined {
    switch (self.$) {
      case "Unparsed": {
        const n = self._0;
        if (n.path.segments.length === 1) {
          const ident = n.path.segments[0]!;
          return ident;
        } else {
          return undefined;
        }
      }
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:191 path_matches
  path_matches(self: Attribute, name: readonly Symbol[]): boolean {
    switch (self.$) {
      case "Unparsed": {
        const n = self._0;
        const segments = n.path.segments;
        return segments.length === name.length && segments.every((s, i) => s === name[i]);
      }
      default:
        return false;
    }
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:199 is_doc_comment
  is_doc_comment(self: Attribute): Span | undefined {
    if (self.$ === "Parsed" && self._0.$ === "DocComment") {
      const span = self._0.span;
      return span;
    } else {
      return undefined;
    }
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:208 span
  span(self: Attribute): Span {
    if (self.$ === "Unparsed") {
      const u = self._0;
      return u.span;
    }
    const a = self._0;
    switch (a.$) {
      // FIXME: should not be needed anymore when all attrs are parsed
      case "DocComment":
        return a.span;
      case "Deprecated":
        return a.span;
      case "CfgTrace": {
        const cfgs = a._0;
        if (cfgs.length === 0) panic(`index out of bounds: the len is ${cfgs.length} but the index is 0`);
        return cfgs[0]![1];
      }
      default:
        return panic(`can't get the span of an arbitrary parsed attribute: ${debug_Attribute(self, PLAIN)}`);
    }
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:220 is_word
  is_word(self: Attribute): boolean {
    switch (self.$) {
      case "Unparsed": {
        const n = self._0;
        return n.args.$ === "Empty";
      }
      default:
        return false;
    }
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:230 symbol_path
  symbol_path(self: Attribute): Symbol[] | undefined {
    switch (self.$) {
      case "Unparsed": {
        const n = self._0;
        return n.path.segments.slice();
      }
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:237 path_span
  path_span(self: Attribute): Span | undefined {
    switch (self.$) {
      case "Unparsed": {
        const attr = self._0;
        return attr.path.span;
      }
      case "Parsed":
        return undefined;
    }
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:245 doc_str
  doc_str(self: Attribute): Symbol | undefined {
    if (self.$ === "Parsed" && self._0.$ === "DocComment") {
      const comment = self._0.comment;
      return comment;
    }
    return undefined;
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:252 is_automatically_derived_attr
  is_automatically_derived_attr(self: Attribute): boolean {
    return self.$ === "Parsed" && self._0.$ === "AutomaticallyDerived";
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:257 doc_str_and_fragment_kind
  doc_str_and_fragment_kind(self: Attribute): [Symbol, DocFragmentKind] | undefined {
    if (self.$ === "Parsed" && self._0.$ === "DocComment") {
      const { kind, comment } = self._0;
      return [comment, kind];
    }
    return undefined;
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:266 doc_resolution_scope
  doc_resolution_scope(self: Attribute): AttrStyle | undefined {
    if (self.$ === "Parsed" && self._0.$ === "DocComment") {
      const style = self._0.style;
      return style;
    }
    if (self.$ === "Unparsed" && AttributeExt_Attribute.has_name(self, sym.doc) && AttributeExt_Attribute.value_str(self) !== undefined) {
      const attr = self._0;
      return attr.style;
    }
    return undefined;
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:276 is_proc_macro_attr
  is_proc_macro_attr(self: Attribute): boolean {
    return (
      self.$ === "Parsed" &&
      (self._0.$ === "ProcMacro" || self._0.$ === "ProcMacroAttribute" || self._0.$ === "ProcMacroDerive")
    );
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:287 is_doc_hidden
  is_doc_hidden(self: Attribute): boolean {
    return self.$ === "Parsed" && self._0.$ === "Doc" && self._0._0.hidden !== undefined;
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:291 is_doc_keyword_or_attribute
  is_doc_keyword_or_attribute(self: Attribute): boolean {
    return self.$ === "Parsed" && self._0.$ === "Doc" && (self._0._0.attribute !== undefined || self._0._0.keyword !== undefined);
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:295 is_rustc_doc_primitive
  is_rustc_doc_primitive(self: Attribute): boolean {
    return self.$ === "Parsed" && self._0.$ === "RustcDocPrimitive";
  },
});

/** The `AttributeExt` impls of this crate, by implementing type (rustc_ast has `AttributeExt.Attribute` for `ast::Attribute`). */
export const AttributeExt = {
  Attribute: AttributeExt_Attribute,
};

// FIXME(fn_delegation): use function delegation instead of manually forwarding
export const Attribute = {
  get_normal_item,
  value_lit,
  is_parsed_attr,
  is_prefix_attr_for_suggestions,

  // rustc: compiler/rustc_attr_ir/src/attr.rs:303 id
  id(self: Attribute): AttrId {
    return AttributeExt_Attribute.id(self);
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:308 name
  name(self: Attribute): Symbol | undefined {
    return AttributeExt_Attribute.name(self);
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:313 meta_item_list
  meta_item_list(self: Attribute): MetaItemInner[] | undefined {
    return AttributeExt_Attribute.meta_item_list(self);
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:318 value_str
  value_str(self: Attribute): Symbol | undefined {
    return AttributeExt_Attribute.value_str(self);
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:323 value_span
  value_span(self: Attribute): Span | undefined {
    return AttributeExt_Attribute.value_span(self);
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:328 path_matches
  path_matches(self: Attribute, name: readonly Symbol[]): boolean {
    return AttributeExt_Attribute.path_matches(self, name);
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:333 is_doc_comment
  is_doc_comment(self: Attribute): Span | undefined {
    return AttributeExt_Attribute.is_doc_comment(self);
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:338 has_name
  has_name(self: Attribute, name: Symbol): boolean {
    return AttributeExt_Attribute.has_name(self, name);
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:343 has_any_name
  has_any_name(self: Attribute, names: readonly Symbol[]): boolean {
    return AttributeExt_Attribute.has_any_name(self, names);
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:348 span
  span(self: Attribute): Span {
    return AttributeExt_Attribute.span(self);
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:353 is_word
  is_word(self: Attribute): boolean {
    return AttributeExt_Attribute.is_word(self);
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:358 path
  path(self: Attribute): Symbol[] {
    return AttributeExt_Attribute.path(self);
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:363 doc_str
  doc_str(self: Attribute): Symbol | undefined {
    return AttributeExt_Attribute.doc_str(self);
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:368 is_proc_macro_attr
  is_proc_macro_attr(self: Attribute): boolean {
    return AttributeExt_Attribute.is_proc_macro_attr(self);
  },

  // rustc: compiler/rustc_attr_ir/src/attr.rs:373 doc_str_and_fragment_kind
  doc_str_and_fragment_kind(self: Attribute): [Symbol, DocFragmentKind] | undefined {
    return AttributeExt_Attribute.doc_str_and_fragment_kind(self);
  },
};
