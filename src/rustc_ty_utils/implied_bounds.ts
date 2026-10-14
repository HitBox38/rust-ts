// Port of compiler/rustc_ty_utils/src/implied_bounds.rs (lane ty-utils).
//
// PORT: query values typed `unknown` in queries.gen.ts (`fn_sig`, `type_of`, `generics_of`, `assumed_wf_types`,
// `opt_rpitit_info`) are cast to their upstream types at the read site. `tcx.arena.alloc_*` is the array itself.
// PORT: `itertools::zip_eq` is the local `zip_eq` (it panics like itertools 0.15 when the lengths differ).
import { DefKind } from "../rustc_hir/def.ts";
import { debug_Item, debug_Node, GenericArg as HirGenericArg, FnRetTy, Node } from "../rustc_hir/hir.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { ImplTraitInTraitData } from "../rustc_middle/ty/decls.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import type { Generics } from "../rustc_middle/ty/generics.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { fold_Span, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { type Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import { fold_regions, fold_tuple2, fold_Vec } from "../rustc_type_ir/fold.ts";
import { fold_FnSig, type FnSig } from "../rustc_type_ir/ty_kind.ts";
import type { TraitRef } from "../rustc_type_ir/predicate.ts";
import { Region } from "../rustc_type_ir/sty/mod.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { debug_LocalDefId, LocalDefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { PLAIN } from "../std/fmt.ts";
import { assert, panic, unwrap } from "../std/panic.ts";

type WfTys = readonly [Ty, Span][];

// rustc: compiler/rustc_ty_utils/src/implied_bounds.rs:11 provide
export function provide(providers: Providers): void {
  providers.assumed_wf_types = assumed_wf_types;
  providers.assumed_wf_types_for_rpitit = (tcx: TyCtxt, def_id: LocalDefId) => {
    assert(tcx.is_impl_trait_in_trait(LocalDefId.to_def_id(def_id)), "assertion failed: tcx.is_impl_trait_in_trait(def_id.to_def_id())");
    return tcx.assumed_wf_types(def_id);
  };
}

// rustc: compiler/rustc_ty_utils/src/implied_bounds.rs:22 assumed_wf_types
function assumed_wf_types(tcx: TyCtxt, def_id: LocalDefId): WfTys {
  const kind = tcx.def_kind(def_id);
  switch (kind.$) {
    case "Fn": {
      const sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>));
      const liberated_sig = tcx.liberate_late_bound_regions(LocalDefId.to_def_id(def_id), sig, fold_FnSig);
      return zip_eq(liberated_sig.inputs_and_output, fn_sig_spans(tcx, def_id));
    }
    case "AssocFn": {
      const sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>));
      const liberated_sig = tcx.liberate_late_bound_regions(LocalDefId.to_def_id(def_id), sig, fold_FnSig);
      const assumed_wf_types: [Ty, Span][] = [...(tcx.assumed_wf_types(tcx.local_parent(def_id)) as WfTys)];
      assumed_wf_types.push(...zip_eq(liberated_sig.inputs_and_output, fn_sig_spans(tcx, def_id)));
      return assumed_wf_types;
    }
    case "Impl": {
      const of_trait = kind.of_trait;
      // Trait arguments and the self type for trait impls or only the self type for
      // inherent impls.
      let tys: Ty[];
      if (of_trait) {
        const trait_ref = tcx.impl_trait_ref(def_id);
        tys = [...(EarlyBinder.skip_binder(trait_ref) as TraitRef).args.types()];
      } else {
        tys = [Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>))];
      }

      const impl_spans_ = impl_spans(tcx, def_id);
      return tys.map((ty): [Ty, Span] => [ty, unwrap(next(impl_spans_))]);
    }
    case "AssocTy": {
      const data = tcx.opt_rpitit_info(LocalDefId.to_def_id(def_id)) as ImplTraitInTraitData | undefined;
      if (data !== undefined) {
        switch (data.$) {
          case "Trait": {
            const fn_def_id = data.fn_def_id;
            // We need to remap all of the late-bound lifetimes in the assumed wf types
            // of the fn (which are represented as ReLateParam) to the early-bound lifetimes
            // of the RPITIT (which are represented by ReEarlyParam owned by the opaque).
            // Luckily, this is very easy to do because we already have that mapping
            // stored in the HIR of this RPITIT.
            //
            // Side-note: We don't really need to do this remapping for early-bound
            // lifetimes because they're already "linked" by the bidirectional outlives
            // clauses we insert in the `explicit_clauses_of` query for RPITITs.
            const mapping = new Map<Region, Region>();
            const generics = tcx.generics_of(def_id) as Generics;

            // For each captured opaque lifetime, if it's late-bound (`ReLateParam` in this
            // case, since it has been liberated), map it back to the early-bound lifetime of
            // the GAT. Since RPITITs also have all of the fn's generics, we slice only
            // the end of the list corresponding to the opaque's generics.
            for (const param of slice_from(generics.own_params, (tcx.generics_of(fn_def_id) as Generics).own_params.length)) {
              const orig_lt = tcx.map_opaque_lifetime_to_parent_lifetime(param.def_id.expect_local());
              if (orig_lt.kind().$ === "ReLateParam") {
                mapping.set(orig_lt, Region.new_early_param(tcx, { index: param.index, name: param.name }));
              }
            }
            // FIXME: This could use a real folder, I guess.
            const remapped_wf_tys = fold_regions(
              tcx,
              [...(tcx.assumed_wf_types(fn_def_id.expect_local()) as WfTys)],
              (region, _) => {
                // If `region` is a `ReLateParam` that is captured by the
                // opaque, remap it to its corresponding the early-
                // bound region.
                const remapped_region = mapping.get(region);
                if (remapped_region !== undefined) {
                  return remapped_region;
                } else {
                  return region;
                }
              },
              fold_Vec(fold_tuple2(fold_Ty, fold_Span)),
            );
            return remapped_wf_tys;
          }
          // Assumed wf types for RPITITs in an impl just inherit (and instantiate)
          // the assumed wf types of the trait's RPITIT GAT.
          case "Impl": {
            const impl_def_id = tcx.local_parent(def_id);
            const rpitit_def_id = unwrap(tcx.trait_item_of(def_id));
            const args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(def_id)).rebase_onto(
              tcx,
              LocalDefId.to_def_id(impl_def_id),
              (Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.impl_trait_ref(impl_def_id))) as TraitRef).args,
            );
            return [
              ...[
                ...EarlyBinder.iter_instantiated_copied(
                  EarlyBinder.bind_iter(tcx.assumed_wf_types_for_rpitit(rpitit_def_id) as WfTys),
                  tcx,
                  args,
                  fold_tuple2(fold_Ty, fold_Span),
                ),
              ].map(Unnormalized.skip_norm_wip),
              ...(tcx.assumed_wf_types(impl_def_id) as WfTys),
            ];
          }
        }
      }
      return tcx.assumed_wf_types(tcx.local_parent(def_id)) as WfTys;
    }
    case "AssocConst":
      return tcx.assumed_wf_types(tcx.local_parent(def_id)) as WfTys;
    case "Static":
    case "Const":
    case "AnonConst":
    case "Struct":
    case "Union":
    case "Enum":
    case "Trait":
    case "TraitAlias":
    case "TyAlias":
    case "TestBinderConstraints":
      return RawList.empty() as unknown as WfTys;
    case "OpaqueTy":
    case "Mod":
    case "Variant":
    case "ForeignTy":
    case "TyParam":
    case "ConstParam":
    case "Ctor":
    case "Macro":
    case "ExternCrate":
    case "Use":
    case "ForeignMod":
    case "Field":
    case "LifetimeParam":
    case "GlobalAsm":
    case "Closure":
    case "SyntheticCoroutineBody": {
      return span_bug(
        tcx.def_span(def_id),
        `\`assumed_wf_types\` not defined for ${DefKind.descr(kind, LocalDefId.to_def_id(def_id))} \`${debug_LocalDefId(def_id, PLAIN)}\``,
      );
    }
  }
}

// rustc: compiler/rustc_ty_utils/src/implied_bounds.rs:162 fn_sig_spans
function fn_sig_spans(tcx: TyCtxt, def_id: LocalDefId): Iterator<Span> {
  const node = tcx.hir_node_by_def_id(def_id);
  const decl = Node.fn_decl(node);
  if (decl !== undefined) {
    return (function* () {
      for (const ty of decl.inputs) yield ty.span;
      yield FnRetTy.span(decl.output);
    })();
  } else {
    return bug(`unexpected item for fn ${debug_LocalDefId(def_id, PLAIN)}: ${debug_Node(node, PLAIN)}`);
  }
}

// rustc: compiler/rustc_ty_utils/src/implied_bounds.rs:171 impl_spans
function impl_spans(tcx: TyCtxt, def_id: LocalDefId): Iterator<Span> {
  const item = tcx.hir_expect_item(def_id);
  if (item.kind.$ === "Impl") {
    const impl_ = item.kind._0;
    return (function* () {
      yield impl_.self_ty.span;
      const of_trait = impl_.of_trait;
      if (of_trait !== undefined) {
        // trait_args
        for (const arg of unwrap(of_trait.trait_ref.path.segments.at(-1)).args_().args) yield HirGenericArg.span(arg);
        // dummy_spans_for_default_args: `iter::repeat(of_trait.trait_ref.path.span)`
        for (;;) yield of_trait.trait_ref.path.span;
      }
    })();
  } else {
    return bug(`unexpected item for impl ${debug_LocalDefId(def_id, PLAIN)}: ${debug_Item(item, PLAIN)}`);
  }
}

/** `itertools::zip_eq` (itertools 0.15 `ZipEq::next`): panics when one side ends before the other. */
function zip_eq<A, B>(a: Iterable<A>, b: Iterator<B>): [A, B][] {
  const out: [A, B][] = [];
  const ia = a[Symbol.iterator]();
  for (;;) {
    const x = ia.next();
    const y = b.next();
    if (x.done && y.done) return out;
    if (x.done || y.done) return panic("itertools: .zip_eq() reached end of one iterator before the other");
    out.push([x.value, y.value]);
  }
}

/** `Iterator::next` of a JS iterator. */
function next<T>(it: Iterator<T>): T | undefined {
  const r = it.next();
  return r.done ? undefined : r.value;
}

/** `&v[start..]` (panics like the slice index when `start > len`). */
function slice_from<T>(v: readonly T[], start: number): readonly T[] {
  if (start > v.length) return panic(`range start index ${start} out of range for slice of length ${v.length}`);
  return v.slice(start);
}
