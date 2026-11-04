// Port of compiler/rustc_middle/src/mono.rs (lane symbol-mangling: `MonoItem::instantiation_mode` and the small
// `MonoItem` helpers; lane query-keys: `CollectionMode`; lane mono-partition: everything else).
//
// PORT: `InstantiationMode` / `MonoItem` are tagged unions; `MonoItem`'s methods live on the companion const
// (PORTING §8). `#[derive(PartialEq)]` on `InstantiationMode` is `InstantiationMode_eq`.
// PORT: `MonoItem` is a value-compared key (`#[derive(PartialEq, Eq, Hash)]`): `FxIndexMap<MonoItem, _>` /
// `UnordMap<MonoItem, _>` are `KeyedMap`s with `key_MonoItem` (PORTING §5), insertion-ordered like `IndexMap`.
// `IndexMap::insert` over an existing key keeps its position and replaces the value, as `Map.set` does.
// PORT: `CodegenUnit`'s fields `name`, `symbol_name`, `items`, `size_estimate` and `is_code_coverage_dead_code_cgu`
// share their names with its methods, so they carry a trailing underscore.
// PORT: `DepNode`, `WorkProduct` and `WorkProductId` (incremental, out of scope, PORTING §3) are not ported: the
// functions that return them stop at `unported`.
import { InlineAttr, type Linkage, debug_Linkage } from "../rustc_attr_ir/data_structures.ts";
import { type BaseNString, CASE_INSENSITIVE, ToBaseN_u128, to_base_fixed_len } from "../rustc_data_structures/base_n.ts";
import { Fingerprint } from "../rustc_data_structures/fingerprint.ts";
import {
  type StableHashCtxt,
  StableHasher,
  stable_hash_Discriminant,
  stable_hash_Option,
  stable_hash_bool,
  stable_hash_usize,
} from "../rustc_data_structures/stable_hash.ts";
import { Hash128, Hash64 } from "../rustc_hashes/lib.ts";
import { type ItemId, debug_ItemId } from "../rustc_hir/hir.ts";
import { stable_hash_ItemId } from "../rustc_hir/stable_hash.gen.ts";
import { intern_key } from "../rust_ts/intern_key.ts";
import { KeyedMap } from "../rust_ts/keyed.ts";
import { type CrateNum, type DefId, type DefIdSet, LOCAL_CRATE, StableCrateId, debug_DefId, stable_hash_DefId } from "../rustc_span/def_id.ts";
import { OrdSpan, Span } from "../rustc_span/lib.ts";
import { Symbol, debug_Symbol } from "../rustc_span/symbol.ts";
import type { SymbolVisibility } from "../rustc_target/spec/mod.ts";
import { type Debug, debug_map, debug_option, debug_struct, debug_tuple, debug_vec } from "../std/fmt.ts";
import { assert, panic, unported } from "../std/panic.ts";
import { Str, str_floor_char_boundary, utf8, utf8_len } from "../std/str.ts";
import { CodegenFnAttrFlags, CodegenFnAttrs, TyCtxt_codegen_instance_attrs } from "./middle/codegen_fn_attrs.ts";
import { stable_hash_Ty } from "./stable_hash.gen.ts";
import type { TyCtxt } from "./ty/context.ts";
import { stable_hash_GenericArg, stable_hash_RawList } from "./ty/impls_ty.ts";
import type { ReifyReason } from "./ty/instance.gen.ts";
import { Instance, InstanceKind, type ShimKind, debug_Instance, display_Instance } from "./ty/instance.ts";
import { RawList } from "./ty/list.ts";
import type { SymbolName, Ty } from "./ty/mod.ts";

/// Describes how a monomorphization will be instantiated in object files.
// #[derive(PartialEq)]
export type InstantiationMode =
  /// There will be exactly one instance of the given MonoItem. It will have
  /// external linkage so that it can be linked to from other codegen units.
  | {
      readonly $: "GloballyShared";
      /// In some compilation scenarios we may decide to take functions that
      /// are typically `LocalCopy` and instead move them to `GloballyShared`
      /// to avoid codegenning them a bunch of times. In this situation,
      /// however, our local copy may conflict with other crates also
      /// inlining the same function.
      ///
      /// This flag indicates that this situation is occurring, and informs
      /// symbol name calculation that some extra mangling is needed to
      /// avoid conflicts. Note that this may eventually go away entirely if
      /// ThinLTO enables us to *always* have a globally shared instance of a
      /// function within one crate's compilation.
      readonly may_conflict: boolean;
    }

  /// Each codegen unit containing a reference to the given MonoItem will
  /// have its own private copy of the function (with internal linkage).
  | { readonly $: "LocalCopy" };
export const InstantiationMode = {
  LocalCopy: { $: "LocalCopy" } as InstantiationMode,
} as const;
export function InstantiationMode_eq(a: InstantiationMode, b: InstantiationMode): boolean {
  if (a.$ === "GloballyShared" && b.$ === "GloballyShared") return a.may_conflict === b.may_conflict;
  return a.$ === b.$;
}

// rustc-type: compiler/rustc_middle/src/mono.rs:53 NormalizationErrorInMono
// #[derive(PartialEq, Eq, Clone, Copy, Debug, Hash, StableHash, TyEncodable, TyDecodable)]
export interface NormalizationErrorInMono {
  readonly $: "NormalizationErrorInMono";
}
export const NormalizationErrorInMono: NormalizationErrorInMono = Object.freeze({ $: "NormalizationErrorInMono" });
/** `#[derive(Debug)]` */
export const debug_NormalizationErrorInMono: Debug<NormalizationErrorInMono> = () => "NormalizationErrorInMono";

// #[derive(PartialEq, Eq, Clone, Copy, Debug, Hash, StableHash, TyEncodable, TyDecodable)]
export type MonoItem =
  | { readonly $: "Fn"; readonly _0: Instance }
  | { readonly $: "Static"; readonly _0: DefId }
  | { readonly $: "GlobalAsm"; readonly _0: ItemId };
/** `#[derive(Debug)]` */
export const debug_MonoItem: Debug<MonoItem> = (v, f) => {
  switch (v.$) {
    case "Fn":
      return debug_tuple(f, "Fn", [debug_Instance(v._0, f)]);
    case "Static":
      return debug_tuple(f, "Static", [debug_DefId(v._0, f)]);
    case "GlobalAsm":
      return debug_tuple(f, "GlobalAsm", [debug_ItemId(v._0, f)]);
  }
};
/** `#[derive(Hash, Eq)]`: the `KeyedMap` / `KeyedSet` key of a `MonoItem` (equal exactly when the items are `==`). */
export function key_MonoItem(v: MonoItem): string {
  return intern_key(v);
}
/** `#[derive(PartialEq)]` */
export function MonoItem_eq(a: MonoItem, b: MonoItem): boolean {
  return key_MonoItem(a) === key_MonoItem(b);
}

// rustc: compiler/rustc_middle/src/mono.rs:62 opt_incr_drop_glue_mode
function opt_incr_drop_glue_mode(tcx: TyCtxt, ty: Ty): InstantiationMode {
  // Non-ADTs can't have a Drop impl. This case is mostly hit by closures whose captures require
  // dropping.
  const k = ty.kind();
  if (k.$ !== "Adt") {
    return InstantiationMode.LocalCopy;
  }
  const adt_def = k._0;

  // Types that don't have a direct Drop impl, but have fields that require dropping.
  const dtor = adt_def.destructor(tcx);
  if (dtor === undefined) {
    // We use LocalCopy for drops of enums only; this code is inherited from
    // https://github.com/rust-lang/rust/pull/67332 and the theory is that we get to optimize
    // out code like `drop_glue(&mut Option::None)` before crate-local ThinLTO, which improves
    // compile time. At the time of writing, simply removing this entire check does seem to
    // regress incr-opt compile times. But it sure seems like a more sophisticated check could
    // do better here.
    if (adt_def.is_enum()) {
      return InstantiationMode.LocalCopy;
    } else {
      return { $: "GloballyShared", may_conflict: true };
    }
  }

  // We've gotten to a `drop_glue` for a type that directly implements Drop.
  // The drop glue is a wrapper for the `Drop::drop` impl, and we are an optimized build, so in an
  // effort to coordinate with the mode that the actual impl will get, we make the glue also
  // LocalCopy.
  if (tcx.cross_crate_inlinable(dtor.did)) {
    return InstantiationMode.LocalCopy;
  } else {
    return { $: "GloballyShared", may_conflict: true };
  }
}

export const MonoItem = {
  /// Returns `true` if the mono item is user-defined (i.e. not compiler-generated, like shims).
  // rustc: compiler/rustc_middle/src/mono.rs:97 is_user_defined
  is_user_defined(self: MonoItem): boolean {
    switch (self.$) {
      case "Fn":
        return self._0.def.$ === "Item";
      case "Static":
      case "GlobalAsm":
        return true;
    }
  },

  // Note: if you change how item size estimates work, you might need to
  // change NON_INCR_MIN_CGU_SIZE as well.
  // rustc: compiler/rustc_middle/src/mono.rs:106 size_estimate
  size_estimate(self: MonoItem, tcx: TyCtxt): number {
    switch (self.$) {
      case "Fn":
        return tcx.size_estimate(self._0);
      // Conservatively estimate the size of a static declaration or
      // assembly item to be 1.
      case "Static":
      case "GlobalAsm":
        return 1;
    }
  },

  // rustc: compiler/rustc_middle/src/mono.rs:115 is_generic_fn
  is_generic_fn(self: MonoItem): boolean {
    switch (self.$) {
      case "Fn":
        return !self._0.args.non_erasable_generics()[globalThis.Symbol.iterator]().next().done;
      case "Static":
      case "GlobalAsm":
        return false;
    }
  },

  // rustc: compiler/rustc_middle/src/mono.rs:122 symbol_name
  symbol_name(self: MonoItem, tcx: TyCtxt): SymbolName {
    // PORT: the `symbol_name` query value is `unknown` in queries.gen.ts; it is `SymbolName`.
    switch (self.$) {
      case "Fn":
        return tcx.symbol_name(self._0) as SymbolName;
      case "Static":
        return tcx.symbol_name(Instance.mono(tcx, self._0)) as SymbolName;
      case "GlobalAsm": {
        const item_id = self._0;
        return tcx.symbol_name(Instance.mono(tcx, item_id.owner_id.to_def_id())) as SymbolName;
      }
    }
  },

  // rustc: compiler/rustc_middle/src/mono.rs:132 instantiation_mode
  instantiation_mode(self: MonoItem, tcx: TyCtxt): InstantiationMode {
    // The case handling here is written in the same style as cross_crate_inlinable, we first
    // handle the cases where we must use a particular instantiation mode, then cascade down
    // through a sequence of heuristics.

    // The first thing we do is detect MonoItems which we must instantiate exactly once in the
    // whole program.

    // Statics and global_asm! must be instantiated exactly once.
    let instance: Instance;
    switch (self.$) {
      case "Fn":
        instance = self._0;
        break;
      case "Static":
      case "GlobalAsm":
        return { $: "GloballyShared", may_conflict: false };
    }

    // Similarly, the executable entrypoint must be instantiated exactly once.
    if (tcx.is_entrypoint(Instance.def_id(instance))) {
      return { $: "GloballyShared", may_conflict: false };
    }

    // If the function is #[naked] or contains any other attribute that requires exactly-once
    // instantiation:
    // We emit an unused_attributes lint for this case, which should be kept in sync if possible.
    const codegen_fn_attrs = TyCtxt_codegen_instance_attrs(tcx, instance.def);
    if (CodegenFnAttrs.contains_extern_indicator(codegen_fn_attrs) || CodegenFnAttrFlags.contains(codegen_fn_attrs.flags, CodegenFnAttrFlags.NAKED)) {
      return { $: "GloballyShared", may_conflict: false };
    }

    // This is technically a heuristic even though it's in the "not a heuristic" part of
    // instantiation mode selection.
    // It is surely possible to untangle this; the root problem is that the way we instantiate
    // InstanceKind other than Item is very complicated.
    //
    // The fallback case is to give everything else GloballyShared at OptLevel::No and
    // LocalCopy at all other opt levels. This is a good default, except for one specific build
    // configuration: Optimized incremental builds.
    // In the current compiler architecture there is a fundamental tension between
    // optimizations (which want big CGUs with as many things LocalCopy as possible) and
    // incrementality (which wants small CGUs with as many things GloballyShared as possible).
    // The heuristics implemented here do better than a completely naive approach in the
    // compiler benchmark suite, but there is no reason to believe they are optimal.
    if (instance.def.$ === "Shim" && instance.def._0.$ === "DropGlue" && instance.def._0._1 !== undefined) {
      const ty = instance.def._0._1;
      if (tcx.sess.opts.optimize === "No") {
        return { $: "GloballyShared", may_conflict: false };
      }
      if (tcx.sess.opts.incremental === undefined) {
        return InstantiationMode.LocalCopy;
      }
      return opt_incr_drop_glue_mode(tcx, ty);
    }

    // We need to ensure that we do not decide the InstantiationMode of an exported symbol is
    // LocalCopy. Since exported symbols are computed based on the output of
    // cross_crate_inlinable, we are beholden to our previous decisions.
    //
    // Note that just like above, this check for requires_inline is technically a heuristic
    // even though it's in the "not a heuristic" part of instantiation mode selection.
    if (!tcx.cross_crate_inlinable(Instance.def_id(instance)) && !InstanceKind.requires_inline(instance.def, tcx)) {
      return { $: "GloballyShared", may_conflict: false };
    }

    // Beginning of heuristics. The handling of link-dead-code and inline(always) are QoL only,
    // the compiler should not crash and linkage should work, but codegen may be undesirable.

    // -Clink-dead-code was given an unfortunate name; the point of the flag is to assist
    // coverage tools which rely on having every function in the program appear in the
    // generated code. If we select LocalCopy, functions which are not used because they are
    // missing test coverage will disappear from such coverage reports, defeating the point.
    // Note that -Cinstrument-coverage does not require such assistance from us, only coverage
    // tools implemented without compiler support ironically require a special compiler flag.
    if (tcx.sess.link_dead_code()) {
      return { $: "GloballyShared", may_conflict: true };
    }

    // To ensure that #[inline(always)] can be inlined as much as possible, especially in unoptimized
    // builds, we always select LocalCopy.
    if (InlineAttr.always(codegen_fn_attrs.inline)) {
      return InstantiationMode.LocalCopy;
    }

    // #[inline(never)] functions in general are poor candidates for inlining and thus since
    // LocalCopy generally increases code size for the benefit of optimizations from inlining,
    // we want to give them GloballyShared codegen.
    // The slight problem is that generic functions need to always support cross-crate
    // compilation, so all previous stages of the compiler are obligated to treat generic
    // functions the same as those that unconditionally get LocalCopy codegen. It's only when
    // we get here that we can at least not codegen a #[inline(never)] generic function in all
    // of our CGUs.
    if (codegen_fn_attrs.inline.$ === "Never" && MonoItem.is_generic_fn(self)) {
      return { $: "GloballyShared", may_conflict: true };
    }

    // The fallthrough case is to generate LocalCopy for all optimized builds, and
    // GloballyShared with conflict prevention when optimizations are disabled.
    switch (tcx.sess.opts.optimize) {
      case "No":
        return { $: "GloballyShared", may_conflict: true };
      default:
        return InstantiationMode.LocalCopy;
    }
  },

  // rustc: compiler/rustc_middle/src/mono.rs:237 explicit_linkage
  explicit_linkage(self: MonoItem, tcx: TyCtxt): Linkage | undefined {
    let instance_kind: InstanceKind;
    switch (self.$) {
      case "Fn":
        instance_kind = self._0.def;
        break;
      case "Static":
        instance_kind = { $: "Item", _0: self._0 };
        break;
      case "GlobalAsm":
        return undefined;
    }

    return TyCtxt_codegen_instance_attrs(tcx, instance_kind).linkage;
  },

  /// Returns `true` if this instance is instantiable - whether it has no unsatisfied
  /// predicates.
  ///
  /// In order to codegen an item, all of its predicates must hold, because
  /// otherwise the item does not make sense. Type-checking ensures that
  /// the predicates of every item that is *used by* a valid item *do*
  /// hold, so we can rely on that.
  ///
  /// However, we codegen collector roots (reachable items) and functions
  /// in vtables when they are seen, even if they are not used, and so they
  /// might not be instantiable. For example, a programmer can define this
  /// public function:
  ///
  ///     pub fn foo<'a>(s: &'a mut ()) where &'a mut (): Clone {
  ///         <&mut () as Clone>::clone(&s);
  ///     }
  ///
  /// That function can't be codegened, because the method `<&mut () as Clone>::clone`
  /// does not exist. Luckily for us, that function can't ever be used,
  /// because that would require for `&'a mut (): Clone` to hold, so we
  /// can just not emit any code, or even a linker reference for it.
  ///
  /// Similarly, if a vtable method has such a signature, and therefore can't
  /// be used, we can just not emit it and have a placeholder (a null pointer,
  /// which will never be accessed) in its place.
  // rustc: compiler/rustc_middle/src/mono.rs:272 is_instantiable
  is_instantiable(self: MonoItem, tcx: TyCtxt): boolean {
    // debug!("is_instantiable({:?})", self);
    let def_id: DefId;
    let args: Instance["args"];
    switch (self.$) {
      case "Fn":
        def_id = Instance.def_id(self._0);
        args = self._0.args;
        break;
      case "Static":
        def_id = self._0;
        args = RawList.empty();
        break;
      // global asm never has predicates
      case "GlobalAsm":
        return true;
    }

    return !tcx.instantiate_and_check_impossible_clauses([def_id, args]);
  },

  // rustc: compiler/rustc_middle/src/mono.rs:284 local_span
  local_span(self: MonoItem, tcx: TyCtxt): Span | undefined {
    let def_id;
    switch (self.$) {
      case "Fn":
        def_id = InstanceKind.def_id(self._0.def).as_local();
        break;
      case "Static":
        def_id = self._0.as_local();
        break;
      case "GlobalAsm":
        def_id = self._0.owner_id.def_id;
        break;
    }
    return def_id === undefined ? undefined : tcx.def_span(def_id);
  },

  // Only used by rustc_codegen_cranelift
  // rustc: compiler/rustc_middle/src/mono.rs:294 codegen_dep_node
  codegen_dep_node(_self: MonoItem, _tcx: TyCtxt): never {
    return unported("rustc_middle::dep_graph::dep_node::make_compile_mono_item (incremental)");
  },

  /// Returns the item's `CrateNum`
  // rustc: compiler/rustc_middle/src/mono.rs:299 krate
  krate(self: MonoItem): CrateNum {
    switch (self.$) {
      case "Fn":
        return Instance.def_id(self._0).krate;
      case "Static":
        return self._0.krate;
      case "GlobalAsm":
        return LOCAL_CRATE;
    }
  },

  /// Returns the item's `DefId`
  // rustc: compiler/rustc_middle/src/mono.rs:308 def_id
  def_id(self: MonoItem): DefId {
    switch (self.$) {
      case "Fn":
        return InstanceKind.def_id(self._0.def);
      case "Static":
        return self._0;
      case "GlobalAsm":
        return self._0.owner_id.to_def_id();
    }
  },
} as const;

// impl<'tcx> fmt::Display for MonoItem<'tcx>
// rustc: compiler/rustc_middle/src/mono.rs:318 fmt
export function display_MonoItem(self: MonoItem): string {
  switch (self.$) {
    case "Fn":
      return `fn ${display_Instance(self._0)}`;
    case "Static":
      return `static ${display_Instance(Instance.new_raw(self._0, RawList.empty()))}`;
    case "GlobalAsm":
      return "global_asm";
  }
}

// impl ToStableHashKey for MonoItem<'_>
// PORT: ported rather than skipped: `collect_crate_mono_items` sorts all mono items by this key
// (`UnordSet::into_sorted`), which fixes the order CGU names are interned in, and so the order of the CGUs of an item in
// `-Zprint-mono-items`.
// rustc: compiler/rustc_middle/src/mono.rs:332 to_stable_hash_key
export function MonoItem_to_stable_hash_key(self: MonoItem, hcx: StableHashCtxt): Fingerprint {
  const hasher = StableHasher.new();
  stable_hash_MonoItem(self, hcx, hasher);
  return hasher.finish(Fingerprint);
}

// PORT(contract): pending a generator batch. `#[derive(StableHash)]` of `MonoItem` and of what it holds, written out as
// tools/codegen's generator would (the discriminant, then the fields in declaration order), because tools/ is not this
// lane's and no set generates them yet. Root: add the types to a set and delete these (docs/handoff/mono-partition.md).
function stable_hash_MonoItem(self: MonoItem, __hcx: StableHashCtxt, __hasher: StableHasher): void {
  switch (self.$) {
    case "Fn":
      stable_hash_Discriminant(0, __hcx, __hasher);
      stable_hash_InstanceKind(self._0.def, __hcx, __hasher);
      stable_hash_RawList(self._0.args, __hcx, __hasher, stable_hash_GenericArg);
      break;
    case "Static":
      stable_hash_Discriminant(1, __hcx, __hasher);
      stable_hash_DefId(self._0, __hcx, __hasher);
      break;
    case "GlobalAsm":
      stable_hash_Discriminant(2, __hcx, __hasher);
      stable_hash_ItemId(self._0, __hcx, __hasher);
      break;
  }
}
function stable_hash_InstanceKind(self: InstanceKind, __hcx: StableHashCtxt, __hasher: StableHasher): void {
  switch (self.$) {
    case "Item":
      stable_hash_Discriminant(0, __hcx, __hasher);
      stable_hash_DefId(self._0, __hcx, __hasher);
      break;
    case "Intrinsic":
      stable_hash_Discriminant(1, __hcx, __hasher);
      stable_hash_DefId(self._0, __hcx, __hasher);
      break;
    case "LlvmIntrinsic":
      stable_hash_Discriminant(2, __hcx, __hasher);
      stable_hash_DefId(self._0, __hcx, __hasher);
      break;
    case "Virtual":
      stable_hash_Discriminant(3, __hcx, __hasher);
      stable_hash_DefId(self._0, __hcx, __hasher);
      stable_hash_usize(self._1, __hcx, __hasher);
      break;
    case "Shim":
      stable_hash_Discriminant(4, __hcx, __hasher);
      stable_hash_ShimKind(self._0, __hcx, __hasher);
      break;
  }
}
/** `mem::discriminant` of `ShimKind`: its declaration order (ty/instance.rs:106). */
const ShimKind__discriminant: Record<ShimKind["$"], number> = {
  VTable: 0,
  Reify: 1,
  FnPtr: 2,
  ClosureOnce: 3,
  ConstructCoroutineInClosure: 4,
  ThreadLocal: 5,
  FutureDropPoll: 6,
  DropGlue: 7,
  Clone: 8,
  FnPtrAsPtr: 9,
  FnPtrFromPtr: 10,
  AsyncDropGlueCtor: 11,
  AsyncDropGlue: 12,
};
function stable_hash_ShimKind(self: ShimKind, __hcx: StableHashCtxt, __hasher: StableHasher): void {
  stable_hash_Discriminant(ShimKind__discriminant[self.$], __hcx, __hasher);
  switch (self.$) {
    case "VTable":
    case "ThreadLocal":
      stable_hash_DefId(self._0, __hcx, __hasher);
      break;
    case "Reify":
      stable_hash_DefId(self._0, __hcx, __hasher);
      stable_hash_Option(self._1, __hcx, __hasher, (v: ReifyReason, h, x) => stable_hash_Discriminant(v === "FnPtr" ? 0 : 1, h, x));
      break;
    case "ClosureOnce":
      stable_hash_DefId(self.call_once, __hcx, __hasher);
      stable_hash_DefId(self.closure, __hcx, __hasher);
      stable_hash_bool(self.track_caller, __hcx, __hasher);
      break;
    case "ConstructCoroutineInClosure":
      stable_hash_DefId(self.coroutine_closure_def_id, __hcx, __hasher);
      stable_hash_bool(self.receiver_by_ref, __hcx, __hasher);
      break;
    case "FutureDropPoll":
      stable_hash_DefId(self._0, __hcx, __hasher);
      stable_hash_Ty(self._1, __hcx, __hasher);
      stable_hash_Ty(self._2, __hcx, __hasher);
      break;
    case "DropGlue":
      stable_hash_DefId(self._0, __hcx, __hasher);
      stable_hash_Option(self._1, __hcx, __hasher, stable_hash_Ty);
      break;
    default:
      // `FnPtr`, `AsyncDropGlue`, `Clone`, `FnPtrAsPtr`, `FnPtrFromPtr`, `AsyncDropGlueCtor`: `(DefId, Ty)`.
      stable_hash_DefId(self._0, __hcx, __hasher);
      stable_hash_Ty(self._1, __hcx, __hasher);
      break;
  }
}

// rustc-type: compiler/rustc_middle/src/mono.rs:340 MonoItemPartitions
// #[derive(Debug, StableHash, Copy, Clone)]
// PORT: no `debug_MonoItemPartitions`: `all_mono_items` is an `UnordSet`, whose `Debug` follows hash order.
export interface MonoItemPartitions {
  codegen_units: readonly CodegenUnit[];
  all_mono_items: DefIdSet;
}

/// Auxiliary info about a `MonoItem`.
// rustc-type: compiler/rustc_middle/src/mono.rs:367 MonoItemData
// #[derive(Copy, Clone, PartialEq, Debug, StableHash)]
export interface MonoItemData {
  /// A cached copy of the result of `MonoItem::instantiation_mode`, where
  /// `GloballyShared` maps to `false` and `LocalCopy` maps to `true`.
  inlined: boolean;

  linkage: Linkage;
  visibility: Visibility;

  /// A cached copy of the result of `MonoItem::size_estimate`.
  size_estimate: number;
}
/** `#[derive(Debug)]` */
export const debug_MonoItemData: Debug<MonoItemData> = (v, f) =>
  debug_struct(f, "MonoItemData", [
    ["inlined", String(v.inlined)],
    ["linkage", debug_Linkage(v.linkage, f)],
    ["visibility", debug_Visibility(v.visibility, f)],
    ["size_estimate", String(v.size_estimate)],
  ]);

/// Specifies the symbol visibility with regards to dynamic linking.
///
/// Visibility doesn't have any effect when linkage is internal.
///
/// DSO means dynamic shared object, that is a dynamically linked executable or dylib.
// rustc-type: compiler/rustc_middle/src/mono.rs:385 Visibility
// #[derive(Copy, Clone, PartialEq, Debug, StableHash, TyEncodable, TyDecodable)]
export type Visibility =
  /// Export the symbol from the DSO and apply overrides of the symbol by outside DSOs to within
  /// the DSO if the object file format supports this.
  | "Default"
  /// Hide the symbol outside of the defining DSO even when external linkage is used to export it
  /// from the object file.
  | "Hidden"
  /// Export the symbol from the DSO, but don't apply overrides of the symbol by outside DSOs to
  /// within the DSO. Equivalent to default visibility with object file formats that don't support
  /// overriding exported symbols by another DSO.
  | "Protected";
export const Visibility = {
  Default: "Default",
  Hidden: "Hidden",
  Protected: "Protected",

  // impl From<SymbolVisibility> for Visibility
  // rustc: compiler/rustc_middle/src/mono.rs:399 from
  from(value: SymbolVisibility): Visibility {
    switch (value) {
      case "Hidden":
        return "Hidden";
      case "Protected":
        return "Protected";
      case "Interposable":
        return "Default";
    }
  },
} as const;
/** `#[derive(Debug)]` */
export const debug_Visibility: Debug<Visibility> = (v) => v;

/** The `<[T]>::sort_by_key` key comparison of `SymbolName` (`#[derive(Ord)]` over `&str`) and every `&str`: byte-wise,
 *  which for UTF-8 is code point order. PORT: JS's `<` compares UTF-16 code units, which differs on astral characters. */
function str_cmp(a: string, b: string): -1 | 0 | 1 {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x !== y) {
      // A surrogate belongs to an astral character, above every BMP character; two surrogates order as their characters.
      const sx = x >= 0xd800 && x <= 0xdfff;
      const sy = y >= 0xd800 && y <= 0xdfff;
      if (sx !== sy) return sx ? 1 : -1;
      return x < y ? -1 : 1;
    }
  }
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

// rustc-type: compiler/rustc_middle/src/mono.rs:346 CodegenUnit
// #[derive(Debug, StableHash)]
export class CodegenUnit {
  constructor(
    /// A name for this CGU. Incremental compilation requires that
    /// name be unique amongst **all** crates. Therefore, it should
    /// contain something unique to this crate (e.g., a module path)
    /// as well as the crate name and disambiguator.
    private name_: Symbol,

    /// Symbol name for this CGU. Backend may emit symbols prefixed with this name
    /// and assume uniqueness.
    private symbol_name_: Symbol | undefined,

    private items_: KeyedMap<MonoItem, MonoItemData>,
    private size_estimate_: number,
    private primary: boolean,
    /// True if this is CGU is used to hold code coverage information for dead code,
    /// false otherwise.
    private is_code_coverage_dead_code_cgu_: boolean,
  ) {}

  // #[inline]
  // rustc: compiler/rustc_middle/src/mono.rs:410 new
  static new(name: Symbol): CodegenUnit {
    return new CodegenUnit(name, undefined, new KeyedMap(key_MonoItem), 0, false, false);
  }

  // rustc: compiler/rustc_middle/src/mono.rs:421 name
  name(): Symbol {
    return this.name_;
  }

  // rustc: compiler/rustc_middle/src/mono.rs:425 set_name
  set_name(name: Symbol): void {
    this.name_ = name;
  }

  // rustc: compiler/rustc_middle/src/mono.rs:429 is_primary
  is_primary(): boolean {
    return this.primary;
  }

  // rustc: compiler/rustc_middle/src/mono.rs:433 make_primary
  make_primary(): void {
    this.primary = true;
  }

  // rustc: compiler/rustc_middle/src/mono.rs:437 items
  items(): KeyedMap<MonoItem, MonoItemData> {
    return this.items_;
  }

  // rustc: compiler/rustc_middle/src/mono.rs:441 items_mut
  items_mut(): KeyedMap<MonoItem, MonoItemData> {
    return this.items_;
  }

  // rustc: compiler/rustc_middle/src/mono.rs:445 is_code_coverage_dead_code_cgu
  is_code_coverage_dead_code_cgu(): boolean {
    return this.is_code_coverage_dead_code_cgu_;
  }

  /// Marks this CGU as the one used to contain code coverage information for dead code.
  // rustc: compiler/rustc_middle/src/mono.rs:450 make_code_coverage_dead_code_cgu
  make_code_coverage_dead_code_cgu(): void {
    this.is_code_coverage_dead_code_cgu_ = true;
  }

  // rustc: compiler/rustc_middle/src/mono.rs:454 symbol_name
  symbol_name(): Symbol {
    if (this.symbol_name_ === undefined) panic("CGU symbol name accessed before setting");
    return this.symbol_name_;
  }

  // rustc: compiler/rustc_middle/src/mono.rs:458 set_symbol_name
  set_symbol_name(name: Symbol): void {
    this.symbol_name_ = name;
  }

  // rustc: compiler/rustc_middle/src/mono.rs:462 mangle_name
  static mangle_name(human_readable_name: string): BaseNString {
    const hasher = StableHasher.new();
    // `human_readable_name.hash(&mut hasher)`: `impl Hash for str` is `state.write_str(self)`.
    hasher.write_str(utf8(human_readable_name));
    const hash: Hash128 = hasher.finish(Hash128);
    return to_base_fixed_len(Hash128.as_u128(hash), CASE_INSENSITIVE, ToBaseN_u128);
  }

  // rustc: compiler/rustc_middle/src/mono.rs:469 shorten_name
  static shorten_name(human_readable_name: string): string {
    // Set a limit a somewhat below the common platform limits for file names.
    const MAX_CGU_NAME_LENGTH = 200;
    const TRUNCATED_NAME_PREFIX = "-trunc-";
    if (utf8_len(human_readable_name) > MAX_CGU_NAME_LENGTH) {
      const mangled_name = CodegenUnit.mangle_name(human_readable_name).as_str();
      // Determine a safe byte offset to truncate the name to
      const name = Str.from(human_readable_name);
      const truncate_to = str_floor_char_boundary(name, MAX_CGU_NAME_LENGTH - utf8_len(TRUNCATED_NAME_PREFIX) - utf8_len(mangled_name));
      return `${name.slice(0, truncate_to).toString()}${TRUNCATED_NAME_PREFIX}${mangled_name}`;
    } else {
      // If the name is short enough, we can just return it as is.
      return human_readable_name;
    }
  }

  // rustc: compiler/rustc_middle/src/mono.rs:492 compute_size_estimate
  compute_size_estimate(): void {
    // The size of a codegen unit as the sum of the sizes of the items
    // within it.
    let sum = 0;
    for (const data of this.items_.values()) sum += data.size_estimate;
    this.size_estimate_ = sum;
  }

  /// Should only be called if [`compute_size_estimate`] has previously been called.
  ///
  /// [`compute_size_estimate`]: Self::compute_size_estimate
  // #[inline]
  // rustc: compiler/rustc_middle/src/mono.rs:502 size_estimate
  size_estimate(): number {
    // Items are never zero-sized, so if we have items the estimate must be
    // non-zero, unless we forgot to call `compute_size_estimate` first.
    assert(this.items_.size === 0 || this.size_estimate_ !== 0, "assertion failed: self.items.is_empty() || self.size_estimate != 0");
    return this.size_estimate_;
  }

  // rustc: compiler/rustc_middle/src/mono.rs:509 contains_item
  contains_item(item: MonoItem): boolean {
    return this.items().has(item);
  }

  // rustc: compiler/rustc_middle/src/mono.rs:513 work_product_id
  work_product_id(): never {
    return unported("rustc_middle::dep_graph::WorkProductId::from_cgu_name (incremental)");
  }

  // rustc: compiler/rustc_middle/src/mono.rs:517 previous_work_product
  previous_work_product(_tcx: TyCtxt): never {
    return unported("rustc_middle::dep_graph::DepGraph::previous_work_product (incremental)");
  }

  // rustc: compiler/rustc_middle/src/mono.rs:524 items_in_deterministic_order
  items_in_deterministic_order(tcx: TyCtxt): [MonoItem, MonoItemData][] {
    // The codegen tests rely on items being process in the same order as
    // they appear in the file, so for local items, we sort by span first
    // #[derive(PartialEq, Eq, PartialOrd, Ord)]
    // struct ItemSortKey<'tcx>(Option<OrdSpan>, SymbolName<'tcx>);
    type ItemSortKey = [OrdSpan | undefined, SymbolName];
    const ItemSortKey_cmp = (a: ItemSortKey, b: ItemSortKey): number => {
      // `Option`'s derived `Ord`: `None < Some`.
      if (a[0] === undefined || b[0] === undefined) {
        if (a[0] !== undefined) return 1;
        if (b[0] !== undefined) return -1;
      } else {
        const c = a[0].cmp(b[0]);
        if (c !== 0) return c;
      }
      return str_cmp(a[1].name, b[1].name);
    };

    // We only want to take HirIds of user-defines instances into account.
    // The others don't matter for the codegen tests and can even make item
    // order unstable.
    // rustc: compiler/rustc_middle/src/mono.rs:536 local_item_id
    function local_item_id(item: MonoItem): DefId | undefined {
      switch (item.$) {
        case "Fn": {
          const instance_def = item._0.def;
          switch (instance_def.$) {
            case "Item": {
              const def = instance_def._0;
              return def.as_local() === undefined ? undefined : def;
            }
            case "Intrinsic":
            case "LlvmIntrinsic":
            case "Virtual":
            case "Shim":
              return undefined;
          }
          break;
        }
        case "Static": {
          const def_id = item._0;
          return def_id.as_local() === undefined ? undefined : def_id;
        }
        case "GlobalAsm":
          return item._0.owner_id.to_def_id();
      }
    }
    // rustc: compiler/rustc_middle/src/mono.rs:561 item_sort_key
    function item_sort_key(tcx: TyCtxt, item: MonoItem): ItemSortKey {
      const def_id = local_item_id(item);
      const span = def_id === undefined ? undefined : Span.find_ancestor_not_from_macro(tcx.def_span(def_id));
      return [span === undefined ? undefined : new OrdSpan(span), MonoItem.symbol_name(item, tcx)];
    }

    // PORT: `&data` copies a `Copy` struct.
    const items: [MonoItem, MonoItemData][] = [];
    for (const [i, data] of this.items()) items.push([i, { ...data }]);
    if (!tcx.sess.opts.unstable_opts.codegen_source_order) {
      // In this case, we do not need to keep the items in any specific order, as the input
      // is already deterministic.
      //
      // However, it seems that moving related things (such as different
      // monomorphizations of the same function) close to one another is actually beneficial
      // for LLVM performance.
      // LLVM will codegen the items in the order we pass them to it, and when it handles
      // similar things in succession, it seems that it leads to better cache utilization,
      // less branch mispredictions and in general to better performance.
      // For example, if we have functions `a`, `c::<u32>`, `b`, `c::<i16>`, `d` and
      // `c::<bool>`, it seems that it helps LLVM's performance to codegen the three `c`
      // instantiations right after one another, as they will likely reference similar types,
      // call similar functions, etc.
      //
      // See https://github.com/rust-lang/rust/pull/145358 for more details.
      //
      // Sorting by symbol name should not incur any new non-determinism.
      return sort_by_cached_key(items, ([i, _]) => MonoItem.symbol_name(i, tcx), (a, b) => str_cmp(a.name, b.name));
    } else {
      return sort_by_cached_key(items, ([i, _]) => item_sort_key(tcx, i), ItemSortKey_cmp);
    }
  }

  // rustc: compiler/rustc_middle/src/mono.rs:596 codegen_dep_node
  codegen_dep_node(_tcx: TyCtxt): never {
    return unported("rustc_middle::dep_graph::dep_node::make_compile_codegen_unit (incremental)");
  }

  // impl ToStableHashKey for CodegenUnit<'_>
  // PORT: ported rather than skipped: `UnordItems::collect_sorted` in `place_mono_items` sorts by this key.
  // rustc: compiler/rustc_middle/src/mono.rs:604 to_stable_hash_key
  to_stable_hash_key(): string {
    // Codegen unit names are conceptually required to be stable across
    // compilation session so that object file names match up.
    return Symbol.as_str(this.name_);
  }
}
/** `#[derive(Debug)]` */
export const debug_CodegenUnit: Debug<CodegenUnit> = (v, f) =>
  debug_struct(f, "CodegenUnit", [
    ["name", debug_Symbol(v.name(), f)],
    ["symbol_name", debug_option(v["symbol_name_"], f, debug_Symbol)],
    ["items", debug_map(f, [...v.items()].map(([k, d]): [string, string] => [debug_MonoItem(k, f), debug_MonoItemData(d, f)]))],
    ["size_estimate", String(v["size_estimate_"])],
    ["primary", String(v.is_primary())],
    ["is_code_coverage_dead_code_cgu", String(v.is_code_coverage_dead_code_cgu())],
  ]);
/** `#[derive(Debug)]` of `&[CodegenUnit]`. */
export const debug_CodegenUnits: Debug<readonly CodegenUnit[]> = (v, f) => debug_vec(v, f, debug_CodegenUnit);

/** `<[T]>::sort_by_cached_key` (stable: it sorts `(key, index)` pairs), each key computed once, in slice order. */
function sort_by_cached_key<T, K>(v: T[], key: (x: T) => K, cmp: (a: K, b: K) => number): T[] {
  const keyed = v.map((x) => [key(x), x] as const);
  keyed.sort((a, b) => cmp(a[0], b[0]));
  return keyed.map(([_, x]) => x);
}

// rustc-type: compiler/rustc_middle/src/mono.rs:611 CodegenUnitNameBuilder
export class CodegenUnitNameBuilder {
  private constructor(
    private tcx: TyCtxt,
    private cache: Map<CrateNum, string>,
  ) {}

  // rustc: compiler/rustc_middle/src/mono.rs:617 new
  static new(tcx: TyCtxt): CodegenUnitNameBuilder {
    return new CodegenUnitNameBuilder(tcx, new Map());
  }

  /// CGU names should fulfill the following requirements:
  /// - They should be able to act as a file name on any kind of file system
  /// - They should not collide with other CGU names, even for different versions
  ///   of the same crate.
  ///
  /// Consequently, we don't use special characters except for '.' and '-' and we
  /// prefix each name with the crate-name and crate-disambiguator.
  ///
  /// This function will build CGU names of the form:
  ///
  /// ```text
  /// <crate-name>.<crate-disambiguator>[-in-<local-crate-id>](-<component>)*[.<special-suffix>]
  /// <local-crate-id> = <local-crate-name>.<local-crate-disambiguator>
  /// ```
  ///
  /// The '.' before `<special-suffix>` makes sure that names with a special
  /// suffix can never collide with a name built out of regular Rust
  /// identifiers (e.g., module paths).
  // PORT: `C: fmt::Display` / `S: fmt::Display` are their formatted strings.
  // rustc: compiler/rustc_middle/src/mono.rs:639 build_cgu_name
  build_cgu_name(cnum: CrateNum, components: Iterable<string>, special_suffix: string | undefined): Symbol {
    const cgu_name = this.build_cgu_name_no_mangle(cnum, components, special_suffix);

    if (this.tcx.sess.opts.unstable_opts.human_readable_cgu_names) {
      return Symbol.intern(CodegenUnit.shorten_name(Symbol.as_str(cgu_name)));
    } else {
      return Symbol.intern(CodegenUnit.mangle_name(Symbol.as_str(cgu_name)).as_str());
    }
  }

  /// Same as `CodegenUnit::build_cgu_name()` but will never mangle the
  /// resulting name.
  // rustc: compiler/rustc_middle/src/mono.rs:661 build_cgu_name_no_mangle
  build_cgu_name_no_mangle(cnum: CrateNum, components: Iterable<string>, special_suffix: string | undefined): Symbol {
    let cgu_name = "";

    // Start out with the crate name and disambiguator
    const tcx = this.tcx;
    let crate_prefix = this.cache.get(cnum);
    if (crate_prefix === undefined) {
      // `{:08x}`: `impl LowerHex for StableCrateId` forwards to the `u64`.
      const hex = (id: StableCrateId): string => Hash64.as_u64(StableCrateId._0(id)).toString(16).padStart(8, "0");
      // Whenever the cnum is not LOCAL_CRATE we also mix in the
      // local crate's ID. Otherwise there can be collisions between CGUs
      // instantiating stuff for upstream crates.
      let local_crate_id: string;
      if (cnum !== LOCAL_CRATE) {
        const local_stable_crate_id = tcx.stable_crate_id(LOCAL_CRATE);
        local_crate_id = `-in-${Symbol.as_str(tcx.crate_name(LOCAL_CRATE))}.${hex(local_stable_crate_id)}`;
      } else {
        local_crate_id = "";
      }

      const stable_crate_id = tcx.stable_crate_id(LOCAL_CRATE);
      crate_prefix = `${Symbol.as_str(tcx.crate_name(cnum))}.${hex(stable_crate_id)}${local_crate_id}`;
      this.cache.set(cnum, crate_prefix);
    }

    cgu_name += crate_prefix;

    // Add the components
    for (const component of components) {
      cgu_name += `-${component}`;
    }

    if (special_suffix !== undefined) {
      // We add a dot in here so it cannot clash with anything in a regular
      // Rust identifier
      cgu_name += `.${special_suffix}`;
    }

    return Symbol.intern(cgu_name);
  }
}

/// See module-level docs of `rustc_monomorphize::collector` on some context for "mentioned" items.
// rustc-type: compiler/rustc_middle/src/mono.rs:712 CollectionMode
// #[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, StableHash)]
export type CollectionMode =
  /// Collect items that are used, i.e., actually needed for codegen.
  ///
  /// Which items are used can depend on optimization levels, as MIR optimizations can remove
  /// uses.
  | "UsedItems"
  /// Collect items that are mentioned. The goal of this mode is that it is independent of
  /// optimizations: the set of "mentioned" items is computed before optimizations are run.
  ///
  /// The exact contents of this set are *not* a stable guarantee. (For instance, it is currently
  /// computed after drop-elaboration. If we ever do some optimizations even in debug builds, we
  /// might decide to run them before computing mentioned items.) The key property of this set is
  /// that it is optimization-independent.
  | "MentionedItems";
export const CollectionMode = { UsedItems: "UsedItems", MentionedItems: "MentionedItems" } as const;
/** `#[derive(Debug)]`: the variant name. */
export const debug_CollectionMode: Debug<CollectionMode> = (v) => v;
