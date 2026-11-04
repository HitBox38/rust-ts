//! Partitioning Codegen Units for Incremental Compilation
//! ======================================================
//!
//! The task of this module is to take the complete set of monomorphizations of
//! a crate and produce a set of codegen units from it, where a codegen unit
//! is a named set of (mono-item, linkage) pairs. That is, this module
//! decides which monomorphization appears in which codegen units with which
//! linkage. The following paragraphs describe some of the background on the
//! partitioning scheme.
//!
//! The most important opportunity for saving on compilation time with
//! incremental compilation is to avoid re-codegenning and re-optimizing code.
//! Since the unit of codegen and optimization for LLVM is "modules" or, how
//! we call them "codegen units", the particulars of how much time can be saved
//! by incremental compilation are tightly linked to how the output program is
//! partitioned into these codegen units prior to passing it to LLVM --
//! especially because we have to treat codegen units as opaque entities once
//! they are created: There is no way for us to incrementally update an existing
//! LLVM module and so we have to build any such module from scratch if it was
//! affected by some change in the source code.
//!
//! From that point of view it would make sense to maximize the number of
//! codegen units by, for example, putting each function into its own module.
//! That way only those modules would have to be re-compiled that were actually
//! affected by some change, minimizing the number of functions that could have
//! been re-used but just happened to be located in a module that is
//! re-compiled.
//!
//! However, since LLVM optimization does not work across module boundaries,
//! using such a highly granular partitioning would lead to very slow runtime
//! code since it would effectively prohibit inlining and other inter-procedure
//! optimizations. We want to avoid that as much as possible.
//!
//! Thus we end up with a trade-off: The bigger the codegen units, the better
//! LLVM's optimizer can do its work, but also the smaller the compilation time
//! reduction we get from incremental compilation.
//!
//! Ideally, we would create a partitioning such that there are few big codegen
//! units with few interdependencies between them. For now though, we use the
//! following heuristic to determine the partitioning:
//!
//! - There are two codegen units for every source-level module:
//! - One for "stable", that is non-generic, code
//! - One for more "volatile" code, i.e., monomorphized instances of functions
//!   defined in that module
//!
//! In order to see why this heuristic makes sense, let's take a look at when a
//! codegen unit can get invalidated:
//!
//! 1. The most straightforward case is when the BODY of a function or global
//! changes. Then any codegen unit containing the code for that item has to be
//! re-compiled. Note that this includes all codegen units where the function
//! has been inlined.
//!
//! 2. The next case is when the SIGNATURE of a function or global changes. In
//! this case, all codegen units containing a REFERENCE to that item have to be
//! re-compiled. This is a superset of case 1.
//!
//! 3. The final and most subtle case is when a REFERENCE to a generic function
//! is added or removed somewhere. Even though the definition of the function
//! might be unchanged, a new REFERENCE might introduce a new monomorphized
//! instance of this function which has to be placed and compiled somewhere.
//! Conversely, when removing a REFERENCE, it might have been the last one with
//! that particular set of generic arguments and thus we have to remove it.
//!
//! From the above we see that just using one codegen unit per source-level
//! module is not such a good idea, since just adding a REFERENCE to some
//! generic item somewhere else would invalidate everything within the module
//! containing the generic item. The heuristic above reduces this detrimental
//! side-effect of references a little by at least not touching the non-generic
//! code of the module.
//!
//! A Note on Inlining
//! ------------------
//! As briefly mentioned above, in order for LLVM to be able to inline a
//! function call, the body of the function has to be available in the LLVM
//! module where the call is made. This has a few consequences for partitioning:
//!
//! - The partitioning algorithm has to take care of placing functions into all
//!   codegen units where they should be available for inlining. It also has to
//!   decide on the correct linkage for these functions.
//!
//! - The partitioning algorithm has to know which functions are likely to get
//!   inlined, so it can distribute function instantiations accordingly. Since
//!   there is no way of knowing for sure which functions LLVM will decide to
//!   inline in the end, we apply a heuristic here: Only functions marked with
//!   `#[inline]` are considered for inlining by the partitioner. The current
//!   implementation will not try to determine if a function is likely to be
//!   inlined by looking at the functions definition.
//!
//! Note though that as a side-effect of creating a codegen units per
//! source-level module, functions from the same module will be available for
//! inlining, even when they are not marked `#[inline]`.
//
// Port of compiler/rustc_monomorphize/src/partitioning.rs (lane mono-partition).
//
// PORT: ordering, since partition results are visible and depend on it:
// - `UnordMap` / `UnordSet` are `Map` / `Set`. Upstream only iterates them through `collect_sorted` or lookups, so their
//   iteration order is not observable (`place_mono_items`' map, `cgu_contents`, `new_cgu_names`, `item_to_cgus`).
// - `FxIndexMap` / `FxIndexSet` keep insertion order, as `Map` / `Set` do; `IndexMap::append` is `insert` of each entry,
//   keeping the position of a key that is already there (indexmap-2.14.0 map.rs:810) and overwriting its value.
// - `sort_by_key`, `sort_by` and `sort_by_cached_key` are stable, as `Array.prototype.sort` is, and their comparators
//   are consistent total preorders, so any stable sort gives their result (std/slice_sort.ts header).
// - `&str` / `String` compare byte-wise, code point order (`str_cmp`), not as JS `<` does.
// - `Symbol`'s `Ord` is its index (`#[derive(Ord)]` on `Symbol(SymbolIndex)`), so `-Zprint-mono-items` orders the CGUs of
//   one item by interning order: `*name` here too. The port's interner numbers symbols sequentially, and the CGU names
//   are interned in the same order as upstream by the same code.
// - The one unstable sort whose ties are observable (`stats` in `dump_mono_items_stats`) is std/slice_sort.ts's ipnsort.
// PORT: `debug!` calls are comments (driver-m2 decision 8); rustc release builds compile them out.
// PORT: `let _prof_timer = tcx.prof.generic_activity(..)` guards are `.run(..)` closures (as rustc_interface passes.ts).
// PORT(contract): `collector` and the diagnostics come from ./pending_mono_collector.ts until lane mono-collector merges.
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { InlineAttr, Linkage, debug_Linkage } from "../rustc_attr_ir/data_structures.ts";
import { par_join } from "../rustc_data_structures/sync/parallel.ts";
import { DefKind } from "../rustc_hir/def.ts";
import { DefPathData } from "../rustc_hir_id/definitions.ts";
import { type CodegenFnAttrs, CodegenFnAttrFlags, TyCtxt_codegen_instance_attrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import { type SymbolExportInfo, SymbolExportLevel } from "../rustc_middle/middle/exported_symbols.ts";
import {
  CodegenUnit,
  CodegenUnitNameBuilder,
  type MonoItemData,
  type MonoItemPartitions,
  MonoItem,
  Visibility,
  display_MonoItem,
  key_MonoItem,
} from "../rustc_middle/mono.ts";
import type { BasicBlockData } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { Instance, InstanceKind } from "../rustc_middle/ty/instance.ts";
import { TyCtxt_assoc_parent, TyCtxt_instance_mir, type Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { characteristic_def_id_of_type } from "../rustc_middle/ty/print/mod.ts";
import { with_no_trimmed_paths } from "../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { Providers } from "../rustc_middle/util/mod.ts";
import { KeyedMap, KeyedSet } from "../rust_ts/keyed.ts";
import { DumpMonoStatsFormat, Options_impl, std_print } from "../rustc_session/config.ts";
import { str_cmp } from "../rustc_session/options.ts";
import { CodegenUnits, type Session } from "../rustc_session/session.ts";
import { CrateNum, type DefId, DefIdMap, DefIdSet, LOCAL_CRATE } from "../rustc_span/def_id.ts";
import { Span } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { Symbol, debug_Symbol } from "../rustc_span/symbol.ts";
import { mangle_cgu } from "../rustc_symbol_mangling/lib.ts";
import { SymbolVisibility } from "../rustc_target/spec/mod.ts";
import type { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { PLAIN } from "../std/fmt.ts";
import { display_IoError, io_error_from_node } from "../std/io.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { assert, assert_eq, panic, unported, unreachable } from "../std/panic.ts";
import { path_join } from "../std/path.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { slice_sort_unstable_by } from "../std/slice_sort.ts";
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { target_specific_checks } from "./graph_checks/mod.ts";
import {
  CouldntDumpMonoStats_diagnostic,
  type MonoItemCollectionStrategy,
  SymbolAlreadyDefined_diagnostic,
  type UsageMap,
  collector,
} from "./pending_mono_collector.ts";

interface PartitioningCx {
  tcx: TyCtxt;
  usage_map: UsageMap;
}

interface PlacedMonoItems {
  /// The codegen units, sorted by name to make things deterministic.
  codegen_units: CodegenUnit[];

  internalization_candidates: KeyedSet<MonoItem>;
}

/** `a.name().as_str() <= b.name().as_str()` for every neighbouring pair (`is_sorted_by`). */
function is_sorted_by_name(codegen_units: readonly CodegenUnit[]): boolean {
  for (let i = 1; i < codegen_units.length; i++) {
    if (str_cmp(Symbol.as_str(codegen_units[i - 1]!.name()), Symbol.as_str(codegen_units[i]!.name())) > 0) return false;
  }
  return true;
}

// The output CGUs are sorted by name.
// rustc: compiler/rustc_monomorphize/src/partitioning.rs:143 partition
function partition(tcx: TyCtxt, mono_items: Iterable<MonoItem>, usage_map: UsageMap): CodegenUnit[] {
  return tcx.prof.generic_activity("cgu_partitioning").run(() => {
    const cx: PartitioningCx = { tcx, usage_map };

    // Place all mono items into a codegen unit. `place_mono_items` is
    // responsible for initializing the CGU size estimates.
    const { codegen_units, internalization_candidates } = tcx.prof.generic_activity("cgu_partitioning_place_items").run(() => {
      const placed = place_mono_items(cx, mono_items);

      debug_dump(tcx, "PLACE", placed.codegen_units);

      return placed;
    });

    // Merge until we don't exceed the max CGU count.
    // `merge_codegen_units` is responsible for updating the CGU size
    // estimates.
    tcx.prof.generic_activity("cgu_partitioning_merge_cgus").run(() => {
      merge_codegen_units(cx, codegen_units);
      debug_dump(tcx, "MERGE", codegen_units);
    });

    // Make as many symbols "internal" as possible, so LLVM has more freedom to
    // optimize.
    if (!tcx.sess.link_dead_code()) {
      tcx.prof.generic_activity("cgu_partitioning_internalize_symbols").run(() => {
        internalize_symbols(cx, codegen_units, internalization_candidates);

        debug_dump(tcx, "INTERNALIZE", codegen_units);
      });
    }

    // Mark one CGU for dead code, if necessary.
    if (tcx.sess.instrument_coverage()) {
      mark_code_coverage_dead_code_cgu(codegen_units);
    }

    // Ensure CGUs are sorted by name, so that we get deterministic results.
    if (!is_sorted_by_name(codegen_units)) {
      let names = "";
      for (const cgu of codegen_units) {
        names += `- ${Symbol.as_str(cgu.name())}\n`;
      }
      bug(`unsorted CGUs:\n${names}`);
    }

    return codegen_units;
  });
}

// rustc: compiler/rustc_monomorphize/src/partitioning.rs:201 place_mono_items
function place_mono_items(cx: PartitioningCx, mono_items: Iterable<MonoItem>): PlacedMonoItems {
  const codegen_units_map = new Map<Symbol, CodegenUnit>();
  const is_incremental_build = cx.tcx.sess.opts.incremental !== undefined;
  const internalization_candidates = new KeyedSet<MonoItem>(key_MonoItem);

  // Determine if monomorphizations instantiated in this crate will be made
  // available to downstream crates. This depends on whether we are in
  // share-generics mode and whether the current crate can even have
  // downstream crates.
  const can_export_generics = cx.tcx.local_crate_exports_generics();
  const always_export_generics = can_export_generics && share_generics(cx.tcx.sess);

  const cgu_name_builder = CodegenUnitNameBuilder.new(cx.tcx);
  const cgu_name_cache: CguNameCache = new Map();

  for (const mono_item of mono_items) {
    // Handle only root (GloballyShared) items directly here. Inlined (LocalCopy) items
    // are handled at the bottom of the loop based on reachability, with one exception.
    // The #[lang = "start"] item is the program entrypoint, so there are no calls to it in MIR.
    // So even if its mode is LocalCopy, we need to treat it like a root.
    switch (MonoItem.instantiation_mode(mono_item, cx.tcx).$) {
      case "GloballyShared":
        break;
      case "LocalCopy":
        continue;
    }

    const characteristic_def_id = characteristic_def_id_of_mono_item(cx.tcx, mono_item);
    const is_volatile = is_incremental_build && MonoItem.is_generic_fn(mono_item);

    const cgu_name =
      characteristic_def_id !== undefined
        ? compute_codegen_unit_name(cx.tcx, cgu_name_builder, characteristic_def_id, is_volatile, cgu_name_cache)
        : fallback_cgu_name(cgu_name_builder);

    let cgu = codegen_units_map.get(cgu_name);
    if (cgu === undefined) {
      cgu = CodegenUnit.new(cgu_name);
      codegen_units_map.set(cgu_name, cgu);
    }

    const can_be_internalized: MutRef<boolean> = { value: true };
    const [linkage, visibility] = mono_item_linkage_and_visibility(cx.tcx, mono_item, can_be_internalized, can_export_generics, always_export_generics);

    if (visibility === Visibility.Hidden && can_be_internalized.value) {
      internalization_candidates.add(mono_item);
    }
    const size_estimate = MonoItem.size_estimate(mono_item, cx.tcx);

    cgu.items_mut().set(mono_item, { inlined: false, linkage, visibility, size_estimate });

    // Get all inlined items that are reachable from `mono_item` without
    // going via another root item. This includes drop-glue, functions from
    // external crates, and local functions the definition of which is
    // marked with `#[inline]`.
    const reachable_inlined_items = new KeyedSet<MonoItem>(key_MonoItem);
    get_reachable_inlined_items(cx.tcx, mono_item, cx.usage_map, reachable_inlined_items);

    // Add those inlined items. It's possible an inlined item is reachable
    // from multiple root items within a CGU, which is fine, it just means
    // the `insert` will be a no-op.
    for (const inlined_item of reachable_inlined_items) {
      // This is a CGU-private copy.
      if (!cgu.items_mut().has(inlined_item)) {
        cgu.items_mut().set(inlined_item, {
          inlined: true,
          linkage: Linkage.Internal,
          visibility: Visibility.Default,
          size_estimate: MonoItem.size_estimate(inlined_item, cx.tcx),
        });
      }
    }
  }

  // Always ensure we have at least one CGU; otherwise, if we have a
  // crate with just types (for example), we could wind up with no CGU.
  if (codegen_units_map.size === 0) {
    const cgu_name = fallback_cgu_name(cgu_name_builder);
    codegen_units_map.set(cgu_name, CodegenUnit.new(cgu_name));
  }

  // `codegen_units.into_items().map(|(_, cgu)| cgu).collect_sorted(&mut hcx, true)`: sorted by the `String` from
  // `CodegenUnit::to_stable_hash_key`.
  const codegen_units = sorted_by_stable_hash_key(codegen_units_map);

  for (const cgu of codegen_units) {
    cgu.compute_size_estimate();
  }

  return { codegen_units, internalization_candidates };

  // rustc: compiler/rustc_monomorphize/src/partitioning.rs:300 get_reachable_inlined_items
  function get_reachable_inlined_items(tcx: TyCtxt, item: MonoItem, usage_map: UsageMap, visited: KeyedSet<MonoItem>): void {
    usage_map.for_each_inlined_used_item(tcx, item, (inlined_item) => {
      const is_new = !visited.has(inlined_item);
      visited.add(inlined_item);
      if (is_new) {
        get_reachable_inlined_items(tcx, inlined_item, usage_map, visited);
      }
    });
  }
}

/** `UnordItems::collect_sorted(hcx, true)` of `CodegenUnit`s: `sort_by_cached_key(to_stable_hash_key)`. */
function sorted_by_stable_hash_key(codegen_units: Map<Symbol, CodegenUnit>): CodegenUnit[] {
  const keyed: [string, CodegenUnit][] = [];
  for (const cgu of codegen_units.values()) keyed.push([cgu.to_stable_hash_key(), cgu]);
  keyed.sort((a, b) => str_cmp(a[0], b[0]));
  return keyed.map((k) => k[1]);
}

/** `Options::share_generics` lives on `Options_impl` (rustc_session config.ts). */
function share_generics(sess: Session): boolean {
  return Options_impl.share_generics(sess.opts);
}

/** `Vec::swap_remove` */
function swap_remove<T>(v: T[], index: number): T {
  const removed = v[index]!;
  const last = v.pop()!;
  if (index < v.length) v[index] = last;
  return removed;
}

/** `sort_by_key(|cgu| cmp::Reverse(cgu.size_estimate()))` */
function sort_by_reverse_size(codegen_units: CodegenUnit[]): void {
  codegen_units.sort((a, b) => b.size_estimate() - a.size_estimate());
}

/** `items_mut().append(src.items_mut())` (see the header). */
function append_items(dst: CodegenUnit, src: CodegenUnit): void {
  for (const [item, data] of src.items_mut()) dst.items_mut().set(item, data);
  src.items_mut().clear();
}

// This function requires the CGUs to be sorted by name on input, and ensures
// they are sorted by name on return, for deterministic behaviour.
// rustc: compiler/rustc_monomorphize/src/partitioning.rs:317 merge_codegen_units
function merge_codegen_units(cx: PartitioningCx, codegen_units: CodegenUnit[]): void {
  assert(CodegenUnits.as_usize(cx.tcx.sess.codegen_units()) >= 1, "assertion failed: cx.tcx.sess.codegen_units().as_usize() >= 1");

  // A sorted order here ensures merging is deterministic.
  assert(is_sorted_by_name(codegen_units), "assertion failed: codegen_units.is_sorted_by(|a, b| a.name().as_str() <= b.name().as_str())");

  // This map keeps track of what got merged into what.
  const cgu_contents = new Map<Symbol, Symbol[]>(codegen_units.map((cgu) => [cgu.name(), [cgu.name()]]));

  // If N is the maximum number of CGUs, and the CGUs are sorted from largest
  // to smallest, we repeatedly find which CGU in codegen_units[N..] has the
  // greatest overlap of inlined items with codegen_units[N-1], merge that
  // CGU into codegen_units[N-1], then re-sort by size and repeat.
  //
  // We use inlined item overlap to guide this merging because it minimizes
  // duplication of inlined items, which makes LLVM be faster and generate
  // better and smaller machine code.
  //
  // Why merge into codegen_units[N-1]? We want CGUs to have similar sizes,
  // which means we don't want codegen_units[0..N] (the already big ones)
  // getting any bigger, if we can avoid it. When we have more than N CGUs
  // then at least one of the biggest N will have to grow. codegen_units[N-1]
  // is the smallest of those, and so has the most room to grow.
  const max_codegen_units = CodegenUnits.as_usize(cx.tcx.sess.codegen_units());
  while (codegen_units.length > max_codegen_units) {
    // Sort small CGUs to the back.
    sort_by_reverse_size(codegen_units);

    const cgu_dst_ = codegen_units[max_codegen_units - 1]!;

    // Find the CGU that overlaps the most with `cgu_dst`. In the case of a
    // tie, favour the earlier (bigger) CGU.
    let max_overlap = 0;
    let max_overlap_i = max_codegen_units;
    for (let i = max_codegen_units; i < codegen_units.length; i++) {
      const cgu_src = codegen_units[i]!;
      if (cgu_src.size_estimate() <= max_overlap) {
        // None of the remaining overlaps can exceed `max_overlap`, so
        // stop looking.
        break;
      }

      const overlap = compute_inlined_overlap(cgu_dst_, cgu_src);
      if (overlap > max_overlap) {
        max_overlap = overlap;
        max_overlap_i = i;
      }
    }

    const cgu_src = swap_remove(codegen_units, max_overlap_i);
    const cgu_dst = codegen_units[max_codegen_units - 1]!;

    // Move the items from `cgu_src` to `cgu_dst`. Some of them may be
    // duplicate inlined items, in which case the destination CGU is
    // unaffected. Recalculate size estimates afterwards.
    append_items(cgu_dst, cgu_src);
    cgu_dst.compute_size_estimate();

    // Record that `cgu_dst` now contains all the stuff that was in
    // `cgu_src` before.
    const consumed_cgu_names = cgu_contents.get(cgu_src.name())!;
    cgu_contents.delete(cgu_src.name());
    cgu_contents.get(cgu_dst.name())!.push(...consumed_cgu_names);
  }

  // Having multiple CGUs can drastically speed up compilation. But for
  // non-incremental builds, tiny CGUs slow down compilation *and* result in
  // worse generated code. So we don't allow CGUs smaller than this (unless
  // there is just one CGU, of course). Note that CGU sizes of 100,000+ are
  // common in larger programs, so this isn't all that large.
  const NON_INCR_MIN_CGU_SIZE = 1800;

  // Repeatedly merge the two smallest codegen units as long as: it's a
  // non-incremental build, and the user didn't specify a CGU count, and
  // there are multiple CGUs, and some are below the minimum size.
  //
  // The "didn't specify a CGU count" condition is because when an explicit
  // count is requested we observe it as closely as possible. For example,
  // the `compiler_builtins` crate sets `codegen-units = 10000` and it's
  // critical they aren't merged. Also, some tests use explicit small values
  // and likewise won't work if small CGUs are merged.
  while (
    cx.tcx.sess.opts.incremental === undefined &&
    cx.tcx.sess.codegen_units().$ === "Default" &&
    codegen_units.length > 1 &&
    codegen_units.some((cgu) => cgu.size_estimate() < NON_INCR_MIN_CGU_SIZE)
  ) {
    // Sort small cgus to the back.
    sort_by_reverse_size(codegen_units);

    const smallest = codegen_units.pop()!;
    const second_smallest = codegen_units[codegen_units.length - 1]!;

    // Move the items from `smallest` to `second_smallest`. Some of them
    // may be duplicate inlined items, in which case the destination CGU is
    // unaffected. Recalculate size estimates afterwards.
    append_items(second_smallest, smallest);
    second_smallest.compute_size_estimate();

    // Don't update `cgu_contents`, that's only for incremental builds.
  }

  const cgu_name_builder = CodegenUnitNameBuilder.new(cx.tcx);

  // Rename the newly merged CGUs.
  if (cx.tcx.sess.opts.incremental !== undefined) {
    // If we are doing incremental compilation, we want CGU names to
    // reflect the path of the source level module they correspond to.
    // For CGUs that contain the code of multiple modules because of the
    // merging done above, we use a concatenation of the names of all
    // contained CGUs.
    const new_cgu_names = new Map<Symbol, string>();
    for (const [current_cgu_name, contents] of cgu_contents) {
      // This `filter` makes sure we only update the name of CGUs that
      // were actually modified by merging.
      if (contents.length > 1) {
        const names = contents.map((s) => Symbol.as_str(s));

        // Sort the names, so things are deterministic and easy to
        // predict. We are sorting primitive `&str`s here so we can
        // use unstable sort.
        names.sort(str_cmp);

        new_cgu_names.set(current_cgu_name, names.join("--"));
      }
    }

    for (const cgu of codegen_units) {
      const new_cgu_name = new_cgu_names.get(cgu.name());
      if (new_cgu_name !== undefined) {
        const new_name = cx.tcx.sess.opts.unstable_opts.human_readable_cgu_names
          ? Symbol.intern(CodegenUnit.shorten_name(new_cgu_name))
          : // If we don't require CGU names to be human-readable,
            // we use a fixed length hash of the composite CGU name
            // instead.
            Symbol.intern(CodegenUnit.mangle_name(new_cgu_name).as_str());
        cgu.set_name(new_name);
      }

      // Assign symbol name to each CGU units.
      cgu.set_symbol_name(Symbol.intern(mangle_cgu(cx.tcx, LOCAL_CRATE, { $: "Right", _0: Symbol.as_str(cgu.name()) })));
    }

    // A sorted order here ensures what follows can be deterministic.
    codegen_units.sort((a, b) => str_cmp(Symbol.as_str(a.name()), Symbol.as_str(b.name())));
  } else {
    // When compiling non-incrementally, we rename the CGUS so they have
    // identical names except for the numeric suffix, something like
    // `regex.f10ba03eb5ec7975-cgu.N`, where `N` varies.
    //
    // It is useful for debugging and profiling purposes if the resulting
    // CGUs are sorted by name *and* reverse sorted by size. (CGU 0 is the
    // biggest, CGU 1 is the second biggest, etc.)
    //
    // So first we reverse sort by size. Then we generate the names with
    // zero-padded suffixes, which means they are automatically sorted by
    // names. The numeric suffix width depends on the number of CGUs, which
    // is always greater than zero:
    // - [1,9]     CGUs: `0`, `1`, `2`, ...
    // - [10,99]   CGUs: `00`, `01`, `02`, ...
    // - [100,999] CGUs: `000`, `001`, `002`, ...
    // - etc.
    //
    // If we didn't zero-pad the sorted-by-name order would be `XYZ-cgu.0`,
    // `XYZ-cgu.1`, `XYZ-cgu.10`, `XYZ-cgu.11`, ..., `XYZ-cgu.2`, etc.
    sort_by_reverse_size(codegen_units);
    // PORT: `len.ilog10() + 1` is the number of decimal digits of `len` (never 0: there is always a CGU).
    const num_digits = String(codegen_units.length).length;
    for (let index = 0; index < codegen_units.length; index++) {
      const cgu = codegen_units[index]!;
      // Note: `WorkItem::short_description` depends on this name ending
      // with `-cgu.` followed by a numeric suffix. Please keep it in
      // sync with this code.
      const suffix = String(index).padStart(num_digits, "0");
      const numbered_codegen_unit_name = cgu_name_builder.build_cgu_name_no_mangle(LOCAL_CRATE, ["cgu"], suffix);
      cgu.set_name(numbered_codegen_unit_name);

      cgu.set_symbol_name(Symbol.intern(mangle_cgu(cx.tcx, LOCAL_CRATE, { $: "Left", _0: BigInt(index) })));
    }
  }
}

/// Compute the combined size of all inlined items that appear in both `cgu1`
/// and `cgu2`.
// rustc: compiler/rustc_monomorphize/src/partitioning.rs:513 compute_inlined_overlap
function compute_inlined_overlap(cgu1: CodegenUnit, cgu2: CodegenUnit): number {
  // Either order works. We pick the one that involves iterating over fewer
  // items.
  const [src_cgu, dst_cgu] = cgu1.items().size <= cgu2.items().size ? [cgu1, cgu2] : [cgu2, cgu1];

  let overlap = 0;
  for (const [item, data] of src_cgu.items()) {
    if (data.inlined && dst_cgu.items().has(item)) {
      overlap += data.size_estimate;
    }
  }
  return overlap;
}

/// For symbol internalization, we need to know whether a symbol/mono-item
/// is used from outside the codegen unit it is defined in. This type is
/// used to keep track of that.
// #[derive(Clone, PartialEq, Eq, Debug)]
type MonoItemPlacement = { readonly $: "SingleCgu"; readonly _0: Symbol } | { readonly $: "MultipleCgus" };
/** `#[derive(PartialEq)]` */
function MonoItemPlacement_eq(a: MonoItemPlacement, b: MonoItemPlacement): boolean {
  if (a.$ === "SingleCgu" && b.$ === "SingleCgu") return a._0 === b._0;
  return a.$ === b.$;
}

// rustc: compiler/rustc_monomorphize/src/partitioning.rs:528 internalize_symbols
function internalize_symbols(cx: PartitioningCx, codegen_units: CodegenUnit[], internalization_candidates: KeyedSet<MonoItem>): void {
  const mono_item_placements = new KeyedMap<MonoItem, MonoItemPlacement>(key_MonoItem);
  const single_codegen_unit = codegen_units.length === 1;

  if (!single_codegen_unit) {
    for (const cgu of codegen_units) {
      for (const item of cgu.items().keys()) {
        // If there is more than one codegen unit, we need to keep track
        // in which codegen units each monomorphization is placed.
        if (mono_item_placements.has(item)) {
          // debug_assert!(match *placement {
          //     MonoItemPlacement::SingleCgu(cgu_name) => cgu_name != cgu.name(),
          //     MonoItemPlacement::MultipleCgus => true,
          // });
          mono_item_placements.set(item, { $: "MultipleCgus" });
        } else {
          mono_item_placements.set(item, { $: "SingleCgu", _0: cgu.name() });
        }
      }
    }
  }

  // For each internalization candidates in each codegen unit, check if it is
  // used from outside its defining codegen unit.
  for (const cgu of codegen_units) {
    const home_cgu: MonoItemPlacement = { $: "SingleCgu", _0: cgu.name() };

    item_loop: for (const [item, data] of cgu.items_mut()) {
      if (!internalization_candidates.has(item)) {
        // This item is no candidate for internalizing, so skip it.
        continue;
      }

      if (!single_codegen_unit) {
        // debug_assert_eq!(mono_item_placements[item], home_cgu);

        for (const user_item of cx.usage_map.get_user_items(item)) {
          // Some user mono items might not have been
          // instantiated. We can safely ignore those.
          const placement = mono_item_placements.get(user_item);
          if (placement !== undefined && !MonoItemPlacement_eq(placement, home_cgu)) {
            // Found a user from another CGU, so skip to the next item
            // without marking this one as internal.
            continue item_loop;
          }
        }
      }

      // When LTO inlines the caller of a naked function, it will attempt but fail to make the
      // naked function symbol visible. To ensure that LTO works correctly, do not default
      // naked functions to internal linkage and default visibility.
      if (item.$ === "Fn") {
        const flags = TyCtxt_codegen_instance_attrs(cx.tcx, item._0.def).flags;
        if (CodegenFnAttrFlags.contains(flags, CodegenFnAttrFlags.NAKED)) {
          continue;
        }
      }

      // If we got here, we did not find any uses from other CGUs, so
      // it's fine to make this monomorphization internal.
      data.linkage = Linkage.Internal;
      data.visibility = Visibility.Default;
    }
  }
}

// rustc: compiler/rustc_monomorphize/src/partitioning.rs:616 mark_code_coverage_dead_code_cgu
function mark_code_coverage_dead_code_cgu(codegen_units: CodegenUnit[]): void {
  assert(codegen_units.length !== 0, "assertion failed: !codegen_units.is_empty()");

  // Find the smallest CGU that has exported symbols and put the dead
  // function stubs in that CGU. We look for exported symbols to increase
  // the likelihood the linker won't throw away the dead functions.
  // FIXME(#92165): In order to truly resolve this, we need to make sure
  // the object file (CGU) containing the dead function stubs is included
  // in the final binary. This will probably require forcing these
  // function symbols to be included via `-u` or `/include` linker args.
  // PORT: `min_by_key` returns the first of several minima.
  let dead_code_cgu: CodegenUnit | undefined = undefined;
  for (const cgu of codegen_units) {
    if ([...cgu.items().values()].some((data) => data.linkage === Linkage.External)) {
      if (dead_code_cgu === undefined || cgu.size_estimate() < dead_code_cgu.size_estimate()) {
        dead_code_cgu = cgu;
      }
    }
  }

  // If there are no CGUs that have externally linked items, then we just
  // pick the first CGU as a fallback.
  (dead_code_cgu ?? codegen_units[0]!).make_code_coverage_dead_code_cgu();
}

// rustc: compiler/rustc_monomorphize/src/partitioning.rs:638 characteristic_def_id_of_mono_item
function characteristic_def_id_of_mono_item(tcx: TyCtxt, mono_item: MonoItem): DefId | undefined {
  switch (mono_item.$) {
    case "Fn": {
      const instance = mono_item._0;
      let def_id: DefId;
      switch (instance.def.$) {
        case "Item":
          def_id = instance.def._0;
          break;
        case "Intrinsic":
        case "LlvmIntrinsic":
        case "Virtual":
        case "Shim":
          return undefined;
      }

      // If this is a method, we want to put it into the same module as
      // its self-type. If the self-type does not provide a characteristic
      // DefId, we use the location of the impl after all.

      const assoc_parent = TyCtxt_assoc_parent(tcx, def_id);

      if (assoc_parent !== undefined && assoc_parent[1].$ === "Trait") {
        const self_ty = instance.args.type_at(0);
        // This is a default implementation of a trait method.
        return characteristic_def_id_of_type(self_ty) ?? def_id;
      }

      if (assoc_parent !== undefined && assoc_parent[1].$ === "Impl") {
        const [impl_def_id, { of_trait }] = assoc_parent as [DefId, { of_trait: boolean }];
        if (of_trait && tcx.sess.opts.incremental !== undefined && tcx.is_lang_item(tcx.impl_trait_id(impl_def_id), LangItem.Drop)) {
          // Put `Drop::drop` into the same cgu as `drop_glue`
          // since `drop_glue` is the only thing that can call it.
          return undefined;
        }

        // This is a method within an impl, find out what the self-type is:
        const impl_self_ty = tcx.instantiate_and_normalize_erasing_regions(instance.args, TypingEnv.fully_monomorphized(), tcx.type_of(impl_def_id) as EarlyBinder<Ty>, fold_Ty);
        const characteristic = characteristic_def_id_of_type(impl_self_ty);
        if (characteristic !== undefined) {
          return characteristic;
        }
      }

      return def_id;
    }
    case "Static":
      return mono_item._0;
    case "GlobalAsm":
      return mono_item._0.owner_id.to_def_id();
  }
}

// rustc: compiler/rustc_monomorphize/src/partitioning.rs:704 compute_codegen_unit_name
function compute_codegen_unit_name(tcx: TyCtxt, name_builder: CodegenUnitNameBuilder, def_id: DefId, volatile: boolean, cache: CguNameCache): Symbol {
  // Find the innermost module that is not nested within a function.
  let current_def_id = def_id;
  let cgu_def_id_: DefId | undefined = undefined;
  // Walk backwards from the item we want to find the module for.
  for (;;) {
    if (current_def_id.is_crate_root()) {
      if (cgu_def_id_ === undefined) {
        // If we have not found a module yet, take the crate root.
        cgu_def_id_ = CrateNum.as_def_id(def_id.krate);
      }
      break;
    } else if (tcx.def_kind(current_def_id).$ === "Mod") {
      if (cgu_def_id_ === undefined) {
        cgu_def_id_ = current_def_id;
      }
    } else {
      // If we encounter something that is not a module, throw away
      // any module that we've found so far because we now know that
      // it is nested within something else.
      cgu_def_id_ = undefined;
    }

    current_def_id = tcx.parent(current_def_id);
  }

  const cgu_def_id: DefId = cgu_def_id_;

  // PORT: the `(DefId, bool)` key as a string (a `DefId` is `krate:index`, unique).
  const key = `${cgu_def_id.krate}:${cgu_def_id.index}:${volatile}`;
  let name = cache.get(key);
  if (name === undefined) {
    const def_path = tcx.def_path(cgu_def_id);

    const components = def_path.data.map((part) => {
      const n = DefPathData.name(part.data);
      switch (n.$) {
        case "Named":
          return Symbol.as_str(n._0);
        case "Anon":
          return unreachable();
      }
    });

    const volatile_suffix = volatile ? "volatile" : undefined;

    name = name_builder.build_cgu_name(def_path.krate, components, volatile_suffix);
    cache.set(key, name);
  }
  return name;
}

// Anything we can't find a proper codegen unit for goes into this.
// rustc: compiler/rustc_monomorphize/src/partitioning.rs:753 fallback_cgu_name
function fallback_cgu_name(name_builder: CodegenUnitNameBuilder): Symbol {
  return name_builder.build_cgu_name(LOCAL_CRATE, ["fallback"], "cgu");
}

// rustc: compiler/rustc_monomorphize/src/partitioning.rs:757 mono_item_linkage_and_visibility
function mono_item_linkage_and_visibility(
  tcx: TyCtxt,
  mono_item: MonoItem,
  can_be_internalized: MutRef<boolean>,
  can_export_generics: boolean,
  always_export_generics: boolean,
): [Linkage, Visibility] {
  const explicit_linkage = MonoItem.explicit_linkage(mono_item, tcx);
  if (explicit_linkage !== undefined) {
    return [explicit_linkage, Visibility.Default];
  }
  const vis = mono_item_visibility(tcx, mono_item, can_be_internalized, can_export_generics, always_export_generics);
  return [Linkage.External, vis];
}

type CguNameCache = Map<string, Symbol>;

// rustc: compiler/rustc_monomorphize/src/partitioning.rs:779 static_visibility
function static_visibility(tcx: TyCtxt, can_be_internalized: MutRef<boolean>, def_id: DefId): Visibility {
  if (tcx.is_reachable_non_generic(def_id)) {
    can_be_internalized.value = false;
    return default_visibility(tcx, def_id, false);
  } else {
    if (DefKind.has_codegen_attrs(tcx.def_kind(def_id))) {
      // Prevent EII and `rustc_std_internal_symbol` statics being internalized.
      const attrs = tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs;
      if (CodegenFnAttrFlags.intersects(attrs.flags, (CodegenFnAttrFlags.RUSTC_STD_INTERNAL_SYMBOL | CodegenFnAttrFlags.EXTERNALLY_IMPLEMENTABLE_ITEM) as CodegenFnAttrFlags)) {
        can_be_internalized.value = false;
      }
    }

    return Visibility.Hidden;
  }
}

/** `instance.args.non_erasable_generics().next().is_some()` */
function has_non_erasable_generics(instance: Instance): boolean {
  return !instance.args.non_erasable_generics()[globalThis.Symbol.iterator]().next().done;
}

// rustc: compiler/rustc_monomorphize/src/partitioning.rs:803 mono_item_visibility
function mono_item_visibility(
  tcx: TyCtxt,
  mono_item: MonoItem,
  can_be_internalized: MutRef<boolean>,
  can_export_generics: boolean,
  always_export_generics: boolean,
): Visibility {
  let instance: Instance;
  switch (mono_item.$) {
    // This is pretty complicated; see below.
    case "Fn":
      instance = mono_item._0;
      break;

    // Misc handling for generics and such, but otherwise:
    case "Static":
      return static_visibility(tcx, can_be_internalized, mono_item._0);
    case "GlobalAsm":
      return static_visibility(tcx, can_be_internalized, mono_item._0.owner_id.to_def_id());
  }

  let def_id: DefId;
  const def = instance.def;
  if (def.$ === "Item") {
    def_id = def._0;
  } else if (def.$ === "Shim" && def._0.$ === "DropGlue" && def._0._1 !== undefined) {
    def_id = def._0._0;
  } else if (def.$ === "Shim" && (def._0.$ === "FutureDropPoll" || def._0.$ === "AsyncDropGlue" || def._0.$ === "AsyncDropGlueCtor")) {
    def_id = def._0._0;
  } else if (def.$ === "Shim" && def._0.$ === "ThreadLocal") {
    // We match the visibility of statics here
    return static_visibility(tcx, can_be_internalized, def._0._0);
  } else {
    // These are all compiler glue and such, never exported, always hidden.
    // (`VTable`, `Reify`, `FnPtr`, `Virtual`, `Intrinsic`, `LlvmIntrinsic`, `ClosureOnce`,
    // `ConstructCoroutineInClosure`, `DropGlue`, `Clone`, `FnPtrAsPtr`, `FnPtrFromPtr`)
    return Visibility.Hidden;
  }

  const attrs = tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs;
  if (CodegenFnAttrFlags.intersects(attrs.flags, CodegenFnAttrFlags.OFFLOAD_KERNEL)) {
    can_be_internalized.value = false;
    return default_visibility(tcx, def_id, has_non_erasable_generics(instance));
  }

  // Both the `start_fn` lang item and `main` itself should not be exported,
  // so we give them with `Hidden` visibility but these symbols are
  // only referenced from the actual `main` symbol which we unfortunately
  // don't know anything about during partitioning/collection. As a result we
  // forcibly keep this symbol out of the `internalization_candidates` set.
  //
  // FIXME: eventually we don't want to always force this symbol to have
  //        hidden visibility, it should indeed be a candidate for
  //        internalization, but we have to understand that it's referenced
  //        from the `main` symbol we'll generate later.
  //
  //        This may be fixable with a new `InstanceKind` perhaps? Unsure!
  if (tcx.is_entrypoint(def_id)) {
    can_be_internalized.value = false;
    return Visibility.Hidden;
  }

  const is_generic = has_non_erasable_generics(instance);

  // Upstream `DefId` instances get different handling than local ones.
  const local_def_id = def_id.as_local();
  if (local_def_id === undefined) {
    if (is_generic && (always_export_generics || (can_export_generics && (tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs).inline.$ === InlineAttr.Never.$))) {
      // If it is an upstream monomorphization and we export generics, we must make
      // it available to downstream crates.
      can_be_internalized.value = false;
      return default_visibility(tcx, def_id, true);
    } else {
      return Visibility.Hidden;
    }
  }

  if (is_generic) {
    if (always_export_generics || (can_export_generics && (tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs).inline.$ === InlineAttr.Never.$)) {
      if (tcx.is_unreachable_local_definition(local_def_id)) {
        // This instance cannot be used from another crate.
        return Visibility.Hidden;
      } else {
        // This instance might be useful in a downstream crate.
        can_be_internalized.value = false;
        return default_visibility(tcx, def_id, true);
      }
    } else {
      // We are not exporting generics or the definition is not reachable
      // for downstream crates, we can internalize its instantiations.
      return Visibility.Hidden;
    }
  } else {
    // If this isn't a generic function then we mark this a `Default` if
    // this is a reachable item, meaning that it's a symbol other crates may
    // use when they link to us.
    if (tcx.is_reachable_non_generic(def_id)) {
      can_be_internalized.value = false;
      // debug_assert!(!is_generic);
      return default_visibility(tcx, def_id, false);
    }

    // If this isn't reachable then we're gonna tag this with `Hidden`
    // visibility. In some situations though we'll want to prevent this
    // symbol from being internalized.
    //
    // There's three categories of items here:
    //
    // * First is weak lang items. These are basically mechanisms for
    //   libcore to forward-reference symbols defined later in crates like
    //   the standard library or `#[panic_handler]` definitions. The
    //   definition of these weak lang items needs to be referenceable by
    //   libcore, so we're no longer a candidate for internalization.
    //   Removal of these functions can't be done by LLVM but rather must be
    //   done by the linker as it's a non-local decision.
    //
    // * Second is "std internal symbols". Currently this is primarily used
    //   for allocator symbols. Allocators are a little weird in their
    //   implementation, but the idea is that the compiler, at the last
    //   minute, defines an allocator with an injected object file. The
    //   `alloc` crate references these symbols (`__rust_alloc`) and the
    //   definition doesn't get hooked up until a linked crate artifact is
    //   generated.
    //
    //   The symbols synthesized by the compiler (`__rust_alloc`) are thin
    //   veneers around the actual implementation, some other symbol which
    //   implements the same ABI. These symbols (things like `__rg_alloc`,
    //   `__rdl_alloc`, `__rde_alloc`, etc), are all tagged with "std
    //   internal symbols".
    //
    //   The std-internal symbols here **should not show up in a dll as an
    //   exported interface**, so they return `false` from
    //   `is_reachable_non_generic` above and we'll give them `Hidden`
    //   visibility below. Like the weak lang items, though, we can't let
    //   LLVM internalize them as this decision is left up to the linker to
    //   omit them, so prevent them from being internalized.
    //
    // * Externally implementable items. They work (in this case) pretty much the same as
    //   RUSTC_STD_INTERNAL_SYMBOL in that their implementation is also chosen later in
    //   the compilation process and we can't let them be internalized and they can't
    //   show up as an external interface.
    const attrs = tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs;
    if (CodegenFnAttrFlags.intersects(attrs.flags, (CodegenFnAttrFlags.RUSTC_STD_INTERNAL_SYMBOL | CodegenFnAttrFlags.EXTERNALLY_IMPLEMENTABLE_ITEM) as CodegenFnAttrFlags)) {
      can_be_internalized.value = false;
    }

    return Visibility.Hidden;
  }
}

/** PORT(contract): `Session::default_visibility` (rustc_session session.rs:908) is not ported and session.ts is not this
 *  lane's file; handoff item. */
function session_default_visibility(sess: Session): SymbolVisibility {
  return sess.opts.unstable_opts.default_visibility ?? sess.target.default_visibility ?? SymbolVisibility.Interposable;
}

// rustc: compiler/rustc_monomorphize/src/partitioning.rs:971 default_visibility
function default_visibility(tcx: TyCtxt, id: DefId, is_generic: boolean): Visibility {
  // Fast-path to avoid expensive query call below
  if (session_default_visibility(tcx.sess) === SymbolVisibility.Interposable) {
    return Visibility.Default;
  }

  let export_level: SymbolExportLevel;
  if (is_generic) {
    // Generic functions never have export-level C.
    export_level = SymbolExportLevel.Rust;
  } else {
    const info = tcx.reachable_non_generics(id.krate).get(id) as SymbolExportInfo | undefined;
    export_level = info !== undefined && info.level === SymbolExportLevel.C ? SymbolExportLevel.C : SymbolExportLevel.Rust;
  }

  switch (export_level) {
    // C-export level items remain at `Default` to allow C code to
    // access and interpose them.
    case "C":
      return Visibility.Default;

    // For all other symbols, `default_visibility` determines which visibility to use.
    case "Rust":
      return Visibility.from(session_default_visibility(tcx.sess));
  }
}

/** `format!("{v:.precision$}")` of a finite `f64`: JS's `toFixed` rounds an exact tie up, Rust's exact mode to even. */
function f64_fixed(v: number, precision: number): string {
  const s = v.toFixed(precision);
  if (!globalThis.Number.isFinite(v)) return s;
  const exact = v.toFixed(100);
  const tail = exact.slice(exact.indexOf(".") + 1 + precision);
  if (tail[0] === "5" && /^0*$/.test(tail.slice(1))) {
    const truncated = exact.slice(0, exact.indexOf(".") + 1 + precision).replace(/\.$/, "");
    const last = truncated[truncated.length - 1]!;
    if ((last.charCodeAt(0) - 48) % 2 === 0) return truncated;
  }
  return s;
}

// rustc: compiler/rustc_monomorphize/src/partitioning.rs:997 debug_dump
function debug_dump(tcx: TyCtxt, label: string, cgus: readonly CodegenUnit[]): void {
  const dump = (): string => {
    let num_cgus = 0;
    const all_cgu_sizes: number[] = [];

    // Note: every unique root item is placed exactly once, so the number
    // of unique root items always equals the number of placed root items.
    //
    // Also, unreached inlined items won't be counted here. This is fine.

    const inlined_items = new KeyedSet<MonoItem>(key_MonoItem);

    let root_items = 0;
    let unique_inlined_items = 0;
    let placed_inlined_items = 0;

    let root_size = 0;
    let unique_inlined_size = 0;
    let placed_inlined_size = 0;

    for (const cgu of cgus) {
      num_cgus += 1;
      all_cgu_sizes.push(cgu.size_estimate());

      for (const [item, data] of cgu.items()) {
        if (!data.inlined) {
          root_items += 1;
          root_size += data.size_estimate;
        } else {
          if (!inlined_items.has(item)) {
            inlined_items.add(item);
            unique_inlined_items += 1;
            unique_inlined_size += data.size_estimate;
          }
          placed_inlined_items += 1;
          placed_inlined_size += data.size_estimate;
        }
      }
    }

    all_cgu_sizes.sort((a, b) => b - a);

    const unique_items = root_items + unique_inlined_items;
    const placed_items = root_items + placed_inlined_items;
    const items_ratio = placed_items / unique_items;

    const unique_size = root_size + unique_inlined_size;
    const placed_size = root_size + placed_inlined_size;
    const size_ratio = placed_size / unique_size;

    const mean_cgu_size = placed_size / num_cgus;

    assert_eq(placed_size, all_cgu_sizes.reduce((a, b) => a + b, 0), (v) => String(v));

    let s = "";
    s += `${label}\n`;
    s +=
      `- unique items: ${unique_items} (${root_items} root + ${unique_inlined_items} inlined), ` +
      `unique size: ${unique_size} (${root_size} root + ${unique_inlined_size} inlined)\n` +
      `- placed items: ${placed_items} (${root_items} root + ${placed_inlined_items} inlined), ` +
      `placed size: ${placed_size} (${root_size} root + ${placed_inlined_size} inlined)\n` +
      `- placed/unique items ratio: ${f64_fixed(items_ratio, 2)}, ` +
      `placed/unique size ratio: ${f64_fixed(size_ratio, 2)}\n` +
      `- CGUs: ${num_cgus}, mean size: ${f64_fixed(mean_cgu_size, 1)}, sizes: ${list(all_cgu_sizes)}\n`;
    s += "\n";

    for (let i = 0; i < cgus.length; i++) {
      const cgu = cgus[i]!;
      const name = cgu.name();
      const size = cgu.size_estimate();
      const num_items = cgu.items().size;
      const mean_size = size / num_items;

      const placed_item_sizes: number[] = [];
      for (const data of cgu.items().values()) placed_item_sizes.push(data.size_estimate);
      placed_item_sizes.sort((a, b) => b - a);
      const sizes = list(placed_item_sizes);

      s += `- CGU[${i}]\n`;
      s += `  - ${Symbol.as_str(name)}, size: ${size}\n`;
      s += `  - items: ${num_items}, mean size: ${f64_fixed(mean_size, 1)}, sizes: ${sizes}\n`;

      for (const [item, data] of cgu.items_in_deterministic_order(tcx)) {
        const linkage = data.linkage;
        const symbol_name = MonoItem.symbol_name(item, tcx).name;
        const symbol_hash_start = symbol_name.lastIndexOf("h");
        const symbol_hash = symbol_hash_start < 0 ? "<no hash>" : symbol_name.slice(symbol_hash_start);
        const kind = !data.inlined ? "root" : "inlined";
        const size = data.size_estimate;
        s += with_no_trimmed_paths(() => `  - ${display_MonoItem(item)} [${debug_Linkage(linkage, PLAIN)}] [${symbol_hash}] (${kind}, size: ${size})\n`);
      }

      s += "\n";
    }

    return s;

    // Converts a slice to a string, capturing repetitions to save space.
    // E.g. `[4, 4, 4, 3, 2, 1, 1, 1, 1, 1]` -> "[4 (x3), 3, 2, 1 (x5)]".
    // rustc: compiler/rustc_monomorphize/src/partitioning.rs:1103 list
    function list(ns: readonly number[]): string {
      const v: string[] = [];
      if (ns.length === 0) {
        return "[]";
      }

      const elem = (curr: number, curr_count: number): void => {
        if (curr_count === 1) {
          v.push(`${curr}`);
        } else {
          v.push(`${curr} (x${curr_count})`);
        }
      };

      let curr = ns[0]!;
      let curr_count = 1;

      for (const n of ns.slice(1)) {
        if (n !== curr) {
          elem(curr, curr_count);
          curr = n;
          curr_count = 1;
        } else {
          curr_count += 1;
        }
      }
      elem(curr, curr_count);

      return `[${v.join(", ")}]`;
    }
  };

  // debug!("{}", dump());
  void dump;
}

// #[inline(never)] // give this a place in the profiler
// rustc: compiler/rustc_monomorphize/src/partitioning.rs:1139 assert_symbols_are_distinct
function assert_symbols_are_distinct(tcx: TyCtxt, mono_items: readonly MonoItem[]): void {
  tcx.prof.generic_activity("assert_symbols_are_distinct").run(() => {
    const symbols = mono_items.map((mono_item) => [mono_item, MonoItem.symbol_name(mono_item, tcx)] as const);

    // `symbols.sort_by_key(|sym| sym.1)`: `SymbolName`'s derived `Ord` compares the `&str`s.
    symbols.sort((a, b) => str_cmp(a[1].name, b[1].name));

    for (let i = 0; i + 1 < symbols.length; i++) {
      const [mono_item1, sym1] = symbols[i]!;
      const [mono_item2, sym2] = symbols[i + 1]!;
      if (sym1.name === sym2.name) {
        const span1 = MonoItem.local_span(mono_item1, tcx);
        const span2 = MonoItem.local_span(mono_item2, tcx);

        // Deterministically select one of the spans for error reporting
        const span = span1 !== undefined && span2 !== undefined ? (Span.lo(span1) > Span.lo(span2) ? span1 : span2) : (span1 ?? span2);

        tcx.dcx().emit_fatal(SymbolAlreadyDefined_diagnostic({ span, symbol: sym1.name }));
      }
    }
  });
}

// rustc: compiler/rustc_monomorphize/src/partitioning.rs:1169 collect_and_partition_mono_items
function collect_and_partition_mono_items(tcx: TyCtxt, _: null): MonoItemPartitions {
  const collection_strategy: MonoItemCollectionStrategy = tcx.sess.link_dead_code() ? "Eager" : "Lazy";

  const [items, usage_map] = collector.collect_crate_mono_items(tcx, collection_strategy);
  // Perform checks that need to operate on the entire mono item graph
  target_specific_checks(tcx, items, usage_map);

  // If there was an error during collection (e.g. from one of the constants we evaluated),
  // then we stop here. This way codegen does not have to worry about failing constants.
  // (codegen relies on this and ICEs will happen if this is violated.)
  tcx.dcx().abort_if_errors();

  const [codegen_units, _unit] = tcx.sess.time("partition_and_assert_distinct_symbols", () =>
    par_join(
      () => {
        const codegen_units = partition(tcx, items, usage_map);
        codegen_units[0]!.make_primary();
        return codegen_units as readonly CodegenUnit[];
      },
      () => assert_symbols_are_distinct(tcx, items),
    ),
  );

  if (tcx.prof.profiler !== undefined) {
    // Record CGU size estimates for self-profiling.
    unported("rustc_data_structures::profiling::SelfProfilerRef::artifact_size (-Z self-profile)");
  }

  const mono_items = new DefIdSet();
  for (const mono_item of items) {
    switch (mono_item.$) {
      case "Fn":
        mono_items.add(Instance.def_id(mono_item._0));
        break;
      case "Static":
        mono_items.add(mono_item._0);
        break;
      default:
        break;
    }
  }

  // Output monomorphization stats per def_id
  const dump_mono_stats = tcx.sess.opts.unstable_opts.dump_mono_stats;
  if (dump_mono_stats.$ === "Enabled") {
    const r = dump_mono_items_stats(tcx, codegen_units, dump_mono_stats._0, tcx.crate_name(LOCAL_CRATE));
    if (r.$ === "Err") {
      tcx.dcx().emit_fatal(CouldntDumpMonoStats_diagnostic({ error: r._0 }));
    }
  }

  if (tcx.sess.opts.unstable_opts.print_mono_items) {
    const item_to_cgus = new KeyedMap<MonoItem, [Symbol, Linkage][]>(key_MonoItem);

    for (const cgu of codegen_units) {
      for (const [mono_item, data] of cgu.items()) {
        let v = item_to_cgus.get(mono_item);
        if (v === undefined) {
          v = [];
          item_to_cgus.set(mono_item, v);
        }
        v.push([cgu.name(), data.linkage]);
      }
    }

    const item_keys = items.map((i) => {
      let output = with_no_trimmed_paths(() => display_MonoItem(i));
      output += " @@";
      const cgus = item_to_cgus.get(i) ?? [];
      // PORT: `Symbol`'s `Ord` is its index (see the header).
      cgus.sort((a, b) => a[0] - b[0]);
      // `cgus.dedup()`
      const deduped = cgus.filter((c, n) => n === 0 || c[0] !== cgus[n - 1]![0] || c[1] !== cgus[n - 1]![1]);
      cgus.length = 0;
      cgus.push(...deduped);
      for (const [cgu_name, linkage] of cgus) {
        output += " ";
        output += Symbol.as_str(cgu_name);

        let linkage_abbrev: string;
        switch (linkage) {
          case "External":
            linkage_abbrev = "External";
            break;
          case "AvailableExternally":
            linkage_abbrev = "Available";
            break;
          case "LinkOnceAny":
            linkage_abbrev = "OnceAny";
            break;
          case "LinkOnceODR":
            linkage_abbrev = "OnceODR";
            break;
          case "WeakAny":
            linkage_abbrev = "WeakAny";
            break;
          case "WeakODR":
            linkage_abbrev = "WeakODR";
            break;
          case "Internal":
            linkage_abbrev = "Internal";
            break;
          case "ExternalWeak":
            linkage_abbrev = "ExternalWeak";
            break;
        }

        output += "[";
        output += linkage_abbrev;
        output += "]";
      }
      return output;
    });

    item_keys.sort(str_cmp);

    for (const item of item_keys) {
      std_print(`MONO_ITEM ${item}\n`);
    }
  }

  return { all_mono_items: mono_items, codegen_units };
}

/// Outputs stats about instantiation counts and estimated size, per `MonoItem`'s
/// def, to a file in the given output directory.
// PORT: `Box<dyn Error>` is its `to_string()`.
// rustc: compiler/rustc_monomorphize/src/partitioning.rs:1277 dump_mono_items_stats
function dump_mono_items_stats(tcx: TyCtxt, codegen_units: readonly CodegenUnit[], output_directory_: string | undefined, crate_name: Symbol): Result<null, string> {
  // PORT: the `?`s on `fs` calls: node's error as `io::Error`, then `to_string()`.
  try {
    let output_directory: string;
    if (output_directory_ !== undefined) {
      mkdirSync(output_directory_, { recursive: true });
      output_directory = output_directory_;
    } else {
      output_directory = ".";
    }

    const format = tcx.sess.opts.unstable_opts.dump_mono_stats_format;
    const ext = DumpMonoStatsFormat.extension(format);
    const filename = `${Symbol.as_str(crate_name)}.mono_items.${ext}`;
    const output_path = path_join(output_directory, filename);
    const file = openSync(output_path, "w");

    try {
      // Gather instantiated mono items grouped by def_id
      const items_per_def_id = new DefIdMap<MonoItem[]>();
      for (const cgu of codegen_units) {
        for (const mono_item of cgu.items().keys()) {
          // Avoid variable-sized compiler-generated shims
          if (MonoItem.is_user_defined(mono_item)) {
            const def_id = MonoItem.def_id(mono_item);
            let v = items_per_def_id.get(def_id);
            if (v === undefined) {
              v = [];
              items_per_def_id.set(def_id, v);
            }
            v.push(mono_item);
          }
        }
      }

      // #[derive(serde::Serialize)]
      // PORT: upstream's local `struct MonoItem`. `JSON.stringify` writes what `serde_json::to_writer` writes: compact,
      // fields in this order, the same string escapes.
      interface MonoItem_ {
        name: string;
        instantiation_count: number;
        size_estimate: number;
        total_estimate: number;
      }

      // Output stats sorted by total instantiated size, from heaviest to lightest
      const stats: MonoItem_[] = [];
      for (const [def_id, items] of items_per_def_id) {
        const name = with_no_trimmed_paths(() => tcx.def_path_str(def_id));
        const instantiation_count = items.length;
        const size_estimate = MonoItem.size_estimate(items[0]!, tcx);
        const total_estimate = instantiation_count * size_estimate;
        stats.push({ name, instantiation_count, size_estimate, total_estimate });
      }
      // PORT: `sort_unstable_by_key(|item| cmp::Reverse(item.total_estimate))`, ties visible: core's ipnsort. `MonoItem`
      // is `String` + 3 `usize`: 48 bytes, `Freeze`, not `Copy`.
      slice_sort_unstable_by(stats, (a, b) => b.total_estimate - a.total_estimate, { size_of: 48, freeze: true, copy: false });

      if (stats.length !== 0) {
        switch (format) {
          case "Json":
            writeSync(file, JSON.stringify(stats));
            break;
          case "Markdown": {
            let out = "| Item | Instantiation count | Estimated Cost Per Instantiation | Total Estimated Cost |\n";
            out += "| --- | ---: | ---: | ---: |\n";

            for (const { name, instantiation_count, size_estimate, total_estimate } of stats) {
              out += `| \`${name}\` | ${instantiation_count} | ${size_estimate} | ${total_estimate} |\n`;
            }
            writeSync(file, out);
            break;
          }
        }
      }
    } finally {
      closeSync(file);
    }
  } catch (e) {
    return Err(display_IoError(io_error_from_node(e)));
  }

  return Ok(null);
}

// rustc: compiler/rustc_monomorphize/src/partitioning.rs:1352 provide
export function provide(providers: Providers): void {
  providers.queries.collect_and_partition_mono_items = collect_and_partition_mono_items;

  providers.queries.is_codegened_item = (tcx, def_id) => (tcx.collect_and_partition_mono_items(null) as MonoItemPartitions).all_mono_items.has(def_id);

  providers.queries.codegen_unit = (tcx, name) => {
    const cgu = (tcx.collect_and_partition_mono_items(null) as MonoItemPartitions).codegen_units.find((cgu) => cgu.name() === name);
    if (cgu === undefined) panic(`failed to find cgu with name ${debug_Symbol(name, PLAIN)}`);
    return cgu;
  };

  providers.queries.size_estimate = (tcx, instance) => {
    const def = instance.def;
    // "Normal" functions size estimate: the number of
    // statements, plus one for the terminator.
    if (def.$ === "Item" || (def.$ === "Shim" && (def._0.$ === "DropGlue" || def._0.$ === "AsyncDropGlueCtor"))) {
      const mir = TyCtxt_instance_mir(tcx, def);
      let sum = 0;
      for (const bb of mir.basic_blocks.deref() as readonly BasicBlockData[]) {
        let count = 0;
        for (const stmt of bb.statements) {
          if (stmt.kind.$ !== "StorageLive" && stmt.kind.$ !== "StorageDead") count += 1;
        }
        sum += count + 1;
      }
      return sum;
    }
    // Other compiler-generated shims size estimate: 1
    return 1;
  };

  collector.provide(providers);
}
