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
import { LateResolutionVisitor, Resolver } from "./decls.ts";
// res-late-b imports
import {
  type AnonConst,
  type Arm,
  type AssocItem,
  type AssocItemKind,
  attr as ast_attr,
  type Attribute,
  type Block,
  BindingMode,
  BindingMode_eq,
  clone_BindingMode,
  clone_Pat,
  clone_TraitRef,
  clone_Ty,
  ConstBlockItem,
  CRATE_NODE_ID,
  type Crate,
  type Delegation,
  type EiiImpl,
  type Expr,
  type ExprField,
  type FnDecl,
  type GenericParam,
  type Item,
  type Label,
  type Local,
  LocalKind,
  type NodeId,
  type Param,
  type Pat,
  type PatFieldsRest,
  type Path,
  type QSelf,
  type RestrictionKind,
  type TestBinderConstraints,
  type TraitImplHeader,
  type TraitRef,
  type Ty,
} from "../rustc_ast/lib.ts";
import { debug_NodeId } from "../rustc_ast/node_id.ts";
import { AssocCtxt, walk_assoc_item, walk_crate, walk_expr, walk_item, walk_trait_ref, WalkItemKind } from "../rustc_ast/visit.ts";
import { index_map_swap_remove } from "../rustc_errors/decorate_diag.ts";
import { type Applicability, type Diag, E0323, E0324, E0325, StashKey } from "../rustc_errors/lib.ts";
import { debug_Res, DefKind, type PrimTy, Res as hir_Res, Res_eq } from "../rustc_hir/def.ts";
import { UNUSED_LABELS } from "../rustc_lint_defs/builtin.gen.ts";
import {
  type DelegationInfo,
  type DelegationInherentFnKind,
  type DelegationResolution,
  DocLinkResMap_key,
  PartialRes,
} from "../rustc_middle/middle/resolve.ts";
import { Visibility as ty_Visibility } from "../rustc_middle/ty/mod.ts";
import { feature_err } from "../rustc_session/diagnostics.ts";
import { CRATE_DEF_ID, CrateNum, LOCAL_CRATE, LocalDefId, type LocalModId, type ModId } from "../rustc_span/def_id.ts";
import { BytePos, DUMMY_SP, respan, Span, type Spanned } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { Ident, kw, sym, Symbol } from "../rustc_span/symbol.ts";
import { CrateType } from "../rustc_structures/crate_type.ts";
import { is_uppercase } from "../std/char.ts";
import { PLAIN } from "../std/fmt.ts";
import { field_mut } from "../std/mut_ref.ts";
import { assert, assert_eq, panic, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { utf8 } from "../std/str.ts";
import { KeyedMap, KeyedSet } from "../rust_ts/keyed.ts";
import * as diagnostics from "./diagnostics/mod.ts";
import * as late_diagnostics from "./late/diagnostics.ts";
import {
  AnonConstKind,
  type BindingInfo,
  type ConstantRequiresType,
  debug_RibKind,
  HasGenericParams,
  type IsNeverPattern,
  type IsRepeatExpr,
  type RecordPartialRes,
} from "./late.gen.ts";
import {
  type BindingError,
  BindingKey,
  clone_ParentScope,
  type Decl,
  DefId_key,
  Finalize,
  Ident_key,
  IdentKey,
  LateDecl,
  type Module,
  path_names_to_string,
  type ResolutionError,
  Segment,
  type UseError,
  with_owner,
} from "./lib.ts";
import * as rustdoc from "./rustdoc.ts";
import * as gen from "./late.gen.ts";
import type { Res } from "./lib.ts";

export * from "./late.gen.ts";
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
export type PatternSource = gen.PatternSource;
export const PatternSource = {
  ...gen.PatternSource,
  /** Stub: `late.rs:90` `PatternSource::descr` (unported). */
  descr(self: PatternSource): string {
    return unported("rustc_resolve::late::PatternSource::descr");
  },
};

// impl IntoDiagArg for PatternSource
/** Stub: `late.rs:101` `<PatternSource as IntoDiagArg>::into_diag_arg` (unported). */
export function PatternSource_into_diag_arg(self: PatternSource, _: MutRef<string | undefined>): DiagArgValue {
  return unported("rustc_resolve::late::<PatternSource as IntoDiagArg>::into_diag_arg");
}
export type ConstantHasGenerics = gen.ConstantHasGenerics;
export const ConstantHasGenerics = {
  ...gen.ConstantHasGenerics,
  /** Stub: `late.rs:152` `ConstantHasGenerics::force_yes_if` (unported). */
  force_yes_if(self: ConstantHasGenerics, b: boolean): ConstantHasGenerics {
    return unported("rustc_resolve::late::ConstantHasGenerics::force_yes_if");
  },
};
export type ConstantItemKind = gen.ConstantItemKind;
export const ConstantItemKind = {
  ...gen.ConstantItemKind,
  /** Stub: `late.rs:185` `ConstantItemKind::as_str` (unported). */
  as_str(self: ConstantItemKind): string {
    return unported("rustc_resolve::late::ConstantItemKind::as_str");
  },
};
export type RibKind = gen.RibKind;
export const RibKind = {
  ...gen.RibKind,
  /** Stub: `late.rs:262` `RibKind::contains_params` (unported). */
  contains_params(self: RibKind): boolean {
    return unported("rustc_resolve::late::RibKind::contains_params");
  },
  /** Stub: `late.rs:279` `RibKind::is_label_barrier` (unported). */
  is_label_barrier(self: RibKind): boolean {
    return unported("rustc_resolve::late::RibKind::is_label_barrier");
  },
};
export type LifetimeRibKind = gen.LifetimeRibKind;
export const LifetimeRibKind = {
  ...gen.LifetimeRibKind,
  /** Stub: `late.rs:388` `LifetimeRibKind::elided` (unported). */
  elided(res: LifetimeRes): LifetimeRibKind {
    return unported("rustc_resolve::late::LifetimeRibKind::elided");
  },
};
export type LifetimeBinderKind = gen.LifetimeBinderKind;
export const LifetimeBinderKind = {
  ...gen.LifetimeBinderKind,
  /** Stub: `late.rs:410` `LifetimeBinderKind::descr` (unported). */
  descr(self: LifetimeBinderKind): string {
    return unported("rustc_resolve::late::LifetimeBinderKind::descr");
  },
};
export type PathSource = gen.PathSource;
export const PathSource = {
  ...gen.PathSource,
  /** Stub: `late.rs:482` `PathSource::namespace` (unported). */
  namespace(self: PathSource): Namespace {
    return unported("rustc_resolve::late::PathSource::namespace");
  },
  /** Stub: `late.rs:502` `PathSource::defer_to_typeck` (unported). */
  defer_to_typeck(self: PathSource): boolean {
    return unported("rustc_resolve::late::PathSource::defer_to_typeck");
  },
  /** Stub: `late.rs:522` `PathSource::descr_expected` (unported). */
  descr_expected(self: PathSource): string {
    return unported("rustc_resolve::late::PathSource::descr_expected");
  },
  /** Stub: `late.rs:567` `PathSource::is_call` (unported). */
  is_call(self: PathSource): boolean {
    return unported("rustc_resolve::late::PathSource::is_call");
  },
  /** Stub: `late.rs:571` `PathSource::is_expected` (unported). */
  is_expected(self: PathSource, res: Res): boolean {
    return unported("rustc_resolve::late::PathSource::is_expected");
  },
  /** Stub: `late.rs:694` `PathSource::error_code` (unported). */
  error_code(self: PathSource, has_unexpected_resolution: boolean): ErrCode {
    return unported("rustc_resolve::late::PathSource::error_code");
  },
};
export type MaybeExported = gen.MaybeExported;
export const MaybeExported = {

  /** Stub: `late.rs:737` `MaybeExported::eval` (unported). */
  eval(self: MaybeExported, r: Resolver): boolean {
    return unported("rustc_resolve::late::MaybeExported::eval");
  },
};
export type Rib<R = Res> = gen.Rib<R>;
export const Rib = gen.Rib as typeof gen.Rib & {
  "new": <R>(kind: RibKind) => Rib<R>;
};
/** Stub: `late.rs:309` `Rib::new` (unported). */
Rib.new = function <R>(kind: RibKind): Rib<R> {
  return unported("rustc_resolve::late::Rib::new");
};
export type LifetimeRib = gen.LifetimeRib;
export const LifetimeRib = gen.LifetimeRib as typeof gen.LifetimeRib & {
  "new": (kind: LifetimeRibKind) => LifetimeRib;
};
/** Stub: `late.rs:433` `LifetimeRib::new` (unported). */
LifetimeRib.new = function (kind: LifetimeRibKind): LifetimeRib {
  return unported("rustc_resolve::late::LifetimeRib::new");
};
unported_methods(LateResolutionVisitor.prototype, "rustc_resolve::late::LateResolutionVisitor", ["as_ref", "as_mut", "visit_attribute", "visit_item", "visit_arm", "visit_block", "visit_anon_const", "visit_expr", "visit_pat", "visit_local", "visit_ty", "visit_ty_pat", "visit_poly_trait_ref", "visit_foreign_item", "visit_fn", "visit_lifetime", "visit_precise_capturing_arg", "visit_generics", "visit_closure_binder", "visit_generic_arg", "visit_assoc_item_constraint", "visit_path_segment", "visit_where_predicate", "visit_inline_asm", "visit_inline_asm_sym", "visit_variant", "visit_field_def", "visit_test_binder_forall", "visit_test_binder_exists", "visit_test_binder_bound_type_constraint", "maybe_resolve_ident_in_lexical_scope", "resolve_ident_in_lexical_scope", "resolve_path", "with_rib", "visit_generic_params", "with_lifetime_rib", "resolve_lifetime", "resolve_anonymous_lifetime", "point_at_impl_lifetimes", "resolve_elided_lifetime", "create_fresh_lifetime", "resolve_elided_lifetimes_in_path", "record_lifetime_use", "record_lifetime_err", "record_lifetime_def", "resolve_fn_signature", "resolve_fn_params", "find_lifetime_for_self", "resolve_label", "is_label_valid_from_rib", "resolve_adt", "future_proof_import", "resolve_item", "with_generic_param_rib", "with_label_rib", "with_static_rib", "with_constant_rib", "with_current_self_type", "with_current_self_item", "resolve_trait_items", "resolve_trait_item", "with_optional_trait_ref", "with_self_rib_ns", "with_self_rib", "resolve_implementation", "resolve_test_binder_constraints", "resolve_impl_item", "fill_delegation_inherent_fn_map", "check_trait_item", "resolve_static_body", "resolve_const_item_rhs", "resolve_delegation", "resolve_params", "resolve_local", "compute_and_check_binding_map", "is_base_res_local", "compute_and_check_or_pat_binding_map", "check_consistent_bindings", "resolve_arm", "resolve_pattern_top", "apply_pattern_bindings", "resolve_pattern", "resolve_pattern_inner", "record_patterns_with_skipped_bindings", "fresh_binding", "innermost_rib_bindings", "try_resolve_as_non_binding", "resolve_restriction_path", "smart_resolve_path", "smart_resolve_path_fragment", "self_type_is_available", "self_value_is_available", "report_error", "should_report_errs", "resolve_qpath_anywhere", "resolve_qpath", "with_resolved_label", "resolve_labeled_block", "resolve_block", "resolve_anon_const", "resolve_anon_const_manual", "resolve_expr_field", "resolve_expr", "record_candidate_traits_for_expr_if_necessary", "record_traits_in_scope", "resolve_and_cache_rustdoc_path", "is_invalid_proc_macro_item_for_doc", "resolve_doc_links", "lint_unused_qualifications", "resolve_define_opaques", "resolve_eii"]);

// ---- lane res-late-b: late.rs:2891..end ---------------------------------------------------------
// `impl LateResolutionVisitor` from `resolve_item` onwards, `ItemInfoCollector`, and
// `impl Resolver { late_resolve_crate }`.
//
// PORT: these prototype assignments come after the stub's
// `unported_methods(LateResolutionVisitor.prototype, ..)` call above, which this lane leaves untouched
// so the file stays mergeable with lane res-late-a (both lanes fill methods of the same list). The
// assignments replace its placeholders (they are writable); the names of this lane's methods can be
// dropped from that list when the two halves are integrated.

// PORT: late.gen.ts's `PatternBindings` came out as `T[][]` (the typemap turns
// `SmallVec<[T; 1]>` into an array of the array type). Upstream:
// `type PatternBindings = SmallVec<[(PatBoundCtx, FxIndexMap<Ident, Res>); 1]>;`
// The maps are `KeyedMap(Ident_key)` (res-lib contract rule 4).
export type PatternBindings = [gen.PatBoundCtx, Map<Ident, Res>][];

/** `map[&key]` (`impl Index for HashMap`): panics when the key is absent. */
function index_map<K, V>(map: Map<K, V>, key: K): V {
  const v = map.get(key);
  if (v === undefined && !map.has(key)) return panic("key not found");
  return v as V;
}

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

/** `#[derive(PartialEq)]` on `rustc_hir::def::LifetimeRes` (`ErrorGuaranteed` is a ZST: always equal). */
function LifetimeRes_eq(a: LifetimeRes, b: LifetimeRes): boolean {
  switch (a.$) {
    case "Param":
      return b.$ === "Param" && a.param === b.param && a.binder === b.binder;
    case "Fresh":
      return b.$ === "Fresh" && a.param === b.param && a.kind === b.kind;
    case "Infer":
    case "Static":
    case "Error":
      return b.$ === a.$;
    case "ElidedAnchor":
      return b.$ === "ElidedAnchor" && a.start === b.start && a.end === b.end;
  }
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
