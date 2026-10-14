// Port of compiler/rustc_middle/src/ty/trait_def.rs (lane ty-adt-assoc; contract stub by lane ty-contract).
//
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes; its
// top-level code may touch only the classes it imports, never another extension module.
//
// PORT: `TraitImpls` is a plain data struct (interface) with its methods on the companion const (PORTING §8): its
// fields and its accessor methods share names (`blanket_impls`, `non_blanket_impls`), and other files read the
// fields directly (context/impl_interner.ts `for_each_blanket_impl`). `non_blanket_impls: FxIndexMap<SimplifiedType,
// Vec<DefId>>` is a `KeyedMap` keyed by `SimplifiedType_key` (insertion-ordered, as `IndexMap`).
// PORT: the `trait_impls_of` / `implementations_of_trait` / `type_of` query values are `unknown` (or hold `unknown`)
// in queries.gen.ts: they are cast at the call sites. `I: Interner` code (`fast_reject::simplify_type`) receives the
// `TyCtxt` through `as_interner` (rustc_type_ir/predicate.ts).
// PORT: the query providers of this file (`trait_impls_of_provider`, ..) are `pub(super)` upstream, installed by
// ty/mod.rs `provide` (lane ty-mod): exported here, not wired.
import type { LocalCrate } from "../query/keys.ts";
import { TyCtxt } from "./context.ts";
import { type VisitorResult, try_visit } from "../../rustc_ast_ir/visit.ts";
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import type { Constness, Safety } from "../../rustc_hir/hir.ts";
import { type CrateNum, type DefId, debug_DefId, LOCAL_CRATE, LocalDefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import type { Ident } from "../../rustc_span/symbol.ts";
import { type Debug, debug_map, debug_struct, debug_vec, PLAIN } from "../../std/fmt.ts";
import { unported, unwrap } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { simplify_type } from "../../rustc_type_ir/fast_reject.ts";
import { as_interner } from "../../rustc_type_ir/predicate.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { debug_SimplifiedType, SimplifiedType, SimplifiedType_key } from "./fast_reject.ts";
import { debug_Ty, HasAttrs_DefId, type Ty } from "./mod.ts";

/** `ty::RestrictionKind` (ty/mod.rs:277). PORT(decls): pending lane ty-mod-a/-b (PORTING §5 shape). */
export type RestrictionKind = { readonly $: "Unrestricted" } | { readonly $: "Restricted"; readonly _0: DefId; readonly _1: Span };

/// A trait's definition with type information.
export class TraitDef {
  constructor(
    public def_id: DefId,

    /// Restrictions on trait implementations.
    public impl_restriction: RestrictionKind,

    public safety: Safety,

    /// Whether this trait is `const`.
    public constness: Constness,

    /// If `true`, then this trait had the `#[rustc_paren_sugar]`
    /// attribute, indicating that it should be used with `Foo()`
    /// sugar. This is a temporary thing -- eventually any trait will
    /// be usable with the sugar (or without it).
    public paren_sugar: boolean,

    public has_auto_impl: boolean,

    /// If `true`, then this trait has the `#[marker]` attribute, indicating
    /// that all its associated items have defaults that cannot be overridden,
    /// and thus `impl`s of it are allowed to overlap.
    public is_marker: boolean,

    /// If `true`, then this trait has the `#[rustc_coinductive]` attribute or
    /// is an auto trait. This indicates that trait solver cycles involving an
    /// `X: ThisTrait` goal are accepted.
    ///
    /// In the future all traits should be coinductive, but we need a better
    /// formal understanding of what exactly that means and should probably
    /// also have already switched to the new trait solver.
    public is_coinductive: boolean,

    /// If `true`, then this trait has the `#[fundamental]` attribute. This
    /// affects how conherence computes whether a trait may have trait implementations
    /// added in the future.
    public is_fundamental: boolean,

    /// If `true`, then this trait has the `#[rustc_skip_during_method_dispatch(array)]`
    /// attribute, indicating that editions before 2021 should not consider this trait
    /// during method dispatch if the receiver is an array.
    public skip_array_during_method_dispatch: boolean,

    /// If `true`, then this trait has the `#[rustc_skip_during_method_dispatch(boxed_slice)]`
    /// attribute, indicating that editions before 2024 should not consider this trait
    /// during method dispatch if the receiver is a boxed slice.
    public skip_boxed_slice_during_method_dispatch: boolean,

    /// Used to determine whether the standard library is allowed to specialize
    /// on this trait.
    public specialization_kind: TraitSpecializationKind,

    /// List of functions from `#[rustc_must_implement_one_of]` attribute one of which
    /// must be implemented.
    public must_implement_one_of: readonly Ident[] | undefined,

    /// Whether the trait should be considered dyn-incompatible, even if it otherwise
    /// satisfies the requirements to be dyn-compatible.
    public force_dyn_incompatible: Span | undefined,

    /// Whether a trait is fully built-in, and any implementation is disallowed.
    /// This only applies to built-in traits, and is marked via
    /// `#[rustc_deny_explicit_impl]`.
    public deny_explicit_impl: boolean,
  ) {}

  // PORT: from the later `impl<'tcx> TraitDef` block (trait_def.rs:125), in the class body.
  // rustc: compiler/rustc_middle/src/ty/trait_def.rs:126 ancestors
  ancestors(tcx: TyCtxt, of_impl: DefId): Result<specialization_graph_Ancestors, ErrorGuaranteed> {
    return specialization_graph_ancestors(tcx, this.def_id, of_impl);
  }
}

/// Whether this trait is treated specially by the standard library
/// specialization lint.
export type TraitSpecializationKind =
  /// The default. Specializing on this trait is not allowed.
  | "None"
  /// Specializing on this trait is allowed because it doesn't have any
  /// methods. For example `Sized` or `FusedIterator`.
  /// Applies to traits with the `rustc_allow_lifetime_dependent_specialization`
  /// attribute.
  | "Marker"
  /// Specializing on this trait is allowed because all of the impls of this
  /// trait are "always applicable". Always applicable means that if
  /// `X<'x>: T<'y>` for any lifetimes, then `for<'a, 'b> X<'a>: T<'b>`.
  /// Applies to traits with the `rustc_specialization_trait` attribute.
  | "AlwaysApplicable";
export const TraitSpecializationKind = { None: "None", Marker: "Marker", AlwaysApplicable: "AlwaysApplicable" } as const;

export interface TraitImpls {
  blanket_impls: DefId[];
  /// Impls indexed by their simplified self type, for fast lookup.
  non_blanket_impls: KeyedMap<SimplifiedType, DefId[]>;
}
export const TraitImpls = {
  /** `#[derive(Default)]` */
  default_(): TraitImpls {
    return { blanket_impls: [], non_blanket_impls: new KeyedMap<SimplifiedType, DefId[]>(SimplifiedType_key) };
  },

  // rustc: compiler/rustc_middle/src/ty/trait_def.rs:112 is_empty
  is_empty(self: TraitImpls): boolean {
    return self.blanket_impls.length === 0 && self.non_blanket_impls.size === 0;
  },

  // rustc: compiler/rustc_middle/src/ty/trait_def.rs:116 blanket_impls
  blanket_impls(self: TraitImpls): readonly DefId[] {
    return self.blanket_impls;
  },

  // rustc: compiler/rustc_middle/src/ty/trait_def.rs:120 non_blanket_impls
  non_blanket_impls(self: TraitImpls): KeyedMap<SimplifiedType, DefId[]> {
    return self.non_blanket_impls;
  },
};
/** `#[derive(Debug)]` */
export const debug_TraitImpls: Debug<TraitImpls> = (v, f) =>
  debug_struct(f, "TraitImpls", [
    ["blanket_impls", debug_vec(v.blanket_impls, f, debug_DefId)],
    ["non_blanket_impls", debug_map(f, [...v.non_blanket_impls].map(([k, d]): [string, string] => [debug_SimplifiedType(k, f), debug_vec(d, f, debug_DefId)]))],
  ]);

// ---- impl TyCtxt ---------------------------------------------------------------------------------------------------

/// Iterate over every impl that could possibly match the self type `self_ty`.
///
/// `trait_def_id` MUST BE the `DefId` of a trait.
// PORT: `R: VisitorResult` is the impl object `r` (ty-contract decision 9); `try_visit!` returns early.
// rustc: compiler/rustc_middle/src/ty/trait_def.rs:139 for_each_relevant_impl
TyCtxt.prototype.for_each_relevant_impl = function <R>(this: TyCtxt, trait_def_id: DefId, self_ty: Ty, f: (impl_def_id: DefId) => R, r: VisitorResult<R, unknown>): R {
  const tcx = this;
  const trait_impls = tcx.trait_impls_of(trait_def_id) as TraitImpls;
  const consider_impls_for_simplified_type = (simp: SimplifiedType): R => {
    const impls_for_type = TraitImpls.non_blanket_impls(trait_impls).get(simp);
    if (impls_for_type !== undefined) {
      for (const impl_def_id of impls_for_type) {
        let res: R | undefined;
        if ((res = try_visit(r, f(impl_def_id))) !== undefined) return res;
      }
    }

    return r.output();
  };

  let res: R | undefined;
  const kind = self_ty.kind();
  switch (kind.$) {
    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Float":
    case "Adt":
    case "Foreign":
    case "Str":
    case "Array":
    case "Slice":
    case "RawPtr":
    case "Ref":
    case "FnDef":
    case "FnPtr":
    case "Dynamic":
    case "Closure":
    case "CoroutineClosure":
    case "Coroutine":
    case "Never":
    case "Tuple":
    case "UnsafeBinder": {
      const simp = unwrap(simplify_type(as_interner(tcx), self_ty, "AsRigid"));
      if ((res = try_visit(r, consider_impls_for_simplified_type(simp))) !== undefined) return res;
      break;
    }

    // HACK: For integer and float variables we have to manually look at all impls
    // which have some integer or float as a self type.
    case "Infer": {
      const infer = kind._0;
      switch (infer.$) {
        case "IntVar": {
          // This causes a compiler error if any new integer kinds are added.
          // let (I8 | I16 | I32 | I64 | I128 | Isize): ty::IntTy;
          // let (U8 | U16 | U32 | U64 | U128 | Usize): ty::UintTy;
          const possible_integers: SimplifiedType[] = [
            // signed integers
            { $: "Int", _0: "I8" },
            { $: "Int", _0: "I16" },
            { $: "Int", _0: "I32" },
            { $: "Int", _0: "I64" },
            { $: "Int", _0: "I128" },
            { $: "Int", _0: "Isize" },
            // unsigned integers
            { $: "Uint", _0: "U8" },
            { $: "Uint", _0: "U16" },
            { $: "Uint", _0: "U32" },
            { $: "Uint", _0: "U64" },
            { $: "Uint", _0: "U128" },
            { $: "Uint", _0: "Usize" },
          ];
          for (const simp of possible_integers) {
            if ((res = try_visit(r, consider_impls_for_simplified_type(simp))) !== undefined) return res;
          }
          break;
        }

        case "FloatVar": {
          // This causes a compiler error if any new float kinds are added.
          // let (ty::FloatTy::F16 | ty::FloatTy::F32 | ty::FloatTy::F64 | ty::FloatTy::F128);
          const possible_floats: SimplifiedType[] = [
            { $: "Float", _0: "F16" },
            { $: "Float", _0: "F32" },
            { $: "Float", _0: "F64" },
            { $: "Float", _0: "F128" },
          ];

          for (const simp of possible_floats) {
            if ((res = try_visit(r, consider_impls_for_simplified_type(simp))) !== undefined) return res;
          }
          break;
        }

        // This is only for diagnostics and normally ty vars should be handled by the callers.
        case "TyVar": {
          for (const impls of TraitImpls.non_blanket_impls(trait_impls).values()) {
            for (const impl_def_id of impls) {
              if ((res = try_visit(r, f(impl_def_id))) !== undefined) return res;
            }
          }
          break;
        }

        // These variants should not exist as a self type.
        case "FreshTy":
        case "FreshIntTy":
        case "FreshFloatTy":
          bug(`unexpected self type: ${debug_Ty(self_ty, PLAIN)}`);
      }
      break;
    }

    // Pattern type might not have a simplified type.
    case "Pat": {
      const simp = simplify_type(as_interner(tcx), self_ty, "AsRigid");
      if (simp !== undefined) {
        if ((res = try_visit(r, consider_impls_for_simplified_type(simp))) !== undefined) return res;
      }
      break;
    }

    // The only traits applying to aliases and placeholders are blanket impls.
    //
    // Impls which apply to an alias after normalization are handled by
    // `assemble_candidates_after_normalizing_self_ty`.
    // FIXME(-Znext-solver=no): Need to support aliases not marked as
    // rigid for the old solver. (`ty::Alias(ty::IsRigid::No, _) => ()`)
    case "Alias":
    case "Placeholder":
    case "Error":
      break;

    // FIXME: These should ideally not exist as a self type. It would be nice for
    // the builtin auto trait impls of coroutines to instead directly recurse
    // into the witness.
    case "CoroutineWitness":
      break;

    // These are used in diagnostics or in the old solver.
    case "Param":
    case "Bound":
      break;
  }

  // #[allow(rustc::usage_of_type_ir_traits)]
  return this.for_each_blanket_impl(trait_def_id, f, r);
};

/// `trait_def_id` MUST BE the `DefId` of a trait.
// rustc: compiler/rustc_middle/src/ty/trait_def.rs:278 non_blanket_impls_for_ty
TyCtxt.prototype.non_blanket_impls_for_ty = function (this: TyCtxt, trait_def_id: DefId, self_ty: Ty): Iterable<DefId> {
  const impls = this.trait_impls_of(trait_def_id) as TraitImpls;
  const simp = simplify_type(as_interner(this), self_ty, "InstantiateWithInfer");
  if (simp !== undefined) {
    const impls_ = impls.non_blanket_impls.get(simp);
    if (impls_ !== undefined) {
      return impls_.values();
    }
  }

  return [].values();
};

/// Returns an iterator containing all impls for `trait_def_id`.
///
/// `trait_def_id` MUST BE the `DefId` of a trait.
// rustc: compiler/rustc_middle/src/ty/trait_def.rs:298 all_impls
TyCtxt.prototype.all_impls = function (this: TyCtxt, trait_def_id: DefId): Iterable<DefId> {
  const { blanket_impls, non_blanket_impls } = this.trait_impls_of(trait_def_id) as TraitImpls;

  return (function* (): Generator<DefId> {
    yield* blanket_impls;
    for (const [, v] of non_blanket_impls) yield* v;
  })();
};

// ---- query providers -----------------------------------------------------------------------------------------------

/// Query provider for `trait_impls_of`.
// rustc: compiler/rustc_middle/src/ty/trait_def.rs:306 trait_impls_of_provider
export function trait_impls_of_provider(tcx: TyCtxt, trait_id: DefId): TraitImpls {
  const impls = TraitImpls.default_();

  // Traits defined in the current crate can't have impls in upstream
  // crates, so we don't bother querying the cstore.
  if (!trait_id.is_local()) {
    for (const cnum of tcx.crates(null)) {
      for (const [impl_def_id, simplified_self_ty] of tcx.implementations_of_trait([cnum, trait_id]) as readonly (readonly [DefId, SimplifiedType | undefined])[]) {
        if (simplified_self_ty !== undefined) {
          entry_or_default(impls.non_blanket_impls, simplified_self_ty).push(impl_def_id);
        } else {
          impls.blanket_impls.push(impl_def_id);
        }
      }
    }
  }

  for (const impl_def_id_ of tcx.local_trait_impls(trait_id)) {
    const impl_def_id = LocalDefId.to_def_id(impl_def_id_);

    const impl_self_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(impl_def_id) as EarlyBinder<Ty>));

    const simplified_self_ty = simplify_type(as_interner(tcx), impl_self_ty, "InstantiateWithInfer");
    if (simplified_self_ty !== undefined) {
      entry_or_default(impls.non_blanket_impls, simplified_self_ty).push(impl_def_id);
    } else {
      impls.blanket_impls.push(impl_def_id);
    }
  }

  return impls;
}

/// Query provider for `incoherent_impls`.
// rustc: compiler/rustc_middle/src/ty/trait_def.rs:347 incoherent_impls_provider
export function incoherent_impls_provider(tcx: TyCtxt, simp: SimplifiedType): readonly DefId[] {
  const def_id = SimplifiedType.def(simp);
  if (def_id !== undefined && !(find_attr(HasAttrs_DefId.get_attrs(def_id, tcx), (k) => (k.$ === "RustcHasIncoherentInherentImpls" ? null : undefined)) !== undefined)) {
    return [];
  }

  const impls: DefId[] = [];
  const crates: CrateNum[] = [LOCAL_CRATE, ...tcx.crates(null)];
  for (const cnum of crates) {
    for (const impl_def_id of tcx.crate_incoherent_impls([cnum, simp])) {
      impls.push(impl_def_id);
    }
  }
  // debug!(?impls);

  return impls;
}

// rustc: compiler/rustc_middle/src/ty/trait_def.rs:365 traits_provider
export function traits_provider(tcx: TyCtxt, _: LocalCrate): readonly DefId[] {
  const traits: DefId[] = [];
  for (const id of tcx.hir_free_items()) {
    const k = tcx.def_kind(id.owner_id);
    if (k.$ === "Trait" || k.$ === "TraitAlias") {
      traits.push(id.owner_id.to_def_id());
    }
  }

  return traits;
}

// rustc: compiler/rustc_middle/src/ty/trait_def.rs:376 trait_impls_in_crate_provider
export function trait_impls_in_crate_provider(tcx: TyCtxt, _: LocalCrate): readonly DefId[] {
  const trait_impls: DefId[] = [];
  for (const id of tcx.hir_free_items()) {
    const k = tcx.def_kind(id.owner_id);
    if (k.$ === "Impl" && k.of_trait === true) {
      trait_impls.push(id.owner_id.to_def_id());
    }
  }

  return trait_impls;
}

// ---- helpers and stand-ins (not markers) ---------------------------------------------------------------------------

/** `map.entry(k).or_default()` for a `Vec` value. */
function entry_or_default(map: KeyedMap<SimplifiedType, DefId[]>, k: SimplifiedType): DefId[] {
  let v = map.get(k);
  if (v === undefined) {
    v = [];
    map.set(k, v);
  }
  return v;
}

/** `traits::specialization_graph::Ancestors` (traits/specialization_graph.rs, lane middle-traits-thir). PORT(decls): pending. */
type specialization_graph_Ancestors = { readonly __pending: "specialization_graph::Ancestors" };
/** PORT: stand-in for `traits::specialization_graph::ancestors` (traits/specialization_graph.rs, lane middle-traits-thir). */
function specialization_graph_ancestors(_tcx: TyCtxt, _trait_def_id: DefId, _start_from_impl: DefId): Result<specialization_graph_Ancestors, ErrorGuaranteed> {
  return unported("rustc_middle::traits::specialization_graph::ancestors (lane middle-traits-thir)");
}
