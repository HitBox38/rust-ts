// Port of compiler/rustc_ty_utils/src/assoc.rs (lane assoc-opaque).
//
// PORT: query values typed `unknown` in queries.gen.ts (`associated_item`, `generics_of`, `defaultness`) are cast to
// their upstream types at the read site.
import { DefKind, debug_DefKind } from "../rustc_hir/def.ts";
import { type FnRetTy, type ImplItem, type OpaqueTy, type TraitItem, debug_Node } from "../rustc_hir/hir.ts";
import { Visitor, walk_opaque_ty } from "../rustc_hir/intravisit.ts";
import type { DefPathData } from "../rustc_hir_id/definitions.ts";
import { PerParentDisambiguatorState } from "../rustc_hir_id/definitions.ts";
import type { OwnerId } from "../rustc_hir_id/lib.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import { type AssocContainer, AssocItem, AssocItems, type AssocKind } from "../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { ImplTraitInTraitData } from "../rustc_middle/ty/decls.ts";
import { type GenericParamDef, Generics } from "../rustc_middle/ty/generics.ts";
import { DefId_hash_key } from "../rustc_middle/query/caches.ts";
import { KeyedMap } from "../rust_ts/keyed.ts";
import { type DefId, DefIdMap, LocalDefId, debug_LocalDefId } from "../rustc_span/def_id.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { kw } from "../rustc_span/symbol.ts";
import { PLAIN } from "../std/fmt.ts";
import { assert_eq, panic, unported } from "../std/panic.ts";
import { Ok } from "../std/result.ts";

// rustc: compiler/rustc_ty_utils/src/assoc.rs:11 provide
export function provide(providers: Providers): void {
  providers.associated_item = associated_item;
  providers.associated_item_def_ids = associated_item_def_ids;
  providers.associated_items = associated_items;
  providers.associated_types_for_impl_traits_in_trait_or_impl = associated_types_for_impl_traits_in_trait_or_impl;
  providers.impl_item_implementor_ids = impl_item_implementor_ids;
}

// rustc: compiler/rustc_ty_utils/src/assoc.rs:22 associated_item_def_ids
function associated_item_def_ids(tcx: TyCtxt, def_id: LocalDefId): readonly DefId[] {
  const item = tcx.hir_expect_item(def_id);
  const kind = item.kind;
  if (kind.$ === "Trait") {
    const trait_item_refs = kind.items;
    // We collect RPITITs for each trait method's return type and create a corresponding
    // associated item using the associated_types_for_impl_traits_in_trait_or_impl
    // query.
    const rpitit_items = tcx.associated_types_for_impl_traits_in_trait_or_impl(def_id);
    const out: DefId[] = [];
    for (const trait_item_ref of trait_item_refs) {
      const item_def_id = trait_item_ref.owner_id.to_def_id();
      out.push(item_def_id);
      for (const id of rpitit_items.get(item_def_id) ?? []) out.push(id);
    }
    return out;
  } else if (kind.$ === "Impl") {
    const impl_ = kind._0;
    // We collect RPITITs for each trait method's return type, on the impl side too and
    // create a corresponding associated item using
    // associated_types_for_impl_traits_in_trait_or_impl query.
    const rpitit_items = tcx.associated_types_for_impl_traits_in_trait_or_impl(def_id);
    const out: DefId[] = [];
    for (const impl_item_ref of impl_.items) {
      const item_def_id = impl_item_ref.owner_id.to_def_id();
      out.push(item_def_id);
      for (const id of rpitit_items.get(item_def_id) ?? []) out.push(id);
    }
    return out;
  } else {
    return span_bug(item.span, "associated_item_def_ids: not impl or trait");
  }
}

// rustc: compiler/rustc_ty_utils/src/assoc.rs:53 associated_items
function associated_items(tcx: TyCtxt, def_id: DefId): AssocItems {
  if (tcx.is_trait_alias(def_id)) {
    return AssocItems.new([]);
  } else {
    const ids = tcx.associated_item_def_ids(def_id);
    function* items(): Generator<AssocItem> {
      for (const did of ids) yield tcx.associated_item(did) as AssocItem;
    }
    return AssocItems.new(items());
  }
}

// rustc: compiler/rustc_ty_utils/src/assoc.rs:62 impl_item_implementor_ids
function impl_item_implementor_ids(tcx: TyCtxt, impl_id: DefId): Map<DefId, DefId> {
  const out = new DefIdMap<DefId>();
  for (const item of AssocItems.in_definition_order(tcx.associated_items(impl_id) as AssocItems)) {
    const trait_item = AssocItem.trait_item_def_id(item);
    if (trait_item !== undefined) out.set(trait_item, item.def_id);
  }
  return out;
}

// rustc: compiler/rustc_ty_utils/src/assoc.rs:69 associated_item
function associated_item(tcx: TyCtxt, def_id: LocalDefId): AssocItem {
  const node = tcx.hir_node_by_def_id(def_id);
  let assoc_item: AssocItem;
  if (node.$ === "TraitItem") {
    assoc_item = associated_item_from_trait_item(tcx, node._0);
  } else if (node.$ === "ImplItem") {
    assoc_item = associated_item_from_impl_item(tcx, node._0);
  } else {
    return span_bug(tcx.def_span(def_id), `impl item or item not found: ${debug_Node(node, PLAIN)}`);
  }
  // debug_assert_eq!(assoc_item.def_id.expect_local(), def_id);
  return assoc_item;
}

// rustc: compiler/rustc_ty_utils/src/assoc.rs:79 fn_has_self_parameter
function fn_has_self_parameter(tcx: TyCtxt, owner_id: OwnerId): boolean {
  const idents = tcx.fn_arg_idents(owner_id.def_id);
  const first = idents.length > 0 ? idents[0] : undefined;
  return first !== undefined && first.name === kw.SelfLower;
}

// rustc: compiler/rustc_ty_utils/src/assoc.rs:83 associated_item_from_trait_item
function associated_item_from_trait_item(tcx: TyCtxt, trait_item: TraitItem): AssocItem {
  const owner_id = trait_item.owner_id;
  const name = trait_item.ident.name;
  let kind: AssocKind;
  switch (trait_item.kind.$) {
    case "Const":
      kind = { $: "Const", name };
      break;
    case "Fn":
      kind = { $: "Fn", name, has_self: fn_has_self_parameter(tcx, owner_id) };
      break;
    case "Type":
      kind = { $: "Type", data: { $: "Normal", _0: name } };
      break;
  }

  const container: AssocContainer = { $: "Trait" };
  return { kind, def_id: owner_id.to_def_id(), container };
}

// rustc: compiler/rustc_ty_utils/src/assoc.rs:102 associated_item_from_impl_item
function associated_item_from_impl_item(tcx: TyCtxt, impl_item: ImplItem): AssocItem {
  const owner_id = impl_item.owner_id;
  const name = impl_item.ident.name;
  let kind: AssocKind;
  switch (impl_item.kind.$) {
    case "Const":
      kind = { $: "Const", name };
      break;
    case "Fn":
      kind = { $: "Fn", name, has_self: fn_has_self_parameter(tcx, owner_id) };
      break;
    case "Type":
      kind = { $: "Type", data: { $: "Normal", _0: name } };
      break;
  }

  let container: AssocContainer;
  switch (impl_item.impl_kind.$) {
    case "Inherent":
      container = { $: "InherentImpl" };
      break;
    case "Trait":
      container = { $: "TraitImpl", _0: impl_item.impl_kind.trait_item_def_id };
      break;
  }
  return { kind, def_id: owner_id.to_def_id(), container };
}

// rustc-type: compiler/rustc_ty_utils/src/assoc.rs:123 RPITVisitor
class RPITVisitor extends Visitor {
  constructor(
    public tcx: TyCtxt,
    public synthetics: LocalDefId[],
    public data: DefPathData,
    public disambiguator: PerParentDisambiguatorState,
  ) {
    super();
  }

  // ---- impl<'tcx> Visitor<'tcx> for RPITVisitor<'_, 'tcx> ----

  // rustc: compiler/rustc_ty_utils/src/assoc.rs:131 visit_opaque_ty
  override visit_opaque_ty(opaque: OpaqueTy): undefined {
    this.synthetics.push(associated_type_for_impl_trait_in_trait(this.tcx, opaque.def_id, this.data, this.disambiguator));
    return walk_opaque_ty(this, opaque);
  }
}

// rustc: compiler/rustc_ty_utils/src/assoc.rs:142 associated_types_for_impl_traits_in_trait_or_impl
function associated_types_for_impl_traits_in_trait_or_impl(tcx: TyCtxt, def_id: LocalDefId): Map<DefId, DefId[]> {
  const item = tcx.hir_expect_item(def_id);
  const disambiguator = PerParentDisambiguatorState.new(def_id);
  const kind = item.kind;
  if (kind.$ === "Trait") {
    const trait_item_refs = kind.items;
    const out = new DefIdMap<DefId[]>();
    for (const item of trait_item_refs) {
      if (!(tcx.def_kind(item.owner_id).$ === "AssocFn")) {
        continue;
      }
      const fn_def_id = item.owner_id.def_id;
      const output: FnRetTy | undefined = tcx.hir_get_fn_output(fn_def_id);
      if (output === undefined) {
        out.set(LocalDefId.to_def_id(fn_def_id), []);
        continue;
      }
      const def_name = tcx.item_name(LocalDefId.to_def_id(fn_def_id));
      const data: DefPathData = { $: "AnonAssocTy", _0: def_name };
      const visitor = new RPITVisitor(tcx, [], data, disambiguator);
      visitor.visit_fn_ret_ty(output);
      const defs = visitor.synthetics.map((def_id) => LocalDefId.to_def_id(def_id));
      out.set(LocalDefId.to_def_id(fn_def_id), defs);
    }
    return out;
  } else if (kind.$ === "Impl") {
    const impl_ = kind._0;
    const of_trait = impl_.of_trait;
    if (of_trait === undefined) {
      return new DefIdMap();
    }
    const trait_def_id = of_trait.trait_ref.trait_def_id();
    if (trait_def_id === undefined) {
      return new DefIdMap();
    }
    const in_trait_def = tcx.associated_types_for_impl_traits_in_trait_or_impl(trait_def_id);
    const out = new DefIdMap<DefId[]>();
    for (const item_id of impl_.items) {
      if (!(tcx.def_kind(item_id.owner_id).$ === "AssocFn")) {
        continue;
      }
      const did = LocalDefId.to_def_id(item_id.owner_id.def_id);
      const item = tcx.hir_impl_item(item_id);
      const impl_kind = item.impl_kind;
      if (!(impl_kind.$ === "Trait" && impl_kind.trait_item_def_id.$ === "Ok")) {
        out.set(did, []);
        continue;
      }
      const trait_item_def_id = impl_kind.trait_item_def_id._0;
      // PORT: `in_trait_def[&trait_item_def_id]` (`Index for HashMap` panics with "no entry found for key").
      const ids = in_trait_def.get(trait_item_def_id) ?? panic("no entry found for key");
      out.set(
        did,
        ids.map((id) => LocalDefId.to_def_id(associated_type_for_impl_trait_in_impl(tcx, id, item, disambiguator))),
      );
    }
    return out;
  } else {
    return bug(
      `associated_types_for_impl_traits_in_trait_or_impl: ${debug_LocalDefId(def_id, PLAIN)} should be Trait or Impl but is ${debug_DefKind(tcx.def_kind(def_id), PLAIN)}`,
    );
  }
}

/// Given an `opaque_ty_def_id` corresponding to an `impl Trait` in an associated
/// function from a trait, synthesize an associated type for that `impl Trait`
/// that inherits properties that we infer from the method and the opaque type.
// rustc: compiler/rustc_ty_utils/src/assoc.rs:215 associated_type_for_impl_trait_in_trait
function associated_type_for_impl_trait_in_trait(
  tcx: TyCtxt,
  opaque_ty_def_id: LocalDefId,
  data: DefPathData,
  disambiguator: PerParentDisambiguatorState,
): LocalDefId {
  const origin = tcx.local_opaque_ty_origin(opaque_ty_def_id);
  if (!(origin.$ === "FnReturn" || origin.$ === "AsyncFn")) {
    return bug(`expected opaque for ${debug_LocalDefId(opaque_ty_def_id, PLAIN)}`);
  }
  const fn_def_id = origin.parent;
  const trait_def_id = tcx.local_parent(fn_def_id);
  assert_eq(tcx.def_kind(trait_def_id), DefKind.Trait, (v) => debug_DefKind(v, PLAIN), (a, b) => a.$ === b.$);

  const span = tcx.def_span(opaque_ty_def_id);
  // Also use the method name to create an unique def path.
  const trait_assoc_ty = tcx.at(span).create_def(
    trait_def_id,
    // No name because this is an anonymous associated type.
    undefined,
    DefKind.AssocTy,
    data,
    disambiguator,
  );

  const local_def_id = trait_assoc_ty.def_id();
  const def_id = LocalDefId.to_def_id(local_def_id);

  trait_assoc_ty.feed_hir();

  // Copy span of the opaque.
  trait_assoc_ty.def_ident_span(span);

  const item: AssocItem = {
    kind: {
      $: "Type",
      data: {
        $: "Rpitit",
        _0: {
          $: "Trait",
          fn_def_id: LocalDefId.to_def_id(fn_def_id),
          opaque_def_id: LocalDefId.to_def_id(opaque_ty_def_id),
        },
      },
    },
    def_id,
    container: { $: "Trait" },
  };
  trait_assoc_ty.associated_item(item);

  // Copy visility of the containing function.
  trait_assoc_ty.visibility(tcx.visibility(fn_def_id));

  // Copy defaultness of the containing function.
  trait_assoc_ty.defaultness(tcx.defaultness(fn_def_id));

  // There are no inferred outlives for the synthesized associated type.
  trait_assoc_ty.inferred_outlives_of([]);

  return local_def_id;
}

/// Given an `trait_assoc_def_id` corresponding to an associated item synthesized
/// from an `impl Trait` in an associated function from a trait, and an
/// `impl_fn` that represents an implementation of the associated function
/// that the `impl Trait` comes from, synthesize an associated type for that `impl Trait`
/// that inherits properties that we infer from the method and the associated type.
// rustc: compiler/rustc_ty_utils/src/assoc.rs:277 associated_type_for_impl_trait_in_impl
function associated_type_for_impl_trait_in_impl(
  tcx: TyCtxt,
  trait_assoc_def_id: DefId,
  impl_fn: ImplItem,
  disambiguator: PerParentDisambiguatorState,
): LocalDefId {
  const impl_local_def_id = tcx.local_parent(impl_fn.owner_id.def_id);

  if (impl_fn.kind.$ !== "Fn") {
    return bug("expected decl");
  }
  const fn_sig = impl_fn.kind._0;
  const output = fn_sig.decl.output;
  let span;
  switch (output.$) {
    case "DefaultReturn":
      span = tcx.def_span(impl_fn.owner_id);
      break;
    case "Return":
      span = output._0.span;
      break;
  }

  // Use the same disambiguator and method name as the anon associated type in the trait.
  const disambiguated_data = tcx.def_key(trait_assoc_def_id).disambiguated_data;
  if (disambiguated_data.data.$ !== "AnonAssocTy") {
    return bug("expected anon associated type");
  }
  const name = disambiguated_data.data._0;
  const data: DefPathData = { $: "AnonAssocTy", _0: name };

  const impl_assoc_ty = tcx.at(span).create_def(
    impl_local_def_id,
    // No name because this is an anonymous associated type.
    undefined,
    DefKind.AssocTy,
    data,
    disambiguator,
  );

  const local_def_id = impl_assoc_ty.def_id();
  const def_id = LocalDefId.to_def_id(local_def_id);

  impl_assoc_ty.feed_hir();

  // Copy span of the opaque.
  impl_assoc_ty.def_ident_span(span);

  const item: AssocItem = {
    kind: {
      $: "Type",
      data: {
        $: "Rpitit",
        _0: {
          $: "Impl",
          fn_def_id: impl_fn.owner_id.to_def_id(),
        },
      },
    },
    def_id,
    container: { $: "TraitImpl", _0: Ok(trait_assoc_def_id) },
  };
  impl_assoc_ty.associated_item(item);

  // Copy visility of the containing function.
  impl_assoc_ty.visibility(tcx.visibility(impl_fn.owner_id));

  // Copy defaultness of the containing function.
  impl_assoc_ty.defaultness(tcx.defaultness(impl_fn.owner_id));

  // Copy generics_of the trait's associated item but the impl as the parent.
  // FIXME: This may be detrimental to diagnostics, as we resolve the early-bound vars
  // here to paramswhose parent are items in the trait. We could synthesize new params
  // here, but it seems overkill.
  impl_assoc_ty.generics_of(
    (() => {
      const trait_assoc_generics = tcx.generics_of(trait_assoc_def_id) as Generics;
      const trait_assoc_parent_count = trait_assoc_generics.parent_count;
      // PORT: `Vec<GenericParamDef>::clone()`: `GenericParamDef` is a plain data struct (derive Clone), copied
      // field by field so the index update below does not touch the trait's generics.
      const own_params: GenericParamDef[] = trait_assoc_generics.own_params.map((param) => ({ ...param }));

      const parent_generics = tcx.generics_of(LocalDefId.to_def_id(impl_local_def_id)) as Generics;
      const parent_count = parent_generics.count();

      for (const param of own_params) {
        param.index = param.index + parent_count - trait_assoc_parent_count;
      }

      // PORT: `FxHashMap<DefId, u32>` keyed by `DefId` value, as `Generics::from_decoded` does.
      const param_def_id_to_index = new KeyedMap<DefId, number>(
        DefId_hash_key,
        own_params.map((param) => [param.def_id, param.index] as const),
      );

      return new Generics(
        LocalDefId.to_def_id(impl_local_def_id),
        parent_count,
        own_params,
        param_def_id_to_index,
        false,
        trait_assoc_generics.has_late_bound_regions,
      );
    })(),
  );

  // There are no inferred outlives for the synthesized associated type.
  impl_assoc_ty.inferred_outlives_of([]);

  return local_def_id;
}
