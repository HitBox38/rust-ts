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
import { AssocItems, type AssocItem as ty_AssocItem } from "../rustc_middle/ty/assoc.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { unported } from "../std/panic.ts";
import { Resolver } from "./decls.ts";
import { LateResolutionVisitor } from "./decls.ts";
// res-late-b imports
import { type AssocItem, AssocItemKind, attr as ast_attr, BindingMode, BindingMode_eq, clone_BindingMode, clone_Pat, clone_TraitRef, clone_Ty, ConstBlockItem, CRATE_NODE_ID, type Crate, type Delegation, type EiiImpl, type ExprField, type FnDecl, type Label, type Param, type PatFieldsRest, type Path, type QSelf, type RestrictionKind, type TestBinderConstraints, type TraitImplHeader, type TraitRef } from "../rustc_ast/lib.ts";
import { AssocCtxt, walk_assoc_item, walk_crate, walk_expr, walk_trait_ref } from "../rustc_ast/visit.ts";
import { type Applicability, E0323, E0324, E0325, StashKey } from "../rustc_errors/lib.ts";
import { debug_Res, DefKind, type PrimTy, Res as hir_Res } from "../rustc_hir/def.ts";
import { UNUSED_LABELS } from "../rustc_lint_defs/builtin.gen.ts";
import { type DelegationInfo, type DelegationInherentFnKind, type DelegationResolution, DocLinkResMap_key } from "../rustc_middle/middle/resolve.ts";
import { Visibility as ty_Visibility } from "../rustc_middle/ty/mod.ts";
import { feature_err } from "../rustc_session/diagnostics.ts";
import { CRATE_DEF_ID, CrateNum, LOCAL_CRATE, type LocalModId, type ModId } from "../rustc_span/def_id.ts";
import { respan, type Spanned } from "../rustc_span/lib.ts";
import { sym, Symbol } from "../rustc_span/symbol.ts";
import { CrateType } from "../rustc_structures/crate_type.ts";
import { assert_eq } from "../std/panic.ts";
import { utf8 } from "../std/str.ts";
import { type BindingInfo, type ConstantRequiresType, debug_RibKind, HasGenericParams, type IsNeverPattern, type IsRepeatExpr, type RecordPartialRes } from "./late.gen.ts";
import { type BindingError, BindingKey, clone_ParentScope, IdentKey, path_names_to_string, type UseError } from "./lib.ts";
import * as rustdoc from "./rustdoc.ts";
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
  Segment,
  type Set1,
  with_owner,
} from "./lib.ts";

export * from "./late.gen.ts";
// `LateResolutionVisitor::new` (late.rs:1581) is declared on the decls.ts class (`declare static new`) and
// assigned below.
export { LateResolutionVisitor };

// rustc-type: compiler/rustc_resolve/src/late.rs:5729 ItemInfoCollector
// PORT: `impl Visitor` -> extends the rustc_ast `Visitor` base class (hand type, types.sets.json).
export class ItemInfoCollector extends visit.Visitor {
  constructor(public r: Resolver) {
    super();
  }
}

// rustc: compiler/rustc_resolve/src/late.rs:5741 required_generic_args_suggestion
export function required_generic_args_suggestion(generics: Generics): string | undefined {
  const required = generics.params.flatMap((param): string[] => {
    const kind = param.kind;
    switch (kind.$) {
      case "Lifetime":
        return ["'_"];
      case "Type": {
        if (kind.default === undefined) {
          return ["_"];
        } else {
          return [];
        }
      }
      case "Const": {
        if (kind.default === undefined) {
          return ["_"];
        } else {
          return [];
        }
      }
    }
  });

  if (required.length === 0) {
    return undefined;
  } else {
    return `<${required.join(", ")}>`;
  }
}
/// Check if definition matches a path
// rustc: compiler/rustc_resolve/src/late.rs:5864 def_id_matches_path
export function def_id_matches_path(tcx: TyCtxt, def_id: DefId, expected_path: readonly string[]): boolean {
  // PORT: `let mut path = expected_path.iter().rev();` -> an index counting down.
  let path = expected_path.length;
  for (;;) {
    // `while let (Some(parent), Some(next_step)) = (tcx.opt_parent(def_id), path.next())`
    const parent = tcx.opt_parent(def_id);
    const next_step = path > 0 ? expected_path[--path] : undefined;
    if (parent === undefined || next_step === undefined) break;
    const n = tcx.opt_item_name(def_id);
    if (!(n !== undefined && Symbol.as_str(n) === next_step)) {
      return false;
    }
    def_id = parent;
  }
  return true;
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
              let assocs: AssocItems | undefined;
              let ident: Ident | undefined;
              let ty_assoc: ty_AssocItem | undefined;
              if (
                !trait_id.is_local() &&
                assoc !== undefined &&
                assoc.kind.$ === "Type" &&
                // PORT: the `associated_items` query value is `unknown` in queries.gen.ts (`&AssocItems`).
                ((assocs = this.r.tcx_.associated_items(trait_id) as AssocItems), true) &&
                (ident = AssocItemKind.ident(assoc.kind)) !== undefined &&
                (ty_assoc = AssocItems.find_by_ident_and_kind(assocs, this.r.tcx_, ident, "Type", trait_id)) !== undefined
              ) {
                decl = into_MultiSpan(this.r.tcx_.def_span(ty_assoc.def_id));
                decl.push_span_label(this.r.tcx_.def_span(trait_id), "");
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
  const bindings: PatternBindings = [["Product", new KeyedMap<Ident, Res>(Ident_key)]];
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

// ---- lane res-late-b: late.rs:2891..end ---------------------------------------------------------
// `impl LateResolutionVisitor` from `resolve_item` onwards, `ItemInfoCollector`, and
// `impl Resolver { late_resolve_crate }`.

// `PatternBindings` maps are `KeyedMap(Ident_key)` (res-lib contract rule 4).

/** PORT: `*dst = src` for an `FxIndexMap` reached through `&mut` (`innermost_rib_bindings`): the rib keeps
 * its map object, whose contents become `src`'s (same order, same stored keys). */
function assign_map<K, V>(dst: Map<K, V>, src: Map<K, V>): void {
  const entries = [...src];
  dst.clear();
  for (const [k, v] of entries) dst.set(k, v);
}

/** `FxIndexMap::extend` (`insert` per entry: an existing key keeps its position and gets the new value). */
function extend_map<K, V>(dst: Map<K, V>, src: Iterable<readonly [K, V]>): void {
  for (const [k, v] of src) dst.set(k, v);
}

/** `Vec::retain` (in place). */
function retain<T>(v: T[], f: (x: T) => boolean): void {
  let j = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i]!;
    if (f(x)) v[j++] = x;
  }
  v.length = j;
}

/**
 * PORT: `hir::PrimTy::from_name` (rustc_hir/src/hir.rs:3381; hir.rs is M3). A faithful copy without a
 * marker (it belongs to hir.rs), like lib.ts's `PrimTy_ALL` / `PrimTy_name`; replace with rustc_hir's
 * when it is ported.
 */
function PrimTy_from_name(name: Symbol): PrimTy | undefined {
  let ty: PrimTy;
  switch (name) {
    // any changes here should also be reflected in `PrimTy::ALL`
    case sym.i8:
      ty = { $: "Int", _0: "I8" };
      break;
    case sym.i16:
      ty = { $: "Int", _0: "I16" };
      break;
    case sym.i32:
      ty = { $: "Int", _0: "I32" };
      break;
    case sym.i64:
      ty = { $: "Int", _0: "I64" };
      break;
    case sym.i128:
      ty = { $: "Int", _0: "I128" };
      break;
    case sym.isize:
      ty = { $: "Int", _0: "Isize" };
      break;
    case sym.u8:
      ty = { $: "Uint", _0: "U8" };
      break;
    case sym.u16:
      ty = { $: "Uint", _0: "U16" };
      break;
    case sym.u32:
      ty = { $: "Uint", _0: "U32" };
      break;
    case sym.u64:
      ty = { $: "Uint", _0: "U64" };
      break;
    case sym.u128:
      ty = { $: "Uint", _0: "U128" };
      break;
    case sym.usize:
      ty = { $: "Uint", _0: "Usize" };
      break;
    case sym.f16:
      ty = { $: "Float", _0: "F16" };
      break;
    case sym.f32:
      ty = { $: "Float", _0: "F32" };
      break;
    case sym.f64:
      ty = { $: "Float", _0: "F64" };
      break;
    case sym.f128:
      ty = { $: "Float", _0: "F128" };
      break;
    case sym.bool:
      ty = { $: "Bool" };
      break;
    case sym.char:
      ty = { $: "Char" };
      break;
    case sym.str:
      ty = { $: "Str" };
      break;
    default:
      return undefined;
  }
  return ty;
}

const RES_ERR: Res = { $: "Err" };


// rustc: compiler/rustc_resolve/src/late.rs:2891 resolve_item
LateResolutionVisitor.prototype.resolve_item = function (this: LateResolutionVisitor, item: Item): void {
  let mod_inner_attrs_start: number | undefined = undefined;
  switch (item.kind.$) {
    case "Mod": {
      // We only handle outer doc comments for modules here.
      const pos = item.attrs.findIndex((a) => {
        const style = ast_attr.AttributeExt.Attribute.doc_resolution_scope(a);
        return style !== undefined && style === "Inner";
      });
      let attrs: readonly Attribute[];
      if (pos !== -1) {
        mod_inner_attrs_start = pos;
        attrs = item.attrs.slice(0, pos);
      } else {
        attrs = item.attrs;
      }
      this.resolve_doc_links(attrs, { $: "Ok", _0: item.id });
      break;
    }
    case "Impl":
    case "Use":
      break;
    default: {
      this.resolve_doc_links(item.attrs, { $: "Ok", _0: item.id });
    }
  }

  // debug!("(resolving item) resolving {:?} ({:?})", item.kind.ident(), item.kind);

  const def_kind = this.r.tcx_.def_kind(this.r.current_owner.def_id);
  const kind = item.kind;
  switch (kind.$) {
    case "TyAlias": {
      const { generics } = kind._0;
      this.with_generic_param_rib(
        generics.params,
        { $: "Item", _0: { $: "Yes", _0: generics.span }, _1: def_kind },
        item.id,
        "Item",
        generics.span,
        (this_) => {
          walk_item(this_, item, WalkItemKind.ItemKind);
        },
      );
      break;
    }

    case "Fn": {
      const { generics, define_opaque } = kind._0;
      this.with_generic_param_rib(
        generics.params,
        { $: "Item", _0: { $: "Yes", _0: generics.span }, _1: def_kind },
        item.id,
        "Function",
        generics.span,
        (this_) => {
          walk_item(this_, item, WalkItemKind.ItemKind);
        },
      );
      this.resolve_define_opaques(define_opaque);
      break;
    }

    case "Enum":
    case "Struct":
    case "Union": {
      const generics = kind._1;
      this.resolve_adt(item, generics);
      break;
    }

    case "Impl": {
      const { generics, of_trait, self_ty, items: impl_items } = kind._0;
      this.diag_metadata.current_impl_items = impl_items;
      this.resolve_implementation(item.attrs, generics, of_trait, self_ty, item.id, impl_items);
      this.diag_metadata.current_impl_items = undefined;
      break;
    }

    case "Trait": {
      const { generics, bounds, items, impl_restriction } = kind._0;
      // resolve paths for `impl` restrictions
      this.resolve_restriction_path(impl_restriction.kind);

      // Create a new rib for the trait-wide type parameters.
      this.with_generic_param_rib(
        generics.params,
        { $: "Item", _0: { $: "Yes", _0: generics.span }, _1: def_kind },
        item.id,
        "Item",
        generics.span,
        (this_) => {
          const local_def_id = LocalDefId.to_def_id(this_.r.current_owner.def_id);
          this_.with_self_rib({ $: "SelfTyParam", trait_: local_def_id }, (this_) => {
            this_.visit_generics(generics);
            for (const bound of bounds) this_.visit_param_bound(bound, "SuperTraits");
            this_.resolve_trait_items(items);
          });
        },
      );
      break;
    }

    case "TraitAlias": {
      const { generics, bounds } = kind._0;
      // Create a new rib for the trait-wide type parameters.
      this.with_generic_param_rib(
        generics.params,
        { $: "Item", _0: { $: "Yes", _0: generics.span }, _1: def_kind },
        item.id,
        "Item",
        generics.span,
        (this_) => {
          const local_def_id = LocalDefId.to_def_id(this_.r.current_owner.def_id);
          this_.with_self_rib({ $: "SelfTyParam", trait_: local_def_id }, (this_) => {
            this_.visit_generics(generics);
            for (const bound of bounds) this_.visit_param_bound(bound, "Bound");
          });
        },
      );
      break;
    }

    case "Mod": {
      const module = this.r.expect_module(LocalDefId.to_def_id(this.r.current_owner.def_id));
      const orig_module = this.parent_scope.module;
      this.parent_scope.module = module;
      this.with_rib("ValueNS", { $: "Module", _0: module.expect_local() }, (this_) => {
        this_.with_rib("TypeNS", { $: "Module", _0: module.expect_local() }, (this_) => {
          // Outer doc comments were already handled above, now we handle
          // inner doc comments.
          let attrs: readonly Attribute[];
          if (mod_inner_attrs_start !== undefined) {
            attrs = item.attrs.slice(mod_inner_attrs_start);
          } else {
            attrs = [];
          }
          this_.resolve_doc_links(attrs, { $: "Ok", _0: item.id });
          const old_macro_rules = this_.parent_scope.macro_rules;
          walk_item(this_, item, WalkItemKind.ItemKind);
          // Maintain macro_rules scopes in the same way as during early resolution
          // for diagnostics and doc links.
          if (item.attrs.every((attr) => !attr.has_name(sym.macro_use) && !attr.has_name(sym.macro_escape))) {
            this_.parent_scope.macro_rules = old_macro_rules;
          }
        });
      });
      this.parent_scope.module = orig_module;
      break;
    }

    case "Static": {
      const { ident, ty, expr, define_opaque, eii_impl } = kind._0;
      this.with_static_rib(def_kind, (this_) => {
        this_.with_lifetime_rib(LifetimeRibKind.elided({ $: "Static" }), (this_) => {
          this_.visit_ty(ty);
        });
        if (expr !== undefined) {
          // We already forbid generic params because of the above item rib,
          // so it doesn't matter whether this is a trivial constant.
          this_.resolve_static_body(expr, [ident, "Static"]);
        }
      });
      this.resolve_define_opaques(define_opaque);
      this.resolve_eii(eii_impl);
      break;
    }

    case "Const": {
      const { ident, generics, ty, body, define_opaque } = kind._0;
      this.with_generic_param_rib(
        generics.params,
        {
          $: "Item",
          _0: this.r.features.generic_const_items() ? { $: "Yes", _0: generics.span } : HasGenericParams.No,
          _1: def_kind,
        },
        item.id,
        "ConstItem",
        generics.span,
        (this_) => {
          this_.visit_generics(generics);

          this_.with_lifetime_rib(LifetimeRibKind.elided({ $: "Static" }), (this_: LateResolutionVisitor) => {
            this_.visit_ty(ty);
          });

          this_.resolve_const_item_rhs(body, [ident, "Const"]);
        },
      );
      this.resolve_define_opaques(define_opaque);
      break;
    }
    case "ConstBlock": {
      const { block } = kind._0;
      this.with_generic_param_rib([], { $: "Item", _0: HasGenericParams.No, _1: def_kind }, item.id, "ConstItem", DUMMY_SP, (this_) => {
        this_.with_lifetime_rib(LifetimeRibKind.elided({ $: "Infer" }), (this_) => {
          this_.with_constant_rib("No", ConstantHasGenerics.Yes, "No", [ConstBlockItem.IDENT, "Const"], (this_) =>
            this_.resolve_labeled_block(undefined, block.id, block),
          );
        });
      });
      break;
    }

    case "Use": {
      const use_tree = kind._0;
      this.use_items.push(item);
      let maybe_exported: MaybeExported;
      switch (use_tree.kind.$) {
        case "Simple":
        case "Glob":
          maybe_exported = { $: "Ok", _0: item.id };
          break;
        case "Nested":
          maybe_exported = { $: "NestedUse", _0: item.vis };
          break;
      }
      this.resolve_doc_links(item.attrs, maybe_exported);

      this.future_proof_import(use_tree);
      break;
    }

    case "MacroDef": {
      const macro_def = kind._1;
      // Maintain macro_rules scopes in the same way as during early resolution
      // for diagnostics and doc links.
      if (macro_def.macro_rules) {
        const def_id = this.r.current_owner.def_id;
        this.parent_scope.macro_rules = index_map(this.r.macro_rules_scopes, def_id);
      }

      if (macro_def.eii_declaration !== undefined) {
        const { foreign_item: extern_item_path } = macro_def.eii_declaration;
        this.smart_resolve_path(item.id, undefined, extern_item_path, PathSource.ExternItemImpl);
      }
      break;
    }

    case "ForeignMod":
    case "GlobalAsm": {
      walk_item(this, item, WalkItemKind.ItemKind);
      break;
    }

    case "Delegation": {
      const delegation = kind._0;
      const span = unwrap(delegation.path.segments.at(-1)).ident.span;
      this.with_generic_param_rib([], { $: "Item", _0: { $: "Yes", _0: span }, _1: def_kind }, item.id, "Function", span, (this_) =>
        this_.resolve_delegation(delegation, item.id, false),
      );
      break;
    }

    case "ExternCrate":
      this.use_items.push(item);
      break;

    case "MacCall":
    case "DelegationMac": {
      return panic("unexpanded macro in resolve!");
    }

    case "TestBinderConstraints": {
      const constraints = kind._0;
      this.resolve_test_binder_constraints(constraints, item.id);
      break;
    }
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:3160 with_generic_param_rib
LateResolutionVisitor.prototype.with_generic_param_rib = function (
  this: LateResolutionVisitor,
  params: readonly GenericParam[],
  kind: RibKind,
  binder: NodeId,
  generics_kind: LifetimeBinderKind,
  generics_span: Span,
  f: (this_: LateResolutionVisitor) => void,
): void {
  // debug!("with_generic_param_rib");
  const lifetime_kind: LifetimeRibKind = { $: "Generics", binder, span: generics_span, kind: generics_kind };

  const function_type_rib = Rib.new<Res>(kind);
  const function_value_rib = Rib.new<Res>(kind);
  const function_lifetime_rib = LifetimeRib.new(lifetime_kind);

  // Only check for shadowed bindings if we're declaring new params.
  if (params.length !== 0) {
    const seen_bindings = new KeyedMap<Ident, Span>(Ident_key);
    // Store all seen lifetimes names from outer scopes.
    const seen_lifetimes = new KeyedSet<Ident>(Ident_key);

    // We also can't shadow bindings from associated parent items.
    for (const ns of ["ValueNS", "TypeNS"] as const) {
      const ribs = this.ribs.index(ns);
      for (let i = ribs.length - 1; i >= 0; i--) {
        const parent_rib = ribs[i]!;
        // Break at module or block level, to account for nested items which are
        // allowed to shadow generic param names.
        if (parent_rib.kind.$ === "Module" || parent_rib.kind.$ === "Block") {
          break;
        }

        extend_map(
          seen_bindings,
          [...parent_rib.bindings.keys()].map((ident): [Ident, Span] => [ident, ident.span]),
        );
      }
    }

    // Forbid shadowing lifetime bindings
    for (let i = this.lifetime_ribs.length - 1; i >= 0; i--) {
      const rib = this.lifetime_ribs[i]!;
      for (const ident of rib.bindings.keys()) seen_lifetimes.add(ident);
      if (rib.kind.$ === "Item") {
        break;
      }
    }

    for (const param of params) {
      const ident = param.ident.normalize_to_macros_2_0();
      // debug!("with_generic_param_rib: {}", param.id);

      if (param.kind.$ === "Lifetime") {
        const original = seen_lifetimes.stored_key(ident);
        if (original !== undefined) {
          const guar = late_diagnostics.signal_lifetime_shadowing(this.r.tcx_.sess, original, param.ident);
          // Record lifetime res, so lowering knows there is something fishy.
          this.record_lifetime_err(param.id, guar);
          continue;
        }
      }

      if (seen_bindings.has(ident)) {
        // Entry::Occupied
        const span = index_map(seen_bindings, ident);
        const err: ResolutionError = { $: "NameAlreadyUsedInParameterList", _0: ident, _1: span };
        const guar = this.r.report_error(param.ident.span, err);
        let rib: Rib<Res>;
        switch (param.kind.$) {
          case "Lifetime": {
            // Record lifetime res, so lowering knows there is something fishy.
            this.record_lifetime_err(param.id, guar);
            continue;
          }
          case "Type":
            rib = function_type_rib;
            break;
          case "Const":
            rib = function_value_rib;
            break;
        }

        // Taint the resolution in case of errors to prevent follow up errors in typeck
        this.r.record_partial_res(param.id, PartialRes.new(RES_ERR));
        rib.bindings.set(ident, RES_ERR);
        continue;
      } else {
        // Entry::Vacant
        seen_bindings.set(ident, param.ident.span);
      }

      if (param.ident.name === kw.UnderscoreLifetime) {
        // To avoid emitting two similar errors,
        // we need to check if the span is a raw underscore lifetime, see issue #143152
        const is_raw_underscore_lifetime = this.r.tcx_.sess.psess.raw_identifier_spans.some((span) => span === param.span());

        const guar = this.r
          .dcx()
          .create_err(diagnostics.UnderscoreLifetimeIsReserved_diagnostic({ span: param.ident.span }))
          .emit_err_unless_delay(is_raw_underscore_lifetime);
        // Record lifetime res, so lowering knows there is something fishy.
        this.record_lifetime_err(param.id, guar);
        continue;
      }

      if (param.ident.name === kw.StaticLifetime) {
        const guar = this.r.dcx().emit_err(
          diagnostics.StaticLifetimeIsReserved_diagnostic({
            span: param.ident.span,
            lifetime: param.ident,
          }),
        );
        // Record lifetime res, so lowering knows there is something fishy.
        this.record_lifetime_err(param.id, guar);
        continue;
      }

      const def_id = this.r.local_def_id(param.id);

      // Plain insert (no renaming).
      let rib: Rib<Res>;
      let def_kind: DefKind;
      switch (param.kind.$) {
        case "Type":
          [rib, def_kind] = [function_type_rib, DefKind.TyParam];
          break;
        case "Const":
          [rib, def_kind] = [function_value_rib, DefKind.ConstParam];
          break;
        case "Lifetime": {
          const res: LifetimeRes = { $: "Param", param: def_id, binder };
          this.record_lifetime_def(param.id, res);
          function_lifetime_rib.bindings.set(ident, [param.id, res]);
          continue;
        }
      }

      let res: Res;
      switch (kind.$) {
        case "Item":
        case "AssocItem":
          res = { $: "Def", _0: def_kind, _1: LocalDefId.to_def_id(def_id) };
          break;
        case "Normal": {
          // FIXME(non_lifetime_binders): Stop special-casing
          // const params to error out here.
          if (this.r.features.non_lifetime_binders() && param.kind.$ === "Type") {
            res = { $: "Def", _0: def_kind, _1: LocalDefId.to_def_id(def_id) };
          } else {
            res = RES_ERR;
          }
          break;
        }
        default:
          return span_bug(param.ident.span, `Unexpected rib kind ${debug_RibKind(kind, PLAIN)}`);
      }
      this.r.record_partial_res(param.id, PartialRes.new(res));
      rib.bindings.set(ident, res);
    }
  }

  this.lifetime_ribs.push(function_lifetime_rib);
  this.ribs.index("ValueNS").push(function_value_rib);
  this.ribs.index("TypeNS").push(function_type_rib);

  f(this);

  this.ribs.index("TypeNS").pop();
  this.ribs.index("ValueNS").pop();
  const function_lifetime_rib_ = unwrap(this.lifetime_ribs.pop());

  // Do not account for the parameters we just bound for function lifetime elision.
  if (this.lifetime_elision_candidates !== undefined) {
    const candidates = this.lifetime_elision_candidates;
    for (const [, res] of function_lifetime_rib_.bindings.values()) {
      retain(candidates, ([r]) => !LifetimeRes_eq(r, res));
    }
  }

  if (generics_kind === "FnPtrType" || generics_kind === "WhereBound" || generics_kind === "Function" || generics_kind === "ImplBlock") {
    this.maybe_report_lifetime_uses(generics_span, params);
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:3348 with_label_rib
LateResolutionVisitor.prototype.with_label_rib = function (this: LateResolutionVisitor, kind: RibKind, f: (this_: LateResolutionVisitor) => void): void {
  this.label_ribs.push(Rib.new<NodeId>(kind));
  f(this);
  this.label_ribs.pop();
};

// rustc: compiler/rustc_resolve/src/late.rs:3354 with_static_rib
LateResolutionVisitor.prototype.with_static_rib = function (this: LateResolutionVisitor, def_kind: DefKind, f: (this_: LateResolutionVisitor) => void): void {
  const kind: RibKind = { $: "Item", _0: HasGenericParams.No, _1: def_kind };
  this.with_rib("ValueNS", kind, (this_) => this_.with_rib("TypeNS", kind, f));
};

// HACK(min_const_generics, generic_const_exprs): We
// want to keep allowing `[0; size_of::<*mut T>()]`
// with a future compat lint for now. We do this by adding an
// additional special case for repeat expressions.
//
// Note that we intentionally still forbid `[0; N + 1]` during
// name resolution so that we don't extend the future
// compat lint to new cases.
// #[instrument(level = "debug", skip(self, f))]
// rustc: compiler/rustc_resolve/src/late.rs:3368 with_constant_rib
LateResolutionVisitor.prototype.with_constant_rib = function (
  this: LateResolutionVisitor,
  is_repeat: IsRepeatExpr,
  may_use_generics: ConstantHasGenerics,
  requires_type: ConstantRequiresType,
  item: [Ident, ConstantItemKind] | undefined,
  f: (this_: LateResolutionVisitor) => void,
): void {
  // PORT: the closure `let f = |this| ..` shadows `f`; it is `f_` here.
  const f_ = (this_: LateResolutionVisitor): void => {
    this_.with_rib("ValueNS", { $: "ConstantItem", _0: may_use_generics, _1: item, _2: requires_type }, (this_) => {
      this_.with_rib(
        "TypeNS",
        {
          $: "ConstantItem",
          _0: ConstantHasGenerics.force_yes_if(may_use_generics, is_repeat === "Yes"),
          _1: item,
          _2: requires_type,
        },
        (this_) => {
          this_.with_label_rib({ $: "ConstantItem", _0: may_use_generics, _1: item, _2: requires_type }, f);
        },
      );
    });
  };

  if (may_use_generics.$ === "No") {
    const cause = may_use_generics._0;
    this.with_lifetime_rib({ $: "ConcreteAnonConst", _0: cause }, f_);
  } else {
    f_(this);
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:3406 with_current_self_type
LateResolutionVisitor.prototype.with_current_self_type = function <T>(this: LateResolutionVisitor, self_type: Ty, f: (this_: LateResolutionVisitor) => T): T {
  // Handle nested impls (inside fn bodies)
  const previous_value = this.diag_metadata.current_self_type;
  this.diag_metadata.current_self_type = self_type;
  const result = f(this);
  this.diag_metadata.current_self_type = previous_value;
  return result;
};

// rustc: compiler/rustc_resolve/src/late.rs:3418 with_current_self_item
LateResolutionVisitor.prototype.with_current_self_item = function <T>(this: LateResolutionVisitor, self_item: Item, f: (this_: LateResolutionVisitor) => T): T {
  const previous_value = this.diag_metadata.current_self_item;
  this.diag_metadata.current_self_item = self_item.id;
  const result = f(this);
  this.diag_metadata.current_self_item = previous_value;
  return result;
};

/// When evaluating a `trait` use its associated types' idents for suggestions in E0425.
// rustc: compiler/rustc_resolve/src/late.rs:3426 resolve_trait_items
LateResolutionVisitor.prototype.resolve_trait_items = function (this: LateResolutionVisitor, trait_items: readonly AssocItem[]): void {
  const trait_assoc_items = this.diag_metadata.current_trait_assoc_items;
  this.diag_metadata.current_trait_assoc_items = trait_items;

  for (const item of trait_items) {
    with_owner(this, item.id, (this_) => this_.resolve_trait_item(item));
  }

  this.diag_metadata.current_trait_assoc_items = trait_assoc_items;
};

// rustc: compiler/rustc_resolve/src/late.rs:3437 resolve_trait_item
LateResolutionVisitor.prototype.resolve_trait_item = function (this: LateResolutionVisitor, item: AssocItem): void {
  const walk_assoc_item_ = (this_: LateResolutionVisitor, generics: Generics, kind: LifetimeBinderKind, item: AssocItem): void => {
    this_.with_generic_param_rib(generics.params, RibKind.AssocItem, item.id, kind, generics.span, (this_) => {
      walk_assoc_item(this_, item, AssocCtxt.Trait, WalkItemKind.AssocItemKind);
    });
  };

  this.resolve_doc_links(item.attrs, { $: "Ok", _0: item.id });
  const kind = item.kind;
  switch (kind.$) {
    case "Const": {
      const { generics, ty, body, define_opaque } = kind._0;
      this.with_generic_param_rib(generics.params, RibKind.AssocItem, item.id, "ConstItem", generics.span, (this_) => {
        this_.with_lifetime_rib(
          {
            $: "Elided",
            res: { $: "Static" },
            error_in_path: true,
          },
          (this_) => {
            this_.visit_generics(generics);
            this_.visit_ty(ty);
            // Only impose the restrictions of `ConstRibKind` for an
            // actual constant expression in a provided default.
            //
            // We allow arbitrary const expressions inside of associated consts,
            // even if they are potentially not const evaluatable.
            //
            // Type parameters can already be used and as associated consts are
            // not used as part of the type system, this is far less surprising.
            this_.resolve_const_item_rhs(body, undefined);
          },
        );
      });

      this.resolve_define_opaques(define_opaque);
      break;
    }
    case "Fn": {
      const { generics, define_opaque } = kind._0;
      walk_assoc_item_(this, generics, "Function", item);

      this.resolve_define_opaques(define_opaque);
      break;
    }
    case "Delegation": {
      const delegation = kind._0;
      this.with_generic_param_rib([], RibKind.AssocItem, item.id, "Function", unwrap(delegation.path.segments.at(-1)).ident.span, (this_) =>
        this_.resolve_delegation(delegation, item.id, false),
      );
      break;
    }
    case "Type": {
      const { generics } = kind._0;
      this.with_lifetime_rib(LifetimeRibKind.AnonymousReportError, (this_) => {
        walk_assoc_item_(this_, generics, "Item", item);
      });
      break;
    }
    case "MacCall":
    case "DelegationMac": {
      return panic("unexpanded macro in resolve!");
    }
  }
};

/// This is called to resolve a trait reference from an `impl` (i.e., `impl Trait for Foo`).
// rustc: compiler/rustc_resolve/src/late.rs:3510 with_optional_trait_ref
LateResolutionVisitor.prototype.with_optional_trait_ref = function <T>(
  this: LateResolutionVisitor,
  opt_trait_ref: TraitRef | undefined,
  self_type: Ty,
  f: (this_: LateResolutionVisitor, _1: DefId | undefined) => T,
): T {
  let new_val: [Module, TraitRef] | undefined = undefined;
  let new_id: DefId | undefined = undefined;
  if (opt_trait_ref !== undefined) {
    const trait_ref = opt_trait_ref;
    const path: Segment[] = Segment.from_path(trait_ref.path);
    this.diag_metadata.currently_processing_impl_trait = [clone_TraitRef(trait_ref), clone_Ty(self_type)];
    const res = this.smart_resolve_path_fragment(
      undefined,
      path,
      { $: "Trait", _0: "No" },
      Finalize.new(trait_ref.ref_id, trait_ref.path.span),
      "Yes",
      undefined,
    );
    this.diag_metadata.currently_processing_impl_trait = undefined;
    const def_id = hir_Res.opt_def_id(res.expect_full_res());
    if (def_id !== undefined) {
      new_id = def_id;
      new_val = [this.r.expect_module(def_id), clone_TraitRef(trait_ref)];
    }
  }
  const original_trait_ref = this.current_trait_ref;
  this.current_trait_ref = new_val;
  const result = f(this, new_id);
  this.current_trait_ref = original_trait_ref;
  return result;
};

// rustc: compiler/rustc_resolve/src/late.rs:3542 with_self_rib_ns
LateResolutionVisitor.prototype.with_self_rib_ns = function (
  this: LateResolutionVisitor,
  ns: Namespace,
  self_res: Res,
  f: (this_: LateResolutionVisitor) => void,
): void {
  const self_type_rib = Rib.new<Res>(RibKind.Normal);

  // Plain insert (no renaming, since types are not currently hygienic)
  self_type_rib.bindings.set(Ident.with_dummy_span(kw.SelfUpper), self_res);
  this.ribs.index(ns).push(self_type_rib);
  f(this);
  this.ribs.index(ns).pop();
};

// rustc: compiler/rustc_resolve/src/late.rs:3552 with_self_rib
LateResolutionVisitor.prototype.with_self_rib = function (this: LateResolutionVisitor, self_res: Res, f: (this_: LateResolutionVisitor) => void): void {
  this.with_self_rib_ns("TypeNS", self_res, f);
};

// rustc: compiler/rustc_resolve/src/late.rs:3556 resolve_implementation
LateResolutionVisitor.prototype.resolve_implementation = function (
  this: LateResolutionVisitor,
  attrs: readonly Attribute[],
  generics: Generics,
  of_trait: TraitImplHeader | undefined,
  self_type: Ty,
  item_id: NodeId,
  impl_items: readonly AssocItem[],
): void {
  // debug!("resolve_implementation");
  // If applicable, create a rib for the type parameters.
  this.with_generic_param_rib(
    generics.params,
    { $: "Item", _0: { $: "Yes", _0: generics.span }, _1: this.r.tcx_.def_kind(this.r.current_owner.def_id) },
    item_id,
    "ImplBlock",
    generics.span,
    (this_) => {
      // Dummy self type for better errors if `Self` is used in the trait path.
      this_.with_self_rib({ $: "SelfTyParam", trait_: CrateNum.as_def_id(LOCAL_CRATE) }, (this_) => {
        this_.with_lifetime_rib(
          {
            $: "AnonymousCreateParameter",
            binder: item_id,
            report_in_path: true,
          },
          (this_) => {
            // Resolve the trait reference, if necessary.
            this_.with_optional_trait_ref(of_trait === undefined ? undefined : of_trait.trait_ref, self_type, (this_, trait_id) => {
              this_.resolve_doc_links(attrs, { $: "Impl", _0: trait_id });

              const item_def_id_ = this_.r.current_owner.def_id;

              // Register the trait definitions from here.
              if (trait_id !== undefined) {
                let impls = this_.r.trait_impls.get(trait_id);
                if (impls === undefined) {
                  impls = [];
                  this_.r.trait_impls.set(trait_id, impls);
                }
                impls.push(item_def_id_);
              }

              const item_def_id = LocalDefId.to_def_id(item_def_id_);
              const res: Res = {
                $: "SelfTyAlias",
                alias_to: item_def_id,
                is_trait_impl: trait_id !== undefined,
              };
              this_.with_self_rib(res, (this_) => {
                if (of_trait !== undefined) {
                  // Resolve type arguments in the trait path.
                  walk_trait_ref(this_, of_trait.trait_ref);
                }
                // Resolve the self type.
                this_.visit_ty(self_type);
                // Resolve the generic parameters.
                this_.visit_generics(generics);

                // Resolve the items within the impl.
                this_.with_current_self_type(self_type, (this_) => {
                  this_.with_self_rib_ns("ValueNS", { $: "SelfCtor", _0: item_def_id }, (this_) => {
                    // debug!("resolve_implementation with_self_rib_ns(ValueNS, ...)");
                    const seen_trait_items = new KeyedMap<DefId, Span>(DefId_key);
                    for (const item of impl_items) {
                      with_owner(this_, item.id, (this_) => {
                        this_.resolve_impl_item(item, seen_trait_items, trait_id, of_trait !== undefined, self_type.id);
                      });
                    }
                  });
                });
              });
            });
          },
        );
      });
    },
  );
};

// rustc: compiler/rustc_resolve/src/late.rs:3643 resolve_test_binder_constraints
LateResolutionVisitor.prototype.resolve_test_binder_constraints = function (
  this: LateResolutionVisitor,
  constraints: TestBinderConstraints,
  item_id: NodeId,
): void {
  const generics = constraints.generics;
  this.with_generic_param_rib(
    generics.params,
    { $: "Item", _0: { $: "Yes", _0: generics.span }, _1: this.r.tcx_.def_kind(this.r.current_owner.def_id) },
    item_id,
    "ImplBlock",
    generics.span,
    (this_) => {
      this_.visit_generics(generics);
      this_.visit_test_binder_body(constraints.body);
    },
  );
};

// rustc: compiler/rustc_resolve/src/late.rs:3665 resolve_impl_item
LateResolutionVisitor.prototype.resolve_impl_item = function (
  this: LateResolutionVisitor,
  item: AssocItem,
  seen_trait_items: Map<DefId, Span>,
  trait_id: DefId | undefined,
  is_in_trait_impl: boolean,
  self_type_id: NodeId,
): void {
  // use crate::ResolutionError::*;
  this.resolve_doc_links(item.attrs, { $: "ImplItem", _0: trait_id !== undefined ? Ok(trait_id) : Err(item.vis) });
  const prev = this.diag_metadata.current_impl_item;
  this.diag_metadata.current_impl_item = undefined;
  this.diag_metadata.current_impl_item = item;
  const kind = item.kind;
  switch (kind.$) {
    case "Const": {
      const { ident, generics, ty, body, define_opaque } = kind._0;
      // debug!("resolve_implementation AssocItemKind::Const");
      this.with_generic_param_rib(generics.params, RibKind.AssocItem, item.id, "ConstItem", generics.span, (this_) => {
        this_.with_lifetime_rib(
          {
            $: "Elided",
            res: { $: "Static" },
            error_in_path: true,
          },
          (this_) => {
            // If this is a trait impl, ensure the const
            // exists in trait
            this_.check_trait_item(item.id, ident, ident, item.kind, "ValueNS", item.span, seen_trait_items, (i, s, c) => ({
              $: "ConstNotMemberOfTrait",
              _0: i,
              _1: s,
              _2: c,
            }));

            this_.visit_generics(generics);
            this_.visit_ty(ty);
            // We allow arbitrary const expressions inside of associated consts,
            // even if they are potentially not const evaluatable.
            //
            // Type parameters can already be used and as associated consts are
            // not used as part of the type system, this is far less surprising.
            this_.resolve_const_item_rhs(body, undefined);
          },
        );
      });
      this.resolve_define_opaques(define_opaque);
      break;
    }
    case "Fn": {
      const fn_kind = kind._0;
      const { ident, generics, define_opaque } = fn_kind;
      // debug!("resolve_implementation AssocItemKind::Fn");
      // We also need a new scope for the impl item type parameters.
      this.with_generic_param_rib(generics.params, RibKind.AssocItem, item.id, "Function", generics.span, (this_) => {
        let effective_ident: Ident;
        if (is_in_trait_impl && fn_kind.is_pin_drop_sugar()) {
          effective_ident = Ident.new(sym.pin_drop, ident.span);
        } else {
          effective_ident = ident;
        }
        // If this is a trait impl, ensure the method
        // exists in trait
        this_.check_trait_item(item.id, effective_ident, ident, item.kind, "ValueNS", item.span, seen_trait_items, (i, s, c) => ({
          $: "MethodNotMemberOfTrait",
          _0: i,
          _1: s,
          _2: c,
        }));

        walk_assoc_item(this_, item, { $: "Impl", of_trait: true }, WalkItemKind.AssocItemKind);
      });

      if (!is_in_trait_impl) {
        this.fill_delegation_inherent_fn_map(self_type_id, ident);
      }

      this.resolve_define_opaques(define_opaque);
      break;
    }
    case "Type": {
      const { ident, generics } = kind._0;
      this.diag_metadata.in_non_gat_assoc_type = generics.params.length === 0;
      // debug!("resolve_implementation AssocItemKind::Type");
      // We also need a new scope for the impl item type parameters.
      this.with_generic_param_rib(generics.params, RibKind.AssocItem, item.id, "ImplAssocType", generics.span, (this_) => {
        this_.with_lifetime_rib(LifetimeRibKind.AnonymousReportError, (this_) => {
          // If this is a trait impl, ensure the type
          // exists in trait
          this_.check_trait_item(item.id, ident, ident, item.kind, "TypeNS", item.span, seen_trait_items, (i, s, c) => ({
            $: "TypeNotMemberOfTrait",
            _0: i,
            _1: s,
            _2: c,
          }));

          walk_assoc_item(this_, item, { $: "Impl", of_trait: true }, WalkItemKind.AssocItemKind);
        });
      });
      this.diag_metadata.in_non_gat_assoc_type = undefined;
      break;
    }
    case "Delegation": {
      const delegation = kind._0;
      // debug!("resolve_implementation AssocItemKind::Delegation");
      this.with_generic_param_rib([], RibKind.AssocItem, item.id, "Function", unwrap(delegation.path.segments.at(-1)).ident.span, (this_) => {
        if (!is_in_trait_impl) {
          this_.fill_delegation_inherent_fn_map(
            self_type_id,
            // If rename is specified then ident equals rename.
            delegation.ident,
          );
        }

        this_.check_trait_item(item.id, delegation.ident, delegation.ident, item.kind, "ValueNS", item.span, seen_trait_items, (i, s, c) => ({
          $: "MethodNotMemberOfTrait",
          _0: i,
          _1: s,
          _2: c,
        }));

        // Here we don't use `trait_id`, as we can process unresolved trait, however
        // in this case we are still in a trait impl, https://github.com/rust-lang/rust/issues/150152
        this_.resolve_delegation(delegation, item.id, is_in_trait_impl);
      });
      break;
    }
    case "MacCall":
    case "DelegationMac": {
      return panic("unexpanded macro in resolve!");
    }
  }
  this.diag_metadata.current_impl_item = prev;
};

/// A heuristic to resolve delegations to inherent impls during AST -> HIR lowering.
/// Ideally we would do it through `ProbeContext`, however now it is impossible due to
/// query cycles even in the code without errors.
/// Not all paths will be properly resolved this way (i.e., type aliases).
/// FIXME(fn_delegation): remove it when resolution through `ProbeContext` will be ready
// rustc: compiler/rustc_resolve/src/late.rs:3842 fill_delegation_inherent_fn_map
LateResolutionVisitor.prototype.fill_delegation_inherent_fn_map = function (this: LateResolutionVisitor, self_type_id: NodeId, ident: Ident): void {
  const res = this.r.partial_res_map.get(self_type_id);

  let self_type_def_id: LocalDefId | undefined = undefined;
  if (res !== undefined) {
    const r = res.full_res();
    const id = r === undefined ? undefined : hir_Res.opt_def_id(r);
    self_type_def_id = id === undefined ? undefined : id.as_local();
  }
  if (self_type_def_id === undefined) {
    return;
  }

  // FIXME(fn_delegation): use correct identifier hygiene
  let map = this.r.delegation_inherent_fn_map.get(self_type_def_id);
  if (map === undefined) {
    map = new KeyedMap<Ident, DelegationInherentFnKind>(Ident_key);
    this.r.delegation_inherent_fn_map.set(self_type_def_id, map);
  }

  const cur = map.get(ident);
  if (cur === undefined) {
    map.set(ident, { $: "Single", _0: this.r.current_owner.def_id });
  } else if (cur.$ === "Single") {
    map.set(ident, { $: "Ambig" });
  } else {
    // _ => {}
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:3865 check_trait_item
LateResolutionVisitor.prototype.check_trait_item = function (
  this: LateResolutionVisitor,
  id: NodeId,
  ident_: Ident,
  reported_ident_: Ident,
  kind: AssocItemKind,
  ns: Namespace,
  span: Span,
  seen_trait_items: Map<DefId, Span>,
  err: (_0: Ident, _1: string, _2: Symbol | undefined) => ResolutionError,
): void {
  // If there is a TraitRef in scope for an impl, then the method must be in the trait.
  if (this.current_trait_ref === undefined) {
    return;
  }
  const [module] = this.current_trait_ref;
  // PORT: `mut ident: Ident` / `mut reported_ident: Ident` are by-value copies (never edit the AST's).
  const ident = new Ident(ident_.name, ident_.span);
  const reported_ident = new Ident(reported_ident_.name, reported_ident_.span);
  Span.normalize_to_macros_2_0_and_adjust(field_mut(ident, "span"), module.expansion);
  Span.normalize_to_macros_2_0_and_adjust(field_mut(reported_ident, "span"), module.expansion);
  const key = BindingKey.new(IdentKey.new(ident), ns);
  let decl = this.r.resolution(module, key)?.best_decl();
  // debug!(?decl);
  if (decl === undefined) {
    // We could not find the trait item in the correct namespace.
    // Check the other namespace to report an error.
    let ns_: Namespace;
    switch (ns) {
      case "ValueNS":
        ns_ = "TypeNS";
        break;
      case "TypeNS":
        ns_ = "ValueNS";
        break;
      default:
        ns_ = ns;
    }
    const key = BindingKey.new(IdentKey.new(ident), ns_);
    decl = this.r.resolution(module, key)?.best_decl();
    // debug!(?decl);
  }

  const feed_visibility = (this_: LateResolutionVisitor, def_id: DefId): void => {
    const vis_ = this_.r.tcx_.visibility(def_id) as ty_Visibility<ModId>;
    let vis: ty_Visibility<LocalModId>;
    if (ty_Visibility.is_visible_locally(vis_)) {
      vis = ty_Visibility.expect_local(vis_);
    } else {
      this_.r.dcx().span_delayed_bug(span, "error should be emitted when an unexpected trait item is used");
      vis = ty_Visibility.Public;
    }
    // HACK: because we don't want to track the `TyCtxtFeed` through the resolver to here
    // in a hash-map, we instead conjure a `TyCtxtFeed` for any `DefId` here, but prevent
    // it from being used generally.
    this_.r.tcx_.feed_visibility_for_trait_impl_item(this_.r.current_owner.def_id, vis);
  };

  if (decl === undefined) {
    // We could not find the method: report an error.
    const candidate = this.find_similarly_named_assoc_item(reported_ident.name, kind);
    const path = unwrap(this.current_trait_ref)[1].path;
    const path_names = path_names_to_string(path);
    this.report_error(span, err(reported_ident, path_names, candidate));
    feed_visibility(this, module.def_id());
    return;
  }

  const res = decl.res();
  if (res.$ !== "Def") return bug();
  const def_kind = res._0;
  const id_in_trait = res._1;
  feed_visibility(this, id_in_trait);

  if (seen_trait_items.has(id_in_trait)) {
    // Entry::Occupied
    const trait_span = Span.shrink_to_lo(unwrap(decl.parent_module).span);
    const impl_span = unwrap(this.current_trait_ref)[1].path.span;
    this.report_error(span, {
      $: "TraitImplDuplicate",
      name: ident,
      old_span: index_map(seen_trait_items, id_in_trait),
      trait_item_span: decl.span,
      trait_span,
      impl_span,
    });
    return;
  } else {
    // Entry::Vacant
    seen_trait_items.set(id_in_trait, span);
  }

  if (
    (def_kind.$ === "AssocTy" && kind.$ === "Type") ||
    (def_kind.$ === "AssocFn" && kind.$ === "Fn") ||
    (def_kind.$ === "AssocConst" && kind.$ === "Const") ||
    (def_kind.$ === "AssocFn" && kind.$ === "Delegation")
  ) {
    this.r.record_partial_res(id, PartialRes.new(res));
    return;
  }

  // The method kind does not correspond to what appeared in the trait, report.
  const path = unwrap(this.current_trait_ref)[1].path;
  let code: ErrCode;
  let kind_: string;
  switch (kind.$) {
    case "Const":
      [code, kind_] = [E0323, "const"];
      break;
    case "Fn":
      [code, kind_] = [E0324, "method"];
      break;
    case "Type":
      [code, kind_] = [E0325, "type"];
      break;
    case "Delegation":
      [code, kind_] = [E0324, "method"];
      break;
    case "MacCall":
    case "DelegationMac": {
      return span_bug(span, "unexpanded macro");
    }
  }
  const trait_path = path_names_to_string(path);
  const trait_span = Span.shrink_to_lo(unwrap(decl.parent_module).span);
  const impl_span = unwrap(this.current_trait_ref)[1].path.span;
  this.report_error(span, {
    $: "TraitImplMismatch",
    name: ident,
    kind: kind_,
    code,
    trait_path,
    trait_item_span: decl.span,
    trait_span,
    impl_span,
  });
};

// rustc: compiler/rustc_resolve/src/late.rs:3991 resolve_static_body
LateResolutionVisitor.prototype.resolve_static_body = function (this: LateResolutionVisitor, expr: Expr, item: [Ident, ConstantItemKind] | undefined): void {
  this.with_lifetime_rib(LifetimeRibKind.elided({ $: "Infer" }), (this_) => {
    this_.with_constant_rib("No", ConstantHasGenerics.Yes, "No", item, (this_) => this_.visit_expr(expr));
  });
};

// rustc: compiler/rustc_resolve/src/late.rs:4003 resolve_const_item_rhs
LateResolutionVisitor.prototype.resolve_const_item_rhs = function (
  this: LateResolutionVisitor,
  body: Expr | undefined,
  item: [Ident, ConstantItemKind] | undefined,
): void {
  if (body !== undefined) {
    this.with_lifetime_rib(LifetimeRibKind.elided({ $: "Infer" }), (this_) => {
      this_.with_constant_rib("No", ConstantHasGenerics.Yes, "No", item, (this_) => this_.visit_expr(body));
    });
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:4021 resolve_delegation
LateResolutionVisitor.prototype.resolve_delegation = function (
  this: LateResolutionVisitor,
  delegation: Delegation,
  item_id: NodeId,
  is_in_trait_impl: boolean,
): void {
  this.smart_resolve_path(delegation.id, delegation.qself, delegation.path, PathSource.Delegation);

  // Create lifetimes not with `LifetimeRibKind::Generics` but with `LifetimeRibKind::Elided`,
  // as we are not processing generic params but generic args in a future call (#156342, #156758).
  this.with_lifetime_rib(LifetimeRibKind.elided({ $: "Infer" }), (this_) => {
    if (delegation.qself !== undefined) {
      this_.visit_ty(delegation.qself.ty);
    }

    this_.visit_path(delegation.path);
  });

  const resolution_node_id = is_in_trait_impl ? item_id : delegation.id;
  const r = this.r.partial_res_map.get(resolution_node_id);
  let resolution: DelegationResolution;
  if (r !== undefined) {
    const full = r.full_res();
    const def_id = full === undefined ? undefined : hir_Res.opt_def_id(full);
    if (def_id === undefined) {
      // If we are inside trait impl delegation is either resolved or not.
      assert(!is_in_trait_impl, "assertion failed: !is_in_trait_impl");
      resolution = { $: "Partial" };
    } else {
      resolution = ((): DelegationResolution => {
        // If we are inside trait impl do additional check if call path is resolved,
        // this will later be used to decide if we should apply type-relative resolution
        // routine during call path resolution in AST -> HIR lowering.
        if (is_in_trait_impl) {
          const path_res = index_map(this.r.partial_res_map, delegation.id);

          const path_full = path_res.full_res();
          if ((path_full === undefined ? undefined : hir_Res.opt_def_id(path_full)) === undefined) {
            return { $: "PartialCall", _0: def_id };
          }
        }

        return { $: "Full", _0: def_id };
      })();
    }
  } else {
    resolution = {
      $: "Error",
      _0: this.r.tcx_.dcx().span_delayed_bug(delegation.path.span, `bad resolution for delegation ${debug_NodeId(item_id, PLAIN)}`),
    };
  }

  const info: DelegationInfo = { resolution };
  this.r.delegation_infos.set(this.r.current_owner.def_id, info);

  const body = delegation.body;
  if (body === undefined) return;
  this.with_rib("ValueNS", RibKind.FnOrCoroutine, (this_) => {
    const ident = Ident.new(kw.SelfLower, Span.normalize_to_macro_rules(body.span));
    const res: Res = { $: "Local", _0: delegation.id };
    this_.innermost_rib_bindings("ValueNS").set(ident, res);

    //As we lower target_expr_template body to a body of a function we need a label rib (#148889)
    this_.with_label_rib(RibKind.FnOrCoroutine, (this_) => {
      this_.with_lifetime_rib(LifetimeRibKind.elided({ $: "Infer" }), (this_) => {
        this_.visit_block(body);
      });
    });
  });
};

// rustc: compiler/rustc_resolve/src/late.rs:4095 resolve_params
LateResolutionVisitor.prototype.resolve_params = function (this: LateResolutionVisitor, params: readonly Param[]): void {
  const bindings: PatternBindings = [["Product", new KeyedMap<Ident, Res>(Ident_key)]];
  this.with_lifetime_rib(LifetimeRibKind.elided({ $: "Infer" }), (this_) => {
    for (const { pat } of params) {
      this_.resolve_pattern(pat, "FnParam", bindings);
    }
    this_.apply_pattern_bindings(bindings);
  });
  for (const { ty } of params) {
    this.visit_ty(ty);
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:4108 resolve_local
LateResolutionVisitor.prototype.resolve_local = function (this: LateResolutionVisitor, local: Local): void {
  // debug!("resolving local ({:?})", local);
  // Resolve the type.
  if (local.ty !== undefined) this.visit_ty(local.ty);

  // Resolve the initializer.
  const init_else = LocalKind.init_else_opt(local.kind);
  if (init_else !== undefined) {
    const [init, els] = init_else;
    this.visit_expr(init);

    // Resolve the `else` block
    if (els !== undefined) {
      this.visit_block(els);
    }
  }

  // Resolve the pattern.
  this.resolve_pattern_top(local.pat, "Let");
};

/// Build a map from pattern identifiers to binding-info's, and check the bindings are
/// consistent when encountering or-patterns and never patterns.
/// This is done hygienically: this could arise for a macro that expands into an or-pattern
/// where one 'x' was from the user and one 'x' came from the macro.
///
/// A never pattern by definition indicates an unreachable case. For example, matching on
/// `Result<T, &!>` could look like:
/// ```rust
/// # #![feature(never_patterns)]
/// # fn bar(_x: u32) {}
/// let foo: Result<u32, &!> = Ok(0);
/// match foo {
///     Ok(x) => bar(x),
///     Err(&!),
/// }
/// ```
/// This extends to product types: `(x, !)` is likewise unreachable. So it doesn't make sense to
/// have a binding here, and we tell the user to use `_` instead.
// rustc: compiler/rustc_resolve/src/late.rs:4145 compute_and_check_binding_map
LateResolutionVisitor.prototype.compute_and_check_binding_map = function (
  this: LateResolutionVisitor,
  pat: Pat,
): Result<Map<Ident, BindingInfo>, IsNeverPattern> {
  const binding_map = new KeyedMap<Ident, BindingInfo>(Ident_key);
  let is_never_pat = false;

  pat.walk((pat) => {
    const kind = pat.kind;
    if (kind.$ === "Ident" && (kind._2 !== undefined || this.is_base_res_local(pat.id))) {
      const annotation = kind._0;
      const ident = kind._1;
      binding_map.set(ident, { span: ident.span, annotation: clone_BindingMode(annotation) });
    } else if (kind.$ === "Or") {
      const ps = kind._0;
      // Check the consistency of this or-pattern and
      // then add all bindings to the larger map.
      const r = this.compute_and_check_or_pat_binding_map(ps);
      if (r.$ === "Ok") {
        extend_map(binding_map, r._0);
      } else {
        is_never_pat = true;
      }
      return false;
    } else if (kind.$ === "Never") {
      is_never_pat = true;
    } else {
      // _ => {}
    }

    return true;
  });

  if (is_never_pat) {
    for (const [, binding] of binding_map) {
      this.report_error(binding.span, { $: "BindingInNeverPattern" });
    }
    return Err({});
  } else {
    return Ok(binding_map);
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:4185 is_base_res_local
LateResolutionVisitor.prototype.is_base_res_local = function (this: LateResolutionVisitor, nid: NodeId): boolean {
  const res = this.r.partial_res_map.get(nid);
  return res !== undefined && res.expect_full_res().$ === "Local";
};

/// Compute the binding map for an or-pattern. Checks that all of the arms in the or-pattern
/// have exactly the same set of bindings, with the same binding modes for each.
/// Returns the computed binding map and a boolean indicating whether the pattern is a never
/// pattern.
///
/// A never pattern by definition indicates an unreachable case. For example, destructuring a
/// `Result<T, &!>` could look like:
/// ```rust
/// # #![feature(never_patterns)]
/// # fn foo() -> Result<bool, &'static !> { Ok(true) }
/// let (Ok(x) | Err(&!)) = foo();
/// # let _ = x;
/// ```
/// Because the `Err(&!)` branch is never reached, it does not need to have the same bindings as
/// the other branches of the or-pattern. So we must ignore never pattern when checking the
/// bindings of an or-pattern.
/// Moreover, if all the subpatterns are never patterns (e.g. `Ok(!) | Err(!)`), then the
/// pattern as a whole counts as a never pattern (since it's definitionallly unreachable).
// rustc: compiler/rustc_resolve/src/late.rs:4210 compute_and_check_or_pat_binding_map
LateResolutionVisitor.prototype.compute_and_check_or_pat_binding_map = function (
  this: LateResolutionVisitor,
  pats: readonly Pat[],
): Result<Map<Ident, BindingInfo>, IsNeverPattern> {
  const missing_vars = new KeyedMap<Ident, BindingError>(Ident_key);
  const inconsistent_vars = new KeyedMap<Ident, [Span, Span]>(Ident_key);

  // 1) Compute the binding maps of all arms; we must ignore never patterns here.
  const not_never_pats: [Map<Ident, BindingInfo>, Pat][] = [];
  for (const pat of pats) {
    const binding_map = this.compute_and_check_binding_map(pat);
    if (binding_map.$ === "Ok") not_never_pats.push([binding_map._0, pat]);
  }

  // 2) Record any missing bindings or binding mode inconsistencies.
  for (const [map_outer, pat_outer] of not_never_pats) {
    // Check against all arms except for the same pattern which is always self-consistent.
    const inners = not_never_pats.filter(([, pat]) => pat.id !== pat_outer.id);

    for (const [map, pat] of inners) {
      for (const [name, binding_inner] of map) {
        const binding_outer = map_outer.get(name);
        if (binding_outer === undefined) {
          // The inner binding is missing in the outer.
          let binding_error = missing_vars.get(name);
          if (binding_error === undefined) {
            const first = name.as_str().codePointAt(0);
            binding_error = {
              name,
              origin: [],
              target: [],
              could_be_path: first !== undefined && is_uppercase(first),
            };
            missing_vars.set(name, binding_error);
          }
          binding_error.origin.push([binding_inner.span, clone_Pat(pat)]);
          binding_error.target.push(clone_Pat(pat_outer));
        } else {
          if (!BindingMode_eq(binding_outer.annotation, binding_inner.annotation)) {
            // The binding modes in the outer and inner bindings differ.
            if (!inconsistent_vars.has(name)) {
              inconsistent_vars.set(name, [binding_inner.span, binding_outer.span]);
            }
          }
        }
      }
    }
  }

  // 3) Report all missing variables we found.
  for (const [name, v] of missing_vars) {
    if (inconsistent_vars.has(name)) {
      v.could_be_path = false;
    }
    this.report_error(unwrap(v.origin[0])[0], { $: "VariableNotBoundInPattern", _0: v, _1: clone_ParentScope(this.parent_scope) });
  }

  // 4) Report all inconsistencies in binding modes we found.
  for (const [name, v] of inconsistent_vars) {
    this.report_error(v[0], { $: "VariableBoundWithDifferentMode", _0: name, _1: v[1] });
  }

  // 5) Bubble up the final binding map.
  if (not_never_pats.length === 0) {
    // All the patterns are never patterns, so the whole or-pattern is one too.
    return Err({});
  } else {
    const binding_map = new KeyedMap<Ident, BindingInfo>(Ident_key);
    for (const [bm] of not_never_pats) {
      extend_map(binding_map, bm);
    }
    return Ok(binding_map);
  }
};

/// Check the consistency of bindings wrt or-patterns and never patterns.
// rustc: compiler/rustc_resolve/src/late.rs:4289 check_consistent_bindings
LateResolutionVisitor.prototype.check_consistent_bindings = function (this: LateResolutionVisitor, pat: Pat): void {
  let is_or_or_never = false;
  pat.walk((pat) => {
    if (pat.kind.$ === "Or" || pat.kind.$ === "Never") {
      is_or_or_never = true;
      return false;
    }
    return true;
  });
  if (is_or_or_never) {
    this.compute_and_check_binding_map(pat);
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:4303 resolve_arm
LateResolutionVisitor.prototype.resolve_arm = function (this: LateResolutionVisitor, arm: Arm): void {
  this.with_rib("ValueNS", RibKind.Normal, (this_) => {
    this_.resolve_pattern_top(arm.pat, "Match");
    if (arm.guard !== undefined) this_.visit_expr(arm.guard.cond);
    if (arm.body !== undefined) this_.visit_expr(arm.body);
  });
};

/// Arising from `source`, resolve a top level pattern.
// rustc: compiler/rustc_resolve/src/late.rs:4312 resolve_pattern_top
LateResolutionVisitor.prototype.resolve_pattern_top = function (this: LateResolutionVisitor, pat: Pat, pat_src: PatternSource): void {
  const bindings: PatternBindings = [["Product", new KeyedMap<Ident, Res>(Ident_key)]];
  this.resolve_pattern(pat, pat_src, bindings);
  this.apply_pattern_bindings(bindings);
};

/// Apply the bindings from a pattern to the innermost rib of the current scope.
// rustc: compiler/rustc_resolve/src/late.rs:4319 apply_pattern_bindings
LateResolutionVisitor.prototype.apply_pattern_bindings = function (this: LateResolutionVisitor, pat_bindings_: PatternBindings): void {
  const rib_bindings = this.innermost_rib_bindings("ValueNS");
  const last = pat_bindings_.pop();
  if (last === undefined) {
    return bug("tried applying nonexistent bindings from pattern");
  }
  const [, pat_bindings] = last;

  if (rib_bindings.size === 0) {
    // Often, such as for match arms, the bindings are introduced into a new rib.
    // In this case, we can move the bindings over directly.
    assign_map(rib_bindings, pat_bindings);
  } else {
    extend_map(rib_bindings, pat_bindings);
  }
};

/// Resolve bindings in a pattern. `apply_pattern_bindings` must be called after to introduce
/// the bindings into scope.
// rustc: compiler/rustc_resolve/src/late.rs:4336 resolve_pattern
LateResolutionVisitor.prototype.resolve_pattern = function (
  this: LateResolutionVisitor,
  pat: Pat,
  pat_src: PatternSource,
  bindings: PatternBindings,
): void {
  // We walk the pattern before declaring the pattern's inner bindings,
  // so that we avoid resolving a literal expression to a binding defined
  // by the pattern.
  // NB: `Self::visit_pat` must be used rather than `visit::walk_pat` to avoid resolving guard
  // patterns' guard expressions multiple times (#141265).
  this.visit_pat(pat);
  this.resolve_pattern_inner(pat, pat_src, bindings);
  // This has to happen *after* we determine which pat_idents are variants:
  this.check_consistent_bindings(pat);
};

/// Resolve bindings in a pattern. This is a helper to `resolve_pattern`.
///
/// ### `bindings`
///
/// A stack of sets of bindings accumulated.
///
/// In each set, `PatBoundCtx::Product` denotes that a found binding in it should
/// be interpreted as re-binding an already bound binding. This results in an error.
/// Meanwhile, `PatBound::Or` denotes that a found binding in the set should result
/// in reusing this binding rather than creating a fresh one.
///
/// When called at the top level, the stack must have a single element
/// with `PatBound::Product`. Otherwise, pushing to the stack happens as
/// or-patterns (`p_0 | ... | p_n`) are encountered and the context needs
/// to be switched to `PatBoundCtx::Or` and then `PatBoundCtx::Product` for each `p_i`.
/// When each `p_i` has been dealt with, the top set is merged with its parent.
/// When a whole or-pattern has been dealt with, the thing happens.
///
/// See the implementation and `fresh_binding` for more details.
// #[tracing::instrument(skip(self, bindings), level = "debug")]
// rustc: compiler/rustc_resolve/src/late.rs:4373 resolve_pattern_inner
LateResolutionVisitor.prototype.resolve_pattern_inner = function (
  this: LateResolutionVisitor,
  pat: Pat,
  pat_src: PatternSource,
  bindings: PatternBindings,
): void {
  // Visit all direct subpatterns of this pattern.
  pat.walk((pat) => {
    const kind = pat.kind;
    switch (kind.$) {
      case "Ident": {
        const bmode = kind._0;
        const ident = kind._1;
        const sub = kind._2;
        // First try to resolve the identifier as some existing entity,
        // then fall back to a fresh binding.
        const has_sub = sub !== undefined;
        const res = this.try_resolve_as_non_binding(pat_src, bmode, ident, has_sub) ?? this.fresh_binding(ident, pat.id, pat_src, bindings);
        this.r.record_partial_res(pat.id, PartialRes.new(res));
        this.r.record_pat_span(pat.id, pat.span);
        break;
      }
      case "TupleStruct": {
        const qself = kind._0;
        const path = kind._1;
        const sub_patterns = kind._2;
        this.smart_resolve_path(pat.id, qself, path, {
          $: "TupleStruct",
          _0: pat.span,
          _1: this.r.arenas.alloc_pattern_spans(sub_patterns.map((p) => p.span)),
        });
        break;
      }
      case "Path": {
        const qself = kind._0;
        const path = kind._1;
        this.smart_resolve_path(pat.id, qself, path, PathSource.Pat);
        break;
      }
      case "Struct": {
        const qself = kind._0;
        const path = kind._1;
        const rest = kind._3;
        this.smart_resolve_path(pat.id, qself, path, { $: "Struct", _0: undefined });
        this.record_patterns_with_skipped_bindings(pat, rest);
        break;
      }
      case "Or": {
        const ps = kind._0;
        // Add a new set of bindings to the stack. `Or` here records that when a
        // binding already exists in this set, it should not result in an error because
        // `V1(a) | V2(a)` must be allowed and are checked for consistency later.
        bindings.push(["Or", new KeyedMap<Ident, Res>(Ident_key)]);
        for (const p of ps) {
          // Now we need to switch back to a product context so that each
          // part of the or-pattern internally rejects already bound names.
          // For example, `V1(a) | V2(a, a)` and `V1(a, a) | V2(a)` are bad.
          bindings.push(["Product", new KeyedMap<Ident, Res>(Ident_key)]);
          this.resolve_pattern_inner(p, pat_src, bindings);
          // Move up the non-overlapping bindings to the or-pattern.
          // Existing bindings just get "merged".
          const collected = unwrap(bindings.pop())[1];
          extend_map(unwrap(bindings.at(-1))[1], collected);
        }
        // This or-pattern itself can itself be part of a product,
        // e.g. `(V1(a) | V2(a), a)` or `(a, V1(a) | V2(a))`.
        // Both cases bind `a` again in a product pattern and must be rejected.
        const collected = unwrap(bindings.pop())[1];
        extend_map(unwrap(bindings.at(-1))[1], collected);

        // Prevent visiting `ps` as we've already done so above.
        return false;
      }
      case "Guard": {
        const subpat = kind._0;
        const guard = kind._1;
        // Add a new set of bindings to the stack to collect bindings in `subpat`.
        bindings.push(["Product", new KeyedMap<Ident, Res>(Ident_key)]);
        // Resolving `subpat` adds bindings onto the newly-pushed context. After, the
        // total number of contexts on the stack should be the same as before.
        const binding_ctx_stack_len = bindings.length;
        this.resolve_pattern_inner(subpat, pat_src, bindings);
        assert_eq(bindings.length, binding_ctx_stack_len, (v) => String(v));
        // These bindings, but none from the surrounding pattern, are visible in the
        // guard; put them in scope and resolve `guard`.
        const subpat_bindings = unwrap(bindings.pop())[1];
        this.with_rib("ValueNS", RibKind.Normal, (this_) => {
          assign_map(this_.innermost_rib_bindings("ValueNS"), new KeyedMap<Ident, Res>(Ident_key, subpat_bindings));
          this_.resolve_expr(guard.cond, undefined);
        });
        // Propagate the subpattern's bindings upwards.
        // FIXME(guard_patterns): For `if let` guards, we'll also need to get the
        // bindings introduced by the guard from its rib and propagate them upwards.
        // This will require checking the identifiers for overlaps with `bindings`, like
        // what `fresh_binding` does (ideally sharing its logic). To keep them separate
        // from `subpat_bindings`, we can introduce a fresh rib for the guard.
        extend_map(unwrap(bindings.at(-1))[1], subpat_bindings);
        // Prevent visiting `subpat` as we've already done so above.
        return false;
      }
      default:
        break;
    }
    return true;
  });
};

// rustc: compiler/rustc_resolve/src/late.rs:4466 record_patterns_with_skipped_bindings
LateResolutionVisitor.prototype.record_patterns_with_skipped_bindings = function (
  this: LateResolutionVisitor,
  pat: Pat,
  rest: PatFieldsRest,
): void {
  switch (rest.$) {
    case "Rest":
    case "Recovered": {
      // Record that the pattern doesn't introduce all the bindings it could.
      const partial_res = this.r.partial_res_map.get(pat.id);
      if (partial_res !== undefined) {
        const res = partial_res.full_res();
        if (res !== undefined) {
          const def_id = hir_Res.opt_def_id(res);
          if (def_id !== undefined) {
            const skipped = unwrap(this.ribs.index("ValueNS").at(-1)).patterns_with_skipped_bindings;
            let entry = skipped.get(def_id);
            if (entry === undefined) {
              entry = [];
              skipped.set(def_id, entry);
            }
            entry.push([
              pat.span,
              rest.$ === "Rest" ? rest._0 : undefined,
              rest.$ === "Recovered" ? Err(rest._0) : Ok(null),
            ]);
          }
        }
      }
      break;
    }
    case "None":
      break;
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:4497 fresh_binding
LateResolutionVisitor.prototype.fresh_binding = function (
  this: LateResolutionVisitor,
  ident_: Ident,
  pat_id: NodeId,
  pat_src: PatternSource,
  bindings: PatternBindings,
): Res {
  // Add the binding to the bindings map, if it doesn't already exist.
  // (We must not add it if it's in the bindings map because that breaks the assumptions
  // later passes make about or-patterns.)
  const ident = ident_.normalize_to_macro_rules();

  // Already bound in a product pattern? e.g. `(a, a)` which is not allowed.
  const already_bound_and = bindings.some(([ctx, map]) => ctx === "Product" && map.has(ident));
  if (already_bound_and) {
    // Overlap in a product pattern somewhere; report an error.
    // use ResolutionError::*;
    let error: ResolutionError;
    switch (pat_src) {
      // `fn f(a: u8, a: u8)`:
      case "FnParam":
        error = { $: "IdentifierBoundMoreThanOnceInParameterList", _0: ident };
        break;
      // `Variant(a, a)`:
      default:
        error = { $: "IdentifierBoundMoreThanOnceInSamePattern", _0: ident };
    }
    this.report_error(ident.span, error);
  }

  // Already bound in an or-pattern? e.g. `V1(a) | V2(a)`.
  // This is *required* for consistency which is checked later.
  let already_bound_or: Res | undefined = undefined;
  for (const [ctx, map] of bindings) {
    const found = ctx === "Or" ? map.get(ident) : undefined;
    if (found !== undefined) {
      already_bound_or = found;
      break;
    }
  }
  let res: Res;
  if (already_bound_or !== undefined) {
    // `Variant1(a) | Variant2(a)`, ok
    // Reuse definition from the first `a`.
    res = already_bound_or;
  } else {
    // A completely fresh binding is added to the map.
    res = { $: "Local", _0: pat_id };
  }

  // Record as bound.
  unwrap(bindings.at(-1))[1].set(ident, res);
  return res;
};

// rustc: compiler/rustc_resolve/src/late.rs:4544 innermost_rib_bindings
LateResolutionVisitor.prototype.innermost_rib_bindings = function (this: LateResolutionVisitor, ns: Namespace): Map<Ident, Res> {
  return unwrap(this.ribs.index(ns).at(-1)).bindings;
};

// rustc: compiler/rustc_resolve/src/late.rs:4548 try_resolve_as_non_binding
LateResolutionVisitor.prototype.try_resolve_as_non_binding = function (
  this: LateResolutionVisitor,
  pat_src: PatternSource,
  ann: BindingMode,
  ident: Ident,
  has_sub: boolean,
): Res | undefined {
  // An immutable (no `mut`) by-value (no `ref`) binding pattern without
  // a sub pattern (no `@ $pat`) is syntactically ambiguous as it could
  // also be interpreted as a path to e.g. a constant, variant, etc.
  const is_syntactic_ambiguity = !has_sub && BindingMode_eq(ann, BindingMode.NONE);

  const ls_binding = this.maybe_resolve_ident_in_lexical_scope(ident, "ValueNS");
  if (ls_binding === undefined) return undefined;
  let res: Res;
  let binding: Decl | undefined;
  if (ls_binding.$ === "Decl" && is_syntactic_ambiguity && ls_binding._0.is_ambiguity_recursive()) {
    const binding_ = ls_binding._0;
    // For ambiguous bindings we don't know all their definitions and cannot check
    // whether they can be shadowed by fresh bindings or not, so force an error.
    // issues/33118#issuecomment-233962221 (see below) still applies here,
    // but we have to ignore it for backward compatibility.
    this.r.record_use(ident, binding_, "Other");
    return undefined;
  } else if (ls_binding.$ === "Decl") {
    [res, binding] = [ls_binding._0.res(), ls_binding._0];
  } else {
    [res, binding] = [ls_binding._0, undefined];
  }

  if (
    (res.$ === "SelfCtor" || // See #70549.
      (res.$ === "Def" &&
        ((res._0.$ === "Ctor" && res._0._1 === "Const") ||
          res._0.$ === "Const" ||
          res._0.$ === "AssocConst" ||
          res._0.$ === "ConstParam"))) &&
    is_syntactic_ambiguity
  ) {
    // Disambiguate in favor of a unit struct/variant or constant pattern.
    if (binding !== undefined) {
      this.r.record_use(ident, binding, "Other");
    }
    return res;
  } else if (
    res.$ === "Def" &&
    (res._0.$ === "Ctor" || res._0.$ === "Const" || res._0.$ === "AssocConst" || res._0.$ === "Static")
  ) {
    // This is unambiguously a fresh binding, either syntactically
    // (e.g., `IDENT @ PAT` or `ref IDENT`) or because `IDENT` resolves
    // to something unusable as a pattern (e.g., constructor function),
    // but we still conservatively report an error, see
    // issues/33118#issuecomment-233962221 for one reason why.
    const binding_ = unwrap(binding, "no binding for a ctor or static");
    this.report_error(ident.span, {
      $: "BindingShadowsSomethingUnacceptable",
      shadowing_binding: pat_src,
      name: ident.name,
      participle: binding_.is_import() ? "imported" : "defined",
      article: hir_Res.article(binding_.res()),
      shadowed_binding: binding_.res(),
      shadowed_binding_span: binding_.span,
    });
    return undefined;
  } else if (res.$ === "Def" && res._0.$ === "ConstParam") {
    const def_id = res._1;
    // Same as for DefKind::Const above, but here, `binding` is `None`, so we
    // have to construct the error differently
    this.report_error(ident.span, {
      $: "BindingShadowsSomethingUnacceptable",
      shadowing_binding: pat_src,
      name: ident.name,
      participle: "defined",
      article: hir_Res.article(res),
      shadowed_binding: res,
      shadowed_binding_span: this.r.def_span(def_id),
    });
    return undefined;
  } else if ((res.$ === "Def" && (res._0.$ === "Fn" || res._0.$ === "AssocFn")) || res.$ === "Local" || res.$ === "Err") {
    // These entities are explicitly allowed to be shadowed by fresh bindings.
    return undefined;
  } else if (res.$ === "SelfCtor") {
    // We resolve `Self` in pattern position as an ident sometimes during recovery,
    // so delay a bug instead of ICEing.
    this.r.dcx().span_delayed_bug(ident.span, "unexpected `SelfCtor` in pattern, expected identifier");
    return undefined;
  } else {
    return span_bug(ident.span, `unexpected resolution for an identifier in pattern: ${debug_Res(res, PLAIN, debug_NodeId)}`);
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:4651 resolve_restriction_path
LateResolutionVisitor.prototype.resolve_restriction_path = function (this: LateResolutionVisitor, restriction: RestrictionKind): void {
  switch (restriction.$) {
    case "Unrestricted":
      break;
    case "Restricted": {
      const { path, id } = restriction;
      this.smart_resolve_path(id, undefined, path, PathSource.Module);
      break;
    }
  }
};

// High-level and context dependent path resolution routine.
// Resolves the path and records the resolution into definition map.
// If resolution fails tries several techniques to find likely
// resolution candidates, suggest imports or other help, and report
// errors in user friendly way.
// rustc: compiler/rustc_resolve/src/late.rs:4665 smart_resolve_path
LateResolutionVisitor.prototype.smart_resolve_path = function (
  this: LateResolutionVisitor,
  id: NodeId,
  qself: QSelf | undefined,
  path: Path,
  source: PathSource,
): void {
  this.smart_resolve_path_fragment(qself, Segment.from_path(path), source, Finalize.new(id, path.span), "Yes", undefined);
};

// rustc: compiler/rustc_resolve/src/late.rs:4682 smart_resolve_path_fragment
LateResolutionVisitor.prototype.smart_resolve_path_fragment = function (
  this: LateResolutionVisitor,
  qself: QSelf | undefined,
  path: readonly Segment[],
  source: PathSource,
  finalize: Finalize,
  record_partial_res: RecordPartialRes,
  parent_qself: QSelf | undefined,
): PartialRes {
  const ns = PathSource.namespace(source);

  const { node_id, path_span } = finalize;
  const report_errors = (this_: LateResolutionVisitor, res: Res | undefined): PartialRes => {
    if (this_.should_report_errs()) {
      let [err, candidates] = this_.smart_resolve_report_errors(path, undefined, path_span, source, res, parent_qself);

      const node_id = this_.parent_scope.module.nearest_parent_mod_node_id();
      const instead = res !== undefined;
      let suggestion: [Span, string, string, Applicability] | undefined;
      let const_err: Diag | undefined;
      const in_range = this_.diag_metadata.in_range;
      if (in_range !== undefined && Span.lo(unwrap(path[0]).ident.span) === Span.lo(in_range[1].span) && in_range[0].kind.$ !== "Lit") {
        const [start, end] = in_range;
        let sugg = ".";
        let span = Span.between(start.span, end.span);
        if (Span.lo(span) + 2 === Span.hi(span)) {
          // There's no space between the start, the range op and the end, suggest
          // removal which will look better.
          span = Span.with_lo(span, BytePos(Span.lo(span) + 1));
          sugg = "";
        }
        [suggestion, const_err] = [[span, "you might have meant to write `.` instead of `..`", sugg, "MaybeIncorrect"], undefined];
      } else if (res === undefined && (source.$ === "Type" || source.$ === "Expr" || source.$ === "PreciseCapturingArg")) {
        [suggestion, const_err] = this_.suggest_adding_generic_parameter(path, source);
      } else {
        [suggestion, const_err] = [undefined, undefined];
      }

      if (const_err !== undefined) {
        err.cancel();
        err = const_err;
      }

      const ue: UseError = {
        err,
        candidates,
        node_id,
        instead,
        suggestion,
        path: path.slice(),
        is_call: PathSource.is_call(source),
      };

      this_.use_injections.push(ue);
    }

    return PartialRes.new(RES_ERR);
  };

  // For paths originating from calls (like in `HashMap::new()`), tries
  // to enrich the plain `failed to resolve: ...` message with hints
  // about possible missing imports.
  //
  // Similar thing, for types, happens in `report_errors` above.
  const report_errors_for_call = (this_: LateResolutionVisitor, parent_err: Spanned<ResolutionError>): Spanned<ResolutionError> | undefined => {
    // Before we start looking for candidates, we have to get our hands
    // on the type user is trying to perform invocation on; basically:
    // we're transforming `HashMap::new` into just `HashMap`.
    let following_seg: Segment | undefined;
    let prefix_path: readonly Segment[];
    if (path.length > 0 && path.length - 1 !== 0) {
      [following_seg, prefix_path] = [path[path.length - 1], path.slice(0, path.length - 1)];
    } else {
      return parent_err;
    }

    const [err, candidates] = this_.smart_resolve_report_errors(prefix_path, following_seg, path_span, PathSource.Type, undefined, parent_qself);

    // There are two different error messages user might receive at
    // this point:
    // - E0425 cannot find type `{}` in this scope
    // - E0433 failed to resolve: use of undeclared type or module `{}`
    //
    // The first one is emitted for paths in type-position, and the
    // latter one - for paths in expression-position.
    //
    // Thus (since we're in expression-position at this point), not to
    // confuse the user, we want to keep the *message* from E0433 (so
    // `parent_err`), but we want *hints* from E0425 (so `err`).
    //
    // And that's what happens below - we're just mixing both messages
    // into a single one.
    let failed_to_resolve: boolean;
    switch (parent_err.node.$) {
      case "FailedToResolve":
        failed_to_resolve = true;
        break;
      default:
        failed_to_resolve = false;
    }
    const parent_err_ = this_.r.into_struct_error(parent_err.span, parent_err.node);

    // PORT: field access through `Diag`'s `DerefMut` is `.deref_mut()`.
    const e = err.deref_mut();
    const p = parent_err_.deref_mut();
    // overwrite all properties with the parent's error message
    e.messages = p.messages;
    p.messages = [];
    e.code = p.code;
    p.code = undefined;
    [e.span, p.span] = [p.span, e.span];
    if (failed_to_resolve) {
      e.children = p.children;
      p.children = [];
    } else {
      e.children.push(...p.children.splice(0));
    }
    e.is_lint = p.is_lint === undefined ? undefined : { ...p.is_lint };

    // merge the parent_err's suggestions with the typo (err's) suggestions
    const typo = e.suggestions;
    switch (typo.$) {
      case "Enabled": {
        const parent_suggestions = p.suggestions;
        switch (parent_suggestions.$) {
          case "Enabled":
            // If both suggestions are enabled, append parent_err's suggestions to err's suggestions.
            typo._0.push(...parent_suggestions._0.splice(0));
            break;
          case "Sealed":
          case "Disabled":
            // If the parent's suggestions are either sealed or disabled, it signifies that
            // new suggestions cannot be added or removed from the diagnostic. Therefore,
            // we assign both types of suggestions to err's suggestions and discard the
            // existing suggestions in err.
            e.suggestions = p.suggestions;
            p.suggestions = { $: "Enabled", _0: [] };
            break;
        }
        break;
      }
      case "Sealed":
      case "Disabled":
        break;
    }

    parent_err_.cancel();

    const node_id = this_.parent_scope.module.nearest_parent_mod_node_id();

    if (this_.should_report_errs()) {
      if (candidates.length === 0) {
        if (path.length === 2 && prefix_path.length === 1) {
          const segment = prefix_path[0]!;
          // Delay to check whether method name is an associated function or not
          // ```
          // let foo = Foo {};
          // foo::bar(); // possibly suggest to foo.bar();
          //```
          err.stash(segment.ident.span, StashKey.CallAssocMethod);
        } else {
          // When there is no suggested imports, we can just emit the error
          // and suggestions immediately. Note that we bypass the usually error
          // reporting routine (ie via `self.r.report_error`) because we need
          // to post-process the `ResolutionError` above.
          err.emit();
        }
      } else {
        // If there are suggested imports, the error reporting is delayed
        this_.use_injections.push({
          err,
          candidates,
          node_id,
          instead: false,
          suggestion: undefined,
          path: prefix_path.slice(),
          is_call: PathSource.is_call(source),
        });
      }
    } else {
      err.cancel();
    }

    // We don't return `Some(parent_err)` here, because the error will
    // be already printed either immediately or as part of the `use` injections
    return undefined;
  };

  let partial_res: PartialRes;
  const r = this.resolve_qpath_anywhere(qself, path, ns, PathSource.defer_to_typeck(source), finalize, source);
  const full = r.$ === "Ok" && r._0 !== undefined ? r._0.full_res() : undefined;
  if (r.$ === "Ok" && r._0 !== undefined && full !== undefined) {
    const partial_res_ = r._0;
    const res = full;
    // If we also have an associated type that matches the ident, record that.
    const items = this.diag_metadata.current_trait_assoc_items;
    if (
      items !== undefined &&
      path.length === 1 &&
      items.some((item) => {
        if (item.kind.$ === "Type" && item.kind._0.ident.eq(path[0]!.ident)) {
          return true;
        } else {
          return false;
        }
      })
    ) {
      this.r.paths_matching_assoc_types.add(Span.with_parent(path_span, undefined));
    }

    if (PathSource.is_expected(source, res) || res.$ === "Err") {
      partial_res = partial_res_;
    } else {
      partial_res = report_errors(this, res);
    }
  } else if (r.$ === "Ok" && r._0 !== undefined && PathSource.defer_to_typeck(source)) {
    const partial_res_ = r._0;
    // Not fully resolved associated item `T::A::B` or `<T as Tr>::A::B`
    // or `<T>::A::B`. If `B` should be resolved in value namespace then
    // it needs to be added to the trait map.
    if (ns === "ValueNS") {
      const item_name = unwrap(path.at(-1)).ident;
      this.record_traits_in_scope(node_id, item_name);
    }

    if (PrimTy_from_name(unwrap(path[0]).ident.name) !== undefined) {
      const std_path: Segment[] = [];

      std_path.push(Segment.from_ident(Ident.with_dummy_span(sym.std)));
      std_path.push(...path);
      const pr = this.resolve_path(std_path, ns, undefined, source);
      if (pr.$ === "Module" || pr.$ === "NonModule") {
        // Check if we wrote `str::from_utf8` instead of `std::str::from_utf8`
        const last = path.at(-1);
        const item_span = last === undefined ? path_span : last.ident.span;

        this.r.confused_type_with_std_module.set(item_span, path_span);
        this.r.confused_type_with_std_module.set(path_span, path_span);
      }
    }

    partial_res = partial_res_;
  } else if (r.$ === "Err") {
    const err = report_errors_for_call(this, r._0);
    if (err !== undefined) {
      this.report_error(err.span, err.node);
    }

    partial_res = PartialRes.new(RES_ERR);
  } else {
    partial_res = report_errors(this, undefined);
  }

  if (record_partial_res === "Yes") {
    // Avoid recording definition of `A::B` in `<T as A>::B::C`.
    this.r.record_partial_res(node_id, partial_res);
    this.resolve_elided_lifetimes_in_path(partial_res, path, source, path_span);
    this.lint_unused_qualifications(path, ns, finalize);
  }

  return partial_res;
};

// rustc: compiler/rustc_resolve/src/late.rs:4957 self_type_is_available
LateResolutionVisitor.prototype.self_type_is_available = function (this: LateResolutionVisitor): boolean {
  const binding = this.maybe_resolve_ident_in_lexical_scope(Ident.with_dummy_span(kw.SelfUpper), "TypeNS");
  if (binding !== undefined && binding.$ === "RibDef") {
    return binding._0.$ !== "Err";
  } else {
    return false;
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:4963 self_value_is_available
LateResolutionVisitor.prototype.self_value_is_available = function (this: LateResolutionVisitor, self_span: Span): boolean {
  const ident = Ident.new(kw.SelfLower, self_span);
  const binding = this.maybe_resolve_ident_in_lexical_scope(ident, "ValueNS");
  if (binding !== undefined && binding.$ === "RibDef") {
    return binding._0.$ !== "Err";
  } else {
    return false;
  }
};

/// A wrapper around [`Resolver::report_error`].
///
/// This doesn't emit errors for function bodies if this is rustdoc.
// rustc: compiler/rustc_resolve/src/late.rs:4972 report_error
LateResolutionVisitor.prototype.report_error = function (this: LateResolutionVisitor, span: Span, resolution_error: ResolutionError): void {
  if (this.should_report_errs()) {
    this.r.report_error(span, resolution_error);
  }
};

// #[inline]
/// If we're actually rustdoc then avoid giving a name resolution error for `cfg()` items or
// an invalid `use foo::*;` was found, which can cause unbounded amounts of "item not found"
// errors. We silence them all.
// rustc: compiler/rustc_resolve/src/late.rs:4982 should_report_errs
LateResolutionVisitor.prototype.should_report_errs = function (this: LateResolutionVisitor): boolean {
  return !(this.r.tcx_.sess.opts.actually_rustdoc && this.in_func_body) && !(this.r.glob_error !== undefined);
};

// Resolve in alternative namespaces if resolution in the primary namespace fails.
// rustc: compiler/rustc_resolve/src/late.rs:4988 resolve_qpath_anywhere
LateResolutionVisitor.prototype.resolve_qpath_anywhere = function (
  this: LateResolutionVisitor,
  qself: QSelf | undefined,
  path: readonly Segment[],
  primary_ns: Namespace,
  defer_to_typeck: boolean,
  finalize: Finalize,
  source: PathSource,
): Result<PartialRes | undefined, Spanned<ResolutionError>> {
  let fin_res: PartialRes | undefined = undefined;

  const nss: readonly Namespace[] = [primary_ns, "TypeNS", "ValueNS"];
  for (let i = 0; i < nss.length; i++) {
    const ns = nss[i]!;
    if (i === 0 || ns !== primary_ns) {
      const r = this.resolve_qpath(qself, path, ns, finalize, source);
      if (r.$ === "Err") return r;
      const partial_res = r._0;
      if (partial_res !== undefined && (partial_res.unresolved_segments() === 0 || defer_to_typeck)) {
        return Ok(partial_res);
      } else {
        if (fin_res === undefined) {
          fin_res = partial_res;
        }
      }
    }
  }

  assert(primary_ns !== "MacroNS", "assertion failed: primary_ns != MacroNS");
  if (qself === undefined) {
    const pr = this.r.cm().maybe_resolve_path(path, "MacroNS", this.parent_scope, undefined);
    if (pr.$ === "NonModule") {
      return Ok(pr._0);
    }
  }

  return Ok(fin_res);
};

/// Handles paths that may refer to associated items.
// rustc: compiler/rustc_resolve/src/late.rs:5028 resolve_qpath
LateResolutionVisitor.prototype.resolve_qpath = function (
  this: LateResolutionVisitor,
  qself: QSelf | undefined,
  path: readonly Segment[],
  ns: Namespace,
  finalize: Finalize,
  source: PathSource,
): Result<PartialRes | undefined, Spanned<ResolutionError>> {
  // debug!(
  //     "resolve_qpath(qself={:?}, path={:?}, ns={:?}, finalize={:?})",
  //     qself, path, ns, finalize,
  // );

  if (qself !== undefined) {
    if (qself.position === 0) {
      // This is a case like `<T>::B`, where there is no
      // trait to resolve. In that case, we leave the `B`
      // segment to be resolved by type-check.
      return Ok(PartialRes.with_unresolved_segments({ $: "Def", _0: DefKind.Mod, _1: LocalDefId.to_def_id(CRATE_DEF_ID) }, path.length));
    }

    const num_privacy_errors = this.r.privacy_errors.length;
    // Make sure that `A` in `<T as A>::B::C` is a trait.
    const trait_res = this.smart_resolve_path_fragment(
      undefined,
      path.slice(0, qself.position),
      { $: "Trait", _0: "No" },
      Finalize.new(finalize.node_id, qself.path_span),
      "No",
      qself,
    );

    if (trait_res.expect_full_res().$ === "Err") {
      return Ok(trait_res);
    }

    // Truncate additional privacy errors reported above,
    // because they'll be recomputed below.
    if (this.r.privacy_errors.length > num_privacy_errors) this.r.privacy_errors.length = num_privacy_errors;

    // Make sure `A::B` in `<T as A>::B::C` is a trait item.
    //
    // Currently, `path` names the full item (`A::B::C`, in
    // our example). so we extract the prefix of that that is
    // the trait (the slice upto and including
    // `qself.position`). And then we recursively resolve that,
    // but with `qself` set to `None`.
    const ns_ = qself.position + 1 === path.length ? ns : "TypeNS";
    const partial_res = this.smart_resolve_path_fragment(
      undefined,
      path.slice(0, qself.position + 1),
      { $: "TraitItem", _0: ns_, _1: source },
      Finalize.with_root_span(finalize.node_id, finalize.path_span, qself.path_span),
      "No",
      qself,
    );

    // The remaining segments (the `C` in our example) will
    // have to be resolved by type-check, since that requires doing
    // trait resolution.
    return Ok(
      PartialRes.with_unresolved_segments(partial_res.base_res(), partial_res.unresolved_segments() + path.length - qself.position - 1),
    );
  }

  let result: PartialRes;
  const pr = this.resolve_path(path, ns, finalize, source);
  if (pr.$ === "NonModule") {
    const path_res = pr._0;
    result = path_res;
  } else if (pr.$ === "Module" && pr._0.$ === "Module" && !pr._0._0.is_normal()) {
    const module = pr._0._0;
    result = PartialRes.new(unwrap(module.res()));
  }
  // A part of this path references a `mod` that had a parse error. To avoid resolution
  // errors for each reference to that module, we don't emit an error for them until the
  // `mod` is fixed. this can have a significant cascade effect.
  else if (pr.$ === "Failed" && pr.error_implied_by_parse_error) {
    result = PartialRes.new(RES_ERR);
  }
  // In `a(::assoc_item)*` `a` cannot be a module. If `a` does resolve to a module we
  // don't report an error right away, but try to fallback to a primitive type.
  // So, we are still able to successfully resolve something like
  //
  // use std::u8; // bring module u8 in scope
  // fn f() -> u8 { // OK, resolves to primitive u8, not to std::u8
  //     u8::max_value() // OK, resolves to associated function <u8>::max_value,
  //                     // not to nonexistent std::u8::max_value
  // }
  //
  // Such behavior is required for backward compatibility.
  // The same fallback is used when `a` resolves to nothing.
  else if (
    ((pr.$ === "Module" && pr._0.$ === "Module") || pr.$ === "Failed") &&
    (ns === "TypeNS" || path.length > 1) &&
    PrimTy_from_name(unwrap(path[0]).ident.name) !== undefined
  ) {
    const prim = unwrap(PrimTy_from_name(unwrap(path[0]).ident.name));
    const tcx = this.r.tcx();

    let gate_err_sym_msg: [Symbol, string] | undefined;
    if (prim.$ === "Float" && prim._0 === "F16" && !this.r.features.f16()) {
      gate_err_sym_msg = [sym.f16, "the type `f16` is unstable"];
    } else if (prim.$ === "Float" && prim._0 === "F128" && !this.r.features.f128()) {
      gate_err_sym_msg = [sym.f128, "the type `f128` is unstable"];
    } else {
      gate_err_sym_msg = undefined;
    }

    if (gate_err_sym_msg !== undefined) {
      const [sym_, msg] = gate_err_sym_msg;
      const span = path[0]!.ident.span;
      if (!Span.allows_unstable(span, sym_)) {
        feature_err(tcx.sess, sym_, span, msg).emit();
      }
    }

    // Fix up partial res of segment from `resolve_path` call.
    const id = path[0]!.id;
    if (id !== undefined) {
      this.r.partial_res_map.set(id, PartialRes.new({ $: "PrimTy", _0: prim }));
    }

    result = PartialRes.with_unresolved_segments({ $: "PrimTy", _0: prim }, path.length - 1);
  } else if (pr.$ === "Module" && pr._0.$ === "Module") {
    const module = pr._0._0;
    result = PartialRes.new(unwrap(module.res()));
  } else if (pr.$ === "Failed" && !pr.is_error_from_last_segment) {
    const { span, label, suggestion, help, module, segment, message } = pr;
    return Err(
      respan(span, {
        $: "FailedToResolve",
        segment: segment.name,
        label,
        suggestion,
        help,
        module,
        message,
      } satisfies ResolutionError as ResolutionError),
    );
  } else if (pr.$ === "Module" || pr.$ === "Failed") {
    return Ok(undefined);
  } else {
    return bug("indeterminate path result in resolve_qpath");
  }

  return Ok(result);
};

// rustc: compiler/rustc_resolve/src/late.rs:5185 with_resolved_label
LateResolutionVisitor.prototype.with_resolved_label = function (
  this: LateResolutionVisitor,
  label: Label | undefined,
  id: NodeId,
  f: (this_: LateResolutionVisitor) => void,
): void {
  if (label !== undefined) {
    if (utf8(label.ident.as_str())[1] !== 0x5f /* b'_' */) {
      this.diag_metadata.unused_labels.set(id, label.ident.span);
    }

    const r = this.resolve_label(label.ident);
    if (r.$ === "Ok") {
      const [, orig_span] = r._0;
      late_diagnostics.signal_label_shadowing(this.r.tcx_.sess, orig_span, label.ident);
    }

    this.with_label_rib(RibKind.Normal, (this_) => {
      const ident = label.ident.normalize_to_macro_rules();
      unwrap(this_.label_ribs.at(-1)).bindings.set(ident, id);
      f(this_);
    });
  } else {
    f(this);
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:5205 resolve_labeled_block
LateResolutionVisitor.prototype.resolve_labeled_block = function (this: LateResolutionVisitor, label: Label | undefined, id: NodeId, block: Block): void {
  this.with_resolved_label(label, id, (this_) => this_.visit_block(block));
};

// rustc: compiler/rustc_resolve/src/late.rs:5209 resolve_block
LateResolutionVisitor.prototype.resolve_block = function (this: LateResolutionVisitor, block: Block): void {
  // debug!("(resolving block) entering block");
  // Move down in the graph, if there's an anonymous module rooted here.
  const orig_module = this.parent_scope.module;
  const anonymous_module = this.r.block_map.get(block.id);

  let num_macro_definition_ribs = 0;
  if (anonymous_module !== undefined) {
    // debug!("(resolving block) found anonymous module, moving down");
    this.ribs.index("ValueNS").push(Rib.new<Res>({ $: "Block", _0: anonymous_module }));
    this.ribs.index("TypeNS").push(Rib.new<Res>({ $: "Block", _0: anonymous_module }));
    this.parent_scope.module = anonymous_module.to_module();
  } else {
    this.ribs.index("ValueNS").push(Rib.new<Res>({ $: "Block", _0: undefined }));
  }

  // Descend into the block.
  for (const stmt of block.stmts) {
    if (stmt.kind.$ === "Item" && stmt.kind._0.kind.$ === "MacroDef") {
      const item = stmt.kind._0;
      num_macro_definition_ribs += 1;
      const res = LocalDefId.to_def_id(this.r.owner_def_id(item.id));
      this.ribs.index("ValueNS").push(Rib.new<Res>({ $: "MacroDefinition", _0: res }));
      this.label_ribs.push(Rib.new<NodeId>({ $: "MacroDefinition", _0: res }));
    }

    this.visit_stmt(stmt);
  }

  // Move back up.
  this.parent_scope.module = orig_module;
  for (let i = 0; i < num_macro_definition_ribs; i++) {
    this.ribs.index("ValueNS").pop();
    this.label_ribs.pop();
  }
  this.last_block_rib = this.ribs.index("ValueNS").pop();
  if (anonymous_module !== undefined) {
    this.ribs.index("TypeNS").pop();
  }
  // debug!("(resolving block) leaving block");
};

// rustc: compiler/rustc_resolve/src/late.rs:5252 resolve_anon_const
LateResolutionVisitor.prototype.resolve_anon_const = function (this: LateResolutionVisitor, constant: AnonConst, anon_const_kind: AnonConstKind): void {
  // debug!(
  //     "resolve_anon_const(constant: {:?}, anon_const_kind: {:?})",
  //     constant, anon_const_kind
  // );

  const is_trivial_const_arg = constant.value.is_potential_trivial_const_arg();
  this.resolve_anon_const_manual(is_trivial_const_arg, anon_const_kind, (this_) => this_.resolve_expr(constant.value, undefined));
};

/// There are a few places that we need to resolve an anon const but we did not parse an
/// anon const so cannot provide an `&'ast AnonConst`. Right now this is just unbraced
/// const arguments that were parsed as type arguments, and `legacy_const_generics` which
/// parse as normal function argument expressions. To avoid duplicating the code for resolving
/// an anon const we have this function which lets the caller manually call `resolve_expr` or
/// `smart_resolve_path`.
// rustc: compiler/rustc_resolve/src/late.rs:5270 resolve_anon_const_manual
LateResolutionVisitor.prototype.resolve_anon_const_manual = function (
  this: LateResolutionVisitor,
  is_trivial_const_arg: boolean,
  anon_const_kind: AnonConstKind,
  resolve_expr: (this_: LateResolutionVisitor) => void,
): void {
  let is_repeat_expr: IsRepeatExpr;
  switch (anon_const_kind.$) {
    case "ConstArg":
      is_repeat_expr = anon_const_kind._0;
      break;
    default:
      is_repeat_expr = "No";
  }

  let may_use_generics: ConstantHasGenerics;
  switch (anon_const_kind.$) {
    case "EnumDiscriminant":
      may_use_generics = { $: "No", _0: "IsEnumDiscriminant" };
      break;
    case "FieldDefaultValue":
      may_use_generics = ConstantHasGenerics.Yes;
      break;
    case "InlineConst":
      may_use_generics = ConstantHasGenerics.Yes;
      break;
    case "ConstArg":
    case "ArrayLength": {
      if (this.r.features.generic_const_exprs() || this.r.features.gca() || is_trivial_const_arg) {
        may_use_generics = ConstantHasGenerics.Yes;
      } else {
        may_use_generics = { $: "No", _0: "NonTrivialConstArg" };
      }
      break;
    }
  }

  let requires_type: ConstantRequiresType;
  if (anon_const_kind.$ === "ArrayLength" || (anon_const_kind.$ === "ConstArg" && anon_const_kind._0 === "Yes")) {
    requires_type = "Usize";
  } else {
    requires_type = "No";
  }

  this.with_constant_rib(is_repeat_expr, may_use_generics, requires_type, undefined, (this_) => {
    this_.with_lifetime_rib(LifetimeRibKind.elided({ $: "Infer" }), (this_) => {
      resolve_expr(this_);
    });
  });
};

// rustc: compiler/rustc_resolve/src/late.rs:5313 resolve_expr_field
LateResolutionVisitor.prototype.resolve_expr_field = function (this: LateResolutionVisitor, f: ExprField, e: Expr): void {
  this.resolve_expr(f.expr, e);
  this.visit_ident(f.ident);
  for (const attr of f.attrs) this.visit_attribute(attr);
};

// rustc: compiler/rustc_resolve/src/late.rs:5319 resolve_expr
LateResolutionVisitor.prototype.resolve_expr = function (this: LateResolutionVisitor, expr: Expr, parent: Expr | undefined): void {
  // First, record candidate traits for this expression if it could
  // result in the invocation of a method call.

  this.record_candidate_traits_for_expr_if_necessary(expr);

  // Next, resolve the node.
  const kind = expr.kind;
  if (kind.$ === "Path") {
    const qself = kind._0;
    const path = kind._1;
    this.smart_resolve_path(expr.id, qself, path, { $: "Expr", _0: parent });
    walk_expr(this, expr);
  } else if (kind.$ === "Struct") {
    const se = kind._0;
    this.smart_resolve_path(expr.id, se.qself, se.path, { $: "Struct", _0: parent });
    // This is the same as `visit::walk_expr(self, expr);`, but we want to pass the
    // parent in for accurate suggestions when encountering `Foo { bar }` that should
    // have been `Foo { bar: self.bar }`.
    if (se.qself !== undefined) {
      this.visit_ty(se.qself.ty);
    }
    this.visit_path(se.path);
    for (const field of se.fields) this.resolve_expr_field(field, expr);
    switch (se.rest.$) {
      case "Base":
        this.visit_expr(se.rest._0);
        break;
      case "Rest":
        break;
      case "None":
      case "NoneWithError":
        break;
    }
  } else if ((kind.$ === "Break" && kind._0 !== undefined) || (kind.$ === "Continue" && kind._0 !== undefined)) {
    const label = kind._0!;
    const r = this.resolve_label(label.ident);
    if (r.$ === "Ok") {
      const [node_id] = r._0;
      // Since this res is a label, it is never read.
      this.r.current_owner.label_res_map.set(expr.id, node_id);
      index_map_swap_remove(this.diag_metadata.unused_labels, node_id);
    } else {
      const error = r._0;
      this.report_error(label.ident.span, error);
    }

    // visit `break` argument if any
    walk_expr(this, expr);
  } else if (kind.$ === "Break" && kind._0 === undefined && kind._1 !== undefined) {
    const e = kind._1;
    // We use this instead of `visit::walk_expr` to keep the parent expr around for
    // better diagnostics.
    this.resolve_expr(e, expr);
  } else if (kind.$ === "Let" && kind._3.$ === "No") {
    const pat = kind._0;
    const scrutinee = kind._1;
    this.visit_expr(scrutinee);
    this.resolve_pattern_top(pat, "Let");
  } else if (kind.$ === "Let" && kind._3.$ === "Yes") {
    const pat = kind._0;
    const scrutinee = kind._1;
    this.visit_expr(scrutinee);
    // This is basically a tweaked, inlined `resolve_pattern_top`.
    const bindings: PatternBindings = [["Product", new KeyedMap<Ident, Res>(Ident_key)]];
    this.resolve_pattern(pat, "Let", bindings);
    // We still collect the bindings in this `let` expression which is in
    // an invalid position (and therefore shouldn't declare variables into
    // its parent scope). To avoid unnecessary errors though, we do just
    // reassign the resolutions to `Res::Err`.
    for (const [, bindings_] of bindings) {
      for (const binding of [...bindings_.keys()]) {
        bindings_.set(binding, RES_ERR);
      }
    }
    this.apply_pattern_bindings(bindings);
  } else if (kind.$ === "If") {
    const cond = kind._0;
    const then = kind._1;
    const opt_else = kind._2;
    this.with_rib("ValueNS", RibKind.Normal, (this_) => {
      const old = this_.diag_metadata.in_if_condition;
      this_.diag_metadata.in_if_condition = cond;
      this_.visit_expr(cond);
      this_.diag_metadata.in_if_condition = old;
      this_.visit_block(then);
    });
    if (opt_else !== undefined) {
      this.visit_expr(opt_else);
    }
  } else if (kind.$ === "Loop") {
    const block = kind._0;
    const label = kind._1;
    this.resolve_labeled_block(label, expr.id, block);
  } else if (kind.$ === "While") {
    const cond = kind._0;
    const block = kind._1;
    const label = kind._2;
    this.with_resolved_label(label, expr.id, (this_) => {
      this_.with_rib("ValueNS", RibKind.Normal, (this_) => {
        const old = this_.diag_metadata.in_if_condition;
        this_.diag_metadata.in_if_condition = cond;
        this_.visit_expr(cond);
        this_.diag_metadata.in_if_condition = old;
        this_.visit_block(block);
      });
    });
  } else if (kind.$ === "ForLoop") {
    const { pat, iter, body, label } = kind._0;
    this.visit_expr(iter);
    this.with_rib("ValueNS", RibKind.Normal, (this_) => {
      this_.resolve_pattern_top(pat, "For");
      this_.resolve_labeled_block(label, expr.id, body);
    });
  } else if (kind.$ === "Block") {
    const block = kind._0;
    const label = kind._1;
    this.resolve_labeled_block(label, block.id, block);
  }
  // Equivalent to `visit::walk_expr` + passing some context to children.
  else if (kind.$ === "Field") {
    const subexpression = kind._0;
    this.resolve_expr(subexpression, expr);
  } else if (kind.$ === "MethodCall") {
    const { seg, receiver, args } = kind._0;
    this.resolve_expr(receiver, expr);
    for (const arg of args) {
      this.resolve_expr(arg, undefined);
    }
    this.visit_path_segment(seg);
  } else if (kind.$ === "Call") {
    const callee = kind._0;
    const arguments_ = kind._1;
    this.resolve_expr(callee, expr);
    const const_args = this.r.legacy_const_generic_args(callee) ?? [];
    for (let idx = 0; idx < arguments_.length; idx++) {
      const argument = arguments_[idx]!;
      // Constant arguments need to be treated as AnonConst since
      // that is how they will be later lowered to HIR.
      if (const_args.includes(idx)) {
        // FIXME(mgca): legacy const generics doesn't support mgca but maybe
        // that's okay.
        const is_trivial_const_arg = argument.is_potential_trivial_const_arg();
        this.resolve_anon_const_manual(is_trivial_const_arg, { $: "ConstArg", _0: "No" }, (this_) => this_.resolve_expr(argument, undefined));
      } else {
        this.resolve_expr(argument, undefined);
      }
    }
  } else if (kind.$ === "FormatArgs") {
    const args = kind._0;
    for (const arg of args.arguments.all_args()) {
      // Keep the format context so recovery can add a named argument instead.
      const parent = arg.kind.$ === "Captured" ? expr : undefined;
      this.resolve_expr(arg.expr, parent);
    }
  } else if (kind.$ === "Type") {
    walk_expr(this, expr);
  }
  // For closures, RibKind::FnOrCoroutine is added in visit_fn
  else if (kind.$ === "Closure" && kind._0.binder.$ === "For") {
    const { generic_params, span } = kind._0.binder;
    this.with_generic_param_rib(generic_params, RibKind.Normal, expr.id, "Closure", span, (this_) => {
      walk_expr(this_, expr);
    });
  } else if (kind.$ === "Closure") {
    walk_expr(this, expr);
  } else if (kind.$ === "Gen") {
    this.with_label_rib(RibKind.FnOrCoroutine, (this_) => {
      walk_expr(this_, expr);
    });
  } else if (kind.$ === "Repeat") {
    const elem = kind._0;
    const ct = kind._1;
    this.visit_expr(elem);
    this.resolve_anon_const(ct, { $: "ConstArg", _0: "Yes" });
  } else if (kind.$ === "ConstBlock") {
    const ct = kind._0;
    this.resolve_anon_const(ct, AnonConstKind.InlineConst);
  } else if (kind.$ === "Index") {
    const elem = kind._0;
    const idx = kind._1;
    this.resolve_expr(elem, expr);
    this.visit_expr(idx);
  } else if (kind.$ === "Assign") {
    const lhs = kind._0;
    const rhs = kind._1;
    if (!this.diag_metadata.is_assign_rhs) {
      this.diag_metadata.in_assignment = expr;
    }
    this.visit_expr(lhs);
    this.diag_metadata.is_assign_rhs = true;
    this.diag_metadata.in_assignment = undefined;
    this.visit_expr(rhs);
    this.diag_metadata.is_assign_rhs = false;
  } else if (kind.$ === "Range" && kind._0 !== undefined && kind._1 !== undefined && kind._2 === "HalfOpen") {
    const start = kind._0;
    const end = kind._1;
    this.diag_metadata.in_range = [start, end];
    this.resolve_expr(start, expr);
    this.resolve_expr(end, expr);
    this.diag_metadata.in_range = undefined;
  } else {
    walk_expr(this, expr);
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:5524 record_candidate_traits_for_expr_if_necessary
LateResolutionVisitor.prototype.record_candidate_traits_for_expr_if_necessary = function (this: LateResolutionVisitor, expr: Expr): void {
  const kind = expr.kind;
  switch (kind.$) {
    case "Field": {
      const ident = kind._1;
      // #6890: Even though you can't treat a method like a field,
      // we need to add any trait methods we find that match the
      // field name so that we can do some nice error reporting
      // later on in typeck.
      this.record_traits_in_scope(expr.id, ident);
      break;
    }
    case "MethodCall": {
      const call = kind._0;
      // debug!("(recording candidate traits for expr) recording traits for {}", expr.id);
      this.record_traits_in_scope(expr.id, call.seg.ident);
      break;
    }
    default: {
      // Nothing to do.
    }
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:5543 record_traits_in_scope
LateResolutionVisitor.prototype.record_traits_in_scope = function (this: LateResolutionVisitor, node_id: NodeId, ident: Ident): void {
  const traits = this.r.traits_in_scope(
    this.current_trait_ref === undefined ? undefined : this.current_trait_ref[0],
    this.parent_scope,
    ident.span,
    [ident.name, "ValueNS"],
  );
  this.r.current_owner.trait_map.set(node_id, traits);
};

// rustc: compiler/rustc_resolve/src/late.rs:5553 resolve_and_cache_rustdoc_path
LateResolutionVisitor.prototype.resolve_and_cache_rustdoc_path = function (this: LateResolutionVisitor, path_str: string, ns: Namespace): Res | undefined {
  // FIXME: This caching may be incorrect in case of multiple `macro_rules`
  // items with the same name in the same module.
  // Also hygiene is not considered.
  const doc_link_resolutions = this.r.doc_link_resolutions;
  this.r.doc_link_resolutions = new Map();
  const module_key = this.parent_scope.module.nearest_parent_mod().expect_local();
  let module_map = doc_link_resolutions.get(module_key);
  if (module_map === undefined) {
    module_map = new Map();
    doc_link_resolutions.set(module_key, module_map);
  }
  const key: [Symbol, Namespace] = [Symbol.intern(path_str), ns];
  let entry = module_map.get(DocLinkResMap_key(key));
  if (entry === undefined) {
    // `.or_insert_with_key(|(path, ns)| ..)`
    const [path, ns_] = key;
    const value = ((): Res | undefined => {
      const res = this.r.resolve_rustdoc_path(Symbol.as_str(path), ns_, this.parent_scope);
      if (res !== undefined) {
        const def_id = hir_Res.opt_def_id(res);
        if (def_id !== undefined && this.is_invalid_proc_macro_item_for_doc(def_id)) {
          // Encoding def ids in proc macro crate metadata will ICE,
          // because it will only store proc macros for it.
          return undefined;
        }
      }
      return res;
    })();
    entry = [key, value];
    module_map.set(DocLinkResMap_key(key), entry);
  }
  const res = entry[1];
  this.r.doc_link_resolutions = doc_link_resolutions;
  return res;
};

// rustc: compiler/rustc_resolve/src/late.rs:5578 is_invalid_proc_macro_item_for_doc
LateResolutionVisitor.prototype.is_invalid_proc_macro_item_for_doc = function (this: LateResolutionVisitor, did: DefId): boolean {
  if (this.r.tcx_.sess.opts.resolve_doc_links !== "ExportedMetadata" || !this.r.tcx_.crate_types().includes("ProcMacro")) {
    return false;
  }
  const local_did = did.as_local();
  if (local_did === undefined) return true;
  return !this.r.proc_macros.includes(local_did);
};

// rustc: compiler/rustc_resolve/src/late.rs:5588 resolve_doc_links
LateResolutionVisitor.prototype.resolve_doc_links = function (this: LateResolutionVisitor, attrs: readonly Attribute[], maybe_exported: MaybeExported): void {
  const resolve_doc_links = this.r.tcx_.sess.opts.resolve_doc_links;
  if (resolve_doc_links === "None") {
    return;
  } else if (
    resolve_doc_links === "ExportedMetadata" &&
    (!this.r.tcx_.crate_types().some((ct) => CrateType.has_metadata(ct)) || !MaybeExported.eval(maybe_exported, this.r))
  ) {
    return;
  } else if (
    resolve_doc_links === "Exported" &&
    !MaybeExported.eval(maybe_exported, this.r) &&
    !rustdoc.has_primitive_or_keyword_or_attribute_docs(attrs, ast_attr.AttributeExt.Attribute)
  ) {
    return;
  } else {
    // ResolveDocLinks::ExportedMetadata | ResolveDocLinks::Exported | ResolveDocLinks::All => {}
  }

  if (!attrs.some((attr) => attr.may_have_doc_links())) {
    return;
  }

  let need_traits_in_scope = false;
  for (const path_str of rustdoc.attrs_to_preprocessed_links(attrs)) {
    // Resolve all namespaces due to no disambiguator or for diagnostics.
    let any_resolved = false;
    let need_assoc = false;
    for (const ns of ["TypeNS", "ValueNS", "MacroNS"] as const) {
      const res = this.resolve_and_cache_rustdoc_path(path_str, ns);
      if (res !== undefined) {
        // Rustdoc ignores tool attribute resolutions and attempts
        // to resolve their prefixes for diagnostics.
        any_resolved = !(res.$ === "NonMacroAttr" && res._0.$ === "Tool");
      } else if (ns !== "MacroNS") {
        need_assoc = true;
      }
    }

    // Resolve all prefixes for type-relative resolution or for diagnostics.
    if (need_assoc || !any_resolved) {
      let path = path_str;
      let idx: number;
      while ((idx = path.lastIndexOf("::")) !== -1) {
        path = path.slice(0, idx);
        need_traits_in_scope = true;
        for (const ns of ["TypeNS", "ValueNS", "MacroNS"] as const) {
          this.resolve_and_cache_rustdoc_path(path, ns);
        }
      }
    }
  }

  if (need_traits_in_scope) {
    // FIXME: hygiene is not considered.
    const doc_link_traits_in_scope = this.r.doc_link_traits_in_scope;
    this.r.doc_link_traits_in_scope = new Map();
    const module_key = this.parent_scope.module.nearest_parent_mod().expect_local();
    if (!doc_link_traits_in_scope.has(module_key)) {
      doc_link_traits_in_scope.set(
        module_key,
        this.r.traits_in_scope(undefined, this.parent_scope, DUMMY_SP, undefined).flatMap((tr): DefId[] => {
          if (this.is_invalid_proc_macro_item_for_doc(tr.def_id)) {
            // Encoding def ids in proc macro crate metadata will ICE.
            // because it will only store proc macros for it.
            return [];
          }
          return [tr.def_id];
        }),
      );
    }
    this.r.doc_link_traits_in_scope = doc_link_traits_in_scope;
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:5663 lint_unused_qualifications
LateResolutionVisitor.prototype.lint_unused_qualifications = function (
  this: LateResolutionVisitor,
  path: readonly Segment[],
  ns: Namespace,
  finalize: Finalize,
): void {
  // Don't lint on global paths because the user explicitly wrote out the full path.
  const seg0 = path[0];
  if (seg0 !== undefined && seg0.ident.name === kw.PathRoot) {
    return;
  }

  if (Span.from_expansion(finalize.path_span) || path.some((seg) => Span.from_expansion(seg.ident.span))) {
    return;
  }

  const pos = path.findIndex((seg) => seg.has_generic_args);
  const end_pos = pos === -1 ? path.length : pos + 1;
  // `path[..end_pos].iter().enumerate().skip(1).rev().find_map(..)`
  let unqualified: [Segment, LateDecl] | undefined = undefined;
  for (let i = end_pos - 1; i >= 1; i--) {
    const seg = path[i]!;
    const found = ((): [Segment, LateDecl] | undefined => {
      // Preserve the current namespace for the final path segment, but use the type
      // namespace for all preceding segments
      //
      // e.g. for `std::env::args` check the `ValueNS` for `args` but the `TypeNS` for
      // `std` and `env`
      //
      // If the final path segment is beyond `end_pos` all the segments to check will
      // use the type namespace
      const ns_ = i + 1 === path.length ? ns : "TypeNS";
      if (seg.id === undefined) return undefined;
      const partial_res = this.r.partial_res_map.get(seg.id);
      if (partial_res === undefined) return undefined;
      const res = partial_res.full_res();
      if (res === undefined) return undefined;
      const binding = this.resolve_ident_in_lexical_scope(seg.ident, ns_, undefined, undefined);
      if (binding === undefined) return undefined;
      return Res_eq(res, LateDecl.res(binding)) ? [seg, binding] : undefined;
    })();
    if (found !== undefined) {
      unqualified = found;
      break;
    }
  }

  if (unqualified !== undefined) {
    const [seg, decl] = unqualified;
    this.r.potentially_unnecessary_qualifications.push({
      decl,
      node_id: finalize.node_id,
      path_span: finalize.path_span,
      removal_span: Span.until(unwrap(path[0]).ident.span, seg.ident.span),
    });
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:5704 resolve_define_opaques
LateResolutionVisitor.prototype.resolve_define_opaques = function (this: LateResolutionVisitor, define_opaque: [NodeId, Path][] | undefined): void {
  if (define_opaque !== undefined) {
    for (const [id, path] of define_opaque) {
      this.smart_resolve_path(id, undefined, path, PathSource.DefineOpaques);
    }
  }
};

// rustc: compiler/rustc_resolve/src/late.rs:5712 resolve_eii
LateResolutionVisitor.prototype.resolve_eii = function (this: LateResolutionVisitor, eii_impl: EiiImpl | undefined): void {
  if (eii_impl !== undefined) {
    const { node_id, eii_macro_path, known_eii_macro_resolution } = eii_impl;
    // See docs on the `known_eii_macro_resolution` field:
    // if we already know the resolution statically, don't bother resolving it.
    if (known_eii_macro_resolution !== undefined) {
      const target = known_eii_macro_resolution;
      this.smart_resolve_path(node_id, undefined, target, PathSource.ExternItemImpl);
    } else {
      this.smart_resolve_path(node_id, undefined, eii_macro_path, PathSource.Macro);
    }
  }
};

/// Walks the whole crate in DFS order, visiting each item, counting the declared number of
/// lifetime generic parameters and function parameters. Also collects all `use` and
/// `extern crate` items so that `check_unused` doesn't need to walk the crate again.
// (struct ItemInfoCollector: the class near the top of this file)

// impl ItemInfoCollector<'_, '_, '_>

// rustc: compiler/rustc_resolve/src/late.rs:5734 collect_fn_info
ItemInfoCollector.prototype.collect_fn_info = function (this: ItemInfoCollector, decl: FnDecl, id: NodeId): void {
  this.r.delegation_fn_sigs.set(this.r.owner_def_id(id), { has_self: decl.has_self() });
};

// (fn required_generic_args_suggestion: near the top of this file)

// impl Visitor<'_> for ItemInfoCollector<'_, '_, '_>

// rustc: compiler/rustc_resolve/src/late.rs:5768 visit_item
ItemInfoCollector.prototype.visit_item = function (this: ItemInfoCollector, item: Item): undefined {
  const generics = item.opt_generics();
  if (generics !== undefined) {
    const def_id = this.r.owner_def_id(item.id);
    const count = generics.params.filter((param) => param.kind.$ === "Lifetime").length;
    this.r.item_generics_num_lifetimes_.set(def_id, count);
  }

  const kind = item.kind;
  switch (kind.$) {
    case "Fn": {
      const { sig } = kind._0;
      this.collect_fn_info(sig.decl, item.id);
      break;
    }

    case "ForeignMod": {
      const { items } = kind._0;
      for (const foreign_item of items) {
        if (foreign_item.kind.$ === "Fn") {
          const { sig } = foreign_item.kind._0;
          this.collect_fn_info(sig.decl, foreign_item.id);
        }
      }
      break;
    }

    case "Mod":
    case "Static":
    case "ConstBlock":
    case "MacroDef":
    case "GlobalAsm":
    case "MacCall":
    case "Use":
    case "ExternCrate":
    case "DelegationMac":
    case "TyAlias":
    case "Const":
    case "Enum":
    case "Struct":
    case "Union":
    case "Impl":
    case "Trait":
    case "TraitAlias":
    case "TestBinderConstraints":
      break;
    case "Delegation": {
      // Delegated functions have lifetimes, their count is not necessarily zero.
      // But skipping the delegation items here doesn't mean that the count will be considered zero,
      // it means there will be a panic when retrieving the count,
      // but for delegation items we are never actually retrieving that count in practice.
      break;
    }
  }
  return walk_item(this, item, WalkItemKind.ItemKind);
};

// rustc: compiler/rustc_resolve/src/late.rs:5820 visit_assoc_item
ItemInfoCollector.prototype.visit_assoc_item = function (this: ItemInfoCollector, item: AssocItem, ctxt: AssocCtxt): undefined {
  if (item.kind.$ === "Fn") {
    const { sig } = item.kind._0;
    this.collect_fn_info(sig.decl, item.id);
  }

  if (item.kind.$ === "Type") {
    const { generics } = item.kind._0;
    const def_id = this.r.owner_def_id(item.id);
    const suggestion = required_generic_args_suggestion(generics);
    if (suggestion !== undefined) {
      this.r.item_required_generic_args_suggestions.set(def_id, suggestion);
    }
  }
  return walk_assoc_item(this, item, ctxt, WalkItemKind.AssocItemKind);
};

// impl<'ra, 'tcx> Resolver<'ra, 'tcx>

/// Returns the `use` and `extern crate` items of the crate, for use by `check_unused`.
// rustc: compiler/rustc_resolve/src/late.rs:5837 late_resolve_crate
Resolver.prototype.late_resolve_crate = function (this: Resolver, krate: Crate): [Item[], UseError[]] {
  return with_owner(this, CRATE_NODE_ID, (this_) => {
    const info_collector = new ItemInfoCollector(this_);
    walk_crate(info_collector, krate);
    const late_resolution_visitor = LateResolutionVisitor.new(this_);
    late_resolution_visitor.resolve_doc_links(krate.attrs, { $: "Ok", _0: CRATE_NODE_ID });
    walk_crate(late_resolution_visitor, krate);
    const { use_injections, diag_metadata, use_items } = late_resolution_visitor;
    for (const [id, span] of diag_metadata.unused_labels) {
      this_.lint_buffer_.buffer_lint(UNUSED_LABELS, id, span, diagnostics.UnusedLabel_diagnostic({}));
    }
    return [use_items, use_injections];
  });
};
