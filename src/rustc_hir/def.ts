// Port of compiler/rustc_hir/src/def.rs
//
// Types and derived Debug/Clone are generated into def.gen.ts (tools/codegen/types.ts, set
// `rustc_hir`). Enum methods live on the companion consts (PORTING §8), struct methods on the
// generated classes (`declare module` + prototype).
//
// PORT: `PartialRes`, `LifetimeRes` and `DocLinkResMap` are not in this file at the pin: they live
// in compiler/rustc_middle/src/middle/resolve.rs (lane tyctxt-min).
import type { NodeId, VariantData } from "../rustc_ast/lib.ts";
import { debug_FloatTy, debug_IntTy, debug_UintTy, decode_FloatTy, decode_IntTy, decode_UintTy, type FloatTy, type IntTy, type UintTy } from "../rustc_ast_ir/lib.ts";
import type { DiagArgValue } from "../rustc_error_messages/lib.ts";
import { DefPathData } from "../rustc_hir_id/definitions.ts";
import { debug_HirId, type HirId } from "../rustc_hir_id/lib.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import type { SpanDecoder } from "../rustc_span/lib.ts";
import type { MacroKind } from "../rustc_span/hygiene.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import { type Debug, debug_tuple, PLAIN } from "../std/fmt.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { panic, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import * as gen from "./def.gen.ts";
import { PerNS } from "./def.gen.ts";

export * from "./def.gen.ts";

// PORT: `hir::PrimTy` and `hir::Safety` (hir.rs) are generated into hir.gen.ts (set `rustc_hir`); def.rs names
// them through `crate::hir`. Re-exported here for this module's existing importers (rustc_resolve).
export { debug_PrimTy, debug_Safety, decode_PrimTy, decode_Safety, encode_PrimTy, encode_Safety, type PrimTy, type Safety } from "./hir.ts";

// ---- def.rs -------------------------------------------------------------------------------------

/** `#[derive(PartialEq)]` for `DefKind` (field-wise; all payloads are Copy values). */
export function DefKind_eq(a: DefKind, b: DefKind): boolean {
  if (a.$ !== b.$) return false;
  switch (a.$) {
    case "Static": {
      const o = b as typeof a;
      return a.safety === o.safety && a.mutability === o.mutability && a.nested === o.nested;
    }
    case "Ctor": {
      const o = b as typeof a;
      return a._0 === o._0 && a._1 === o._1;
    }
    case "Macro":
      return a._0 === (b as typeof a)._0;
    case "Impl":
      return a.of_trait === (b as typeof a).of_trait;
    default:
      return true;
  }
}

export type MacroKinds = gen.MacroKinds;
export const MacroKinds = {
  ...gen.MacroKinds,

  // Constants to allow easy pattern-matching on any combination.
  /// `ATTR | BANG`
  ATTR_BANG: gen.MacroKinds.union(gen.MacroKinds.ATTR, gen.MacroKinds.BANG),
  /// `DERIVE | BANG`
  DERIVE_BANG: gen.MacroKinds.union(gen.MacroKinds.DERIVE, gen.MacroKinds.BANG),
  /// `DERIVE | ATTR`
  DERIVE_ATTR: gen.MacroKinds.union(gen.MacroKinds.DERIVE, gen.MacroKinds.ATTR),
  /// `DERIVE | ATTR | BANG`
  DERIVE_ATTR_BANG: gen.MacroKinds.union(gen.MacroKinds.union(gen.MacroKinds.DERIVE, gen.MacroKinds.ATTR), gen.MacroKinds.BANG),

  // rustc: compiler/rustc_hir/src/def.rs:48 from
  from_MacroKind(kind: MacroKind): MacroKinds {
    switch (kind) {
      case "Bang":
        return gen.MacroKinds.BANG;
      case "Attr":
        return gen.MacroKinds.ATTR;
      case "Derive":
        return gen.MacroKinds.DERIVE;
    }
  },

  /// Convert the MacroKinds to a static string.
  ///
  /// This hardcodes all the possibilities, in order to return a static string.
  // rustc: compiler/rustc_hir/src/def.rs:72 descr
  descr(self: MacroKinds): string {
    switch (self) {
      // FIXME: change this to "function-like macro" and fix all tests
      case MacroKinds.BANG:
        return "macro";
      case MacroKinds.ATTR:
        return "attribute macro";
      case MacroKinds.DERIVE:
        return "derive macro";
      case MacroKinds.ATTR_BANG:
        return "attribute/function macro";
      case MacroKinds.DERIVE_BANG:
        return "derive/function macro";
      case MacroKinds.DERIVE_ATTR:
        return "attribute/derive macro";
      case MacroKinds.DERIVE_ATTR_BANG:
        return "attribute/derive/function macro";
      default:
        if (gen.MacroKinds.is_empty(self)) return "useless macro";
        return unreachable();
    }
  },

  /// Return an indefinite article (a/an) for use with `descr()`
  // rustc: compiler/rustc_hir/src/def.rs:88 article
  article(self: MacroKinds): string {
    if (gen.MacroKinds.contains(self, gen.MacroKinds.ATTR)) {
      return "an";
    } else {
      return "a";
    }
  },
};

/// What kind of definition something is; e.g., `mod` vs `struct`.
/// `enum DefPathData` may need to be updated if a new variant is added here.
export type DefKind = gen.DefKind;
export const DefKind = {
  ...gen.DefKind,

  /// Get an English description for the item's kind.
  ///
  /// If you have access to `TyCtxt`, use `TyCtxt::def_descr` or
  /// `TyCtxt::def_kind_descr` instead, because they give better
  /// information for coroutines and associated functions.
  // rustc: compiler/rustc_hir/src/def.rs:220 descr
  descr(self: DefKind, def_id: DefId): string {
    switch (self.$) {
      case "Fn":
        return "function";
      case "Mod":
        if (def_id.is_crate_root() && !def_id.is_local()) return "crate";
        return "module";
      case "Static":
        return "static";
      case "Enum":
        return "enum";
      case "Variant":
        return "variant";
      case "Ctor":
        if (self._0 === "Variant" && self._1 === "Fn") return "tuple variant";
        if (self._0 === "Variant" && self._1 === "Const") return "unit variant";
        if (self._0 === "Struct" && self._1 === "Fn") return "tuple struct";
        return "unit struct";
      case "Struct":
        return "struct";
      case "OpaqueTy":
        return "opaque type";
      case "TyAlias":
        return "type alias";
      case "TraitAlias":
        return "trait alias";
      case "AssocTy":
        return "associated type";
      case "Union":
        return "union";
      case "Trait":
        return "trait";
      case "ForeignTy":
        return "foreign type";
      case "AssocFn":
        return "associated function";
      case "Const":
        return "constant";
      case "AssocConst":
        return "associated constant";
      case "TyParam":
        return "type parameter";
      case "ConstParam":
        return "const parameter";
      case "Macro":
        return MacroKinds.descr(self._0);
      case "LifetimeParam":
        return "lifetime parameter";
      case "Use":
        return "import";
      case "ForeignMod":
        return "foreign module";
      case "AnonConst":
        return "constant expression";
      case "Field":
        return "field";
      case "Impl":
        return "implementation";
      case "Closure":
        return "closure";
      case "ExternCrate":
        return "extern crate";
      case "GlobalAsm":
        return "global assembly block";
      case "SyntheticCoroutineBody":
        return "synthetic mir body";
      case "TestBinderConstraints":
        return "test_binder_constraints!";
    }
  },

  /// Gets an English article for the definition.
  ///
  /// If you have access to `TyCtxt`, use `TyCtxt::def_descr_article` or
  /// `TyCtxt::def_kind_descr_article` instead, because they give better
  /// information for coroutines and associated functions.
  // rustc: compiler/rustc_hir/src/def.rs:265 article
  article(self: DefKind): string {
    switch (self.$) {
      case "AssocTy":
      case "AssocConst":
      case "AssocFn":
      case "Enum":
      case "OpaqueTy":
      case "Impl":
      case "Use":
      case "ExternCrate":
        return "an";
      case "Macro":
        return MacroKinds.article(self._0);
      default:
        return "a";
    }
  },

  // rustc: compiler/rustc_hir/src/def.rs:280 ns
  ns(self: DefKind): Namespace | undefined {
    switch (self.$) {
      case "Mod":
      case "Struct":
      case "Union":
      case "Enum":
      case "Variant":
      case "Trait":
      case "TyAlias":
      case "ForeignTy":
      case "TraitAlias":
      case "AssocTy":
      case "TyParam":
        return "TypeNS";

      case "Fn":
      case "Const":
      case "ConstParam":
      case "Static":
      case "Ctor":
      case "AssocFn":
      case "AssocConst":
        return "ValueNS";

      case "Macro":
        return "MacroNS";

      // Not namespaced.
      case "AnonConst":
      case "Field":
      case "LifetimeParam":
      case "ExternCrate":
      case "Closure":
      case "Use":
      case "ForeignMod":
      case "GlobalAsm":
      case "Impl":
      case "OpaqueTy":
      case "SyntheticCoroutineBody":
      case "TestBinderConstraints":
        return undefined;
    }
  },

  // Some `DefKind`s require a name, some don't. Panics if one is needed but
  // not provided. (`AssocTy` is an exception, see below.)
  // rustc: compiler/rustc_hir/src/def.rs:322 def_path_data
  def_path_data(self: DefKind, name: Symbol | undefined): DefPathData {
    switch (self.$) {
      case "Mod":
      case "Struct":
      case "Union":
      case "Enum":
      case "Variant":
      case "Trait":
      case "TyAlias":
      case "ForeignTy":
      case "TraitAlias":
      case "TyParam":
      case "ExternCrate":
        return { $: "TypeNs", _0: unwrap(name) };

      // An associated type name will be missing for an RPITIT (DefPathData::AnonAssocTy),
      // but those provide their own DefPathData.
      case "AssocTy":
        return { $: "TypeNs", _0: unwrap(name) };

      case "Fn":
      case "Const":
      case "ConstParam":
      case "Static":
      case "AssocFn":
      case "AssocConst":
      case "Field":
        return { $: "ValueNs", _0: unwrap(name) };
      case "Macro":
        return { $: "MacroNs", _0: unwrap(name) };
      case "LifetimeParam":
        return { $: "LifetimeNs", _0: unwrap(name) };
      case "Ctor":
        return DefPathData.Ctor;
      case "Use":
        return DefPathData.Use;
      case "ForeignMod":
        return DefPathData.ForeignMod;
      case "AnonConst":
        return DefPathData.AnonConst;
      case "OpaqueTy":
        return DefPathData.OpaqueTy;
      case "GlobalAsm":
        return DefPathData.GlobalAsm;
      case "Impl":
        return DefPathData.Impl;
      case "Closure":
        return DefPathData.Closure;
      case "SyntheticCoroutineBody":
        return DefPathData.SyntheticCoroutineBody;
      case "TestBinderConstraints":
        return DefPathData.TestBinderConstraints;
    }
  },

  // rustc: compiler/rustc_hir/src/def.rs:362 is_assoc
  is_assoc(self: DefKind): boolean {
    return self.$ === "AssocConst" || self.$ === "AssocFn" || self.$ === "AssocTy";
  },

  /// This is a "module" in name resolution sense.
  // rustc: compiler/rustc_hir/src/def.rs:368 is_module_like
  is_module_like(self: DefKind): boolean {
    return self.$ === "Mod" || self.$ === "Enum" || self.$ === "Trait";
  },

  // rustc: compiler/rustc_hir/src/def.rs:373 is_adt
  is_adt(self: DefKind): boolean {
    return self.$ === "Struct" || self.$ === "Union" || self.$ === "Enum";
  },

  // rustc: compiler/rustc_hir/src/def.rs:378 is_fn_like
  is_fn_like(self: DefKind): boolean {
    return self.$ === "Fn" || self.$ === "AssocFn" || self.$ === "Closure" || self.$ === "SyntheticCoroutineBody";
  },

  /// Whether the corresponding item has generic parameters, i.e. the `generics_of` query works.
  // rustc: compiler/rustc_hir/src/def.rs:386 has_generics
  has_generics(self: DefKind): boolean {
    switch (self.$) {
      case "AnonConst":
      case "AssocConst":
      case "AssocFn":
      case "AssocTy":
      case "Closure":
      case "Const":
      case "Ctor":
      case "Enum":
      case "Field":
      case "Fn":
      case "ForeignTy":
      case "Impl":
      case "OpaqueTy":
      case "Static":
      case "Struct":
      case "SyntheticCoroutineBody":
      case "Trait":
      case "TraitAlias":
      case "TyAlias":
      case "Union":
      case "Variant":
      case "TestBinderConstraints":
        return true;
      case "ConstParam":
      case "ExternCrate":
      case "ForeignMod":
      case "GlobalAsm":
      case "LifetimeParam":
      case "Macro":
      case "Mod":
      case "TyParam":
      case "Use":
        return false;
    }
  },

  /// Whether `query get_codegen_attrs` should be used with this definition.
  // rustc: compiler/rustc_hir/src/def.rs:423 has_codegen_attrs
  has_codegen_attrs(self: DefKind): boolean {
    switch (self.$) {
      case "Fn":
      case "AssocFn":
      case "Ctor":
      case "Closure":
      case "Static":
      case "SyntheticCoroutineBody":
        return true;
      case "Mod":
      case "Struct":
      case "Union":
      case "Enum":
      case "Variant":
      case "Trait":
      case "TyAlias":
      case "ForeignTy":
      case "TraitAlias":
      case "AssocTy":
      case "Const":
      case "AssocConst":
      case "Macro":
      case "Use":
      case "ForeignMod":
      case "OpaqueTy":
      case "Impl":
      case "Field":
      case "TyParam":
      case "ConstParam":
      case "LifetimeParam":
      case "AnonConst":
      case "GlobalAsm":
      case "ExternCrate":
      case "TestBinderConstraints":
        return false;
    }
  },
};

/// The resolution of a path or export.
///
/// For every path or identifier in Rust, the compiler must determine
/// what the path refers to. This process is called name resolution,
/// and `Res` is the primary result of name resolution.
// (see def.gen.ts for the variants)
export type Res<Id = HirId> = gen.Res<Id>;

/** `#[derive(PartialEq)]` for `Res<Id>`; `eq_Id` compares the `Local` payloads. */
export function Res_eq<Id>(a: Res<Id>, b: Res<Id>, eq_Id: (x: Id, y: Id) => boolean = (x, y) => x === y): boolean {
  if (a.$ !== b.$) return false;
  switch (a.$) {
    case "Def": {
      const o = b as typeof a;
      return DefKind_eq(a._0, o._0) && DefId_eq_(a._1, o._1);
    }
    case "PrimTy": {
      const x = a._0;
      const y = (b as typeof a)._0;
      return x.$ === y.$ && ("_0" in x ? x._0 === (y as typeof x)._0 : true);
    }
    case "SelfTyParam":
      return DefId_eq_(a.trait_, (b as typeof a).trait_);
    case "SelfTyAlias": {
      const o = b as typeof a;
      return DefId_eq_(a.alias_to, o.alias_to) && a.is_trait_impl === o.is_trait_impl;
    }
    case "SelfCtor":
      return DefId_eq_(a._0, (b as typeof a)._0);
    case "Local":
      return eq_Id(a._0, (b as typeof a)._0);
    case "OpenMod":
      return a._0 === (b as typeof a)._0;
    case "NonMacroAttr": {
      const x = a._0;
      const y = (b as typeof a)._0;
      return x.$ === y.$ && (x.$ !== "Builtin" || x._0 === (y as typeof x)._0);
    }
    case "ToolMod":
    case "Err":
      return true;
  }
}

function DefId_eq_(a: DefId, b: DefId): boolean {
  return a.index === b.index && a.krate === b.krate;
}

/// Different kinds of symbols can coexist even if they share the same textual name.
/// Therefore, they each have a separate universe (known as a "namespace").
export type Namespace = gen.Namespace;

/// Just a helper ‒ separate structure for each namespace.
// (class PerNS: def.gen.ts)
declare module "./def.gen.ts" {
  interface PerNS<T> {
    map<U>(f: (x: T) => U): PerNS<U>;
    into_iter(): T[];
    iter(): T[];
    index(ns: Namespace): T;
    index_mut(ns: Namespace): MutRef<T>;
    is_empty(): boolean;
    present_items(): NonNullable<T>[];
  }
}

/** `#[derive_const(Default)]`: every namespace `T::default()`. */
export function PerNS_default<T>(default_T: () => T): PerNS<T> {
  return new PerNS(default_T(), default_T(), default_T());
}

export const Res_ = {
  // rustc: compiler/rustc_hir/src/def.rs:591 in_namespace
  in_namespace(self: Res): PerNS<Res | undefined> {
    if (self.$ === "Def" && (self._0.$ === "Mod" || self._0.$ === "Trait")) {
      return new PerNS<Res | undefined>(undefined, self, undefined);
    } else if (self.$ === "Def" && self._0.$ === "Enum") {
      return new PerNS<Res | undefined>(self, undefined, undefined);
    } else if (self.$ === "Err") {
      // Propagate the error to all namespaces, just to be sure.
      const err: Res | undefined = gen.Res.Err;
      return new PerNS<Res | undefined>(err, err, err);
    } else {
      return panic(`bad path segment res ${gen.debug_Res(self, PLAIN, debug_HirId)}`);
    }
  },
};

// rustc: compiler/rustc_hir/src/def.rs:610 into_diag_arg
export function Res_into_diag_arg<Id>(self: Res<Id>, _: MutRef<string | undefined>): DiagArgValue {
  return { $: "Str", _0: Res.descr(self) };
}

export const Namespace = {
  ...gen.Namespace,

  /// The English description of the namespace.
  // rustc: compiler/rustc_hir/src/def.rs:636 descr
  descr(self: Namespace): string {
    switch (self) {
      case "TypeNS":
        return "type";
      case "ValueNS":
        return "value";
      case "MacroNS":
        return "macro";
    }
  },
};

// rustc: compiler/rustc_hir/src/def.rs:646 into_diag_arg
export function Namespace_into_diag_arg(self: Namespace, _: MutRef<string | undefined>): DiagArgValue {
  return { $: "Str", _0: Namespace.descr(self) };
}

// rustc: compiler/rustc_hir/src/def.rs:661 map
PerNS.prototype.map = function <T, U>(this: PerNS<T>, f: (x: T) => U): PerNS<U> {
  return new PerNS(f(this.value_ns), f(this.type_ns), f(this.macro_ns));
};

/// Note: Do you really want to use this? Often you know which namespace a
/// name will belong in, and you can consider just that namespace directly,
/// rather than iterating through all of them.
// rustc: compiler/rustc_hir/src/def.rs:668 into_iter
PerNS.prototype.into_iter = function <T>(this: PerNS<T>): T[] {
  return [this.value_ns, this.type_ns, this.macro_ns];
};

/// Note: Do you really want to use this? Often you know which namespace a
/// name will belong in, and you can consider just that namespace directly,
/// rather than iterating through all of them.
// rustc: compiler/rustc_hir/src/def.rs:675 iter
PerNS.prototype.iter = function <T>(this: PerNS<T>): T[] {
  return [this.value_ns, this.type_ns, this.macro_ns];
};

// rustc: compiler/rustc_hir/src/def.rs:683 index
PerNS.prototype.index = function <T>(this: PerNS<T>, ns: Namespace): T {
  switch (ns) {
    case "ValueNS":
      return this.value_ns;
    case "TypeNS":
      return this.type_ns;
    case "MacroNS":
      return this.macro_ns;
  }
};

// rustc: compiler/rustc_hir/src/def.rs:693 index_mut
PerNS.prototype.index_mut = function <T>(this: PerNS<T>, ns: Namespace): MutRef<T> {
  // PORT: `&mut T` into one of the three fields -> a `MutRef` over that field (PORTING §8).
  const self = this;
  switch (ns) {
    case "ValueNS":
      return {
        get value() {
          return self.value_ns;
        },
        set value(v: T) {
          self.value_ns = v;
        },
      };
    case "TypeNS":
      return {
        get value() {
          return self.type_ns;
        },
        set value(v: T) {
          self.type_ns = v;
        },
      };
    case "MacroNS":
      return {
        get value() {
          return self.macro_ns;
        },
        set value(v: T) {
          self.macro_ns = v;
        },
      };
  }
};

/// Returns `true` if all the items in this collection are `None`.
// rustc: compiler/rustc_hir/src/def.rs:704 is_empty
PerNS.prototype.is_empty = function <T>(this: PerNS<T>): boolean {
  return this.type_ns === undefined && this.value_ns === undefined && this.macro_ns === undefined;
};

/// Returns an iterator over the items which are `Some`.
///
/// Note: Do you really want to use this? Often you know which namespace a
/// name will belong in, and you can consider just that namespace directly,
/// rather than iterating through all of them.
// rustc: compiler/rustc_hir/src/def.rs:713 present_items
PerNS.prototype.present_items = function <T>(this: PerNS<T>): NonNullable<T>[] {
  return [this.type_ns, this.value_ns, this.macro_ns].filter((x): x is NonNullable<T> => x !== undefined);
};

export const CtorKind = {
  ...gen.CtorKind,

  // rustc: compiler/rustc_hir/src/def.rs:719 from_ast
  from_ast(vdata: VariantData): [CtorKind, NodeId] | undefined {
    switch (vdata.$) {
      case "Tuple":
        return ["Fn", vdata._1];
      case "Unit":
        return ["Const", vdata._0];
      case "Struct":
        return undefined;
    }
  },
};
export type CtorKind = gen.CtorKind;

export const NonMacroAttrKind = {
  ...gen.NonMacroAttrKind,

  // rustc: compiler/rustc_hir/src/def.rs:729 descr
  descr(self: NonMacroAttrKind): string {
    switch (self.$) {
      case "Builtin":
        return "built-in attribute";
      case "Tool":
        return "tool attribute";
      case "DeriveHelper":
      case "DeriveHelperCompat":
        return "derive helper attribute";
    }
  },

  // Currently trivial, but exists in case a new kind is added in the future whose name starts
  // with a vowel.
  // rustc: compiler/rustc_hir/src/def.rs:741 article
  article(_self: NonMacroAttrKind): string {
    return "a";
  },

  /// Users of some attributes cannot mark them as used, so they are considered always used.
  // rustc: compiler/rustc_hir/src/def.rs:746 is_used
  is_used(self: NonMacroAttrKind): boolean {
    switch (self.$) {
      case "Tool":
      case "DeriveHelper":
      case "DeriveHelperCompat":
        return true;
      case "Builtin":
        return false;
    }
  },
};
export type NonMacroAttrKind = gen.NonMacroAttrKind;

// PORT: `impl<Id> Res<Id>` methods on the `Res` companion. `def_id` (which formats `{self:?}`)
// takes the `Id` Debug impl as a parameter (generic Debug convention, see ast-types handoff).
export const Res = {
  ...gen.Res,
  ...Res_,

  /// Return the `DefId` of this `Def` if it has an ID, else panic.
  // rustc: compiler/rustc_hir/src/def.rs:758 def_id
  def_id<Id>(self: Res<Id>, debug_Id: Debug<Id>): DefId {
    const id = Res.opt_def_id(self);
    if (id !== undefined) return id;
    return panic(`attempted .def_id() on invalid res: ${gen.debug_Res(self, PLAIN, debug_Id)}`);
  },

  /// Return `Some(..)` with the `DefId` of this `Res` if it has a ID, else `None`.
  // rustc: compiler/rustc_hir/src/def.rs:766 opt_def_id
  opt_def_id<Id>(self: Res<Id>): DefId | undefined {
    switch (self.$) {
      case "Def":
        return self._1;

      case "Local":
      case "PrimTy":
      case "SelfTyParam":
      case "SelfTyAlias":
      case "SelfCtor":
      case "ToolMod":
      case "OpenMod":
      case "NonMacroAttr":
      case "Err":
        return undefined;
    }
  },

  /// Return the `DefId` of this `Res` if it represents a module.
  // rustc: compiler/rustc_hir/src/def.rs:783 mod_def_id
  mod_def_id<Id>(self: Res<Id>): DefId | undefined {
    if (self.$ === "Def" && self._0.$ === "Mod") return self._1;
    return undefined;
  },

  /// If this is a "module" in name resolution sense, return its `DefId`.
  // rustc: compiler/rustc_hir/src/def.rs:792 module_like_def_id
  module_like_def_id<Id>(self: Res<Id>): DefId | undefined {
    if (self.$ === "Def" && DefKind.is_module_like(self._0)) return self._1;
    return undefined;
  },

  /// A human readable name for the res kind ("function", "module", etc.).
  // rustc: compiler/rustc_hir/src/def.rs:800 descr
  descr<Id>(self: Res<Id>): string {
    switch (self.$) {
      case "Def":
        return DefKind.descr(self._0, self._1);
      case "SelfCtor":
        return "self constructor";
      case "PrimTy":
        return "builtin type";
      case "Local":
        return "local variable";
      case "SelfTyParam":
      case "SelfTyAlias":
        return "self type";
      case "ToolMod":
        return "tool module";
      case "OpenMod":
        return "namespaced crate";
      case "NonMacroAttr":
        return NonMacroAttrKind.descr(self._0);
      case "Err":
        return "unresolved item";
    }
  },

  /// Gets an English article for the `Res`.
  // rustc: compiler/rustc_hir/src/def.rs:815 article
  article<Id>(self: Res<Id>): string {
    switch (self.$) {
      case "Def":
        return DefKind.article(self._0);
      case "NonMacroAttr":
        return NonMacroAttrKind.article(self._0);
      case "Err":
        return "an";
      default:
        return "a";
    }
  },

  // rustc: compiler/rustc_hir/src/def.rs:824 map_id
  map_id<Id, R>(self: Res<Id>, map: (id: Id) => R): Res<R> {
    switch (self.$) {
      case "Def":
        return { $: "Def", _0: self._0, _1: self._1 };
      case "SelfCtor":
        return { $: "SelfCtor", _0: self._0 };
      case "PrimTy":
        return { $: "PrimTy", _0: self._0 };
      case "Local":
        return { $: "Local", _0: map(self._0) };
      case "SelfTyParam":
        return { $: "SelfTyParam", trait_: self.trait_ };
      case "SelfTyAlias":
        return { $: "SelfTyAlias", alias_to: self.alias_to, is_trait_impl: self.is_trait_impl };
      case "ToolMod":
        return gen.Res.ToolMod;
      case "OpenMod":
        return { $: "OpenMod", _0: self._0 };
      case "NonMacroAttr":
        return { $: "NonMacroAttr", _0: self._0 };
      case "Err":
        return gen.Res.Err;
    }
  },

  // rustc: compiler/rustc_hir/src/def.rs:841 apply_id
  apply_id<Id, R, E>(self: Res<Id>, map: (id: Id) => Result<R, E>): Result<Res<R>, E> {
    switch (self.$) {
      case "Def":
        return Ok({ $: "Def", _0: self._0, _1: self._1 });
      case "SelfCtor":
        return Ok({ $: "SelfCtor", _0: self._0 });
      case "PrimTy":
        return Ok({ $: "PrimTy", _0: self._0 });
      case "Local": {
        const r = map(self._0);
        if (r.$ === "Err") return Err(r._0);
        return Ok({ $: "Local", _0: r._0 });
      }
      case "SelfTyParam":
        return Ok({ $: "SelfTyParam", trait_: self.trait_ });
      case "SelfTyAlias":
        return Ok({ $: "SelfTyAlias", alias_to: self.alias_to, is_trait_impl: self.is_trait_impl });
      case "ToolMod":
        return Ok(gen.Res.ToolMod);
      case "OpenMod":
        return Ok({ $: "OpenMod", _0: self._0 });
      case "NonMacroAttr":
        return Ok({ $: "NonMacroAttr", _0: self._0 });
      case "Err":
        return Ok(gen.Res.Err);
    }
  },

  // rustc: compiler/rustc_hir/src/def.rs:859 expect_non_local
  expect_non_local<Id, OtherId>(self: Res<Id>): Res<OtherId> {
    return Res.map_id<Id, OtherId>(self, (_) => panic("unexpected `Res::Local`"));
  },

  // rustc: compiler/rustc_hir/src/def.rs:866 macro_kinds
  macro_kinds<Id>(self: Res<Id>): MacroKinds | undefined {
    if (self.$ === "Def" && self._0.$ === "Macro") return self._0._0;
    if (self.$ === "NonMacroAttr") return gen.MacroKinds.ATTR;
    return undefined;
  },

  /// Returns `None` if this is `Res::Err`
  // rustc: compiler/rustc_hir/src/def.rs:875 ns
  ns<Id>(self: Res<Id>): Namespace | undefined {
    switch (self.$) {
      case "Def":
        return DefKind.ns(self._0);
      case "PrimTy":
      case "SelfTyParam":
      case "SelfTyAlias":
      case "ToolMod":
      case "OpenMod":
        return "TypeNS";
      case "SelfCtor":
      case "Local":
        return "ValueNS";
      case "NonMacroAttr":
        return "MacroNS";
      case "Err":
        return undefined;
    }
  },

  /// Always returns `true` if `self` is `Res::Err`
  // rustc: compiler/rustc_hir/src/def.rs:890 matches_ns
  matches_ns<Id>(self: Res<Id>, ns: Namespace): boolean {
    const actual_ns = Res.ns(self);
    return actual_ns === undefined || actual_ns === ns;
  },

  /// Returns whether such a resolved path can occur in a tuple struct/variant pattern
  // rustc: compiler/rustc_hir/src/def.rs:895 expected_in_tuple_struct_pat
  expected_in_tuple_struct_pat<Id>(self: Res<Id>): boolean {
    return (self.$ === "Def" && self._0.$ === "Ctor" && self._0._1 === "Fn") || self.$ === "SelfCtor";
  },

  /// Returns whether such a resolved path can occur in a unit struct/variant pattern
  // rustc: compiler/rustc_hir/src/def.rs:900 expected_in_unit_struct_pat
  expected_in_unit_struct_pat<Id>(self: Res<Id>): boolean {
    return (self.$ === "Def" && self._0.$ === "Ctor" && self._0._1 === "Const") || self.$ === "SelfCtor";
  },
};
