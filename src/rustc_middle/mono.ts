// Port of compiler/rustc_middle/src/mono.rs (lane symbol-mangling: the part `rustc_symbol_mangling`'s
// `compute_symbol_name` reaches, `MonoItem::instantiation_mode` and the small `MonoItem` helpers before it).
// The rest of the file (CGUs, `CodegenUnitNameBuilder`, `explicit_linkage`, ...) belongs to monomorphization (M4+)
// and is not ported yet.
//
// PORT: `InstantiationMode` / `MonoItem` are tagged unions; `MonoItem`'s methods live on the companion const
// (PORTING §8). `#[derive(PartialEq)]` on `InstantiationMode` is `InstantiationMode_eq`.
// Lane query-keys: `CollectionMode` (the key of `items_of_instance`), as a fieldless enum (PORTING §5).
import { InlineAttr } from "../rustc_attr_ir/data_structures.ts";
import type { ItemId } from "../rustc_hir/hir.ts";
import { type CrateNum, type DefId, LOCAL_CRATE } from "../rustc_span/def_id.ts";
import { CodegenFnAttrFlags, CodegenFnAttrs, TyCtxt_codegen_instance_attrs } from "./middle/codegen_fn_attrs.ts";
import type { TyCtxt } from "./ty/context.ts";
import { Instance, InstanceKind } from "./ty/instance.ts";
import type { SymbolName, Ty } from "./ty/mod.ts";
import type { Debug } from "../std/fmt.ts";

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

// #[derive(PartialEq, Eq, Clone, Copy, Debug, Hash, StableHash, TyEncodable, TyDecodable)]
export type MonoItem =
  | { readonly $: "Fn"; readonly _0: Instance }
  | { readonly $: "Static"; readonly _0: DefId }
  | { readonly $: "GlobalAsm"; readonly _0: ItemId };

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
