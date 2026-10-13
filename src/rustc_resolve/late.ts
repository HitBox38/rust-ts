// Port of compiler/rustc_resolve/src/late.rs
//! "Late resolution" is the pass that resolves most of names in a crate beside imports and macros.
//! It runs when the crate is fully expanded and its module structure is fully built.
//! So it just walks through the crate and resolves all the expressions, types, etc.
//!
//! If you wonder why there's no `early.rs`, that's because it's split into three files -
//! `build_reduced_graph.rs`, `macros.rs` and `imports.rs`.
//
// Stub (contract-first, lane res-lib): the methods of this file are declared in ./decls.ts (the
// `LateResolutionVisitor` class lives there too: its `impl` is split with late/diagnostics.rs) and
// installed below as `unported(..)` placeholders; free fns, companions and statics have their final
// signatures and `unported` bodies, without markers. The lane that ports late.rs replaces each stub
// in place (adding its `// rustc: ` marker) and removes the method's name from the
// `unported_methods` list (docs/handoff/res-lib.md, "How to fill a stub").
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other
// crates; another rustc_resolve module's exports (late/diagnostics.ts included) are read inside
// function bodies only; this module must not import late/diagnostics.ts at runtime except for
// such uses (lib.ts loads both).
import { type Generics, visit } from "../rustc_ast/lib.ts";
import type { DiagArgValue, ErrCode } from "../rustc_errors/lib.ts";
import type { Namespace } from "../rustc_hir/def.ts";
import type { LifetimeRes } from "../rustc_middle/middle/resolve.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { unported } from "../std/panic.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { Resolver } from "./decls.ts";
import * as gen from "./late.gen.ts";
import type { Res } from "./lib.ts";
// res-late-a imports
import {
  type AnonConst,
  type Arm,
  type AssocItemConstraint,
  type AttrVec,
  type Attribute,
  type Block,
  type ClosureBinder,
  debug_AnonConst,
  type Expr,
  type FieldDef,
  type FnRetTy,
  type ForeignItem,
  type GenericArg,
  type GenericParam,
  type InlineAsm,
  type InlineAsmSym,
  type Item,
  type Lifetime,
  type Local,
  LocalKind,
  type Pat,
  type PathSegment,
  type PolyTraitRef,
  type PreciseCapturingArg,
  type TestBinderBoundTypeConstraint,
  type TestBinderExists,
  type TestBinderForall,
  type Ty,
  type TyPat,
  type UseTree,
  type Variant,
  VisibilityKind,
  type WherePredicate,
} from "../rustc_ast/lib.ts";
import { debug_NodeId, NodeId } from "../rustc_ast/node_id.ts";
import {
  BoundKind,
  type FnKind,
  type LifetimeCtxt,
  walk_fn_ret_ty,
  walk_generic_args,
  walk_inline_asm_sym,
  walk_item,
  walk_lifetime,
  walk_pat,
  walk_precise_capturing_arg,
  walk_test_binder_bound_type_constraint,
  walk_test_binder_exists,
  walk_ty,
  walk_where_predicate,
  WalkItemKind,
} from "../rustc_ast/visit.ts";
import { ControlFlow, VisitorResult } from "../rustc_ast_ir/visit.ts";
import { index_map_swap_remove } from "../rustc_errors/decorate_diag.ts";
import { into_MultiSpan, type MultiSpan } from "../rustc_error_messages/lib.ts";
import {
  type Diag,
  E0404,
  E0405,
  E0422,
  E0423,
  E0425,
  E0433,
  E0531,
  E0532,
  E0573,
  E0574,
  E0575,
  E0576,
  E0577,
  E0799,
  E0800,
  elided_lifetime_in_path_suggestion,
} from "../rustc_errors/lib.ts";
import { PerNS, Res as def_Res, Res_eq } from "../rustc_hir/def.ts";
import { ELIDED_LIFETIMES_IN_PATHS } from "../rustc_lint_defs/builtin.ts";
import { pluralize } from "../rustc_lint_defs/lib.ts";
import { debug_LifetimeRes, PartialRes } from "../rustc_middle/middle/resolve.ts";
import { Session } from "../rustc_session/session.ts";
import { DefId_eq, LocalDefId } from "../rustc_span/def_id.ts";
import { BytePos, DUMMY_SP, type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { display_Ident, Ident, kw } from "../rustc_span/symbol.ts";
import { is_uppercase } from "../std/char.ts";
import { format_debug, PLAIN, PRETTY } from "../std/fmt.ts";
import { field_mut } from "../std/mut_ref.ts";
import { assert, panic, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { KeyedMap, KeyedSet } from "../rust_ts/keyed.ts";
import * as decls from "./decls.ts";
import * as diagnostics from "./diagnostics/mod.ts";
import { AnonConstKind, type DiagMetadata, LifetimeUseSet, type PatternBindings } from "./late.gen.ts";
import type { ElisionFnParameter, LifetimeElisionCandidate, MissingLifetime } from "./late/diagnostics.ts";
import * as late_diagnostics from "./late/diagnostics.ts";
import type { LabelSuggestion } from "./diagnostics/impls.ts";
import {
  clone_Finalize,
  type Decl,
  DefId_key,
  Finalize,
  Ident_key,
  LateDecl,
  type Module,
  ParentScope,
  type PathResult,
  type Range,
  type ResolutionError,
  type Segment,
  type Set1,
  with_owner,
} from "./lib.ts";

export * from "./late.gen.ts";
// PORT: `LateResolutionVisitor::new` (late.rs:1581) is a static of the decls.ts class; this companion
// declares it (the `X = decls.X as typeof decls.X & {..}` pattern of res-lib contract rule 4).
export type LateResolutionVisitor = decls.LateResolutionVisitor;
export const LateResolutionVisitor = decls.LateResolutionVisitor as typeof decls.LateResolutionVisitor & {
  "new": (resolver: Resolver) => LateResolutionVisitor;
};

// rustc-type: compiler/rustc_resolve/src/late.rs:5729 ItemInfoCollector
// PORT: `impl Visitor` -> extends the rustc_ast `Visitor` base class (hand type, types.sets.json).
export class ItemInfoCollector extends visit.Visitor {
  constructor(public r: Resolver) {
    super();
  }
}

/** Stub (lane res-lib): `late.rs:5741` `required_generic_args_suggestion` (unported). */
export function required_generic_args_suggestion(generics: Generics): string | undefined {
  return unported("rustc_resolve::late::required_generic_args_suggestion");
}
/** Stub (lane res-lib): `late.rs:5864` `def_id_matches_path` (unported). */
export function def_id_matches_path(tcx: TyCtxt, def_id: DefId, expected_path: readonly string[]): boolean {
  return unported("rustc_resolve::late::def_id_matches_path");
}
// ---- res-late-a: late.rs:1-2890 (companions, `impl Visitor for LateResolutionVisitor`, and the inherent
// `impl LateResolutionVisitor` up to `future_proof_import`) ----

/**
 * PORT: stand-in for `rustc_hir::MissingLifetimeKind` (hir.rs:812, M3; typemap.middle.json maps it to
 * `unknown`). A fieldless enum, so its values are the variant names (PORTING §5); `LifetimeRes::Fresh`,
 * `MissingLifetime::kind` and `extra_lifetime_params_map` carry these strings. No marker: the type belongs
 * to hir.rs; replace it with rustc_hir's when that is ported.
 */
export type MissingLifetimeKind =
  /// An explicit `'_`.
  | "Underscore"
  /// An elided lifetime `&' ty`.
  | "Ampersand"
  /// An elided lifetime in brackets with written brackets.
  | "Comma"
  /// An elided lifetime with elided brackets.
  | "Brackets";
export const MissingLifetimeKind = { Underscore: "Underscore", Ampersand: "Ampersand", Comma: "Comma", Brackets: "Brackets" } as const;

/**
 * PORT: `#[derive(PartialEq)]` of `rustc_middle::middle::resolve::LifetimeRes` (resolve.ts has no `_eq`).
 * `ErrorGuaranteed` compares always equal (PORTING §8); `Fresh::kind` is a `MissingLifetimeKind` string.
 */
function LifetimeRes_eq(a: LifetimeRes, b: LifetimeRes): boolean {
  switch (a.$) {
    case "Param":
      return b.$ === "Param" && a.param === b.param && a.binder === b.binder;
    case "Fresh":
      return b.$ === "Fresh" && a.param === b.param && a.kind === b.kind;
    case "ElidedAnchor":
      return b.$ === "ElidedAnchor" && a.start === b.start && a.end === b.end;
    case "Infer":
    case "Static":
    case "Error":
      return a.$ === b.$;
  }
}

/** PORT: the key fn of `LifetimeRes`'s derived `Eq`/`Hash`, for the `UnordSet<LifetimeRes>` of `resolve_fn_params`. */
function LifetimeRes_key(r: LifetimeRes): string {
  switch (r.$) {
    case "Param":
      return `Param:${r.param}:${r.binder}`;
    case "Fresh":
      return `Fresh:${r.param}:${String(r.kind)}`;
    case "ElidedAnchor":
      return `ElidedAnchor:${r.start}:${r.end}`;
    case "Infer":
    case "Static":
    case "Error":
      return r.$;
  }
}

/**
 * PORT: `Set1::insert` (rustc_middle/src/middle/resolve_bound_vars.rs:32, not ported; lib.ts has the `Set1`
 * stand-in). Faithful copy without a marker; `&mut self` is the returned new value.
 */
function Set1_insert<T>(self: Set1<T>, value: T, eq: (a: T, b: T) => boolean): Set1<T> {
  switch (self.$) {
    case "Empty":
      return { $: "One", _0: value };
    case "One":
      if (eq(self._0, value)) return self;
      return { $: "Many" };
    default:
      return { $: "Many" };
  }
}

/** `LifetimeRes::Infer` / `LifetimeRes::Static` (unit variants; resolve.ts has no companion). */
const LIFETIME_RES_INFER: LifetimeRes = Object.freeze({ $: "Infer" as const });
const LIFETIME_RES_STATIC: LifetimeRes = Object.freeze({ $: "Static" as const });

/** `LifetimeElisionCandidate::Ignore` (late/diagnostics.ts is read inside function bodies only). */
function LifetimeElisionCandidate_Ignore(): LifetimeElisionCandidate {
  return late_diagnostics.LifetimeElisionCandidate.Ignore;
}

/** `map[&key]` (`impl Index for HashMap`): panics when the key is absent. */
function index_map<K, V>(map: Map<K, V>, key: K): V {
  const v = map.get(key);
  if (v === undefined && !map.has(key)) return panic("key not found");
  return v as V;
}

/**
 * `IndexMap::swap_remove` on a struct-keyed `KeyedMap` (rustc_errors' `index_map_swap_remove` compares
 * keys by identity, so look the stored key object up first).
 */
function keyed_map_swap_remove<K, V>(map: Map<K, V>, key: K): V | undefined {
  const stored = (map as KeyedMap<K, V>).stored_key(key);
  if (stored === undefined) return undefined;
  return index_map_swap_remove(map, stored);
}

/** `NodeId`s of a `Range<NodeId>` (`for id in node_ids`). */
function* node_id_range(r: Range<NodeId>): Generator<NodeId> {
  for (let n = NodeId.as_usize(r.start); n < NodeId.as_usize(r.end); n++) {
    yield NodeId.from_usize(n);
  }
}

/** `#[derive(Default)]` of `DiagMetadata`. */
function DiagMetadata_default(): DiagMetadata {
  return {
    current_trait_assoc_items: undefined,
    current_self_type: undefined,
    current_self_item: undefined,
    current_item: undefined,
    currently_processing_generic_args: false,
    current_function: undefined,
    unused_labels: new Map(),
    current_let_binding: undefined,
    current_pat: undefined,
    in_if_condition: undefined,
    in_assignment: undefined,
    is_assign_rhs: false,
    in_non_gat_assoc_type: undefined,
    in_range: undefined,
    current_trait_object: undefined,
    current_where_predicate: undefined,
    in_assoc_ty_binding: false,
    current_type_path: undefined,
    current_impl_items: undefined,
    current_impl_item: undefined,
    currently_processing_impl_trait: undefined,
    current_elision_failures: [],
  };
}

export type PatternSource = gen.PatternSource;
export const PatternSource = {
  ...gen.PatternSource,
  // rustc: compiler/rustc_resolve/src/late.rs:90 descr
  descr(self: PatternSource): string {
    switch (self) {
      case "Match":
        return "match binding";
      case "Let":
        return "let binding";
      case "For":
        return "for binding";
      case "FnParam":
        return "function parameter";
    }
  },
};

// impl IntoDiagArg for PatternSource
// rustc: compiler/rustc_resolve/src/late.rs:101 into_diag_arg
export function PatternSource_into_diag_arg(self: PatternSource, _: MutRef<string | undefined>): DiagArgValue {
  return { $: "Str", _0: PatternSource.descr(self) };
}
export type ConstantHasGenerics = gen.ConstantHasGenerics;
export const ConstantHasGenerics = {
  ...gen.ConstantHasGenerics,
  // rustc: compiler/rustc_resolve/src/late.rs:152 force_yes_if
  force_yes_if(self: ConstantHasGenerics, b: boolean): ConstantHasGenerics {
    return b ? gen.ConstantHasGenerics.Yes : self;
  },
};
export type ConstantItemKind = gen.ConstantItemKind;
export const ConstantItemKind = {
  ...gen.ConstantItemKind,
  // rustc: compiler/rustc_resolve/src/late.rs:185 as_str
  as_str(self: ConstantItemKind): string {
    switch (self) {
      case "Const":
        return "const";
      case "Static":
        return "static";
    }
  },
};
export type RibKind = gen.RibKind;
export const RibKind = {
  ...gen.RibKind,
  /// Whether this rib kind contains generic parameters, as opposed to local
  /// variables.
  // rustc: compiler/rustc_resolve/src/late.rs:262 contains_params
  contains_params(self: RibKind): boolean {
    switch (self.$) {
      case "Normal":
      case "Block":
      case "FnOrCoroutine":
      case "ConstantItem":
      case "Module":
      case "MacroDefinition":
      case "InlineAsmSym":
        return false;
      case "ConstParamTy":
      case "AssocItem":
      case "Item":
      case "ForwardGenericParamBan":
        return true;
    }
  },

  /// This rib forbids referring to labels defined in upwards ribs.
  // rustc: compiler/rustc_resolve/src/late.rs:279 is_label_barrier
  is_label_barrier(self: RibKind): boolean {
    switch (self.$) {
      case "Normal":
      case "MacroDefinition":
        return false;
      case "FnOrCoroutine":
      case "ConstantItem":
        return true;
      default: {
        const kind = self;
        return bug(`unexpected rib kind: ${gen.debug_RibKind(kind, PLAIN)}`);
      }
    }
  },
};
export type LifetimeRibKind = gen.LifetimeRibKind;
export const LifetimeRibKind = {
  ...gen.LifetimeRibKind,
  /// Convenience function for creating non-erroring `Elided` variants.
  // rustc: compiler/rustc_resolve/src/late.rs:388 elided
  elided(res: LifetimeRes): LifetimeRibKind {
    return { $: "Elided", res, error_in_path: false };
  },
};
export type LifetimeBinderKind = gen.LifetimeBinderKind;
export const LifetimeBinderKind = {
  ...gen.LifetimeBinderKind,
  // rustc: compiler/rustc_resolve/src/late.rs:410 descr
  descr(self: LifetimeBinderKind): string {
    switch (self) {
      case "FnPtrType":
        return "type";
      case "PolyTrait":
        return "bound";
      case "WhereBound":
        return "bound";
      case "Item":
      case "ConstItem":
        return "item";
      case "ImplAssocType":
        return "associated type";
      case "ImplBlock":
        return "impl block";
      case "Function":
        return "function";
      case "Closure":
        return "closure";
    }
  },
};
export type PathSource = gen.PathSource;
export const PathSource = {
  ...gen.PathSource,
  // rustc: compiler/rustc_resolve/src/late.rs:482 namespace
  namespace(self: PathSource): Namespace {
    switch (self.$) {
      case "Type":
      case "TypeParam":
      case "Trait":
      case "Struct":
      case "DefineOpaques":
      case "Module":
        return "TypeNS";
      case "Expr":
      case "Pat":
      case "TupleStruct":
      case "Delegation":
      case "ExternItemImpl":
      case "ReturnTypeNotation":
        return "ValueNS";
      case "TraitItem":
        return self._0;
      case "PreciseCapturingArg":
        return self._0;
      case "Macro":
        return "MacroNS";
    }
  },

  // rustc: compiler/rustc_resolve/src/late.rs:502 defer_to_typeck
  defer_to_typeck(self: PathSource): boolean {
    switch (self.$) {
      case "Type":
      case "TypeParam":
      case "Expr":
      case "Pat":
      case "Struct":
      case "TupleStruct":
      case "Delegation":
      case "ReturnTypeNotation":
        return true;
      case "Trait":
      case "TraitItem":
      case "DefineOpaques":
      case "ExternItemImpl":
      case "PreciseCapturingArg":
      case "Macro":
      case "Module":
        return false;
    }
  },

  // rustc: compiler/rustc_resolve/src/late.rs:522 descr_expected
  descr_expected(self: PathSource): string {
    // PORT: the arms in upstream order; `TraitItem(ValueNS, TupleStruct(..)) | TupleStruct(..)` comes
    // before the general `TraitItem(ns, _)` arm.
    if (self.$ === "DefineOpaques") return "type alias or associated type with opaqaue types";
    if (self.$ === "Type") return "type";
    if (self.$ === "TypeParam") return "type or constant";
    if (self.$ === "Trait") return "trait";
    if (self.$ === "Pat") return "unit struct, unit variant or constant";
    if (self.$ === "Struct") return "struct, variant or union type";
    if ((self.$ === "TraitItem" && self._0 === "ValueNS" && self._1.$ === "TupleStruct") || self.$ === "TupleStruct") {
      return "tuple struct or tuple variant";
    }
    if (self.$ === "TraitItem") {
      switch (self._0) {
        case "TypeNS":
          return "associated type";
        case "ValueNS":
          return "method or associated constant";
        case "MacroNS":
          return bug("associated macro");
      }
    }
    if (self.$ === "Expr") {
      const parent = self._0;
      const kind = parent === undefined ? undefined : parent.kind;
      if (kind !== undefined && kind.$ === "Call") {
        // "function" here means "anything callable" rather than `DefKind::Fn`,
        // this is not precise but usually more helpful than just "value".
        const call_expr = kind._0;
        // the case of `::some_crate()`
        if (call_expr.kind.$ === "Path") {
          const path = call_expr.kind._1;
          if (path.segments.length === 2 && path.segments[0]!.ident.name === kw.PathRoot) {
            return "external crate";
          }
        }
        if (call_expr.kind.$ === "Path") {
          const path = call_expr.kind._1;
          const segment = path.segments.at(-1);
          if (segment !== undefined) {
            const c = display_Ident(segment.ident).codePointAt(0);
            if (c !== undefined && is_uppercase(c)) {
              return "function, tuple struct or tuple variant";
            }
          }
        }
        return "function";
      }
      return "value";
    }
    if (self.$ === "ReturnTypeNotation" || self.$ === "Delegation") return "function";
    if (self.$ === "ExternItemImpl") return "function or static";
    if (self.$ === "PreciseCapturingArg") return "type or const parameter";
    if (self.$ === "Macro") return "macro";
    // PathSource::Module
    return "module";
  },

  // rustc: compiler/rustc_resolve/src/late.rs:567 is_call
  is_call(self: PathSource): boolean {
    return self.$ === "Expr" && self._0 !== undefined && self._0.kind.$ === "Call";
  },

  // rustc: compiler/rustc_resolve/src/late.rs:571 is_expected
  is_expected(self: PathSource, res: Res): boolean {
    const def = res.$ === "Def" ? res._0.$ : undefined;
    switch (self.$) {
      case "DefineOpaques":
        return (
          (res.$ === "Def" && (def === "Struct" || def === "Union" || def === "Enum" || def === "TyAlias" || def === "AssocTy")) ||
          res.$ === "SelfTyAlias"
        );
      case "Type":
        return (
          (res.$ === "Def" &&
            (def === "Struct" ||
              def === "Union" ||
              def === "Enum" ||
              def === "Trait" ||
              def === "TraitAlias" ||
              def === "TyAlias" ||
              def === "AssocTy" ||
              def === "TyParam" ||
              def === "OpaqueTy" ||
              def === "ForeignTy")) ||
          res.$ === "PrimTy" ||
          res.$ === "SelfTyParam" ||
          res.$ === "SelfTyAlias"
        );
      case "TypeParam":
        return (
          (res.$ === "Def" &&
            (def === "Struct" ||
              def === "Union" ||
              def === "Enum" ||
              def === "Trait" ||
              def === "TraitAlias" ||
              def === "TyAlias" ||
              def === "AssocTy" ||
              def === "TyParam" ||
              def === "OpaqueTy" ||
              def === "AnonConst" ||
              def === "AssocConst" ||
              def === "Const" ||
              def === "ConstParam" ||
              def === "ForeignTy")) ||
          res.$ === "PrimTy" ||
          res.$ === "SelfTyParam" ||
          res.$ === "SelfTyAlias"
        );
      case "Trait":
        if (self._0 === "No") {
          return res.$ === "Def" && def === "Trait";
        } else {
          return res.$ === "Def" && (def === "Trait" || def === "TraitAlias");
        }
      case "Expr":
        return (
          (res.$ === "Def" &&
            ((res._0.$ === "Ctor" && (res._0._1 === "Const" || res._0._1 === "Fn")) ||
              def === "Const" ||
              def === "Static" ||
              def === "Fn" ||
              def === "AssocFn" ||
              def === "AssocConst" ||
              def === "ConstParam")) ||
          res.$ === "Local" ||
          res.$ === "SelfCtor"
        );
      case "Pat":
        return def_Res.expected_in_unit_struct_pat(res) || (res.$ === "Def" && (def === "Const" || def === "AssocConst"));
      case "TupleStruct":
        return def_Res.expected_in_tuple_struct_pat(res);
      case "Struct":
        return (
          (res.$ === "Def" && (def === "Struct" || def === "Union" || def === "Variant" || def === "TyAlias" || def === "AssocTy")) ||
          res.$ === "SelfTyParam" ||
          res.$ === "SelfTyAlias"
        );
      case "TraitItem": {
        const ns = self._0;
        if (res.$ === "Def" && (def === "AssocConst" || def === "AssocFn") && ns === "ValueNS") return true;
        if (res.$ === "Def" && def === "AssocTy" && ns === "TypeNS") return true;
        return false;
      }
      case "ReturnTypeNotation":
        return res.$ === "Def" && def === "AssocFn";
      case "Delegation":
        return res.$ === "Def" && (def === "Fn" || def === "AssocFn");
      case "ExternItemImpl":
        return res.$ === "Def" && (def === "Fn" || def === "AssocFn" || def === "Ctor" || def === "Static");
      case "PreciseCapturingArg":
        if (self._0 === "ValueNS") {
          return res.$ === "Def" && def === "ConstParam";
        } else if (self._0 === "TypeNS") {
          // We allow `SelfTyAlias` here so we can give a more descriptive error later.
          return (res.$ === "Def" && def === "TyParam") || res.$ === "SelfTyParam" || res.$ === "SelfTyAlias";
        } else {
          // PathSource::PreciseCapturingArg(MacroNS)
          return false;
        }
      case "Macro":
        return res.$ === "Def" && def === "Macro";
      case "Module":
        return res.$ === "Def" && def === "Mod";
    }
  },

  // rustc: compiler/rustc_resolve/src/late.rs:694 error_code
  error_code(self: PathSource, has_unexpected_resolution: boolean): ErrCode {
    switch (self.$) {
      case "Trait":
        return has_unexpected_resolution ? E0404 : E0405;
      case "Type":
      case "DefineOpaques":
      case "TypeParam":
        return has_unexpected_resolution ? E0573 : E0425;
      case "Struct":
        return has_unexpected_resolution ? E0574 : E0422;
      case "Expr":
      case "Delegation":
      case "ExternItemImpl":
        return has_unexpected_resolution ? E0423 : E0425;
      case "Pat":
      case "TupleStruct":
        return has_unexpected_resolution ? E0532 : E0531;
      case "TraitItem":
      case "ReturnTypeNotation":
        return has_unexpected_resolution ? E0575 : E0576;
      case "PreciseCapturingArg":
        return has_unexpected_resolution ? E0799 : E0800;
      case "Macro":
        return E0425;
      // FIXME: There is no dedicated error code for this case yet.
      // E0577 already covers the same situation for visibilities,
      // so we reuse it here for now. It may make sense to generalize
      // it for restrictions in the future.
      case "Module":
        return has_unexpected_resolution ? E0577 : E0433;
    }
  },
};
export type MaybeExported = gen.MaybeExported;
export const MaybeExported = {

  // rustc: compiler/rustc_resolve/src/late.rs:737 eval
  eval(self: MaybeExported, r: Resolver): boolean {
    let def_id: LocalDefId | undefined;
    switch (self.$) {
      case "Ok": {
        const node_id = self._0;
        def_id = r.current_owner.id === node_id ? r.current_owner.def_id : index_map(r.current_owner.node_id_to_def_id, node_id);
        break;
      }
      case "Impl":
        if (self._0 !== undefined) {
          const trait_def_id = self._0;
          def_id = trait_def_id.as_local();
          break;
        }
        return true;
      case "ImplItem":
        if (self._0.$ === "Ok") {
          const trait_def_id = self._0._0;
          def_id = trait_def_id.as_local();
          break;
        }
        return VisibilityKind.is_pub(self._0._0.kind);
      case "NestedUse":
        return VisibilityKind.is_pub(self._0.kind);
    }
    return def_id === undefined || r.effective_visibilities.is_exported(def_id);
  },
};
export type Rib<R = Res> = gen.Rib<R>;
export const Rib = gen.Rib as typeof gen.Rib & {
  "new": <R>(kind: RibKind) => Rib<R>;
};
// PORT: `bindings` (`FxIndexMap<Ident, R>`) is a `KeyedMap(Ident_key)` and `patterns_with_skipped_bindings`
// (`UnordMap<DefId, ..>`) a `KeyedMap(DefId_key)` (res-lib contract rule 4).
// rustc: compiler/rustc_resolve/src/late.rs:309 new
Rib.new = function <R>(kind: RibKind): Rib<R> {
  return new gen.Rib<R>(new KeyedMap<Ident, R>(Ident_key), new KeyedMap(DefId_key), kind);
};
export type LifetimeRib = gen.LifetimeRib;
export const LifetimeRib = gen.LifetimeRib as typeof gen.LifetimeRib & {
  "new": (kind: LifetimeRibKind) => LifetimeRib;
};
// rustc: compiler/rustc_resolve/src/late.rs:433 new
LifetimeRib.new = function (kind: LifetimeRibKind): LifetimeRib {
  return new gen.LifetimeRib(kind, new KeyedMap<Ident, [NodeId, LifetimeRes]>(Ident_key));
};

// impl AsRef<Resolver> for LateResolutionVisitor

// rustc: compiler/rustc_resolve/src/late.rs:883 as_ref
LateResolutionVisitor.prototype.as_ref = function (this: LateResolutionVisitor): Resolver {
  return this.r;
};

// impl AsMut<Resolver> for LateResolutionVisitor

// rustc: compiler/rustc_resolve/src/late.rs:888 as_mut
LateResolutionVisitor.prototype.as_mut = function (this: LateResolutionVisitor): Resolver {
  return this.r;
};

/// Walks the whole crate in DFS order, visiting each item, resolving names as it goes.
// impl<'ast, 'ra, 'tcx> Visitor<'ast> for LateResolutionVisitor<'_, 'ast, 'ra, 'tcx>

// rustc: compiler/rustc_resolve/src/late.rs:895 visit_attribute
LateResolutionVisitor.prototype.visit_attribute = function (this: LateResolutionVisitor, _: Attribute): undefined {
  // We do not want to resolve expressions that appear in attributes,
  // as they do not correspond to actual code.
};

// rustc: compiler/rustc_resolve/src/late.rs:899 visit_item
LateResolutionVisitor.prototype.visit_item = function (this: LateResolutionVisitor, item: Item): undefined {
  const prev = this.diag_metadata.current_item;
  this.diag_metadata.current_item = item;
  // Always report errors in items we just entered.
  const old_ignore = this.in_func_body;
  this.in_func_body = false;
  with_owner(this, item.id, (this_) => {
    this_.with_lifetime_rib(LifetimeRibKind.Item, (this_) => this_.resolve_item(item));
  });
  this.in_func_body = old_ignore;
  this.diag_metadata.current_item = prev;
};

// rustc: compiler/rustc_resolve/src/late.rs:909 visit_arm
LateResolutionVisitor.prototype.visit_arm = function (this: LateResolutionVisitor, arm: Arm): undefined {
  this.resolve_arm(arm);
};

// rustc: compiler/rustc_resolve/src/late.rs:912 visit_block
LateResolutionVisitor.prototype.visit_block = function (this: LateResolutionVisitor, block: Block): undefined {
  const old_macro_rules = this.parent_scope.macro_rules;
  this.resolve_block(block);
  this.parent_scope.macro_rules = old_macro_rules;
};

// rustc: compiler/rustc_resolve/src/late.rs:917 visit_anon_const
LateResolutionVisitor.prototype.visit_anon_const = function (this: LateResolutionVisitor, constant: AnonConst): undefined {
  bug(`encountered anon const without a manual call to \`resolve_anon_const\`: ${format_debug(constant, debug_AnonConst, PRETTY)}`);
};

// rustc: compiler/rustc_resolve/src/late.rs:920 visit_expr
LateResolutionVisitor.prototype.visit_expr = function (this: LateResolutionVisitor, expr: Expr): undefined {
  this.resolve_expr(expr, undefined);
};

// rustc: compiler/rustc_resolve/src/late.rs:923 visit_pat
LateResolutionVisitor.prototype.visit_pat = function (this: LateResolutionVisitor, p: Pat): undefined {
  const prev = this.diag_metadata.current_pat;
  this.diag_metadata.current_pat = p;

  if (p.kind.$ === "Guard") {
    const subpat = p.kind._0;
    // We walk the guard expression in `resolve_pattern_inner`. Don't resolve it twice.
    this.visit_pat(subpat);
  } else {
    walk_pat(this, p);
  }

  this.diag_metadata.current_pat = prev;
};

// rustc: compiler/rustc_resolve/src/late.rs:936 visit_local
LateResolutionVisitor.prototype.visit_local = function (this: LateResolutionVisitor, local: Local): undefined {
  let local_spans: [Span, Span | undefined, Span | undefined] | undefined;
  switch (local.pat.kind.$) {
    // We check for this to avoid tuple struct fields.
    case "Wild":
      local_spans = undefined;
      break;
    default: {
      const init = LocalKind.init(local.kind);
      local_spans = [local.pat.span, local.ty === undefined ? undefined : local.ty.span, init === undefined ? undefined : init.span];
      break;
    }
  }
  const original = this.diag_metadata.current_let_binding;
  this.diag_metadata.current_let_binding = local_spans;
  this.resolve_local(local);
  this.diag_metadata.current_let_binding = original;
};

// rustc: compiler/rustc_resolve/src/late.rs:950 visit_ty
LateResolutionVisitor.prototype.visit_ty = function (this: LateResolutionVisitor, ty: Ty): undefined {
  const prev = this.diag_metadata.current_trait_object;
  const prev_ty = this.diag_metadata.current_type_path;
  const kind = ty.kind;
  if ((kind.$ === "Ref" || kind.$ === "PinnedRef") && kind._0 === undefined) {
    // Elided lifetime in reference: we resolve as if there was some lifetime `'_` with
    // NodeId `ty.id`.
    // This span will be used in case of elision failure.
    const span = this.r.tcx_.sess.source_map().start_point(ty.span);
    this.resolve_elided_lifetime(ty.id, span);
    walk_ty(this, ty);
  } else if (kind.$ === "Path") {
    const qself = kind._0;
    const path = kind._1;
    this.diag_metadata.current_type_path = ty;

    // If we have a path that ends with `(..)`, then it must be
    // return type notation. Resolve that path in the *value*
    // namespace.
    const seg = path.segments.at(-1);
    let source: PathSource;
    if (seg !== undefined && seg.args !== undefined && seg.args.$ === "ParenthesizedElided") {
      source = PathSource.ReturnTypeNotation;
    } else {
      source = PathSource.Type;
    }

    this.smart_resolve_path(ty.id, qself, path, source);

    // Check whether we should interpret this as a bare trait object.
    let partial_res: PartialRes | undefined;
    let full_res: Res | undefined;
    if (
      qself === undefined &&
      (partial_res = this.r.partial_res_map.get(ty.id)) !== undefined &&
      (full_res = partial_res.full_res()) !== undefined &&
      full_res.$ === "Def" &&
      (full_res._0.$ === "Trait" || full_res._0.$ === "TraitAlias")
    ) {
      // This path is actually a bare trait object. In case of a bare `Fn`-trait
      // object with anonymous lifetimes, we need this rib to correctly place the
      // synthetic lifetimes.
      const span = Span.to(Span.shrink_to_lo(ty.span), Span.shrink_to_lo(path.span));
      this.with_generic_param_rib([], RibKind.Normal, ty.id, "PolyTrait", span, (this_) => this_.visit_path(path));
    } else {
      walk_ty(this, ty);
    }
  } else if (kind.$ === "ImplicitSelf") {
    const self_ty = Ident.with_dummy_span(kw.SelfUpper);
    const d = this.resolve_ident_in_lexical_scope(self_ty, "TypeNS", Finalize.new(ty.id, ty.span), undefined);
    const res = d === undefined ? def_Res.Err : LateDecl.res(d);
    this.r.record_partial_res(ty.id, PartialRes.new(res));
    walk_ty(this, ty);
  } else if (kind.$ === "ImplTrait") {
    const candidates = this.lifetime_elision_candidates;
    this.lifetime_elision_candidates = undefined;
    this.with_lifetime_rib(LifetimeRibKind.ImplTrait, (this_) => walk_ty(this_, ty));
    this.lifetime_elision_candidates = candidates;
  } else if (kind.$ === "TraitObject") {
    const bounds = kind._0;
    this.diag_metadata.current_trait_object = bounds;
    walk_ty(this, ty);
  } else if (kind.$ === "FnPtr") {
    const fn_ptr = kind._0;
    const span = Span.to(Span.shrink_to_lo(ty.span), Span.shrink_to_lo(fn_ptr.decl_span));
    this.with_generic_param_rib(fn_ptr.generic_params, RibKind.Normal, ty.id, "FnPtrType", span, (this_) => {
      this_.visit_generic_params(fn_ptr.generic_params, false);
      this_.resolve_fn_signature(
        ty.id,
        false,
        // We don't need to deal with patterns in parameters, because
        // they are not possible for foreign or bodiless functions.
        fn_ptr.decl.inputs.map(({ ty }): [Pat | undefined, Ty] => [undefined, ty]),
        fn_ptr.decl.output,
        false,
      );
    });
  } else if (kind.$ === "UnsafeBinder") {
    const unsafe_binder = kind._0;
    const span = Span.to(Span.shrink_to_lo(ty.span), Span.shrink_to_lo(unsafe_binder.inner_ty.span));
    this.with_generic_param_rib(unsafe_binder.generic_params, RibKind.Normal, ty.id, "FnPtrType", span, (this_) => {
      this_.visit_generic_params(unsafe_binder.generic_params, false);
      this_.with_lifetime_rib(
        // We don't allow anonymous `unsafe &'_ ()` binders,
        // although I guess we could.
        LifetimeRibKind.AnonymousReportError,
        (this_) => this_.visit_ty(unsafe_binder.inner_ty),
      );
    });
  } else if (kind.$ === "Array") {
    const element_ty = kind._0;
    const length = kind._1;
    this.visit_ty(element_ty);
    this.resolve_anon_const(length, AnonConstKind.ArrayLength);
  } else if (kind.$ === "GcaMacro") {
    const expr = kind._0;
    this.resolve_anon_const_manual(true, { $: "ConstArg", _0: "No" }, (this_) => this_.resolve_expr(expr, undefined));
  } else {
    walk_ty(this, ty);
  }
  this.diag_metadata.current_trait_object = prev;
  this.diag_metadata.current_type_path = prev_ty;
};

// rustc: compiler/rustc_resolve/src/late.rs:1079 visit_ty_pat
LateResolutionVisitor.prototype.visit_ty_pat = function (this: LateResolutionVisitor, t: TyPat): undefined {
  const kind = t.kind;
  switch (kind.$) {
    case "Range": {
      const start = kind._0;
      const end = kind._1;
      if (start !== undefined) {
        this.resolve_anon_const(start, { $: "ConstArg", _0: "No" });
      }
      if (end !== undefined) {
        this.resolve_anon_const(end, { $: "ConstArg", _0: "No" });
      }
      break;
    }
    case "Or": {
      const patterns = kind._0;
      for (const pat of patterns) {
        this.visit_ty_pat(pat);
      }
      break;
    }
    case "NotNull":
    case "Err":
      break;
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:1098 visit_poly_trait_ref
LateResolutionVisitor.prototype.visit_poly_trait_ref = function (this: LateResolutionVisitor, tref: PolyTraitRef): undefined {
  const span = Span.to(Span.shrink_to_lo(tref.span), Span.shrink_to_lo(tref.trait_ref.path.span));
  this.with_generic_param_rib(tref.bound_generic_params, RibKind.Normal, tref.trait_ref.ref_id, "PolyTrait", span, (this_) => {
    this_.visit_generic_params(tref.bound_generic_params, false);
    this_.smart_resolve_path(tref.trait_ref.ref_id, undefined, tref.trait_ref.path, { $: "Trait", _0: "Maybe" });
    this_.visit_trait_ref(tref.trait_ref);
  });
};

// rustc: compiler/rustc_resolve/src/late.rs:1118 visit_foreign_item
LateResolutionVisitor.prototype.visit_foreign_item = function (this: LateResolutionVisitor, foreign_item: ForeignItem): undefined {
  with_owner(this, foreign_item.id, (this_) => {
    this_.resolve_doc_links(foreign_item.attrs, { $: "Ok", _0: foreign_item.id });
    const def_kind = this_.r.tcx_.def_kind(this_.r.current_owner.def_id);
    const kind = foreign_item.kind;
    switch (kind.$) {
      case "TyAlias": {
        const generics = kind._0.generics;
        this_.with_generic_param_rib(
          generics.params,
          { $: "Item", _0: { $: "Yes", _0: generics.span }, _1: def_kind },
          foreign_item.id,
          "Item",
          generics.span,
          (this_) => walk_item(this_, foreign_item, WalkItemKind.ForeignItemKind),
        );
        break;
      }
      case "Fn": {
        const generics = kind._0.generics;
        this_.with_generic_param_rib(
          generics.params,
          { $: "Item", _0: { $: "Yes", _0: generics.span }, _1: def_kind },
          foreign_item.id,
          "Function",
          generics.span,
          (this_) => walk_item(this_, foreign_item, WalkItemKind.ForeignItemKind),
        );
        break;
      }
      case "Static":
        this_.with_static_rib(def_kind, (this_) => walk_item(this_, foreign_item, WalkItemKind.ForeignItemKind));
        break;
      case "MacCall":
        panic("unexpanded macro in resolve!");
    }
  });
};

// rustc: compiler/rustc_resolve/src/late.rs:1152 visit_fn
LateResolutionVisitor.prototype.visit_fn = function (this: LateResolutionVisitor, fn_kind: FnKind, _: AttrVec, sp: Span, fn_id: NodeId): undefined {
  const previous_value = this.diag_metadata.current_function;
  if (fn_kind.$ === "Fn" && (fn_kind._0.$ === "Foreign" || fn_kind._2.body === undefined)) {
    // Bail if the function is foreign, and thus cannot validly have
    // a body, or if there's no body for some other reason.
    const { sig, ident, generics } = fn_kind._2;
    this.visit_fn_header(sig.header);
    this.visit_ident(ident);
    this.visit_generics(generics);
    this.resolve_fn_signature(
      fn_id,
      sig.decl.has_self(),
      sig.decl.inputs.map(({ ty }): [Pat | undefined, Ty] => [undefined, ty]),
      sig.decl.output,
      false,
    );
    return;
  } else if (fn_kind.$ === "Fn") {
    this.diag_metadata.current_function = [fn_kind, sp];
  } else {
    // Do not update `current_function` for closures: it suggests `self` parameters.
  }
  // debug!("(resolving function) entering function");

  if (fn_kind.$ === "Fn") {
    const f = fn_kind._2;
    this.resolve_eii(f.eii_impl);
  }

  // Create a value rib for the function.
  this.with_rib("ValueNS", RibKind.FnOrCoroutine, (this_) => {
    // Create a label rib for the function.
    this_.with_label_rib(RibKind.FnOrCoroutine, (this_) => {
      switch (fn_kind.$) {
        case "Fn": {
          const { sig, generics, contract, body } = fn_kind._2;
          this_.visit_generics(generics);

          const declaration = sig.decl;
          this_.resolve_fn_signature(
            fn_id,
            declaration.has_self(),
            declaration.inputs.map(({ pat, ty }): [Pat | undefined, Ty] => [pat, ty]),
            declaration.output,
            sig.header.coroutine_marker !== undefined,
          );

          if (contract !== undefined) {
            this_.visit_contract(contract);
          }

          if (body !== undefined) {
            // Ignore errors in function bodies if this is rustdoc. Be sure not to
            // set this until the function signature has been resolved.
            const previous_state = this_.in_func_body;
            this_.in_func_body = true;
            // We only care block in the same function
            this_.last_block_rib = undefined;
            // Resolve the function body, potentially inside the body of an async
            // closure.
            this_.with_lifetime_rib(LifetimeRibKind.elided(LIFETIME_RES_INFER), (this_) => this_.visit_block(body));

            // debug!("(resolving function) leaving function");
            this_.in_func_body = previous_state;
          }
          break;
        }
        case "Closure": {
          const binder = fn_kind._0;
          const declaration = fn_kind._2;
          const body = fn_kind._3;
          this_.visit_closure_binder(binder);

          this_.with_lifetime_rib(
            binder.$ === "NotPresent"
              ? // We do not have any explicit generic lifetime parameter.
                { $: "AnonymousCreateParameter", binder: fn_id, report_in_path: false }
              : LifetimeRibKind.AnonymousReportError,
            // Add each argument to the rib.
            (this_) => this_.resolve_params(declaration.inputs),
          );
          this_.with_lifetime_rib(
            binder.$ === "NotPresent" ? LifetimeRibKind.elided(LIFETIME_RES_INFER) : LifetimeRibKind.AnonymousReportError,
            (this_) => walk_fn_ret_ty(this_, declaration.output),
          );

          // Ignore errors in function bodies if this is rustdoc
          // Be sure not to set this until the function signature has been resolved.
          const previous_state = this_.in_func_body;
          this_.in_func_body = true;
          // Resolve the function body, potentially inside the body of an async closure
          this_.with_lifetime_rib(LifetimeRibKind.elided(LIFETIME_RES_INFER), (this_) => this_.visit_expr(body));

          // debug!("(resolving function) leaving function");
          this_.in_func_body = previous_state;
          break;
        }
      }
    });
  });
  this.diag_metadata.current_function = previous_value;
};

// rustc: compiler/rustc_resolve/src/late.rs:1269 visit_lifetime
LateResolutionVisitor.prototype.visit_lifetime = function (this: LateResolutionVisitor, lifetime: Lifetime, use_ctxt: LifetimeCtxt): undefined {
  this.resolve_lifetime(lifetime, use_ctxt);
};

// rustc: compiler/rustc_resolve/src/late.rs:1273 visit_precise_capturing_arg
LateResolutionVisitor.prototype.visit_precise_capturing_arg = function (this: LateResolutionVisitor, arg: PreciseCapturingArg): undefined {
  switch (arg.$) {
    // Lower the lifetime regularly; we'll resolve the lifetime and check
    // it's a parameter later on in HIR lowering.
    case "Lifetime":
      break;

    case "Arg": {
      const path = arg._0;
      const id = arg._1;
      // we want `impl use<C>` to try to resolve `C` as both a type parameter or
      // a const parameter. Since the resolver specifically doesn't allow having
      // two generic params with the same name, even if they're a different namespace,
      // it doesn't really matter which we try resolving first, but just like
      // `Ty::Param` we just fall back to the value namespace only if it's missing
      // from the type namespace.
      const check_ns = (ns: Namespace): boolean => this.maybe_resolve_ident_in_lexical_scope(path.segments[0]!.ident, ns) !== undefined;
      // Like `Ty::Param`, we try resolving this as both a const and a type.
      if (!check_ns("TypeNS") && check_ns("ValueNS")) {
        this.smart_resolve_path(id, undefined, path, { $: "PreciseCapturingArg", _0: "ValueNS" });
      } else {
        this.smart_resolve_path(id, undefined, path, { $: "PreciseCapturingArg", _0: "TypeNS" });
      }
      break;
    }
  }

  walk_precise_capturing_arg(this, arg);
};

// rustc: compiler/rustc_resolve/src/late.rs:1311 visit_generics
LateResolutionVisitor.prototype.visit_generics = function (this: LateResolutionVisitor, generics: Generics): undefined {
  this.visit_generic_params(generics.params, this.diag_metadata.current_self_item !== undefined);
  for (const p of generics.where_clause.predicates) {
    this.visit_where_predicate(p);
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:1318 visit_closure_binder
LateResolutionVisitor.prototype.visit_closure_binder = function (this: LateResolutionVisitor, b: ClosureBinder): undefined {
  switch (b.$) {
    case "NotPresent":
      break;
    case "For": {
      const generic_params = b.generic_params;
      this.visit_generic_params(generic_params, this.diag_metadata.current_self_item !== undefined);
      break;
    }
  }
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_resolve/src/late.rs:1331 visit_generic_arg
LateResolutionVisitor.prototype.visit_generic_arg = function (this: LateResolutionVisitor, arg: GenericArg): undefined {
  const prev = this.diag_metadata.currently_processing_generic_args;
  this.diag_metadata.currently_processing_generic_args = true;
  switch (arg.$) {
    case "Type": {
      const ty = arg._0;
      // We parse const arguments as path types as we cannot distinguish them during
      // parsing. We try to resolve that ambiguity by attempting resolution the type
      // namespace first, and if that fails we try again in the value namespace. If
      // resolution in the value namespace succeeds, we have an generic const argument on
      // our hands.
      //
      // We cannot disambiguate multi-segment paths right now as that requires type
      // checking.
      let ident: Ident | undefined;
      if (
        ty.kind.$ === "Path" &&
        ty.kind._0 === undefined &&
        (ident = ty.kind._1.as_single_argless_ident()) !== undefined &&
        this.maybe_resolve_ident_in_lexical_scope(ident, "TypeNS") === undefined &&
        this.maybe_resolve_ident_in_lexical_scope(ident, "ValueNS") !== undefined
      ) {
        const path = ty.kind._1;
        this.resolve_anon_const_manual(true, { $: "ConstArg", _0: "No" }, (this_) => {
          this_.smart_resolve_path(ty.id, undefined, path, { $: "Expr", _0: undefined });
          this_.visit_path(path);
        });
      } else {
        this.visit_ty(ty);
      }
      break;
    }
    case "Lifetime": {
      const lt = arg._0;
      this.visit_lifetime(lt, "GenericArg");
      break;
    }
    case "Const": {
      const ct = arg._0;
      this.resolve_anon_const(ct, { $: "ConstArg", _0: "No" });
      break;
    }
  }
  this.diag_metadata.currently_processing_generic_args = prev;
};

// rustc: compiler/rustc_resolve/src/late.rs:1368 visit_assoc_item_constraint
LateResolutionVisitor.prototype.visit_assoc_item_constraint = function (this: LateResolutionVisitor, constraint: AssocItemConstraint): undefined {
  this.visit_ident(constraint.ident);
  if (constraint.gen_args !== undefined) {
    const gen_args = constraint.gen_args;
    // Forbid anonymous lifetimes in GAT parameters until proper semantics are decided.
    this.with_lifetime_rib(LifetimeRibKind.AnonymousReportError, (this_) => {
      this_.visit_generic_args(gen_args);
    });
  }
  const kind = constraint.kind;
  switch (kind.$) {
    case "Equality": {
      const term = kind.term;
      switch (term.$) {
        case "Ty": {
          const ty = term._0;
          const prev = this.diag_metadata.in_assoc_ty_binding;
          this.diag_metadata.in_assoc_ty_binding = true;
          this.visit_ty(ty);
          this.diag_metadata.in_assoc_ty_binding = prev;
          break;
        }
        case "Const": {
          const c = term._0;
          this.resolve_anon_const(c, { $: "ConstArg", _0: "No" });
          break;
        }
      }
      break;
    }
    case "Bound": {
      const bounds = kind.bounds;
      // walk_list!(self, visit_param_bound, bounds, BoundKind::Bound);
      for (const bound of bounds) {
        this.visit_param_bound(bound, BoundKind.Bound);
      }
      break;
    }
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:1393 visit_path_segment
LateResolutionVisitor.prototype.visit_path_segment = function (this: LateResolutionVisitor, path_segment: PathSegment): undefined {
  const args = path_segment.args;
  if (args === undefined) {
    return;
  }

  switch (args.$) {
    case "AngleBracketed":
      walk_generic_args(this, args);
      break;
    case "Parenthesized": {
      const p_args = args._0;
      // Probe the lifetime ribs to know how to behave.
      for (let i = this.lifetime_ribs.length - 1; i >= 0; i--) {
        const rib = this.lifetime_ribs[i]!;
        const kind = rib.kind;
        if (kind.$ === "Generics" && kind.kind === "PolyTrait") {
          // We are inside a `PolyTraitRef`. The lifetimes are
          // to be introduced in that (maybe implicit) `for<>` binder.
          const binder = kind.binder;
          this.resolve_fn_signature(
            binder,
            false,
            p_args.inputs.map((param): [Pat | undefined, Ty] => [undefined, param.ty]),
            p_args.output,
            false,
          );
          break;
        } else if (kind.$ === "Item" || kind.$ === "Generics") {
          // We have nowhere to introduce generics. Code is malformed,
          // so use regular lifetime resolution to avoid spurious errors.
          walk_generic_args(this, args);
          break;
        } else {
          // AnonymousCreateParameter | AnonymousReportError | ImplTrait | Elided | ElisionFailure
          // | ConcreteAnonConst | ConstParamTy
        }
      }
      break;
    }
    case "ParenthesizedElided":
      break;
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:1440 visit_where_predicate
LateResolutionVisitor.prototype.visit_where_predicate = function (this: LateResolutionVisitor, p: WherePredicate): undefined {
  // debug!("visit_where_predicate {:?}", p);
  const previous_value = this.diag_metadata.current_where_predicate;
  this.diag_metadata.current_where_predicate = p;
  this.with_lifetime_rib(LifetimeRibKind.AnonymousReportError, (this_) => {
    if (p.kind.$ === "BoundPredicate") {
      const { bounded_ty, bounds, bound_generic_params } = p.kind._0;
      const span = Span.to(Span.shrink_to_lo(p.span), Span.shrink_to_lo(bounded_ty.span));
      this_.with_generic_param_rib(bound_generic_params, RibKind.Normal, bounded_ty.id, "WhereBound", span, (this_) => {
        this_.visit_generic_params(bound_generic_params, false);
        this_.visit_ty(bounded_ty);
        for (const bound of bounds) {
          this_.visit_param_bound(bound, BoundKind.Bound);
        }
      });
    } else {
      walk_where_predicate(this_, p);
    }
  });
  this.diag_metadata.current_where_predicate = previous_value;
};

// rustc: compiler/rustc_resolve/src/late.rs:1473 visit_inline_asm
LateResolutionVisitor.prototype.visit_inline_asm = function (this: LateResolutionVisitor, asm: InlineAsm): undefined {
  for (const [op, _] of asm.operands) {
    switch (op.$) {
      case "In":
      case "InOut":
        this.visit_expr(op.expr);
        break;
      case "Out":
        if (op.expr !== undefined) {
          this.visit_expr(op.expr);
        }
        break;
      case "SplitInOut":
        this.visit_expr(op.in_expr);
        if (op.out_expr !== undefined) {
          this.visit_expr(op.out_expr);
        }
        break;
      case "Const":
        // Although this is `DefKind::AnonConst`, it is allowed to reference outer
        // generic parameters like an inline const.
        this.resolve_anon_const(op.anon_const, AnonConstKind.InlineConst);
        break;
      case "Sym":
        this.visit_inline_asm_sym(op.sym);
        break;
      case "Label":
        this.visit_block(op.block);
        break;
    }
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:1497 visit_inline_asm_sym
LateResolutionVisitor.prototype.visit_inline_asm_sym = function (this: LateResolutionVisitor, sym: InlineAsmSym): undefined {
  // This is similar to the code for AnonConst.
  this.with_rib("ValueNS", RibKind.InlineAsmSym, (this_) => {
    this_.with_rib("TypeNS", RibKind.InlineAsmSym, (this_) => {
      this_.with_label_rib(RibKind.InlineAsmSym, (this_) => {
        this_.smart_resolve_path(sym.id, sym.qself, sym.path, { $: "Expr", _0: undefined });
        walk_inline_asm_sym(this_, sym);
      });
    });
  });
};

// rustc: compiler/rustc_resolve/src/late.rs:1509 visit_variant
LateResolutionVisitor.prototype.visit_variant = function (this: LateResolutionVisitor, v: Variant): undefined {
  this.resolve_doc_links(v.attrs, { $: "Ok", _0: v.id });
  this.visit_id(v.id);
  // walk_list!(self, visit_attribute, &v.attrs);
  for (const attr of v.attrs) {
    this.visit_attribute(attr);
  }
  this.visit_vis(v.vis);
  this.visit_ident(v.ident);
  this.visit_variant_data(v.data);
  if (v.disr_expr !== undefined) {
    const discr = v.disr_expr;
    this.resolve_anon_const(discr, AnonConstKind.EnumDiscriminant);
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:1521 visit_field_def
LateResolutionVisitor.prototype.visit_field_def = function (this: LateResolutionVisitor, f: FieldDef): undefined {
  this.resolve_doc_links(f.attrs, { $: "Ok", _0: f.id });
  const { attrs, vis, ident, ty } = f;
  // walk_list!(self, visit_attribute, attrs);
  for (const attr of attrs) {
    this.visit_attribute(attr);
  }
  // try_visit!(self.visit_vis(vis)); (`Result = ()`)
  this.visit_vis(vis);
  this.resolve_restriction_path(f.mut_restriction().kind);
  // visit_opt!(self, visit_ident, ident);
  if (ident !== undefined) {
    this.visit_ident(ident);
  }
  // try_visit!(self.visit_ty(ty));
  this.visit_ty(ty);
  const v = f.default_value();
  if (v !== undefined) {
    this.resolve_anon_const(v, AnonConstKind.FieldDefaultValue);
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:1534 visit_test_binder_forall
LateResolutionVisitor.prototype.visit_test_binder_forall = function (this: LateResolutionVisitor, forall: TestBinderForall): undefined {
  this.with_generic_param_rib(forall.generics.params, RibKind.Normal, forall.node_id, "WhereBound", forall.span, (this_) => {
    this_.visit_generics(forall.generics);
    this_.visit_test_binder_body(forall.body);
  });
  // exit assertions don't have the bound vars in scope
  if (forall.assert_on_exit !== undefined) {
    const assert_on_exit = forall.assert_on_exit;
    for (const constraint of assert_on_exit) {
      this.visit_test_binder_constraint(constraint);
    }
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:1554 visit_test_binder_exists
LateResolutionVisitor.prototype.visit_test_binder_exists = function (this: LateResolutionVisitor, exists: TestBinderExists): undefined {
  this.with_generic_param_rib(exists.params, RibKind.Normal, exists.node_id, "WhereBound", exists.span, (this_) =>
    walk_test_binder_exists(this_, exists),
  );
};

// rustc: compiler/rustc_resolve/src/late.rs:1565 visit_test_binder_bound_type_constraint
LateResolutionVisitor.prototype.visit_test_binder_bound_type_constraint = function (
  this: LateResolutionVisitor,
  bound_type: TestBinderBoundTypeConstraint,
): undefined {
  this.with_generic_param_rib(
    bound_type.params,
    RibKind.Normal,
    bound_type.node_id,
    "WhereBound",
    Span.to(bound_type.lhs.span, bound_type.rhs.ident.span),
    (this_) => walk_test_binder_bound_type_constraint(this_, bound_type),
  );
};

// impl<'a, 'ast, 'ra, 'tcx> LateResolutionVisitor<'a, 'ast, 'ra, 'tcx>

// rustc: compiler/rustc_resolve/src/late.rs:1581 new
LateResolutionVisitor.new = function (resolver: Resolver): LateResolutionVisitor {
  // During late resolution we only track the module component of the parent scope,
  // although it may be useful to track other components as well for diagnostics.
  const graph_root = resolver.graph_root;
  const parent_scope = ParentScope.module(graph_root, resolver.arenas);
  const start_rib_kind: RibKind = { $: "Module", _0: graph_root };
  return new LateResolutionVisitor(
    resolver,
    parent_scope,
    new PerNS<Rib[]>([Rib.new(start_rib_kind)], [Rib.new(start_rib_kind)], [Rib.new(start_rib_kind)]),
    undefined,
    [],
    [],
    undefined,
    undefined,
    DiagMetadata_default(),
    // errors at module scope should always be reported
    false,
    new Map(),
    [],
    [],
  );
};

// rustc: compiler/rustc_resolve/src/late.rs:1609 maybe_resolve_ident_in_lexical_scope
LateResolutionVisitor.prototype.maybe_resolve_ident_in_lexical_scope = function (
  this: LateResolutionVisitor,
  ident: Ident,
  ns: Namespace,
): LateDecl | undefined {
  return this.r.resolve_ident_in_lexical_scope(ident, ns, this.parent_scope, undefined, this.ribs.index(ns), undefined, this.diag_metadata);
};

// rustc: compiler/rustc_resolve/src/late.rs:1625 resolve_ident_in_lexical_scope
LateResolutionVisitor.prototype.resolve_ident_in_lexical_scope = function (
  this: LateResolutionVisitor,
  ident: Ident,
  ns: Namespace,
  finalize: Finalize | undefined,
  ignore_decl: Decl | undefined,
): LateDecl | undefined {
  return this.r.resolve_ident_in_lexical_scope(ident, ns, this.parent_scope, finalize, this.ribs.index(ns), ignore_decl, this.diag_metadata);
};

// rustc: compiler/rustc_resolve/src/late.rs:1643 resolve_path
LateResolutionVisitor.prototype.resolve_path = function (
  this: LateResolutionVisitor,
  path: readonly Segment[],
  opt_ns: Namespace | undefined, // `None` indicates a module path in import
  finalize: Finalize | undefined,
  source: PathSource,
): PathResult {
  return this.r
    .cm_mut()
    .resolve_path_with_ribs(
      path,
      opt_ns,
      this.parent_scope,
      source,
      finalize === undefined ? undefined : finalize_late(finalize),
      this.ribs,
      undefined,
      undefined,
      this.diag_metadata,
    );
};

/** PORT: `Finalize { stage: Stage::Late, ..finalize }` (`Finalize` is `Copy`). */
function finalize_late(finalize: Finalize): Finalize {
  const f = clone_Finalize(finalize);
  f.stage = "Late";
  return f;
}

// AST resolution
//
// We maintain a list of value ribs and type ribs.
//
// Simultaneously, we keep track of the current position in the module
// graph in the `parent_scope.module` pointer. When we go to resolve a name in
// the value or type namespaces, we first look through all the ribs and
// then query the module graph. When we resolve a name in the module
// namespace, we can skip all the ribs (since nested modules are not
// allowed within blocks in Rust) and jump straight to the current module
// graph node.
//
// Named implementations are handled separately. When we find a method
// call, we consult the module node to find all of the implementations in
// scope. This information is lazily cached in the module node. We then
// generate a fake "implementation scope" containing all the
// implementations thus found, for compatibility with old resolve pass.

/// Do some `work` within a new innermost rib of the given `kind` in the given namespace (`ns`).
// rustc: compiler/rustc_resolve/src/late.rs:1682 with_rib
LateResolutionVisitor.prototype.with_rib = function <T>(
  this: LateResolutionVisitor,
  ns: Namespace,
  kind: RibKind,
  work: (this_: LateResolutionVisitor) => T,
): T {
  this.ribs.index(ns).push(Rib.new(kind));
  const ret = work(this);
  this.ribs.index(ns).pop();
  return ret;
};

// rustc: compiler/rustc_resolve/src/late.rs:1694 visit_generic_params
LateResolutionVisitor.prototype.visit_generic_params = function (
  this: LateResolutionVisitor,
  params: readonly GenericParam[],
  add_self_upper: boolean,
): void {
  // For type parameter defaults, we have to ban access
  // to following type parameters, as the GenericArgs can only
  // provide previous type parameters as they're built. We
  // put all the parameters on the ban list and then remove
  // them one by one as they are processed and become available.
  let forward_ty_ban_rib = Rib.new<Res>({ $: "ForwardGenericParamBan", _0: "Default" });
  let forward_const_ban_rib = Rib.new<Res>({ $: "ForwardGenericParamBan", _0: "Default" });
  for (const param of params) {
    switch (param.kind.$) {
      case "Type":
        forward_ty_ban_rib.bindings.set(Ident.with_dummy_span(param.ident.name), def_Res.Err);
        break;
      case "Const":
        forward_const_ban_rib.bindings.set(Ident.with_dummy_span(param.ident.name), def_Res.Err);
        break;
      case "Lifetime":
        break;
    }
  }

  // rust-lang/rust#61631: The type `Self` is essentially
  // another type parameter. For ADTs, we consider it
  // well-defined only after all of the ADT type parameters have
  // been provided. Therefore, we do not allow use of `Self`
  // anywhere in ADT type parameter defaults.
  //
  // (We however cannot ban `Self` for defaults on *all* generic
  // lists; e.g. trait generics can usefully refer to `Self`,
  // such as in the case of `trait Add<Rhs = Self>`.)
  if (add_self_upper) {
    // (`Some` if + only if we are in ADT's generics.)
    forward_ty_ban_rib.bindings.set(Ident.with_dummy_span(kw.SelfUpper), def_Res.Err);
  }

  // NOTE: We use different ribs here not for a technical reason, but just
  // for better diagnostics.
  let forward_ty_ban_rib_const_param_ty = new Rib<Res>(
    new KeyedMap(Ident_key, forward_ty_ban_rib.bindings),
    new KeyedMap(DefId_key),
    { $: "ForwardGenericParamBan", _0: "ConstParamTy" },
  );
  let forward_const_ban_rib_const_param_ty = new Rib<Res>(
    new KeyedMap(Ident_key, forward_const_ban_rib.bindings),
    new KeyedMap(DefId_key),
    { $: "ForwardGenericParamBan", _0: "ConstParamTy" },
  );
  // We'll ban these with a `ConstParamTy` rib, so just clear these ribs for better
  // diagnostics, so we don't mention anything about const param tys having generics at all.
  if (!this.r.features.generic_const_parameter_types()) {
    forward_ty_ban_rib_const_param_ty.bindings.clear();
    forward_const_ban_rib_const_param_ty.bindings.clear();
  }

  this.with_lifetime_rib(LifetimeRibKind.AnonymousReportError, (this_) => {
    for (const param of params) {
      const kind = param.kind;
      switch (kind.$) {
        case "Lifetime":
          for (const bound of param.bounds) {
            this_.visit_param_bound(bound, BoundKind.Bound);
          }
          break;
        case "Type": {
          for (const bound of param.bounds) {
            this_.visit_param_bound(bound, BoundKind.Bound);
          }

          if (kind.default !== undefined) {
            const ty = kind.default;
            this_.ribs.index("TypeNS").push(forward_ty_ban_rib);
            this_.ribs.index("ValueNS").push(forward_const_ban_rib);
            this_.visit_ty(ty);
            forward_const_ban_rib = unwrap(this_.ribs.index("ValueNS").pop());
            forward_ty_ban_rib = unwrap(this_.ribs.index("TypeNS").pop());
          }

          // Allow all following defaults to refer to this type parameter.
          const i = Ident.with_dummy_span(param.ident.name);
          keyed_map_swap_remove(forward_ty_ban_rib.bindings, i);
          keyed_map_swap_remove(forward_ty_ban_rib_const_param_ty.bindings, i);
          break;
        }
        case "Const": {
          const ty = kind.ty;
          const default_ = kind.default;
          // Const parameters can't have param bounds.
          assert(param.bounds.length === 0, "assertion failed: param.bounds.is_empty()");

          this_.ribs.index("TypeNS").push(forward_ty_ban_rib_const_param_ty);
          this_.ribs.index("ValueNS").push(forward_const_ban_rib_const_param_ty);
          if (this_.r.features.generic_const_parameter_types()) {
            this_.visit_ty(ty);
          } else {
            this_.ribs.index("TypeNS").push(Rib.new(RibKind.ConstParamTy));
            this_.ribs.index("ValueNS").push(Rib.new(RibKind.ConstParamTy));
            this_.with_lifetime_rib(LifetimeRibKind.ConstParamTy, (this_) => {
              this_.visit_ty(ty);
            });
            unwrap(this_.ribs.index("TypeNS").pop());
            unwrap(this_.ribs.index("ValueNS").pop());
          }
          forward_const_ban_rib_const_param_ty = unwrap(this_.ribs.index("ValueNS").pop());
          forward_ty_ban_rib_const_param_ty = unwrap(this_.ribs.index("TypeNS").pop());

          if (default_ !== undefined) {
            const expr = default_;
            this_.ribs.index("TypeNS").push(forward_ty_ban_rib);
            this_.ribs.index("ValueNS").push(forward_const_ban_rib);
            this_.resolve_anon_const(expr, { $: "ConstArg", _0: "No" });
            forward_const_ban_rib = unwrap(this_.ribs.index("ValueNS").pop());
            forward_ty_ban_rib = unwrap(this_.ribs.index("TypeNS").pop());
          }

          // Allow all following defaults to refer to this const parameter.
          const i = Ident.with_dummy_span(param.ident.name);
          keyed_map_swap_remove(forward_const_ban_rib.bindings, i);
          keyed_map_swap_remove(forward_const_ban_rib_const_param_ty.bindings, i);
          break;
        }
      }
    }
  });
};

// #[instrument(level = "debug", skip(self, work))]
// rustc: compiler/rustc_resolve/src/late.rs:1821 with_lifetime_rib
LateResolutionVisitor.prototype.with_lifetime_rib = function <T>(
  this: LateResolutionVisitor,
  kind: LifetimeRibKind,
  work: (this_: LateResolutionVisitor) => T,
): T {
  this.lifetime_ribs.push(LifetimeRib.new(kind));
  const outer_elision_candidates = this.lifetime_elision_candidates;
  this.lifetime_elision_candidates = undefined;
  const ret = work(this);
  this.lifetime_elision_candidates = outer_elision_candidates;
  this.lifetime_ribs.pop();
  return ret;
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_resolve/src/late.rs:1835 resolve_lifetime
LateResolutionVisitor.prototype.resolve_lifetime = function (this: LateResolutionVisitor, lifetime: Lifetime, use_ctxt: LifetimeCtxt): void {
  const ident = lifetime.ident;

  if (ident.name === kw.StaticLifetime) {
    this.record_lifetime_use(lifetime.id, LIFETIME_RES_STATIC, LifetimeElisionCandidate_Ignore());
    return;
  }

  if (ident.name === kw.UnderscoreLifetime) {
    return this.resolve_anonymous_lifetime(lifetime, lifetime.id, false);
  }

  // PORT: `lifetime_rib_iter` (`self.lifetime_ribs.iter().rev()`) is the index `next`; the ribs not
  // consumed by the loop are `next - 1 ..= 0`.
  let next = this.lifetime_ribs.length;
  while (next > 0) {
    const rib = this.lifetime_ribs[--next]!;
    const normalized_ident = ident.normalize_to_macros_2_0();
    const binding = rib.bindings.get(normalized_ident);
    if (binding !== undefined) {
      const res = binding[1];
      this.record_lifetime_use(lifetime.id, res, LifetimeElisionCandidate_Ignore());

      if (res.$ === "Param") {
        const param = res.param;
        const binder = res.binder;
        const entry = this.lifetime_uses.get(param);
        if (entry === undefined) {
          // debug!("First use of {:?} at {:?}", res, ident.span);
          let use_set: LifetimeUseSet | undefined;
          for (let j = this.lifetime_ribs.length - 1; j >= 0 && use_set === undefined; j--) {
            const rib = this.lifetime_ribs[j]!;
            const kind = rib.kind;
            switch (kind.$) {
              // Do not suggest eliding a lifetime where an anonymous
              // lifetime would be illegal.
              case "Item":
              case "AnonymousReportError":
              case "ElisionFailure":
                use_set = LifetimeUseSet.Many;
                break;
              // An anonymous lifetime is legal here, and bound to the right
              // place, go ahead.
              case "AnonymousCreateParameter": {
                const anon_binder = kind.binder;
                use_set = binder === anon_binder ? { $: "One", use_span: ident.span, use_ctxt } : LifetimeUseSet.Many;
                break;
              }
              // Only report if eliding the lifetime would have the same
              // semantics.
              case "Elided": {
                const r = kind.res;
                const error_in_path = kind.error_in_path;
                use_set = LifetimeRes_eq(res, r) && !error_in_path ? { $: "One", use_span: ident.span, use_ctxt } : LifetimeUseSet.Many;
                break;
              }
              case "Generics":
              case "ConstParamTy":
                break;
              case "ConcreteAnonConst":
                span_bug(ident.span, `unexpected rib kind: ${gen.debug_LifetimeRibKind(rib.kind, PLAIN)}`);
                break;

              case "ImplTrait":
                if (this.r.features.anonymous_lifetime_in_impl_trait()) {
                  // None
                } else {
                  use_set = LifetimeUseSet.Many;
                }
                break;
            }
          }
          const use_set_ = use_set ?? LifetimeUseSet.Many;
          // debug!(?use_ctxt, ?use_set);
          this.lifetime_uses.set(param, use_set_);
        } else {
          // debug!("Many uses of {:?} at {:?}", res, ident.span);
          this.lifetime_uses.set(param, LifetimeUseSet.Many);
        }
      }
      return;
    }

    const kind = rib.kind;
    let stop = false;
    switch (kind.$) {
      case "Item":
        stop = true;
        break;
      case "ConstParamTy": {
        const guar = this.emit_non_static_lt_in_const_param_ty_error(lifetime);
        this.record_lifetime_err(lifetime.id, guar);
        return;
      }
      case "ConcreteAnonConst": {
        const cause = kind._0;
        const guar = this.emit_forbidden_non_static_lifetime_error(cause, lifetime);
        this.record_lifetime_err(lifetime.id, guar);
        return;
      }
      case "AnonymousCreateParameter":
      case "Elided":
      case "Generics":
      case "ElisionFailure":
      case "AnonymousReportError":
      case "ImplTrait":
        break;
    }
    if (stop) break;
  }

  const normalized_ident = ident.normalize_to_macros_2_0();
  let outer_res: Ident | undefined;
  while (next > 0 && outer_res === undefined) {
    const rib = this.lifetime_ribs[--next]!;
    outer_res = (rib.bindings as KeyedMap<Ident, [NodeId, LifetimeRes]>).stored_key(normalized_ident);
  }

  const guar = this.emit_undeclared_lifetime_error(lifetime, outer_res);
  this.record_lifetime_err(lifetime.id, guar);
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_resolve/src/late.rs:1947 resolve_anonymous_lifetime
LateResolutionVisitor.prototype.resolve_anonymous_lifetime = function (
  this: LateResolutionVisitor,
  lifetime: Lifetime,
  id_for_lint: NodeId,
  elided: boolean,
): void {
  // debug_assert_eq!(lifetime.ident.name, kw::UnderscoreLifetime);

  const kind: MissingLifetimeKind = elided ? MissingLifetimeKind.Ampersand : MissingLifetimeKind.Underscore;
  const missing_lifetime: MissingLifetime = {
    id: lifetime.id,
    span: lifetime.ident.span,
    kind,
    count: 1,
    id_for_lint,
  };
  const elision_candidate: LifetimeElisionCandidate = { $: "Missing", _0: missing_lifetime };
  for (let i = this.lifetime_ribs.length - 1; i >= 0; i--) {
    const rib = this.lifetime_ribs[i]!;
    // debug!(?rib.kind);
    const rib_kind = rib.kind;
    let stop = false;
    switch (rib_kind.$) {
      case "AnonymousCreateParameter": {
        const binder = rib_kind.binder;
        const res = this.create_fresh_lifetime(lifetime.ident, binder, kind);
        this.record_lifetime_use(lifetime.id, res, elision_candidate);
        return;
      }
      case "AnonymousReportError": {
        let guar: ErrorGuaranteed;
        if (elided) {
          let suggestion: diagnostics.ElidedAnonymousLifetimeReportErrorSuggestion | undefined;
          if (this.diag_metadata.in_assoc_ty_binding) {
            // In an associated type binding like `I: IntoIterator<Item = &T>`,
            // introducing the lifetime on the trait ref would produce
            // `I: for<'a> IntoIterator<Item = &'a T>`. Prefer a named lifetime
            // from an enclosing item instead, so the assoc-ty-binding-specific path
            // below builds that suggestion.
            suggestion = undefined;
          } else {
            suggestion = undefined;
            for (let j = this.lifetime_ribs.length - 1; j >= i; j--) {
              const rib = this.lifetime_ribs[j]!;
              // Look for a `Generics` rib that represents a trait or where-bound
              // binder (`T: Trait<&U>` or `where T: Trait<&U>`), since that is
              // where the generic E0637 diagnostic can insert `for<'a>`.
              if (rib.kind.$ === "Generics" && (rib.kind.kind === "PolyTrait" || rib.kind.kind === "WhereBound")) {
                const span = rib.kind.span;
                suggestion = {
                  lo: Span.shrink_to_lo(span),
                  hi: Span.shrink_to_hi(lifetime.ident.span),
                };
                break;
              }
            }
          }
          // are we trying to use an anonymous lifetime
          // on a non GAT associated trait type?
          let module: Module | undefined;
          let ty: Ty | undefined;
          if (
            !this.in_func_body &&
            this.current_trait_ref !== undefined &&
            ((module = this.current_trait_ref[0]), true) &&
            (ty = this.diag_metadata.current_self_type) !== undefined &&
            true === this.diag_metadata.in_non_gat_assoc_type &&
            module.kind.$ === "Def" &&
            module.kind._0.$ === "Trait"
          ) {
            const trait_id = module.kind._1;
            if (def_id_matches_path(this.r.tcx_, trait_id, ["core", "iter", "traits", "iterator", "Iterator"])) {
              guar = this.r.dcx().emit_err(
                diagnostics.LendingIteratorReportError_diagnostic({
                  lifetime: lifetime.ident.span,
                  ty: ty.span,
                }),
              );
            } else {
              let decl: MultiSpan;
              const assoc = this.diag_metadata.current_impl_item;
              if (!trait_id.is_local() && assoc !== undefined && assoc.kind.$ === "Type") {
                // `let assocs = self.r.tcx.associated_items(trait_id) && let Some(ident) =
                // assoc.kind.ident() && let Some(assoc) = assocs.find_by_ident_and_kind(..)`
                decl = unported("rustc_middle::ty::AssocItems::find_by_ident_and_kind (tcx.associated_items of an extern trait, M3)");
              } else {
                decl = into_MultiSpan(DUMMY_SP);
              }
              const err = this.r.dcx().create_err(
                diagnostics.AnonymousLifetimeNonGatReportError_diagnostic({
                  lifetime: lifetime.ident.span,
                  decl,
                }),
              );
              this.point_at_impl_lifetimes(err, i, lifetime.ident.span);
              guar = err.emit_err();
            }
          } else if (this.diag_metadata.in_assoc_ty_binding) {
            // For associated type bindings, e.g.
            // `fn f<I: IntoIterator<Item = &T>>()`, introduce a named lifetime
            // on an enclosing generics binder instead:
            // `fn f<'a, I: IntoIterator<Item = &'a T>>()`.
            const err = this.r.dcx().create_err(
              diagnostics.ElidedAnonymousLifetimeReportError_diagnostic({
                span: lifetime.ident.span,
                suggestion,
              }),
            );
            this.suggest_introducing_lifetime_for_assoc_ty_binding(err, lifetime.ident.span);
            guar = err.emit_err();
          } else {
            guar = this.r.dcx().emit_err(
              diagnostics.ElidedAnonymousLifetimeReportError_diagnostic({
                span: lifetime.ident.span,
                suggestion,
              }),
            );
          }
        } else {
          guar = this.r.dcx().emit_err(
            diagnostics.ExplicitAnonymousLifetimeReportError_diagnostic({
              span: lifetime.ident.span,
            }),
          );
        }
        this.record_lifetime_err(lifetime.id, guar);
        return;
      }
      case "Elided": {
        const res = rib_kind.res;
        this.record_lifetime_use(lifetime.id, res, elision_candidate);
        return;
      }
      case "ElisionFailure":
        this.diag_metadata.current_elision_failures.push([missing_lifetime, { $: "Left", _0: lifetime.id }]);
        return;
      case "Item":
        stop = true;
        break;
      case "Generics":
      case "ConstParamTy":
      case "ImplTrait":
        break;
      case "ConcreteAnonConst":
        // There is always an `Elided(LifetimeRes::Infer)` inside an `AnonConst`.
        span_bug(lifetime.ident.span, `unexpected rib kind: ${gen.debug_LifetimeRibKind(rib.kind, PLAIN)}`);
    }
    if (stop) break;
  }
  const guar = this.report_missing_lifetime_specifiers([missing_lifetime], undefined);
  this.record_lifetime_err(lifetime.id, guar);
};

// rustc: compiler/rustc_resolve/src/late.rs:2113 point_at_impl_lifetimes
LateResolutionVisitor.prototype.point_at_impl_lifetimes = function (this: LateResolutionVisitor, err: Diag, i: number, lifetime: Span): void {
  let found: [LifetimeRib, Span] | undefined;
  for (let j = i - 1; j >= 0; j--) {
    const rib = this.lifetime_ribs[j]!;
    if (rib.kind.$ === "Generics" && rib.kind.kind === "ImplBlock") {
      found = [rib, rib.kind.span];
      break;
    }
  }
  if (found === undefined) {
    return;
  }
  const [rib, span] = found;
  if (rib.bindings.size !== 0) {
    err.span_label(
      span,
      `there ${rib.bindings.size === 1 ? "is a" : "are"} named lifetime${pluralize(rib.bindings.size)} specified on the impl block you could use`,
    );
    if (rib.bindings.size === 1) {
      err.span_suggestion_verbose(
        Span.shrink_to_hi(lifetime),
        "consider using the lifetime from the impl block",
        `${display_Ident(unwrap(rib.bindings.keys().next().value))} `,
        "MaybeIncorrect",
      );
    }
  } else {
    class AnonRefFinder extends visit.Visitor<ControlFlow<Span>> {
      override Result = VisitorResult.ControlFlow<Span>();

      // rustc: compiler/rustc_resolve/src/late.rs:2146 visit_ty
      override visit_ty(ty: Ty): ControlFlow<Span> {
        if (ty.kind.$ === "Ref" && ty.kind._0 === undefined) {
          const inner_ty = ty.kind._1;
          return ControlFlow.Break(Span.shrink_to_lo(inner_ty.span));
        }
        return walk_ty(this, ty);
      }

      // rustc: compiler/rustc_resolve/src/late.rs:2153 visit_lifetime
      override visit_lifetime(lt: Lifetime, _cx: LifetimeCtxt): ControlFlow<Span> {
        if (lt.ident.name === kw.UnderscoreLifetime) {
          return ControlFlow.Break(lt.ident.span);
        }
        return walk_lifetime(this, lt);
      }
    }

    const ty = this.diag_metadata.current_self_type;
    let cf: ControlFlow<Span> | undefined;
    const item = this.diag_metadata.current_item;
    if (ty !== undefined && (cf = new AnonRefFinder().visit_ty(ty)).$ === "Break") {
      const sp = cf._0;
      err.multipart_suggestion(
        "add a lifetime to the impl block and use it in the self type and associated type",
        [
          [span, "<'a>"],
          [sp, "'a "],
          [Span.shrink_to_hi(lifetime), "'a "],
        ],
        "MaybeIncorrect",
      );
    } else if (
      item !== undefined &&
      item.kind.$ === "Impl" &&
      item.kind._0.of_trait !== undefined &&
      (cf = new AnonRefFinder().visit_trait_ref(item.kind._0.of_trait.trait_ref)).$ === "Break"
    ) {
      const sp = cf._0;
      err.multipart_suggestion(
        "add a lifetime to the impl block and use it in the trait and associated type",
        [
          [span, "<'a>"],
          [sp, "'a"],
          [Span.shrink_to_hi(lifetime), "'a "],
        ],
        "MaybeIncorrect",
      );
    } else {
      err.span_label(span, "you could add a lifetime on the impl block, if the trait or the self type could have one");
    }
  }
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_resolve/src/late.rs:2203 resolve_elided_lifetime
LateResolutionVisitor.prototype.resolve_elided_lifetime = function (this: LateResolutionVisitor, anchor_id: NodeId, span: Span): void {
  const id = this.r.next_node_id();
  const lt: Lifetime = { id, ident: Ident.new(kw.UnderscoreLifetime, span) };

  this.record_lifetime_use(anchor_id, { $: "ElidedAnchor", start: id, end: NodeId.from_usize(NodeId.as_usize(id) + 1) }, LifetimeElisionCandidate_Ignore());
  this.resolve_anonymous_lifetime(lt, anchor_id, true);
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_resolve/src/late.rs:2216 create_fresh_lifetime
LateResolutionVisitor.prototype.create_fresh_lifetime = function (
  this: LateResolutionVisitor,
  ident: Ident,
  binder: NodeId,
  kind: MissingLifetimeKind,
): LifetimeRes {
  // debug_assert_eq!(ident.name, kw::UnderscoreLifetime);
  // debug!(?ident.span);

  // Leave the responsibility to create the `LocalDefId` to lowering.
  const param = this.r.next_node_id();
  const res: LifetimeRes = { $: "Fresh", param, kind };
  this.record_lifetime_def(param, res);

  // Record the created lifetime parameter so lowering can pick it up and add it to HIR.
  const map = this.r.current_owner.extra_lifetime_params_map;
  let entry = map.get(binder);
  if (entry === undefined) {
    entry = [];
    map.set(binder, entry);
  }
  entry.push([ident, param, kind]);
  return res;
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_resolve/src/late.rs:2241 resolve_elided_lifetimes_in_path
LateResolutionVisitor.prototype.resolve_elided_lifetimes_in_path = function (
  this: LateResolutionVisitor,
  partial_res: PartialRes,
  path: readonly Segment[],
  source: PathSource,
  path_span: Span,
): void {
  const proj_start = path.length - partial_res.unresolved_segments();
  for (let i = 0; i < path.length; i++) {
    const segment = path[i]!;
    if (segment.has_lifetime_args) {
      continue;
    }
    if (segment.id === undefined) {
      continue;
    }
    const segment_id = segment.id;

    // Figure out if this is a type/trait segment,
    // which may need lifetime elision performed.
    const base_res = partial_res.base_res();
    let type_def_id: DefId;
    if (base_res.$ === "Def" && base_res._0.$ === "AssocTy" && i + 2 === proj_start) {
      type_def_id = this.r.tcx_.parent(base_res._1);
    } else if (base_res.$ === "Def" && base_res._0.$ === "Variant" && i + 2 === proj_start && segment.has_generic_args) {
      type_def_id = this.r.tcx_.parent(base_res._1);
    } else if (
      base_res.$ === "Def" &&
      base_res._0.$ === "Variant" &&
      i + 1 === proj_start &&
      !(i >= 1 && path[i - 1]!.has_generic_args)
    ) {
      type_def_id = this.r.tcx_.parent(base_res._1);
    } else if (
      base_res.$ === "Def" &&
      (base_res._0.$ === "Struct" ||
        base_res._0.$ === "Union" ||
        base_res._0.$ === "Enum" ||
        base_res._0.$ === "TyAlias" ||
        base_res._0.$ === "Trait") &&
      i + 1 === proj_start
    ) {
      type_def_id = base_res._1;
    } else {
      continue;
    }

    const expected_lifetimes = this.r.item_generics_num_lifetimes(type_def_id);
    if (expected_lifetimes === 0) {
      continue;
    }

    const node_ids = this.r.next_node_ids(expected_lifetimes);
    this.record_lifetime_use(segment_id, { $: "ElidedAnchor", start: node_ids.start, end: node_ids.end }, LifetimeElisionCandidate_Ignore());

    let inferred: boolean;
    switch (source.$) {
      case "Trait":
      case "TraitItem":
      case "Type":
      case "TypeParam":
      case "PreciseCapturingArg":
      case "ReturnTypeNotation":
      case "Macro":
      case "Module":
        inferred = false;
        break;
      case "Expr":
      case "Pat":
      case "Struct":
      case "TupleStruct":
      case "DefineOpaques":
      case "Delegation":
      case "ExternItemImpl":
        inferred = true;
        break;
    }
    if (inferred) {
      // Do not create a parameter for patterns and expressions: type checking can infer
      // the appropriate lifetime for us.
      for (const id of node_id_range(node_ids)) {
        this.record_lifetime_use(id, LIFETIME_RES_INFER, LifetimeElisionCandidate_Ignore());
      }
      continue;
    }

    let elided_lifetime_span: Span;
    if (segment.has_generic_args) {
      // If there are brackets, but not generic arguments, then use the opening bracket
      elided_lifetime_span = Span.with_hi(segment.args_span, BytePos(Span.lo(segment.args_span) + 1));
    } else {
      // If there are no brackets, use the identifier span.
      // HACK: we use find_ancestor_inside to properly suggest elided spans in paths
      // originating from macros, since the segment's span might be from a macro arg.
      elided_lifetime_span = Span.find_ancestor_inside(segment.ident.span, path_span) ?? path_span;
    }
    const ident = Ident.new(kw.UnderscoreLifetime, elided_lifetime_span);

    const kind: MissingLifetimeKind = segment.has_generic_args ? MissingLifetimeKind.Comma : MissingLifetimeKind.Brackets;
    const missing_lifetime: MissingLifetime = {
      id: node_ids.start,
      id_for_lint: segment_id,
      span: elided_lifetime_span,
      kind,
      count: expected_lifetimes,
    };
    let should_lint = true;
    for (let j = this.lifetime_ribs.length - 1; j >= 0; j--) {
      const rib = this.lifetime_ribs[j]!;
      const rib_kind = rib.kind;
      // In create-parameter mode we error here because we don't want to support
      // deprecated impl elision in new features like impl elision and `async fn`,
      // both of which work using the `CreateParameter` mode:
      //
      //     impl Foo for std::cell::Ref<u32> // note lack of '_
      //     async fn foo(_: std::cell::Ref<u32>) { ... }
      if (
        (rib_kind.$ === "AnonymousCreateParameter" && rib_kind.report_in_path) ||
        (rib_kind.$ === "Elided" && rib_kind.error_in_path)
      ) {
        const sess = this.r.tcx_.sess;
        const subdiag = elided_lifetime_in_path_suggestion(
          sess.source_map(),
          expected_lifetimes,
          path_span,
          !segment.has_generic_args,
          elided_lifetime_span,
        );
        const guar = this.r.dcx().emit_err(
          diagnostics.ImplicitElidedLifetimeNotAllowedHere_diagnostic({
            span: path_span,
            subdiag,
          }),
        );
        should_lint = false;

        for (const id of node_id_range(node_ids)) {
          this.record_lifetime_err(id, guar);
        }
        break;
      } else if (rib_kind.$ === "AnonymousCreateParameter") {
        // Do not create a parameter for patterns and expressions.
        const binder = rib_kind.binder;
        // Group all suggestions into the first record.
        let candidate: LifetimeElisionCandidate = { $: "Missing", _0: missing_lifetime };
        for (const id of node_id_range(node_ids)) {
          const res = this.create_fresh_lifetime(ident, binder, kind);
          const c = candidate;
          candidate = LifetimeElisionCandidate_Ignore();
          this.record_lifetime_use(id, res, c);
        }
        break;
      } else if (rib_kind.$ === "Elided" && !rib_kind.error_in_path) {
        const res = rib_kind.res;
        let candidate: LifetimeElisionCandidate = { $: "Missing", _0: missing_lifetime };
        for (const id of node_id_range(node_ids)) {
          const c = candidate;
          candidate = LifetimeElisionCandidate_Ignore();
          this.record_lifetime_use(id, res, c);
        }
        break;
      } else if (rib_kind.$ === "ElisionFailure") {
        this.diag_metadata.current_elision_failures.push([missing_lifetime, { $: "Right", _0: node_ids }]);
        break;
      } else if (rib_kind.$ === "AnonymousReportError" || rib_kind.$ === "Item") {
        // `LifetimeRes::Error`, which would usually be used in the case of
        // `ReportError`, is unsuitable here, as we don't emit an error yet. Instead,
        // we simply resolve to an implicit lifetime, which will be checked later, at
        // which point a suitable error will be emitted.
        const guar = this.report_missing_lifetime_specifiers([missing_lifetime], undefined);
        for (const id of node_id_range(node_ids)) {
          this.record_lifetime_err(id, guar);
        }
        break;
      } else if (rib_kind.$ === "Generics" || rib_kind.$ === "ConstParamTy" || rib_kind.$ === "ImplTrait") {
        // nothing
      } else if (rib_kind.$ === "ConcreteAnonConst") {
        // There is always an `Elided(LifetimeRes::Infer)` inside an `AnonConst`.
        span_bug(elided_lifetime_span, `unexpected rib kind: ${gen.debug_LifetimeRibKind(rib.kind, PLAIN)}`);
      }
    }

    if (should_lint) {
      const include_angle_bracket = !segment.has_generic_args;
      this.r.lint_buffer_.dyn_buffer_lint_any(ELIDED_LIFETIMES_IN_PATHS, segment_id, elided_lifetime_span, (dcx, level, sess) => {
        if (!(sess instanceof Session)) return panic("expected a `Session`");
        const source_map = sess.source_map();
        return diagnostics.ElidedLifetimesInPaths_into_diag(
          {
            subdiag: elided_lifetime_in_path_suggestion(source_map, expected_lifetimes, path_span, include_angle_bracket, elided_lifetime_span),
          },
          dcx,
          level,
        );
      });
    }
  }
};

/// Register a use of an already defined lifetime.
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_resolve/src/late.rs:2465 record_lifetime_use
LateResolutionVisitor.prototype.record_lifetime_use = function (
  this: LateResolutionVisitor,
  id: NodeId,
  res: LifetimeRes,
  candidate: LifetimeElisionCandidate,
): void {
  this.record_lifetime_def(id, res);

  switch (res.$) {
    case "Param":
    case "Fresh":
    case "Static":
      if (this.lifetime_elision_candidates !== undefined) {
        const candidates = this.lifetime_elision_candidates;
        candidates.push([res, candidate]);
      }
      break;
    case "Infer":
    case "Error":
    case "ElidedAnchor":
      break;
  }
};

/// Can be used for both definitions and uses of lifetimes, as an error
/// has already been reported.
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_resolve/src/late.rs:2486 record_lifetime_err
LateResolutionVisitor.prototype.record_lifetime_err = function (this: LateResolutionVisitor, id: NodeId, guar: ErrorGuaranteed): void {
  this.record_lifetime_def(id, { $: "Error", _0: guar });
};

/// Define a new lifetime (e.g. in generics)
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_resolve/src/late.rs:2492 record_lifetime_def
LateResolutionVisitor.prototype.record_lifetime_def = function (this: LateResolutionVisitor, id: NodeId, res: LifetimeRes): void {
  const map = this.r.current_owner.lifetimes_res_map;
  const prev_res = map.get(id);
  map.set(id, res);
  if (prev_res !== undefined) {
    panic(
      `lifetime parameter ${debug_NodeId(id, PLAIN)} resolved multiple times (${debug_LifetimeRes(prev_res, PLAIN)} before, ${debug_LifetimeRes(res, PLAIN)} now)`,
    );
  }
};

/// Perform resolution of a function signature, accounting for lifetime elision.
// #[instrument(level = "debug", skip(self, inputs))]
// rustc: compiler/rustc_resolve/src/late.rs:2502 resolve_fn_signature
LateResolutionVisitor.prototype.resolve_fn_signature = function (
  this: LateResolutionVisitor,
  fn_id: NodeId,
  has_self: boolean,
  inputs: Iterable<[Pat | undefined, Ty]>,
  output_ty: FnRetTy,
  report_elided_lifetimes_in_path: boolean,
): void {
  const rib: LifetimeRibKind = {
    $: "AnonymousCreateParameter",
    binder: fn_id,
    report_in_path: report_elided_lifetimes_in_path,
  };
  this.with_lifetime_rib(rib, (this_) => {
    // Add each argument to the rib.
    const elision_lifetime = this_.resolve_fn_params(has_self, inputs);
    // debug!(?elision_lifetime);

    const outer_failures = this_.diag_metadata.current_elision_failures;
    this_.diag_metadata.current_elision_failures = [];
    let output_rib: LifetimeRibKind;
    if (elision_lifetime.$ === "Ok") {
      const res = elision_lifetime._0;
      if (fn_id === this_.r.current_owner.id) {
        this_.r.current_owner.lifetime_elision_allowed = true;
      }
      output_rib = LifetimeRibKind.elided(res);
    } else {
      output_rib = LifetimeRibKind.ElisionFailure;
    }
    this_.with_lifetime_rib(output_rib, (this_) => walk_fn_ret_ty(this_, output_ty));
    const elision_failures = this_.diag_metadata.current_elision_failures;
    this_.diag_metadata.current_elision_failures = outer_failures;
    if (elision_failures.length !== 0) {
      if (elision_lifetime.$ !== "Err") return bug();
      const failure_info = elision_lifetime._0;
      const guar = this_.report_missing_lifetime_specifiers(
        elision_failures.map(([missing_lifetime]) => missing_lifetime),
        failure_info,
      );
      const record_res = (lifetime: NodeId): void => this_.record_lifetime_err(lifetime, guar);
      for (const [_, nodes] of elision_failures) {
        switch (nodes.$) {
          case "Left":
            record_res(nodes._0);
            break;
          case "Right":
            for (const lifetime of node_id_range(nodes._0)) {
              record_res(lifetime);
            }
            break;
        }
      }
    }
  });
};

/// Resolve inside function parameters and parameter types.
/// Returns the lifetime for elision in fn return type,
/// or diagnostic information in case of elision failure.
// rustc: compiler/rustc_resolve/src/late.rs:2555 resolve_fn_params
LateResolutionVisitor.prototype.resolve_fn_params = function (
  this: LateResolutionVisitor,
  has_self: boolean,
  inputs_: Iterable<[Pat | undefined, Ty]>,
): Result<LifetimeRes, [MissingLifetime[], ElisionFnParameter[]]> {
  type Elision =
    /// We have not found any candidate.
    | { readonly $: "None" }
    /// We have a candidate bound to `self`.
    | { readonly $: "Self_"; readonly _0: LifetimeRes }
    /// We have a candidate bound to a parameter.
    | { readonly $: "Param"; readonly _0: LifetimeRes }
    /// We failed elision.
    | { readonly $: "Err" };
  // PORT: `inputs: impl Iterator + Clone` is iterated twice (`inputs.clone()`, then `inputs`).
  const inputs = [...inputs_];

  // Save elision state to reinstate it later.
  const outer_candidates = this.lifetime_elision_candidates;
  this.lifetime_elision_candidates = undefined;

  // Result of elision.
  let elision_lifetime: Elision = { $: "None" };
  // Information for diagnostics.
  const parameter_info: ElisionFnParameter[] = [];
  const all_candidates: MissingLifetime[] = [];

  // Resolve and apply bindings first so diagnostics can see if they're used in types.
  // PORT(decls): `PatternBindings` is `SmallVec<[(PatBoundCtx, FxIndexMap<Ident, Res>); 1]>`, a list of
  // pairs; late.gen.ts maps `SmallVec<[T; 1]>` to `T[][]` (codegen typemap: `$0[]` of the array type), so
  // the pair list is cast to the generated type until root fixes the typemap.
  const bindings = [["Product", new KeyedMap<Ident, Res>(Ident_key)]] as [gen.PatBoundCtx, Map<Ident, Res>][] as unknown as PatternBindings;
  for (const [pat, _] of inputs) {
    // debug!("resolving bindings in pat = {pat:?}");
    this.with_lifetime_rib(LifetimeRibKind.elided(LIFETIME_RES_INFER), (this_) => {
      if (pat !== undefined) {
        this_.resolve_pattern(pat, "FnParam", bindings);
      }
    });
  }
  this.apply_pattern_bindings(bindings);

  for (let index = 0; index < inputs.length; index++) {
    const [pat, ty] = inputs[index]!;
    // debug!("resolving type for pat = {pat:?}, ty = {ty:?}");
    // Record elision candidates only for this parameter.
    // debug_assert_matches!(self.lifetime_elision_candidates, None);
    this.lifetime_elision_candidates = [];
    this.visit_ty(ty);
    const local_candidates = this.lifetime_elision_candidates;
    this.lifetime_elision_candidates = undefined;

    if (local_candidates !== undefined) {
      const candidates = local_candidates;
      const distinct = new KeyedSet<LifetimeRes>(
        LifetimeRes_key,
        candidates.map(([res, _]) => res),
      );
      const lifetime_count = distinct.size;
      if (lifetime_count !== 0) {
        parameter_info.push({
          index,
          ident: pat !== undefined && pat.kind.$ === "Ident" ? pat.kind._1 : undefined,
          lifetime_count,
          span: ty.span,
        });
        for (const [_, candidate] of candidates) {
          switch (candidate.$) {
            case "Ignore":
              break;
            case "Missing":
              all_candidates.push(candidate._0);
              break;
          }
        }
      }
      if (distinct.size !== 0) {
        switch (elision_lifetime.$) {
          // We are the first parameter to bind lifetimes.
          case "None": {
            // PORT: `UnordSet::get_only`: the only element when `len() == 1`.
            const res = distinct.size === 1 ? unwrap(distinct.values().next().value) : undefined;
            if (res !== undefined) {
              // We have a single lifetime => success.
              elision_lifetime = { $: "Param", _0: res };
            } else {
              // We have multiple lifetimes => error.
              elision_lifetime = { $: "Err" };
            }
            break;
          }
          // We have 2 parameters that bind lifetimes => error.
          case "Param":
            elision_lifetime = { $: "Err" };
            break;
          // `self` elision takes precedence over everything else.
          case "Self_":
          case "Err":
            break;
        }
      }
    }

    // Handle `self` specially.
    if (index === 0 && has_self) {
      const self_lifetime = this.find_lifetime_for_self(ty);
      switch (self_lifetime.$) {
        // We found `self` elision.
        case "One":
          elision_lifetime = { $: "Self_", _0: self_lifetime._0 };
          break;
        // `self` itself had ambiguous lifetimes, e.g.
        // &Box<&Self>. In this case we won't consider
        // taking an alternative parameter lifetime; just avoid elision
        // entirely.
        case "Many":
          elision_lifetime = { $: "Err" };
          break;
        // We do not have `self` elision: disregard the `Elision::Param` that we may
        // have found.
        case "Empty":
          elision_lifetime = { $: "None" };
          break;
      }
    }
    // debug!("(resolving function / closure) recorded parameter");
  }

  // Reinstate elision state.
  // debug_assert_matches!(self.lifetime_elision_candidates, None);
  this.lifetime_elision_candidates = outer_candidates;

  if (elision_lifetime.$ === "Param" || elision_lifetime.$ === "Self_") {
    const res = elision_lifetime._0;
    return Ok(res);
  }

  // We do not have a candidate.
  return Err<[MissingLifetime[], ElisionFnParameter[]]>([all_candidates, parameter_info]);
};

/// List all the lifetimes that appear in the provided type.
// rustc: compiler/rustc_resolve/src/late.rs:2675 find_lifetime_for_self
LateResolutionVisitor.prototype.find_lifetime_for_self = function (this: LateResolutionVisitor, ty: Ty): Set1<LifetimeRes> {
  /// Visits a type to find all the &references, and determines the
  /// set of lifetimes for all of those references where the referent
  /// contains Self.
  class FindReferenceVisitor extends visit.Visitor {
    constructor(
      public r: Resolver,
      public impl_self: Res | undefined,
      public lifetime: Set1<LifetimeRes>,
    ) {
      super();
    }

    // rustc: compiler/rustc_resolve/src/late.rs:2686 visit_ty
    override visit_ty(ty: Ty): undefined {
      // trace!("FindReferenceVisitor considering ty={:?}", ty);
      if (ty.kind.$ === "Ref" || ty.kind.$ === "PinnedRef") {
        const lt = ty.kind._0;
        // See if anything inside the &thing contains Self
        const visitor = new SelfVisitor(this.r, this.impl_self, false);
        visitor.visit_ty(ty);
        // trace!("FindReferenceVisitor: SelfVisitor self_found={:?}", visitor.self_found);
        if (visitor.self_found) {
          let lt_id: NodeId;
          if (lt !== undefined) {
            lt_id = lt.id;
          } else {
            const res = index_map(this.r.current_owner.lifetimes_res_map, ty.id);
            if (res.$ !== "ElidedAnchor") return bug();
            lt_id = res.start;
          }
          const lt_res = index_map(this.r.current_owner.lifetimes_res_map, lt_id);
          // trace!("FindReferenceVisitor inserting res={:?}", lt_res);
          this.lifetime = Set1_insert(this.lifetime, lt_res, LifetimeRes_eq);
        }
      }
      return walk_ty(this, ty);
    }

    // A type may have an expression as a const generic argument.
    // We do not want to recurse into those.
    // rustc: compiler/rustc_resolve/src/late.rs:2712 visit_expr
    override visit_expr(_: Expr): undefined {}
  }

  /// Visitor which checks the referent of a &Thing to see if the
  /// Thing contains Self
  class SelfVisitor extends visit.Visitor {
    constructor(
      public r: Resolver,
      public impl_self: Res | undefined,
      public self_found: boolean,
    ) {
      super();
    }

    // Look for `self: &'a Self` - also desugared from `&'a self`
    // rustc: compiler/rustc_resolve/src/late.rs:2725 is_self_ty
    is_self_ty(ty: Ty): boolean {
      switch (ty.kind.$) {
        case "ImplicitSelf":
          return true;
        case "Path": {
          if (ty.kind._0 !== undefined) return false;
          const path_res = index_map(this.r.partial_res_map, ty.id).full_res();
          if (path_res !== undefined && (path_res.$ === "SelfTyParam" || path_res.$ === "SelfTyAlias")) {
            return true;
          }
          return this.impl_self !== undefined && path_res !== undefined && Res_eq(path_res, this.impl_self);
        }
        default:
          return false;
      }
    }

    // rustc: compiler/rustc_resolve/src/late.rs:2741 visit_ty
    override visit_ty(ty: Ty): undefined {
      // trace!("SelfVisitor considering ty={:?}", ty);
      if (this.is_self_ty(ty)) {
        // trace!("SelfVisitor found Self");
        this.self_found = true;
      }
      return walk_ty(this, ty);
    }

    // A type may have an expression as a const generic argument.
    // We do not want to recurse into those.
    // rustc: compiler/rustc_resolve/src/late.rs:2752 visit_expr
    override visit_expr(_: Expr): undefined {}
  }

  let impl_self: Res | undefined;
  const self_ty = this.diag_metadata.current_self_type;
  const partial_res = self_ty !== undefined && self_ty.kind.$ === "Path" && self_ty.kind._0 === undefined ? this.r.partial_res_map.get(self_ty.id) : undefined;
  const full_res = partial_res === undefined ? undefined : partial_res.full_res();
  // Permit the types that unambiguously always
  // result in the same type constructor being used
  // (it can't differ between `Self` and `self`).
  if (
    full_res !== undefined &&
    ((full_res.$ === "Def" && (full_res._0.$ === "Struct" || full_res._0.$ === "Union" || full_res._0.$ === "Enum")) || full_res.$ === "PrimTy")
  ) {
    impl_self = full_res;
  }
  const visitor = new FindReferenceVisitor(this.r, impl_self, { $: "Empty" });
  visitor.visit_ty(ty);
  // trace!("FindReferenceVisitor found={:?}", visitor.lifetime);
  return visitor.lifetime;
};

/// Searches the current set of local scopes for labels. Returns the `NodeId` of the resolved
/// label and reports an error if the label is not found or is unreachable.
// rustc: compiler/rustc_resolve/src/late.rs:2783 resolve_label
LateResolutionVisitor.prototype.resolve_label = function (this: LateResolutionVisitor, label_: Ident): Result<[NodeId, Span], ResolutionError> {
  // PORT: `mut label: Ident` is a by-value copy, edited in place below.
  const label = Ident.new(label_.name, label_.span);
  let suggestion: LabelSuggestion | undefined = undefined;

  for (let i = this.label_ribs.length - 1; i >= 0; i--) {
    const rib = this.label_ribs[i]!;

    if (
      rib.kind.$ === "MacroDefinition" &&
      // If an invocation of this macro created `ident`, give up on `ident`
      // and switch to `ident`'s source from the macro definition.
      DefId_eq(rib.kind._0, this.r.macro_def(Span.ctxt(label.span)))
    ) {
      Span.remove_mark(field_mut(label, "span"));
    }

    const ident = label.normalize_to_macro_rules();
    const bindings = rib.bindings as KeyedMap<Ident, NodeId>;
    const stored = bindings.stored_key(ident);
    if (stored !== undefined) {
      const id = bindings.get(stored)!;
      const definition_span = stored.span;
      return this.is_label_valid_from_rib(i)
        ? Ok([id, definition_span])
        : Err({
            $: "UnreachableLabel",
            name: label.name,
            definition_span,
            suggestion,
          });
    }

    // Diagnostics: Check if this rib contains a label with a similar name, keep track of
    // the first such label that is encountered.
    if (suggestion === undefined) {
      suggestion = this.suggestion_for_label_in_rib(i, label);
    }
  }

  return Err({ $: "UndeclaredLabel", name: label.name, suggestion });
};

/// Determine whether or not a label from the `rib_index`th label rib is reachable.
// rustc: compiler/rustc_resolve/src/late.rs:2820 is_label_valid_from_rib
LateResolutionVisitor.prototype.is_label_valid_from_rib = function (this: LateResolutionVisitor, rib_index: number): boolean {
  const ribs = this.label_ribs.slice(rib_index + 1);
  return ribs.every((rib) => !RibKind.is_label_barrier(rib.kind));
};

// rustc: compiler/rustc_resolve/src/late.rs:2825 resolve_adt
LateResolutionVisitor.prototype.resolve_adt = function (this: LateResolutionVisitor, item: Item, generics: Generics): void {
  // debug!("resolve_adt");
  const kind = this.r.tcx_.def_kind(this.r.current_owner.def_id);
  this.with_current_self_item(item, (this_) => {
    this_.with_generic_param_rib(
      generics.params,
      { $: "Item", _0: { $: "Yes", _0: generics.span }, _1: kind },
      item.id,
      "Item",
      generics.span,
      (this_) => {
        const item_def_id = LocalDefId.to_def_id(this_.r.current_owner.def_id);
        this_.with_self_rib({ $: "SelfTyAlias", alias_to: item_def_id, is_trait_impl: false }, (this_) => {
          walk_item(this_, item, WalkItemKind.ItemKind);
        });
      },
    );
  });
};

// rustc: compiler/rustc_resolve/src/late.rs:2848 future_proof_import
LateResolutionVisitor.prototype.future_proof_import = function (this: LateResolutionVisitor, use_tree: UseTree): void {
  const segments = use_tree.prefix.segments;
  if (segments.length >= 1) {
    const segment = segments[0]!;
    const rest = segments.slice(1);
    const ident = segment.ident;
    if (ident.is_path_segment_keyword() || Span.is_rust_2015(ident.span)) {
      return;
    }

    const nss: readonly Namespace[] = use_tree.kind.$ === "Simple" && rest.length === 0 ? ["TypeNS", "ValueNS"] : ["TypeNS"];
    const report_error = (this_: LateResolutionVisitor, ns: Namespace): void => {
      if (this_.should_report_errs()) {
        const what = ns === "TypeNS" ? "type parameters" : "local variables";
        this_.r.dcx().emit_err(
          diagnostics.ImportsCannotReferTo_diagnostic({
            span: ident.span,
            what,
          }),
        );
      }
    };

    for (const ns of nss) {
      const d = this.maybe_resolve_ident_in_lexical_scope(ident, ns);
      if (d === undefined) {
        // None => {}
      } else if (d.$ === "RibDef") {
        report_error(this, ns);
      } else {
        const binding = d._0;
        const d2 = this.resolve_ident_in_lexical_scope(ident, ns, undefined, binding);
        if (d2 !== undefined && d2.$ === "RibDef") {
          report_error(this, ns);
        }
      }
    }
  } else if (use_tree.kind.$ === "Nested") {
    const items = use_tree.kind.items;
    for (const use_tree of items) {
      this.future_proof_import(use_tree.inner);
    }
  }
};

// ---- end res-late-a ----
unported_methods(LateResolutionVisitor.prototype, "rustc_resolve::late::LateResolutionVisitor", ["as_ref", "as_mut", "visit_attribute", "visit_item", "visit_arm", "visit_block", "visit_anon_const", "visit_expr", "visit_pat", "visit_local", "visit_ty", "visit_ty_pat", "visit_poly_trait_ref", "visit_foreign_item", "visit_fn", "visit_lifetime", "visit_precise_capturing_arg", "visit_generics", "visit_closure_binder", "visit_generic_arg", "visit_assoc_item_constraint", "visit_path_segment", "visit_where_predicate", "visit_inline_asm", "visit_inline_asm_sym", "visit_variant", "visit_field_def", "visit_test_binder_forall", "visit_test_binder_exists", "visit_test_binder_bound_type_constraint", "maybe_resolve_ident_in_lexical_scope", "resolve_ident_in_lexical_scope", "resolve_path", "with_rib", "visit_generic_params", "with_lifetime_rib", "resolve_lifetime", "resolve_anonymous_lifetime", "point_at_impl_lifetimes", "resolve_elided_lifetime", "create_fresh_lifetime", "resolve_elided_lifetimes_in_path", "record_lifetime_use", "record_lifetime_err", "record_lifetime_def", "resolve_fn_signature", "resolve_fn_params", "find_lifetime_for_self", "resolve_label", "is_label_valid_from_rib", "resolve_adt", "future_proof_import", "resolve_item", "with_generic_param_rib", "with_label_rib", "with_static_rib", "with_constant_rib", "with_current_self_type", "with_current_self_item", "resolve_trait_items", "resolve_trait_item", "with_optional_trait_ref", "with_self_rib_ns", "with_self_rib", "resolve_implementation", "resolve_test_binder_constraints", "resolve_impl_item", "fill_delegation_inherent_fn_map", "check_trait_item", "resolve_static_body", "resolve_const_item_rhs", "resolve_delegation", "resolve_params", "resolve_local", "compute_and_check_binding_map", "is_base_res_local", "compute_and_check_or_pat_binding_map", "check_consistent_bindings", "resolve_arm", "resolve_pattern_top", "apply_pattern_bindings", "resolve_pattern", "resolve_pattern_inner", "record_patterns_with_skipped_bindings", "fresh_binding", "innermost_rib_bindings", "try_resolve_as_non_binding", "resolve_restriction_path", "smart_resolve_path", "smart_resolve_path_fragment", "self_type_is_available", "self_value_is_available", "report_error", "should_report_errs", "resolve_qpath_anywhere", "resolve_qpath", "with_resolved_label", "resolve_labeled_block", "resolve_block", "resolve_anon_const", "resolve_anon_const_manual", "resolve_expr_field", "resolve_expr", "record_candidate_traits_for_expr_if_necessary", "record_traits_in_scope", "resolve_and_cache_rustdoc_path", "is_invalid_proc_macro_item_for_doc", "resolve_doc_links", "lint_unused_qualifications", "resolve_define_opaques", "resolve_eii"]);
unported_methods(ItemInfoCollector.prototype, "rustc_resolve::late::ItemInfoCollector", ["collect_fn_info", "visit_item", "visit_assoc_item"]);
unported_methods(Resolver.prototype, "rustc_resolve::late::Resolver", ["late_resolve_crate"]);
