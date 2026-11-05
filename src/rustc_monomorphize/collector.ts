// Port of compiler/rustc_monomorphize/src/collector.rs (lane mono-collector).
//
// PORT: `debug!` / `trace!` / `#[instrument]` are comments (driver-m2 decision 8), `debug_assert!` too (PORTING section 3).
// PORT: `UnordSet<MonoItem>` / `UnordMap<MonoItem, _>` / `FxIndexMap<MonoItem, Span>` are `KeyedSet` / `KeyedMap` on
// `intern_key`, since `MonoItem` is a data enum compared by value and not a handle. `MonoItems.items` is upstream's
// `FxIndexMap`: insertion-ordered, and `retain` keeps the rest in order, which a JS Map gives (`delete` while iterating is
// defined). The `UnordSet`s are only read through `contains`/`insert`, except `state.visited` at the very end, which
// upstream sorts by the items' stable hash (`into_sorted(hcx, true)`) and so does this port. `UsageMap` is only read per
// key. So no output order here rests on JS iteration order of a hash container.
// PORT: `Lock` is the value itself (PORTING section 5) and `par_for_each_in` runs in order with `check_dyn_thread_safe()`
// unset, as upstream at `-Zthreads=1`. The `OnceCell`s around the locks in `collect_items_rec` only avoid taking a lock
// (upstream's "lazily lock" optimisation), so they are gone.
// PORT: `MirUsedCollector` / `RootCollector` keep upstream's fields; `MirUsedCollector` `extends Visitor` (mir/visit.ts).
//! Mono Item Collection
//! ====================
//!
//! This module is responsible for discovering all items that will contribute
//! to code generation of the crate. The important part here is that it not only
//! needs to find syntax-level items (functions, structs, etc) but also all
//! their monomorphized instantiations. Every non-generic, non-const function
//! maps to one LLVM artifact. Every generic function can produce
//! from zero to N artifacts, depending on the sets of type arguments it
//! is instantiated with.
//! This also applies to generic items from other crates: A generic definition
//! in crate X might produce monomorphizations that are compiled into crate Y.
//! We also have to collect these here.
//!
//! The following kinds of "mono items" are handled here:
//!
//! - Functions
//! - Methods
//! - Closures
//! - Statics
//! - Drop glue
//!
//! The following things also result in LLVM artifacts, but are not collected
//! here, since we instantiate them locally on demand when needed in a given
//! codegen unit:
//!
//! - Constants
//! - VTables
//! - Object Shims
//!
//! The main entry point is `collect_crate_mono_items`, at the bottom of this file.
//!
//! General Algorithm
//! -----------------
//! Let's define some terms first:
//!
//! - A "mono item" is something that results in a function or global in
//!   the LLVM IR of a codegen unit. Mono items do not stand on their
//!   own, they can use other mono items. For example, if function
//!   `foo()` calls function `bar()` then the mono item for `foo()`
//!   uses the mono item for function `bar()`. In general, the
//!   definition for mono item A using a mono item B is that
//!   the LLVM artifact produced for A uses the LLVM artifact produced
//!   for B.
//!
//! - Mono items and the uses between them form a directed graph,
//!   where the mono items are the nodes and uses form the edges.
//!   Let's call this graph the "mono item graph".
//!
//! - The mono item graph for a program contains all mono items
//!   that are needed in order to produce the complete LLVM IR of the program.
//!
//! The purpose of the algorithm implemented in this module is to build the
//! mono item graph for the current crate. It runs in two phases:
//!
//! 1. Discover the roots of the graph by traversing the HIR of the crate.
//! 2. Starting from the roots, find uses by inspecting the MIR
//!    representation of the item corresponding to a given node, until no more
//!    new nodes are found.
//!
//! ### Discovering roots
//! The roots of the mono item graph correspond to the public non-generic
//! syntactic items in the source code. We find them by walking the HIR of the
//! crate, and whenever we hit upon a public function, method, or static item,
//! we create a mono item consisting of the items DefId and, since we only
//! consider non-generic items, an empty type-parameters set. (In eager
//! collection mode, during incremental compilation, all non-generic functions
//! are considered as roots, as well as when the `-Clink-dead-code` option is
//! specified. Functions marked `#[no_mangle]` and functions called by inlinable
//! functions also always act as roots.)
//!
//! ### Finding uses
//! Given a mono item node, we can discover uses by inspecting its MIR. We walk
//! the MIR to find other mono items used by each mono item. Since the mono
//! item we are currently at is always monomorphic, we also know the concrete
//! type arguments of its used mono items. The specific forms a use can take in
//! MIR are quite diverse. Here is an overview:
//!
//! #### Calling Functions/Methods
//! The most obvious way for one mono item to use another is a
//! function or method call (represented by a CALL terminator in MIR). But
//! calls are not the only thing that might introduce a use between two
//! function mono items, and as we will see below, they are just a
//! specialization of the form described next, and consequently will not get any
//! special treatment in the algorithm.
//!
//! #### Taking a reference to a function or method
//! A function does not need to actually be called in order to be used by
//! another function. It suffices to just take a reference in order to introduce
//! an edge. Consider the following example:
//!
//! ```
//! # use core::fmt::Display;
//! fn print_val<T: Display>(x: T) {
//!     println!("{}", x);
//! }
//!
//! fn call_fn(f: &dyn Fn(i32), x: i32) {
//!     f(x);
//! }
//!
//! fn main() {
//!     let print_i32 = print_val::<i32>;
//!     call_fn(&print_i32, 0);
//! }
//! ```
//! The MIR of none of these functions will contain an explicit call to
//! `print_val::<i32>`. Nonetheless, in order to mono this program, we need
//! an instance of this function. Thus, whenever we encounter a function or
//! method in operand position, we treat it as a use of the current
//! mono item. Calls are just a special case of that.
//!
//! #### Drop glue
//! Drop glue mono items are introduced by MIR drop-statements. The
//! generated mono item will have additional drop-glue item uses if the
//! type to be dropped contains nested values that also need to be dropped. It
//! might also have a function item use for the explicit `Drop::drop`
//! implementation of its type.
//!
//! #### Unsizing Casts
//! A subtle way of introducing use edges is by casting to a trait object.
//! Since the resulting wide-pointer contains a reference to a vtable, we need to
//! instantiate all dyn-compatible methods of the trait, as we need to store
//! pointers to these functions even if they never get called anywhere. This can
//! be seen as a special case of taking a function reference.
//!
//!
//! Interaction with Cross-Crate Inlining
//! -------------------------------------
//! The binary of a crate will not only contain machine code for the items
//! defined in the source code of that crate. It will also contain monomorphic
//! instantiations of any extern generic functions and of functions marked with
//! `#[inline]`.
//! The collection algorithm handles this more or less mono. If it is
//! about to create a mono item for something with an external `DefId`,
//! it will take a look if the MIR for that item is available, and if so just
//! proceed normally. If the MIR is not available, it assumes that the item is
//! just linked to and no node is created; which is exactly what we want, since
//! no machine code should be generated in the current crate for such an item.
//!
//! Eager and Lazy Collection Strategy
//! ----------------------------------
//! Mono item collection can be performed with one of two strategies:
//!
//! - Lazy strategy means that items will only be instantiated when actually
//!   used. The goal is to produce the least amount of machine code
//!   possible.
//!
//! - Eager strategy is meant to be used in conjunction with incremental compilation
//!   where a stable set of mono items is more important than a minimal
//!   one. Thus, eager strategy will instantiate drop-glue for every drop-able type
//!   in the crate, even if no drop call for that type exists (yet). It will
//!   also instantiate default implementations of trait methods, something that
//!   otherwise is only done on demand.
//!
//! Collection-time const evaluation and "mentioned" items
//! ------------------------------------------------------
//!
//! One important role of collection is to evaluate all constants that are used by all the items
//! which are being collected. Codegen can then rely on only encountering constants that evaluate
//! successfully, and if a constant fails to evaluate, the collector has much better context to be
//! able to show where this constant comes up.
//!
//! However, the exact set of "used" items (collected as described above), and therefore the exact
//! set of used constants, can depend on optimizations. Optimizing away dead code may optimize away
//! a function call that uses a failing constant, so an unoptimized build may fail where an
//! optimized build succeeds. This is undesirable.
//!
//! To avoid this, the collector has the concept of "mentioned" items. Some time during the MIR
//! pipeline, before any optimization-level-dependent optimizations, we compute a list of all items
//! that syntactically appear in the code. These are considered "mentioned", and even if they are in
//! dead code and get optimized away (which makes them no longer "used"), they are still
//! "mentioned". For every used item, the collector ensures that all mentioned items, recursively,
//! do not use a failing constant. This is reflected via the [`CollectionMode`], which determines
//! whether we are visiting a used item or merely a mentioned item.
//!
//! The collector and "mentioned items" gathering (which lives in `rustc_mir_transform::mentioned_items`)
//! need to stay in sync in the following sense:
//!
//! - For every item that the collector gather that could eventually lead to build failure (most
//!   likely due to containing a constant that fails to evaluate), a corresponding mentioned item
//!   must be added. This should use the exact same strategy as the ecollector to make sure they are
//!   in sync. However, while the collector works on monomorphized types, mentioned items are
//!   collected on generic MIR -- so any time the collector checks for a particular type (such as
//!   `ty::FnDef`), we have to just onconditionally add this as a mentioned item.
//! - In `visit_mentioned_item`, we then do with that mentioned item exactly what the collector
//!   would have done during regular MIR visiting. Basically you can think of the collector having
//!   two stages, a pre-monomorphization stage and a post-monomorphization stage (usually quite
//!   literally separated by a call to `self.monomorphize`); the pre-monomorphizationn stage is
//!   duplicated in mentioned items gathering and the post-monomorphization stage is duplicated in
//!   `visit_mentioned_item`.
//! - Finally, as a performance optimization, the collector should fill `used_mentioned_item` during
//!   its MIR traversal with exactly what mentioned item gathering would have added in the same
//!   situation. This detects mentioned items that have *not* been optimized away and hence don't
//!   need a dedicated traversal.
//!
//! Open Issues
//! -----------
//! Some things are not yet fully implemented in the current version of this
//! module.
//!
//! ### Const Fns
//! Ideally, no mono item should be generated for const fns unless there
//! is a call to them that cannot be evaluated at compile time. At the moment
//! this is not implemented however: a mono item will be produced
//! regardless of whether it is actually needed or not.

import { Fingerprint } from "../rustc_data_structures/fingerprint.ts";
import { par_for_each_in } from "../rustc_data_structures/sync/parallel.ts";
import { DefKind } from "../rustc_hir/def.ts";
import type { LangItem } from "../rustc_attr_ir/lang_items.ts";
import type { Constness, ImplItemId, ItemId } from "../rustc_hir/hir.ts";
import type { ModuleItems } from "../rustc_middle/hir/mod.ts";
import { CodegenFnAttrFlags, type CodegenFnAttrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import { Const as mir_Const, type ConstValue, debug_Const as debug_mir_Const, fold_Const as mir_Const_foldable } from "../rustc_middle/mir/consts.ts";
import { type AllocId, ErrorHandled, type GlobalAlloc } from "../rustc_middle/mir/interpret/mod.ts";
import { CtfeProvenance } from "../rustc_middle/mir/interpret/pointer.ts";
import {
  AssertKind,
  type Body,
  type ConstOperand,
  fold_with_MentionedItem,
  try_fold_with_MentionedItem,
  visit_with_MentionedItem,
  type Location,
  type MentionedItem,
  Operand,
  type Rvalue,
  type Terminator,
  TerminatorKind,
  UnwindTerminateReason,
  visit_with_Body,
} from "../rustc_middle/mir/mod.ts";
import { mono_reachable } from "../rustc_middle/mir/traversal.ts";
import { Visitor } from "../rustc_middle/mir/visit.ts";
import { CollectionMode, InstantiationMode, InstantiationMode_eq, MonoItem, NormalizationErrorInMono } from "../rustc_middle/mono.ts";
import type { TyCtxtAt } from "../rustc_middle/query/calls.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { fold_GenericArgs, type GenericArg } from "../rustc_middle/ty/generic_args.ts";
import type { GenericParamDef, Generics } from "../rustc_middle/ty/generics.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import {
  debug_Instance,
  display_Instance,
  fold_with_Instance,
  Instance,
  InstanceKind,
  try_fold_with_Instance,
  visit_with_Instance,
} from "../rustc_middle/ty/instance.ts";
import { ValidityRequirement } from "../rustc_middle/ty/layout.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { Asyncness, debug_Ty, type ImplTraitHeader, Ty, TypingEnv, Visibility } from "../rustc_middle/ty/mod.ts";
import type { PolyFnSig } from "../rustc_middle/ty/sty.gen.ts";
import type { EntryFnType } from "../rustc_passes/entry.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { Providers } from "../rustc_middle/util/mod.ts";
import { intern_key } from "../rust_ts/intern_key.ts";
import { KeyedMap, KeyedSet } from "../rust_ts/keyed.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { DefIdMap, LocalDefId } from "../rustc_span/def_id.ts";
import { DUMMY_SP, dummy_spanned, respan, type Span, type Spanned } from "../rustc_span/lib.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import type { Limit } from "../rustc_structures/lib.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { ControlFlow, VisitorResult } from "../rustc_ast_ir/visit.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import {
  as_interner,
  fold_with_ExistentialTraitRef,
  fold_with_TraitRef,
  PolyExistentialTraitRef,
  type TraitRef,
  try_fold_with_ExistentialTraitRef,
  try_fold_with_TraitRef,
  visit_with_ExistentialTraitRef,
  visit_with_TraitRef,
} from "../rustc_type_ir/predicate.ts";
import { fold_FnSig, PolyFnSig as PolyFnSigC } from "../rustc_type_ir/ty_kind.ts";
import { TypeVisitableExt, type TypeVisitor, TypeVisitor_provided } from "../rustc_type_ir/visit.ts";
import { Binder, EarlyBinder, fold_Binder } from "../rustc_type_ir/binder.ts";
import { assert, panic, unported, unreachable, unwrap } from "../std/panic.ts";
import { PLAIN } from "../std/fmt.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import {
  EncounteredErrorWhileInstantiatingGlobalAsm_diagnostic,
  EncounteredErrorWhileInstantiating_diagnostic,
  NoOptimizedMir_diagnostic,
  RecursionLimit_diagnostic,
  StartNotFound_diagnostic,
} from "./diagnostics.ts";
import { custom_coerce_unsize_info } from "./lib.ts";
import { dump_closure_profile } from "./util.ts";

// `impl TypeFoldable` of the types this file instantiates and normalizes (derived upstream), as D4 descriptors.
const fold_PolyFnSig = fold_Binder(fold_FnSig);
const d_Instance: TypeFoldable<Instance> = { visit_with: visit_with_Instance, try_fold_with: try_fold_with_Instance, fold_with: fold_with_Instance };
const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
const d_ExistentialTraitRef = { visit_with: visit_with_ExistentialTraitRef, try_fold_with: try_fold_with_ExistentialTraitRef, fold_with: fold_with_ExistentialTraitRef };
const d_MentionedItem: TypeFoldable<MentionedItem> = { visit_with: visit_with_MentionedItem, try_fold_with: try_fold_with_MentionedItem, fold_with: fold_with_MentionedItem };

// #[derive(PartialEq)]
// rustc-type: compiler/rustc_monomorphize/src/collector.rs:243 MonoItemCollectionStrategy
export type MonoItemCollectionStrategy = "Eager" | "Lazy";
export const MonoItemCollectionStrategy = { Eager: "Eager", Lazy: "Lazy" } as const;

/// The state that is shared across the concurrent threads that are doing collection.
// rustc-type: compiler/rustc_monomorphize/src/collector.rs:249 SharedState
interface SharedState {
  /// Items that have been or are currently being recursively collected.
  visited: KeyedSet<MonoItem>;
  /// Items that have been or are currently being recursively treated as "mentioned", i.e., their
  /// consts are evaluated but nothing is added to the collection.
  mentioned: KeyedSet<MonoItem>;
  /// Which items are being used where, for better errors.
  usage_map: UsageMap;
}

/** `HashSet::insert`: `true` if the value was not there. */
function insert<K>(set: Set<K>, k: K): boolean {
  if (set.has(k)) return false;
  set.add(k);
  return true;
}

// rustc-type: compiler/rustc_monomorphize/src/collector.rs:259 UsageMap
export class UsageMap {
  constructor(
    // Maps every mono item to the mono items used by it.
    public used_map: KeyedMap<MonoItem, MonoItem[]>,

    // Maps each mono item with users to the mono items that use it.
    // Be careful: subsets `used_map`, so unused items are vacant.
    private user_map: KeyedMap<MonoItem, MonoItem[]>,
  ) {}

  // rustc: compiler/rustc_monomorphize/src/collector.rs:269 new
  static new(): UsageMap {
    return new UsageMap(new KeyedMap<MonoItem, MonoItem[]>(intern_key), new KeyedMap<MonoItem, MonoItem[]>(intern_key));
  }

  // rustc: compiler/rustc_monomorphize/src/collector.rs:273 record_used
  record_used(user_item: MonoItem, used_items: MonoItems): void {
    for (const used_item of used_items.items_()) {
      const users = this.user_map.get(used_item);
      if (users !== undefined) users.push(user_item);
      else this.user_map.set(used_item, [user_item]);
    }

    assert(!this.used_map.has(user_item), "assertion failed: self.used_map.insert(user_item, used_items.items().collect()).is_none()");
    this.used_map.set(user_item, [...used_items.items_()]);
  }

  // rustc: compiler/rustc_monomorphize/src/collector.rs:284 get_user_items
  get_user_items(item: MonoItem): readonly MonoItem[] {
    return this.user_map.get(item) ?? [];
  }

  /// Internally iterate over all inlined items used by `item`.
  // rustc: compiler/rustc_monomorphize/src/collector.rs:289 for_each_inlined_used_item
  for_each_inlined_used_item(tcx: TyCtxt, item: MonoItem, f: (item: MonoItem) => void): void {
    const used_items = this.used_map.get(item);
    if (used_items === undefined) panic("called `Option::unwrap()` on a `None` value");
    for (const used_item of used_items) {
      const is_inlined = InstantiationMode_eq(MonoItem.instantiation_mode(used_item, tcx), InstantiationMode.LocalCopy);
      if (is_inlined) {
        f(used_item);
      }
    }
  }
}

// rustc-type: compiler/rustc_monomorphize/src/collector.rs:307 MonoItems
class MonoItems {
  constructor(
    // We want a set of MonoItem + Span where trying to re-insert a MonoItem with a different Span
    // is ignored. Map does that, but it looks odd.
    public items: KeyedMap<MonoItem, Span>,
  ) {}

  // rustc: compiler/rustc_monomorphize/src/collector.rs:314 new
  static new(): MonoItems {
    return new MonoItems(new KeyedMap<MonoItem, Span>(intern_key));
  }

  // rustc: compiler/rustc_monomorphize/src/collector.rs:318 is_empty
  is_empty(): boolean {
    return this.items.size === 0;
  }

  // rustc: compiler/rustc_monomorphize/src/collector.rs:322 push
  push(item: Spanned<MonoItem>): void {
    // Insert only if the entry does not exist. A normal insert would stomp the first span that
    // got inserted.
    if (!this.items.has(item.node)) this.items.set(item.node, item.span);
  }

  // PORT: `items()`; the field is `items`, so the method keeps a trailing underscore.
  // rustc: compiler/rustc_monomorphize/src/collector.rs:328 items
  items_(): Iterable<MonoItem> {
    return this.items.keys();
  }

  // rustc: compiler/rustc_monomorphize/src/collector.rs:337 into_iter
  into_iter(): Spanned<MonoItem>[] {
    const out: Spanned<MonoItem>[] = [];
    for (const [item, span] of this.items) out.push(respan(span, item));
    return out;
  }

  // rustc: compiler/rustc_monomorphize/src/collector.rs:343 extend
  extend(iter: Iterable<Spanned<MonoItem>>): void {
    for (const item of iter) {
      this.push(item);
    }
  }
}

// rustc: compiler/rustc_monomorphize/src/collector.rs:355 collect_items_root
function collect_items_root(tcx: TyCtxt, starting_item: Spanned<MonoItem>, state: SharedState, recursion_limit: Limit): void {
  if (!insert(state.visited, starting_item.node)) {
    // We've been here already, no need to search again.
    return;
  }
  const recursion_depths = new DefIdMap<number>();
  collect_items_rec(tcx, starting_item, state, recursion_depths, recursion_limit, CollectionMode.UsedItems);
}

/// Collect all monomorphized items reachable from `starting_point`, and emit a note diagnostic if a
/// post-monomorphization error is encountered during a collection step.
///
/// `mode` determined whether we are scanning for [used items][CollectionMode::UsedItems]
/// or [mentioned items][CollectionMode::MentionedItems].
// #[instrument(skip(tcx, state, recursion_depths, recursion_limit), level = "debug")]
// rustc: compiler/rustc_monomorphize/src/collector.rs:382 collect_items_rec
function collect_items_rec(
  tcx: TyCtxt,
  starting_item: Spanned<MonoItem>,
  state: SharedState,
  recursion_depths: DefIdMap<number>,
  recursion_limit: Limit,
  mode: CollectionMode,
): void {
  const used_items = MonoItems.new();
  const mentioned_items = MonoItems.new();
  let recursion_depth_reset: [DefId, number] | undefined;

  // Post-monomorphization errors MVP
  //
  // We can encounter errors while monomorphizing an item, but we don't have a good way of
  // showing a complete stack of spans ultimately leading to collecting the erroneous one yet.
  // (It's also currently unclear exactly which diagnostics and information would be interesting
  // to report in such cases)
  //
  // This leads to suboptimal error reporting: a post-monomorphization error (PME) will be
  // shown with just a spanned piece of code causing the error, without information on where
  // it was called from. This is especially obscure if the erroneous mono item is in a
  // dependency. See for example issue #85155, where, before minimization, a PME happened two
  // crates downstream from libcore's stdarch, without a way to know which dependency was the
  // cause.
  //
  // If such an error occurs in the current crate, its span will be enough to locate the
  // source. If the cause is in another crate, the goal here is to quickly locate which mono
  // item in the current crate is ultimately responsible for causing the error.
  //
  // To give at least _some_ context to the user: while collecting mono items, we check the
  // error count. If it has changed, a PME occurred, and we trigger some diagnostics about the
  // current step of mono items collection.
  //
  // FIXME: don't rely on global state, instead bubble up errors. Note: this is very hard to do.
  const error_count = tcx.dcx().err_count_on_current_thread();

  // In `mentioned_items` we collect items that were mentioned in this MIR but possibly do not
  // need to be monomorphized. This is done to ensure that optimizing away function calls does not
  // hide const-eval errors that those calls would otherwise have triggered.
  const node = starting_item.node;
  switch (node.$) {
    case "Static": {
      const def_id = node._0;
      recursion_depth_reset = undefined;

      // Statics always get evaluated (which is possible because they can't be generic), so for
      // `MentionedItems` collection there's nothing to do here.
      if (mode === CollectionMode.UsedItems) {
        const instance = Instance.mono(tcx, def_id);

        // Sanity check whether this ended up being collected accidentally
        // debug_assert!(tcx.should_codegen_locally(instance));

        const kind = tcx.def_kind(def_id);
        if (kind.$ !== "Static") return bug("");
        const nested = kind.nested;
        // Nested statics have no type.
        if (!nested) {
          const ty = Instance.ty(instance, tcx, TypingEnv.fully_monomorphized());
          visit_drop_use(tcx, ty, true, starting_item.span, used_items);
        }

        const alloc = tcx.eval_static_initializer(def_id);
        if (alloc.$ === "Ok") {
          for (const prov of alloc._0.inner().provenance.ptrs_().values()) {
            collect_alloc(tcx, CtfeProvenance.alloc_id(prov), used_items);
          }
        }

        if (tcx.needs_thread_local_shim(def_id)) {
          used_items.push(
            respan(starting_item.span, {
              $: "Fn",
              _0: {
                def: { $: "Shim", _0: { $: "ThreadLocal", _0: def_id } },
                args: RawList.empty(),
              },
            }),
          );
        }
      }

      // mentioned_items stays empty since there's no codegen for statics. statics don't get
      // optimized, and if they did then the const-eval interpreter would have to worry about
      // mentioned_items.
      break;
    }
    case "Fn": {
      const instance = node._0;
      // Sanity check whether this ended up being collected accidentally
      // debug_assert!(tcx.should_codegen_locally(instance));

      // Keep track of the monomorphization recursion depth
      recursion_depth_reset = check_recursion_limit(tcx, instance, starting_item.span, recursion_depths, recursion_limit);

      const r = tcx.items_of_instance([instance, mode]) as Result<[readonly Spanned<MonoItem>[], readonly Spanned<MonoItem>[]], NormalizationErrorInMono>;
      if (r.$ !== "Ok") {
        // Normalization errors here are usually due to trait solving overflow.
        // FIXME: I assume that there are few type errors at post-analysis stage, but not
        // entirely sure.
        // We have to emit the error outside of `items_of_instance` to access the
        // span of the `starting_item`.
        const def_id = Instance.def_id(instance);
        const def_span = tcx.def_span(def_id);
        const def_path_str = tcx.def_path_str(def_id);
        tcx.dcx().emit_fatal(
          RecursionLimit_diagnostic({
            span: starting_item.span,
            instance,
            def_span,
            def_path_str,
          }),
        );
      }
      const [used, mentioned] = r._0 as [readonly Spanned<MonoItem>[], readonly Spanned<MonoItem>[]];
      used_items.extend(used);
      mentioned_items.extend(mentioned);
      break;
    }
    case "GlobalAsm": {
      const item_id = node._0;
      assert(mode === CollectionMode.UsedItems, "should never encounter global_asm when collecting mentioned items");
      recursion_depth_reset = undefined;

      const item = tcx.hir_item(item_id);
      if (item.kind.$ === "GlobalAsm") {
        const asm = item.kind.asm;
        for (const [op, op_sp] of asm.operands) {
          switch (op.$) {
            case "Const": {
              const anon_const = op.anon_const;
              const r = tcx.const_eval_poly(LocalDefId.to_def_id(anon_const.def_id));
              if (r.$ === "Ok") {
                collect_const_value(tcx, r._0, used_items);
              } else if (r._0.$ === "TooGeneric") {
                span_bug(op_sp, "asm const cannot be resolved; too generic");
              } else {
                continue;
              }
              break;
            }
            case "SymFn": {
              const fn_ty = (tcx.typeck(item_id.owner_id) as TypeckResults).expr_ty(op.expr);
              visit_fn_use(tcx, fn_ty, false, op_sp, used_items);
              break;
            }
            case "SymStatic": {
              const def_id = op.def_id;
              const instance = Instance.mono(tcx, def_id);
              if (tcx.should_codegen_locally(instance)) {
                // trace!("collecting static {:?}", def_id);
                used_items.push(dummy_spanned<MonoItem>({ $: "Static", _0: def_id }));
              }
              break;
            }
            case "In":
            case "Out":
            case "InOut":
            case "SplitInOut":
            case "Label":
              span_bug(op_sp, "invalid operand type for global_asm!");
          }
        }
      } else {
        span_bug(item.span, "Mismatch between hir::Item type and MonoItem type");
      }

      // mention_items stays empty as nothing gets optimized here.
      break;
    }
  }

  // Check for PMEs and emit a diagnostic if one happened. To try to show relevant edges of the
  // mono item graph.
  if (tcx.dcx().err_count_on_current_thread() > error_count && MonoItem.is_generic_fn(node) && MonoItem.is_user_defined(node)) {
    switch (node.$) {
      case "Fn":
        tcx.dcx().emit_note(
          EncounteredErrorWhileInstantiating_diagnostic({
            span: starting_item.span,
            kind: "fn",
            instance: node._0,
          }),
        );
        break;
      case "Static":
        tcx.dcx().emit_note(
          EncounteredErrorWhileInstantiating_diagnostic({
            span: starting_item.span,
            kind: "static",
            instance: Instance.new_raw(node._0, RawList.empty()),
          }),
        );
        break;
      case "GlobalAsm":
        tcx.dcx().emit_note(
          EncounteredErrorWhileInstantiatingGlobalAsm_diagnostic({
            span: starting_item.span,
          }),
        );
        break;
    }
  }
  // Only updating `usage_map` for used items as otherwise we may be inserting the same item
  // multiple times (if it is first 'mentioned' and then later actually used), and the usage map
  // logic does not like that.
  // This is part of the output of collection and hence only relevant for "used" items.
  // ("Mentioned" items are only considered internally during collection.)
  if (mode === CollectionMode.UsedItems) {
    state.usage_map.record_used(node, used_items);
  }

  {
    if (mode === CollectionMode.UsedItems) {
      // `used_items.items.retain(|k, _| visited.insert(*k))`
      for (const k of [...used_items.items.keys()]) {
        if (!insert(state.visited, k)) used_items.items.delete(k);
      }
    }

    // `mentioned_items.items.retain(|k, _| !visited.contains(k) && mentioned.insert(*k))`
    for (const k of [...mentioned_items.items.keys()]) {
      if (!(!state.visited.has(k) && insert(state.mentioned, k))) mentioned_items.items.delete(k);
    }
  }
  if (mode === CollectionMode.MentionedItems) {
    assert(used_items.is_empty(), "'mentioned' collection should never encounter used items");
  } else {
    for (const used_item of used_items.into_iter()) {
      collect_items_rec(tcx, used_item, state, recursion_depths, recursion_limit, CollectionMode.UsedItems);
    }
  }

  // Walk over mentioned items *after* used items, so that if an item is both mentioned and used then
  // the loop above has fully collected it, so this loop will skip it.
  for (const mentioned_item of mentioned_items.into_iter()) {
    collect_items_rec(tcx, mentioned_item, state, recursion_depths, recursion_limit, CollectionMode.MentionedItems);
  }

  if (recursion_depth_reset !== undefined) {
    const [def_id, depth] = recursion_depth_reset;
    recursion_depths.set(def_id, depth);
  }
}

// Check whether we can normalize every type in the instantiated MIR body.
// rustc: compiler/rustc_monomorphize/src/collector.rs:627 check_normalization_error
function check_normalization_error(tcx: TyCtxt, instance: Instance, body: Body): Result<null, NormalizationErrorInMono> {
  const checker = new NormalizationChecker(tcx, instance);
  if (visit_with_Body(body, checker).$ === "Break") {
    return Err(NormalizationErrorInMono);
  } else {
    return Ok(null);
  }
}

// rustc-type: compiler/rustc_monomorphize/src/collector.rs:632 NormalizationChecker
class NormalizationChecker implements TypeVisitor<ControlFlow<null>> {
  readonly Result: TypeVisitor<ControlFlow<null>>["Result"] = VisitorResult.ControlFlow<null>();
  constructor(
    public tcx: TyCtxt,
    public instance: Instance,
  ) {}

  // rustc: compiler/rustc_monomorphize/src/collector.rs:639 visit_ty
  visit_ty(t: Ty): ControlFlow<null> {
    const r = Instance.try_instantiate_mir_and_normalize_erasing_regions(
      this.instance,
      this.tcx,
      TypingEnv.fully_monomorphized(),
      EarlyBinder.bind(this.tcx, t, fold_Ty),
      fold_Ty,
    );
    if (r.$ === "Ok") {
      return ControlFlow.CONTINUE;
    } else {
      return ControlFlow.Break(null);
    }
  }

  // (provided) the methods `NormalizationChecker` does not override.
  visit_binder<T>(t: Binder<T>, d: Parameters<typeof TypeVisitor_provided.visit_binder<T, ControlFlow<null>>>[2]): ControlFlow<null> {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }
  visit_region(r: Parameters<TypeVisitor<ControlFlow<null>>["visit_region"]>[0]): ControlFlow<null> {
    return TypeVisitor_provided.visit_region(this, r);
  }
  visit_const(c: Parameters<TypeVisitor<ControlFlow<null>>["visit_const"]>[0]): ControlFlow<null> {
    return TypeVisitor_provided.visit_const(this, c);
  }
  visit_predicate<P>(p: P, d: Parameters<typeof TypeVisitor_provided.visit_predicate<P, ControlFlow<null>>>[2]): ControlFlow<null> {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }
  visit_clauses(c: Parameters<TypeVisitor<ControlFlow<null>>["visit_clauses"]>[0]): ControlFlow<null> {
    return TypeVisitor_provided.visit_clauses(this, c);
  }
  visit_error(guar: Parameters<TypeVisitor<ControlFlow<null>>["visit_error"]>[0]): ControlFlow<null> {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

// rustc: compiler/rustc_monomorphize/src/collector.rs:655 check_recursion_limit
function check_recursion_limit(
  tcx: TyCtxt,
  instance: Instance,
  span: Span,
  recursion_depths: DefIdMap<number>,
  recursion_limit: Limit,
): [DefId, number] {
  const def_id = Instance.def_id(instance);
  const recursion_depth = recursion_depths.get(def_id) ?? 0;
  // debug!(" => recursion depth={}", recursion_depth);

  // HACK: `drop_glue` creates tight monomorphization loops. Give
  // it more margin.
  const adjusted_recursion_depth = tcx.is_lang_item(def_id, "DropGlue") ? Math.floor(recursion_depth / 4) : recursion_depth;

  // Code that needs to instantiate the same function recursively
  // more than the recursion limit is assumed to be causing an
  // infinite expansion.
  if (!recursion_limit.value_within_limit(adjusted_recursion_depth)) {
    const def_span = tcx.def_span(def_id);
    const def_path_str = tcx.def_path_str(def_id);
    tcx.dcx().emit_fatal(RecursionLimit_diagnostic({ span, instance, def_span, def_path_str }));
  }

  recursion_depths.set(def_id, recursion_depth + 1);

  return [def_id, recursion_depth];
}

// rustc-type: compiler/rustc_monomorphize/src/collector.rs:688 MirUsedCollector
class MirUsedCollector extends Visitor {
  constructor(
    public tcx: TyCtxt,
    public body: Body,
    public used_items: MonoItems,
    /// See the comment in `collect_items_of_instance` for the purpose of this set.
    /// Note that this contains *not-monomorphized* items!
    public used_mentioned_items: KeyedSet<MentionedItem>,
    public instance: Instance,
  ) {
    super();
  }

  // PORT: `T: TypeFoldable` takes its descriptor `d_T` (D4).
  // rustc: compiler/rustc_monomorphize/src/collector.rs:699 monomorphize
  monomorphize<T>(value: T, d_T: Parameters<typeof Instance.instantiate_mir_and_normalize_erasing_regions<T>>[4]): T {
    // trace!("monomorphize: self.instance={:?}", self.instance);
    return Instance.instantiate_mir_and_normalize_erasing_regions(
      this.instance,
      this.tcx,
      TypingEnv.fully_monomorphized(),
      EarlyBinder.bind(this.tcx, value, d_T),
      d_T,
    );
  }

  /// Evaluates a *not yet monomorphized* constant.
  // rustc: compiler/rustc_monomorphize/src/collector.rs:712 eval_constant
  eval_constant(constant: ConstOperand): ConstValue | undefined {
    const const_ = this.monomorphize(constant.const_, mir_Const_foldable);
    // Evaluate the constant. This makes const eval failure a collection-time error (rather than
    // a codegen-time error). rustc stops after collection if there was an error, so this
    // ensures codegen never has to worry about failing consts.
    // (codegen relies on this and ICEs will happen if this is violated.)
    const r = mir_Const.eval(const_, this.tcx, TypingEnv.fully_monomorphized(), constant.span);
    if (r.$ === "Ok") {
      return r._0;
    }
    const err = r._0;
    if (err.$ === "TooGeneric") {
      span_bug(constant.span, `collection encountered polymorphic constant: ${debug_mir_Const(const_, PLAIN)}`);
    }
    ErrorHandled.emit_note(err, this.tcx);
    return undefined;
  }

  // rustc: compiler/rustc_monomorphize/src/collector.rs:734 visit_rvalue
  override visit_rvalue(rvalue: Rvalue, location: Location): void {
    // debug!("visiting rvalue {:?}", *rvalue);

    const span = this.body.source_info(location).span;

    if (rvalue.$ === "Cast" && rvalue._0.$ === "PointerCoercion" && rvalue._0._0.$ === "Unsize") {
      // When doing an cast from a regular pointer to a wide pointer, we
      // have to instantiate all methods of the trait being cast to, so we
      // can build the appropriate vtable.
      const operand = rvalue._1;
      const target_ty = rvalue._2;
      const source_ty = Operand.ty(operand, this.body, this.tcx);
      // *Before* monomorphizing, record that we already handled this mention.
      this.used_mentioned_items.add({ $: "UnsizeCast", source_ty, target_ty });
      const target_ty_ = this.monomorphize(target_ty, fold_Ty);
      const source_ty_ = this.monomorphize(source_ty, fold_Ty);
      const [source_tail, target_tail] = find_tails_for_unsizing(this.tcx.at(span), source_ty_, target_ty_);
      // This could also be a different Unsize instruction, like
      // from a fixed sized array to a slice. But we are only
      // interested in things that produce a vtable.
      if (target_tail.is_trait() && !source_tail.is_trait()) {
        create_mono_items_for_vtable_methods(this.tcx, target_tail, source_tail, span, this.used_items);
      }
    } else if (rvalue.$ === "Cast" && rvalue._0.$ === "PointerCoercion" && rvalue._0._0.$ === "ReifyFnPointer") {
      const operand = rvalue._1;
      const fn_ty = Operand.ty(operand, this.body, this.tcx);
      // *Before* monomorphizing, record that we already handled this mention.
      this.used_mentioned_items.add({ $: "Fn", _0: fn_ty });
      const fn_ty_ = this.monomorphize(fn_ty, fold_Ty);
      visit_fn_use(this.tcx, fn_ty_, false, span, this.used_items);
    } else if (rvalue.$ === "Cast" && rvalue._0.$ === "PointerCoercion" && rvalue._0._0.$ === "ClosureFnPointer") {
      const operand = rvalue._1;
      const source_ty = Operand.ty(operand, this.body, this.tcx);
      // *Before* monomorphizing, record that we already handled this mention.
      this.used_mentioned_items.add({ $: "Closure", _0: source_ty });
      const source_ty_ = this.monomorphize(source_ty, fold_Ty);
      const kind = source_ty_.kind();
      if (kind.$ === "Closure") {
        const instance = Instance.resolve_closure(this.tcx, kind._0, kind._1, "FnOnce");
        if (this.tcx.should_codegen_locally(instance)) {
          this.used_items.push(create_fn_mono_item(this.tcx, instance, span));
        }
      } else {
        bug("");
      }
    } else if (rvalue.$ === "ThreadLocalRef") {
      const def_id = rvalue._0;
      assert(this.tcx.is_thread_local_static(def_id), "assertion failed: self.tcx.is_thread_local_static(def_id)");
      const instance = Instance.mono(this.tcx, def_id);
      if (this.tcx.should_codegen_locally(instance)) {
        // trace!("collecting thread-local static {:?}", def_id);
        this.used_items.push(respan<MonoItem>(span, { $: "Static", _0: def_id }));
      }
    } else {
      /* not interesting */
    }

    this.super_rvalue(rvalue, location);
  }

  /// This does not walk the MIR of the constant as that is not needed for codegen, all we need is
  /// to ensure that the constant evaluates successfully and walk the result.
  // #[instrument(skip(self), level = "debug")]
  // rustc: compiler/rustc_monomorphize/src/collector.rs:816 visit_const_operand
  override visit_const_operand(constant: ConstOperand, _location: Location): void {
    // No `super_constant` as we don't care about `visit_ty`/`visit_ty_const`.
    const val = this.eval_constant(constant);
    if (val === undefined) return;
    collect_const_value(this.tcx, val, this.used_items);
  }

  // rustc: compiler/rustc_monomorphize/src/collector.rs:822 visit_terminator
  override visit_terminator(terminator: Terminator, location: Location): void {
    // debug!("visiting terminator {:?} @ {:?}", terminator, location);
    const source = this.body.source_info(location).span;

    const tcx = this.tcx;
    const push_mono_lang_item = (this_: MirUsedCollector, lang_item: LangItem): void => {
      const instance = Instance.mono(tcx, tcx.require_lang_item(lang_item, source));
      if (tcx.should_codegen_locally(instance)) {
        this_.used_items.push(create_fn_mono_item(tcx, instance, source));
      }
    };

    const kind = terminator.kind;
    switch (kind.$) {
      case "Call":
      case "TailCall": {
        const func = kind.func;
        const args = kind.args;
        const callee_ty = Operand.ty(func, this.body, tcx);
        // *Before* monomorphizing, record that we already handled this mention.
        this.used_mentioned_items.add({ $: "Fn", _0: callee_ty });
        const callee_ty_ = this.monomorphize(callee_ty, fold_Ty);

        // HACK(explicit_tail_calls): collect tail calls to `#[track_caller]` functions as indirect,
        // because we later call them as such, to prevent issues with ABI incompatibility.
        // Ideally we'd replace such tail calls with normal call + return, but this requires
        // post-mono MIR optimizations, which we don't yet have.
        let force_indirect_call = false;
        if (kind.$ === "TailCall") {
          const callee_kind = callee_ty_.kind();
          if (callee_kind.$ === "FnDef") {
            const instance = Instance.expect_resolve(
              this.tcx,
              TypingEnv.fully_monomorphized(),
              callee_kind._0,
              unwrap(Binder.no_bound_vars(callee_kind._1, fold_GenericArgs)),
              source,
            );
            if (InstanceKind.requires_caller_location(instance.def, this.tcx)) {
              force_indirect_call = true;
            }
          }
        }

        visit_fn_use(this.tcx, callee_ty_, !force_indirect_call, source, this.used_items);

        const callee_kind = callee_ty_.kind();
        if (callee_kind.$ === "FnDef" && this.tcx.is_intrinsic(callee_kind._0, sym.offload) && args[0] !== undefined) {
          const kernel = args[0];
          const kernel_ty = Operand.ty(kernel.node, this.body, this.tcx);
          const kernel_ty_ = this.monomorphize(kernel_ty, fold_Ty);
          visit_fn_use(this.tcx, kernel_ty_, false, source, this.used_items);
        }
        break;
      }
      case "Drop": {
        const ty = kind.place.ty(this.body, this.tcx).ty;
        // *Before* monomorphizing, record that we already handled this mention.
        this.used_mentioned_items.add({ $: "Drop", _0: ty });
        const ty_ = this.monomorphize(ty, fold_Ty);
        visit_drop_use(this.tcx, ty_, true, source, this.used_items);
        break;
      }
      case "InlineAsm": {
        for (const op of kind.operands) {
          if (op.$ === "SymFn") {
            const fn_ty = mir_Const.ty(op.value.const_);
            // *Before* monomorphizing, record that we already handled this mention.
            this.used_mentioned_items.add({ $: "Fn", _0: fn_ty });
            const fn_ty_ = this.monomorphize(fn_ty, fold_Ty);
            visit_fn_use(this.tcx, fn_ty_, false, source, this.used_items);
          } else if (op.$ === "SymStatic") {
            const def_id = op.def_id;
            const instance = Instance.mono(this.tcx, def_id);
            if (this.tcx.should_codegen_locally(instance)) {
              // trace!("collecting asm sym static {:?}", def_id);
              this.used_items.push(respan<MonoItem>(source, { $: "Static", _0: def_id }));
            }
          }
        }
        break;
      }
      case "Assert": {
        const msg = kind.msg;
        switch (msg.$) {
          case "BoundsCheck":
            push_mono_lang_item(this, "PanicBoundsCheck");
            break;
          case "MisalignedPointerDereference":
            push_mono_lang_item(this, "PanicMisalignedPointerDereference");
            break;
          case "NullPointerDereference":
            push_mono_lang_item(this, "PanicNullPointerDereference");
            break;
          case "NullReferenceConstructed":
            push_mono_lang_item(this, "PanicNullReferenceConstructed");
            break;
          case "InvalidEnumConstruction":
            push_mono_lang_item(this, "PanicInvalidEnumConstruction");
            break;
          default:
            push_mono_lang_item(this, AssertKind.panic_function(msg));
            break;
        }
        break;
      }
      case "UnwindTerminate":
        push_mono_lang_item(this, UnwindTerminateReason.lang_item(kind._0));
        break;
      case "Goto":
      case "SwitchInt":
      case "UnwindResume":
      case "Return":
      case "Unreachable":
        break;
      case "CoroutineDrop":
      case "Yield":
      case "FalseEdge":
      case "FalseUnwind":
        bug("");
    }

    const unwind = terminator.unwind();
    if (unwind !== undefined && unwind.$ === "Terminate") {
      push_mono_lang_item(this, UnwindTerminateReason.lang_item(unwind._0));
    }

    this.super_terminator(terminator, location);
  }
}

// rustc: compiler/rustc_monomorphize/src/collector.rs:950 visit_drop_use
function visit_drop_use(tcx: TyCtxt, ty: Ty, is_direct_call: boolean, source: Span, output: MonoItems): void {
  const instance = Instance.resolve_drop_glue(tcx, ty);
  visit_instance_use(tcx, instance, is_direct_call, source, output);
}

/// For every call of this function in the visitor, make sure there is a matching call in the
/// `mentioned_items` pass!
// rustc: compiler/rustc_monomorphize/src/collector.rs:963 visit_fn_use
function visit_fn_use(tcx: TyCtxt, ty: Ty, is_direct_call: boolean, source: Span, output: MonoItems): void {
  const kind = ty.kind();
  if (kind.$ === "FnDef") {
    const def_id = kind._0;
    const args = unwrap(Binder.no_bound_vars(kind._1, fold_GenericArgs));
    let instance: Instance;
    if (is_direct_call) {
      instance = Instance.expect_resolve(tcx, TypingEnv.fully_monomorphized(), def_id, args, source);
    } else {
      const r = Instance.resolve_for_fn_ptr(tcx, TypingEnv.fully_monomorphized(), def_id, args);
      if (r === undefined) return bug(`failed to resolve instance for ${display_Ty(ty)}`);
      instance = r;
    }
    visit_instance_use(tcx, instance, is_direct_call, source, output);
  }
}

// rustc: compiler/rustc_monomorphize/src/collector.rs:995 visit_instance_use
function visit_instance_use(tcx: TyCtxt, instance: Instance, is_direct_call: boolean, source: Span, output: MonoItems): void {
  // debug!("visit_item_use({:?}, is_direct_call={:?})", instance, is_direct_call);
  if (!tcx.should_codegen_locally(instance)) {
    return;
  }
  const intrinsic = tcx.intrinsic(Instance.def_id(instance));
  if (intrinsic !== undefined) {
    const _requirement = ValidityRequirement.from_intrinsic(intrinsic.name);
    if (_requirement !== undefined) {
      // The intrinsics assert_inhabited, assert_zero_valid, and assert_mem_uninitialized_valid will
      // be lowered in codegen to nothing or a call to panic_nounwind. So if we encounter any
      // of those intrinsics, we need to include a mono item for panic_nounwind, else we may try to
      // codegen a call to that function without generating code for the function itself.
      const def_id = tcx.require_lang_item("PanicNounwind", source);
      const panic_instance = Instance.mono(tcx, def_id);
      if (tcx.should_codegen_locally(panic_instance)) {
        output.push(create_fn_mono_item(tcx, panic_instance, source));
      }
    } else if (
      !intrinsic.must_be_overridden &&
      (tcx.sess.opts.unstable_opts.force_intrinsic_fallback || !tcx.sess.replaced_intrinsics.has(intrinsic.name))
    ) {
      // Codegen the fallback body of intrinsics with fallback bodies.
      // We have to skip this otherwise as there's no body to codegen.
      //
      // We also skip `replaced_intrinsics` which are always replaced by the backend and hence
      // monomorphizing the fallback body would be pointless.
      //
      // However, when -Zforce-intrinsic-fallback is set (e.g. to test the fallback
      // implementations) we ignore the optimization hint and do monomorphize
      // the fallback body.
      const instance_ = Instance.new_raw(Instance.def_id(instance), instance.args);
      if (tcx.should_codegen_locally(instance_)) {
        output.push(create_fn_mono_item(tcx, instance_, source));
      }
    }
  }

  const def = instance.def;
  if (def.$ === "Virtual" || def.$ === "Intrinsic" || def.$ === "LlvmIntrinsic") {
    if (!is_direct_call) {
      bug(`${debug_Instance(instance, PLAIN)} being reified`);
    }
  } else if (def.$ === "Shim" && def._0.$ === "ThreadLocal") {
    bug(`${debug_Instance(instance, PLAIN)} being reified`);
  } else if (def.$ === "Shim" && def._0.$ === "DropGlue" && def._0._1 === undefined) {
    // Don't need to emit noop drop glue if we are calling directly.
    //
    // Note that we also optimize away the call to visit_instance_use in vtable construction
    // (see create_mono_items_for_vtable_methods).
    if (!is_direct_call) {
      output.push(create_fn_mono_item(tcx, instance, source));
    }
  } else {
    // `Item(..)`, `Shim(DropGlue(_, Some(_)))`, `Shim(FutureDropPoll(..))`, `Shim(AsyncDropGlue(_, _))`,
    // `Shim(AsyncDropGlueCtor(_, _))`, `Shim(VTable(..))`, `Shim(Reify(..))`, `Shim(ClosureOnce { .. })`,
    // `Shim(ConstructCoroutineInClosure { .. })`, `Shim(FnPtr(..))`, `Shim(Clone(..))`, `Shim(FnPtrAsPtr(..))`,
    // `Shim(FnPtrFromPtr(..))`
    output.push(create_fn_mono_item(tcx, instance, source));
  }
}

/// Returns `true` if we should codegen an instance in the local crate, or returns `false` if we
/// can just link to the upstream crate and therefore don't need a mono item.
// rustc: compiler/rustc_monomorphize/src/collector.rs:1077 should_codegen_locally
function should_codegen_locally(tcx: TyCtxt, instance: Instance): boolean {
  const def_id = InstanceKind.def_id_if_not_guaranteed_local_codegen(instance.def);
  if (def_id === undefined) {
    return true;
  }

  if (tcx.is_foreign_item(def_id)) {
    // Foreign items are always linked against, there's no way of instantiating them.
    return false;
  }

  if (DefKind.has_codegen_attrs(tcx.def_kind(def_id)) && (tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs).inline.$ === "Force") {
    // `#[rustc_force_inline]` items should never be codegened. This should be caught by
    // the MIR validator.
    tcx.dcx().delayed_bug("attempt to codegen `#[rustc_force_inline]` item");
  }

  if (def_id.is_local()) {
    // Local items cannot be referred to locally without monomorphizing them locally.
    return true;
  }

  if (tcx.is_reachable_non_generic(def_id) || Instance.upstream_monomorphization(instance, tcx) !== undefined) {
    // We can link to the item in question, no instance needed in this crate.
    return false;
  }

  if (tcx.def_kind(def_id).$ === "Static") {
    // We cannot monomorphize statics from upstream crates.
    return false;
  }

  // See comment in should_encode_mir in rustc_metadata for why we don't report
  // an error for constructors.
  if (!tcx.is_mir_available(def_id) && tcx.def_kind(def_id).$ !== "Ctor") {
    tcx.dcx().emit_fatal(
      NoOptimizedMir_diagnostic({
        span: tcx.def_span(def_id),
        crate_name: tcx.crate_name(def_id.krate),
        instance: display_Instance(instance),
      }),
    );
  }

  return true;
}

/// For a given pair of source and target type that occur in an unsizing coercion,
/// this function finds the pair of types that determines the vtable linking
/// them.
///
/// For example, the source type might be `&SomeStruct` and the target type
/// might be `&dyn SomeTrait` in a cast like:
///
/// ```rust,ignore (not real code)
/// let src: &SomeStruct = ...;
/// let target = src as &dyn SomeTrait;
/// ```
///
/// Then the output of this function would be (SomeStruct, SomeTrait) since for
/// constructing the `target` wide-pointer we need the vtable for that pair.
///
/// Things can get more complicated though because there's also the case where
/// the unsized type occurs as a field:
///
/// ```rust
/// struct ComplexStruct<T: ?Sized> {
///    a: u32,
///    b: f64,
///    c: T
/// }
/// ```
///
/// In this case, if `T` is sized, `&ComplexStruct<T>` is a thin pointer. If `T`
/// is unsized, `&SomeStruct` is a wide pointer, and the vtable it points to is
/// for the pair of `T` (which is a trait) and the concrete type that `T` was
/// originally coerced from:
///
/// ```rust,ignore (not real code)
/// let src: &ComplexStruct<SomeStruct> = ...;
/// let target = src as &ComplexStruct<dyn SomeTrait>;
/// ```
///
/// Again, we want this `find_vtable_types_for_unsizing()` to provide the pair
/// `(SomeStruct, SomeTrait)`.
///
/// Finally, there is also the case of custom unsizing coercions, e.g., for
/// smart pointers such as `Rc` and `Arc`.
// rustc: compiler/rustc_monomorphize/src/collector.rs:1164 find_tails_for_unsizing
function find_tails_for_unsizing(tcx: TyCtxtAt, source_ty: Ty, target_ty: Ty): [Ty, Ty] {
  const typing_env = TypingEnv.fully_monomorphized();
  // debug_assert!(!source_ty.has_param(), "{source_ty} should be fully monomorphic");
  // debug_assert!(!target_ty.has_param(), "{target_ty} should be fully monomorphic");

  const source_kind = source_ty.kind();
  const target_kind = target_ty.kind();
  if (source_kind.$ === "Pat" && target_kind.$ === "Pat") {
    return find_tails_for_unsizing(tcx, source_kind._0, target_kind._0);
  }
  if (source_kind.$ === "Ref" && target_kind.$ === "Ref") {
    return tcx.tcx.struct_lockstep_tails_for_codegen(source_kind._1, target_kind._1, typing_env);
  }
  if (source_kind.$ === "Ref" && target_kind.$ === "RawPtr") {
    return tcx.tcx.struct_lockstep_tails_for_codegen(source_kind._1, target_kind._0, typing_env);
  }
  if (source_kind.$ === "RawPtr" && target_kind.$ === "RawPtr") {
    return tcx.tcx.struct_lockstep_tails_for_codegen(source_kind._0, target_kind._0, typing_env);
  }

  // `Box<T>` could go through the ADT code below, b/c it'll unpeel to `Unique<T>`,
  // and eventually bottom out in a raw ref, but we can micro-optimize it here.
  const source_boxed = source_ty.boxed_ty();
  if (source_boxed !== undefined) {
    const target_boxed = target_ty.boxed_ty();
    if (target_boxed !== undefined) {
      return tcx.tcx.struct_lockstep_tails_for_codegen(source_boxed, target_boxed, typing_env);
    }
  }

  if (source_kind.$ === "Adt" && target_kind.$ === "Adt") {
    const source_adt_def = source_kind._0;
    const target_adt_def = target_kind._0;
    const source_args = source_kind._1;
    const target_args = target_kind._1;
    assert(source_adt_def === target_adt_def, "assertion `left == right` failed");
    const ccu = custom_coerce_unsize_info(tcx, source_ty, target_ty);
    if (ccu.$ === "Err") {
      const e = Ty.new_error(tcx.tcx, ccu._0);
      return [e, e];
    }
    const coerce_index = ccu._0._0;
    const coerce_field = source_adt_def.non_enum_variant().fields[coerce_index]!;
    // We're getting a possibly unnormalized type, so normalize it.
    const source_field = tcx.tcx.normalize_erasing_regions(typing_env, coerce_field.ty(tcx.tcx, source_args), fold_Ty);
    const target_field = tcx.tcx.normalize_erasing_regions(typing_env, coerce_field.ty(tcx.tcx, target_args), fold_Ty);
    return find_tails_for_unsizing(tcx, source_field, target_field);
  }

  bug(`find_vtable_types_for_unsizing: invalid coercion ${debug_Ty(source_ty, PLAIN)} -> ${debug_Ty(target_ty, PLAIN)}`);
}

// #[instrument(skip(tcx), level = "debug", ret)]
// rustc: compiler/rustc_monomorphize/src/collector.rs:1220 create_fn_mono_item
function create_fn_mono_item(tcx: TyCtxt, instance: Instance, source: Span): Spanned<MonoItem> {
  const def_id = Instance.def_id(instance);
  if (tcx.sess.opts.unstable_opts.profile_closures && def_id.is_local() && tcx.is_closure_like(def_id)) {
    dump_closure_profile(tcx, instance);
  }

  return respan<MonoItem>(source, { $: "Fn", _0: instance });
}

/// Creates a `MonoItem` for each method that is referenced by the vtable for
/// the given trait/impl pair.
// rustc: compiler/rustc_monomorphize/src/collector.rs:1238 create_mono_items_for_vtable_methods
function create_mono_items_for_vtable_methods(tcx: TyCtxt, trait_ty: Ty, impl_ty: Ty, source: Span, output: MonoItems): void {
  assert(!TypeVisitableExt.has_escaping_bound_vars(trait_ty, fold_Ty) && !TypeVisitableExt.has_escaping_bound_vars(impl_ty, fold_Ty), "assertion failed: !trait_ty.has_escaping_bound_vars() && !impl_ty.has_escaping_bound_vars()");

  const kind = trait_ty.kind();
  if (kind.$ !== "Dynamic") {
    bug(`create_mono_items_for_vtable_methods: ${debug_Ty(trait_ty, PLAIN)} not a trait type`);
  }
  const principal = kind._0.principal();
  if (principal !== undefined) {
    const trait_ref = tcx.instantiate_bound_regions_with_erased(PolyExistentialTraitRef.with_self_ty(principal, as_interner(tcx), impl_ty), d_TraitRef);
    assert(!TypeVisitableExt.has_escaping_bound_vars(trait_ref, d_TraitRef), "assertion failed: !trait_ref.has_escaping_bound_vars()");

    // Walk all methods of the trait, including those of its supertraits
    const entries = tcx.vtable_entries(trait_ref);
    // debug!(?entries);
    for (const entry of entries) {
      switch (entry.$) {
        case "MetadataDropInPlace":
        case "MetadataSize":
        case "MetadataAlign":
        case "Vacant":
          break;
        case "TraitVPtr":
          // all super trait items already covered, so skip them.
          break;
        case "Method":
          if (tcx.should_codegen_locally(entry._0)) {
            output.push(create_fn_mono_item(tcx, entry._0, source));
          }
          break;
      }
    }
  }

  // Also add the destructor, if it's necessary.
  //
  // This matches the check in vtable_allocation_provider in middle/ty/vtable.rs,
  // if we don't need drop we're not adding an actual pointer to the vtable.
  if (impl_ty.needs_drop(tcx, TypingEnv.fully_monomorphized())) {
    visit_drop_use(tcx, impl_ty, false, source, output);
  }
}

/// Scans the CTFE alloc in order to find function pointers and statics that must be monomorphized.
// rustc: compiler/rustc_monomorphize/src/collector.rs:1287 collect_alloc
function collect_alloc(tcx: TyCtxt, alloc_id: AllocId, output: MonoItems): void {
  const ga: GlobalAlloc = tcx.global_alloc(alloc_id);
  switch (ga.$) {
    case "Static": {
      const def_id = ga._0;
      assert(!tcx.is_thread_local_static(def_id), "assertion failed: !tcx.is_thread_local_static(def_id)");
      const instance = Instance.mono(tcx, def_id);
      if (tcx.should_codegen_locally(instance)) {
        // trace!("collecting static {:?}", def_id);
        output.push(dummy_spanned<MonoItem>({ $: "Static", _0: def_id }));
      }
      break;
    }
    case "Memory": {
      // trace!("collecting {:?} with {:#?}", alloc_id, alloc);
      const ptrs = ga._0.inner().provenance.ptrs_();
      if (!ptrs.is_empty()) {
        for (const prov of ptrs.values()) {
          collect_alloc(tcx, CtfeProvenance.alloc_id(prov), output);
        }
      }
      break;
    }
    case "Function": {
      const instance = ga.instance;
      if (tcx.should_codegen_locally(instance)) {
        // trace!("collecting {:?} with {:#?}", alloc_id, instance);
        output.push(create_fn_mono_item(tcx, instance, DUMMY_SP));
      }
      break;
    }
    case "VTable": {
      const ty = ga._0;
      const dyn_ty = ga._1;
      const principal = dyn_ty.principal();
      const alloc_id_ = tcx.vtable_allocation([ty, principal !== undefined ? tcx.instantiate_bound_regions_with_erased(principal, d_ExistentialTraitRef) : undefined]);
      collect_alloc(tcx, alloc_id_, output);
      break;
    }
    case "TypeId":
      break;
  }
}

/// Scans the MIR in order to find function calls, closures, and drop-glue.
///
/// Anything that's found is added to `output`. Furthermore the "mentioned items" of the MIR are returned.
// #[instrument(skip(tcx), level = "debug")]
// rustc: compiler/rustc_monomorphize/src/collector.rs:1329 collect_items_of_instance
function collect_items_of_instance(tcx: TyCtxt, instance: Instance, mode: CollectionMode): Result<[MonoItems, MonoItems], NormalizationErrorInMono> {
  // This item is getting monomorphized, do mono-time checks.
  const body = tcx.instance_mir(instance.def);
  // Plenty of code paths later assume that everything can be normalized. So we have to check
  // normalization first.
  // We choose to emit the error outside to provide helpful diagnostics.
  const norm = check_normalization_error(tcx, instance, body);
  if (norm.$ === "Err") return norm;
  tcx.ensure_ok().check_mono_item(instance);

  // Naively, in "used" collection mode, all functions get added to *both* `used_items` and
  // `mentioned_items`. Mentioned items processing will then notice that they have already been
  // visited, but at that point each mentioned item has been monomorphized, added to the
  // `mentioned_items` worklist, and checked in the global set of visited items. To remove that
  // overhead, we have a special optimization that avoids adding items to `mentioned_items` when
  // they are already added in `used_items`. We could just scan `used_items`, but that's a linear
  // scan and not very efficient. Furthermore we can only do that *after* monomorphizing the
  // mentioned item. So instead we collect all pre-monomorphized `MentionedItem` that were already
  // added to `used_items` in a hash set, which can efficiently query in the
  // `body.mentioned_items` loop below without even having to monomorphize the item.
  const used_items = MonoItems.new();
  const mentioned_items = MonoItems.new();
  const used_mentioned_items = new KeyedSet<MentionedItem>(intern_key);
  const collector = new MirUsedCollector(tcx, body, used_items, used_mentioned_items, instance);

  if (mode === CollectionMode.UsedItems) {
    if (tcx.sess.opts.debuginfo === "Full") {
      for (const var_debug_info of body.var_debug_info) {
        collector.visit_var_debug_info(var_debug_info);
      }
    }
    for (const [bb, data] of mono_reachable(body, tcx, instance)) {
      collector.visit_basic_block_data(bb, data);
    }
  }

  // Always visit all `required_consts`, so that we evaluate them and abort compilation if any of
  // them errors.
  for (const const_op of body.required_consts_()) {
    const val = collector.eval_constant(const_op);
    if (val !== undefined) {
      collect_const_value(tcx, val, mentioned_items);
    }
  }

  // Always gather mentioned items. We try to avoid processing items that we have already added to
  // `used_items` above.
  for (const item of body.mentioned_items_()) {
    if (!collector.used_mentioned_items.has(item.node)) {
      const item_mono = collector.monomorphize(item.node, d_MentionedItem);
      visit_mentioned_item(tcx, item_mono, item.span, mentioned_items);
    }
  }

  return Ok([used_items, mentioned_items]);
}

// rustc: compiler/rustc_monomorphize/src/collector.rs:1394 items_of_instance
function items_of_instance(
  tcx: TyCtxt,
  [instance, mode]: [Instance, CollectionMode],
): Result<[readonly Spanned<MonoItem>[], readonly Spanned<MonoItem>[]], NormalizationErrorInMono> {
  const r = collect_items_of_instance(tcx, instance, mode);
  if (r.$ === "Err") return r;
  const [used_items, mentioned_items] = r._0;

  return Ok([used_items.into_iter(), mentioned_items.into_iter()]);
}

/// `item` must be already monomorphized.
// #[instrument(skip(tcx, span, output), level = "debug")]
// rustc: compiler/rustc_monomorphize/src/collector.rs:1411 visit_mentioned_item
function visit_mentioned_item(tcx: TyCtxt, item: MentionedItem, span: Span, output: MonoItems): void {
  switch (item.$) {
    case "Fn": {
      const kind = item._0.kind();
      if (kind.$ === "FnDef") {
        const args = unwrap(Binder.no_bound_vars(kind._1, fold_GenericArgs));
        const instance = Instance.expect_resolve(tcx, TypingEnv.fully_monomorphized(), kind._0, args, span);
        // `visit_instance_use` was written for "used" item collection but works just as well
        // for "mentioned" item collection.
        // We can set `is_direct_call`; that just means we'll skip a bunch of shims that anyway
        // can't have their own failing constants.
        visit_instance_use(tcx, instance, /*is_direct_call*/ true, span, output);
      }
      break;
    }
    case "Drop":
      visit_drop_use(tcx, item._0, /*is_direct_call*/ true, span, output);
      break;
    case "UnsizeCast": {
      const [source_ty, target_ty] = find_tails_for_unsizing(tcx.at(span), item.source_ty, item.target_ty);
      // This could also be a different Unsize instruction, like
      // from a fixed sized array to a slice. But we are only
      // interested in things that produce a vtable.
      if (target_ty.is_trait() && !source_ty.is_trait()) {
        create_mono_items_for_vtable_methods(tcx, target_ty, source_ty, span, output);
      }
      break;
    }
    case "Closure": {
      const kind = item._0.kind();
      if (kind.$ === "Closure") {
        const instance = Instance.resolve_closure(tcx, kind._0, kind._1, "FnOnce");
        if (tcx.should_codegen_locally(instance)) {
          output.push(create_fn_mono_item(tcx, instance, span));
        }
      } else {
        bug("");
      }
      break;
    }
  }
}

// #[instrument(skip(tcx, output), level = "debug")]
// rustc: compiler/rustc_monomorphize/src/collector.rs:1463 collect_const_value
function collect_const_value(tcx: TyCtxt, value: ConstValue, output: MonoItems): void {
  if (value.$ === "Scalar" && value._0.$ === "Ptr") {
    collect_alloc(tcx, CtfeProvenance.alloc_id(value._0._0.provenance), output);
  } else if (value.$ === "Indirect" || value.$ === "Slice") {
    collect_alloc(tcx, value.alloc_id, output);
  }
}

//=-----------------------------------------------------------------------------
// Root Collection
//=-----------------------------------------------------------------------------

// Find all non-generic items by walking the HIR. These items serve as roots to
// start monomorphizing from.
// #[instrument(skip(tcx, mode), level = "debug")]
// rustc: compiler/rustc_monomorphize/src/collector.rs:1485 collect_roots
function collect_roots(tcx: TyCtxt, mode: MonoItemCollectionStrategy): MonoItem[] {
  // debug!("collecting roots");
  const roots = MonoItems.new();

  // Read the manifest and add the recorded kernel instantiations as roots so they are codegened.
  const offload = tcx.sess.opts.unstable_opts.offload;
  if (offload.some((o) => o.$ === "Device" && o._0 !== "")) {
    unported("rustc_monomorphize::offload::manifest::read_manifest");
  }

  {
    const entry_fn = tcx.entry_fn(null) as [DefId, EntryFnType] | undefined;

    // debug!("collect_roots: entry_fn = {:?}", entry_fn);

    const collector = new RootCollector(tcx, mode, roots, entry_fn);

    const crate_items = tcx.hir_crate_items(null) as ModuleItems;

    for (const id of crate_items.free_items()) {
      collector.process_item(id);
    }

    for (const id of crate_items.impl_items()) {
      collector.process_impl_item(id);
    }

    for (const id of crate_items.nested_bodies()) {
      collector.process_nested_body(id);
    }

    collector.push_extra_entry_roots();
  }

  const is_host_metadata = offload.some((o) => o.$ === "HostMetadata");
  if (is_host_metadata) {
    const crate_items = tcx.hir_crate_items(null) as ModuleItems;
    for (const id of crate_items.free_items()) {
      const kind = tcx.def_kind(id.owner_id);
      if (!(kind.$ === "Fn" || kind.$ === "AssocFn")) {
        continue;
      }
      const def_id = id.owner_id.to_def_id();
      if (
        !(tcx.generics_of(def_id) as Generics).requires_monomorphization(tcx) &&
        CodegenFnAttrFlags.intersects((tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs).flags, CodegenFnAttrFlags.OFFLOAD_KERNEL)
      ) {
        roots.push(dummy_spanned<MonoItem>({ $: "Fn", _0: Instance.mono(tcx, def_id) }));
      }
    }
    for (const id of crate_items.impl_items()) {
      const kind = tcx.def_kind(id.owner_id);
      if (!(kind.$ === "Fn" || kind.$ === "AssocFn")) {
        continue;
      }
      const def_id = id.owner_id.to_def_id();
      if (
        !(tcx.generics_of(def_id) as Generics).requires_monomorphization(tcx) &&
        CodegenFnAttrFlags.intersects((tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs).flags, CodegenFnAttrFlags.OFFLOAD_KERNEL)
      ) {
        roots.push(dummy_spanned<MonoItem>({ $: "Fn", _0: Instance.mono(tcx, def_id) }));
      }
    }
    for (const id of crate_items.trait_items()) {
      const kind = tcx.def_kind(id.owner_id);
      if (!(kind.$ === "Fn" || kind.$ === "AssocFn")) {
        continue;
      }
      const def_id = id.owner_id.to_def_id();
      if (
        !(tcx.generics_of(def_id) as Generics).requires_monomorphization(tcx) &&
        CodegenFnAttrFlags.intersects((tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs).flags, CodegenFnAttrFlags.OFFLOAD_KERNEL)
      ) {
        roots.push(dummy_spanned<MonoItem>({ $: "Fn", _0: Instance.mono(tcx, def_id) }));
      }
    }
  }

  // We can only codegen items that are instantiable - items all of
  // whose predicates hold. Luckily, items that aren't instantiable
  // can't actually be used, so we can just skip codegenning them.
  return roots
    .into_iter()
    .filter(({ node: mono_item }) => MonoItem.is_instantiable(mono_item, tcx))
    .map(({ node: mono_item }) => mono_item);
}

// rustc-type: compiler/rustc_monomorphize/src/collector.rs:1596 RootCollector
class RootCollector {
  constructor(
    public tcx: TyCtxt,
    public strategy: MonoItemCollectionStrategy,
    public output: MonoItems,
    public entry_fn: [DefId, EntryFnType] | undefined,
  ) {}

  // rustc: compiler/rustc_monomorphize/src/collector.rs:1604 process_item
  process_item(id: ItemId): void {
    const def_kind = this.tcx.def_kind(id.owner_id);
    switch (def_kind.$) {
      case "Enum":
      case "Struct":
      case "Union": {
        if (this.strategy === MonoItemCollectionStrategy.Eager && !(this.tcx.generics_of(id.owner_id) as Generics).requires_monomorphization(this.tcx)) {
          // debug!("RootCollector: ADT drop-glue for `{id:?}`",);
          const id_args = RawList.for_item(this.tcx, id.owner_id.to_def_id(), (param, _) => {
            switch (param.kind.$) {
              case "Lifetime":
                return this.tcx.lifetimes.re_erased as GenericArg;
              case "Type":
              case "Const":
                unreachable("`own_requires_monomorphization` check means that we should have no type/const params");
            }
          });

          // This type is impossible to instantiate, so we should not try to
          // generate a `drop_glue` instance for it.
          if (this.tcx.instantiate_and_check_impossible_clauses([id.owner_id.to_def_id(), id_args])) {
            return;
          }

          const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(this.tcx.type_of(id.owner_id.to_def_id()), this.tcx, id_args, fold_Ty));
          assert(!TypeVisitableExt.has_non_region_param(ty, fold_Ty), "assertion failed: !ty.has_non_region_param()");
          visit_drop_use(this.tcx, ty, true, DUMMY_SP, this.output);
        }
        break;
      }
      case "GlobalAsm": {
        // debug!(
        //     "RootCollector: ItemKind::GlobalAsm({})",
        //     self.tcx.def_path_str(id.owner_id)
        // );
        this.output.push(dummy_spanned<MonoItem>({ $: "GlobalAsm", _0: id }));
        break;
      }
      case "Static": {
        const def_id = id.owner_id.to_def_id();
        // debug!("RootCollector: ItemKind::Static({})", self.tcx.def_path_str(def_id));
        this.output.push(dummy_spanned<MonoItem>({ $: "Static", _0: def_id }));
        break;
      }
      case "Const": {
        // Const items only generate mono items if they are actually used somewhere.
        // Just declaring them is insufficient.

        // If we're collecting items eagerly, then recurse into all constants.
        // Otherwise the value is only collected when explicitly mentioned in other items.
        if (this.strategy === MonoItemCollectionStrategy.Eager) {
          const def_id = id.owner_id.to_def_id();
          // Type Consts don't have bodies to evaluate
          // nor do they make sense as a static.
          if (this.tcx.const_of_item(def_id) !== undefined) {
            // FIXME(mgca): Is this actually what we want? We may want to
            // normalize to a ValTree then convert to a const allocation and
            // collect that?
            return;
          }
          if ((this.tcx.generics_of(id.owner_id) as Generics).own_requires_monomorphization()) {
            return;
          }
          const val = this.tcx.const_eval_poly(def_id);
          if (val.$ !== "Ok") {
            return;
          }
          collect_const_value(this.tcx, val._0, this.output);
        }
        break;
      }
      case "Impl": {
        if (def_kind.of_trait) {
          if (this.strategy === MonoItemCollectionStrategy.Eager) {
            create_mono_items_for_default_impls(this.tcx, id, this.output);
          }
        }
        break;
      }
      case "Fn": {
        this.push_if_root(id.owner_id.def_id);
        break;
      }
      default:
        break;
    }
  }

  // rustc: compiler/rustc_monomorphize/src/collector.rs:1694 process_impl_item
  process_impl_item(id: ImplItemId): void {
    if (this.tcx.def_kind(id.owner_id).$ === "AssocFn") {
      this.push_if_root(id.owner_id.def_id);
    }
  }

  // rustc: compiler/rustc_monomorphize/src/collector.rs:1700 process_nested_body
  process_nested_body(def_id: LocalDefId): void {
    const def_kind = this.tcx.def_kind(def_id);
    if (def_kind.$ === "Closure") {
      // for 'pub async fn foo(..)' also trying to monomorphize foo::{closure}
      const self_ty = (): Ty => Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(def_id)));
      const self_kind = self_ty().kind();
      let is_pub_fn_coroutine: boolean;
      switch (self_kind.$) {
        case "Coroutine": {
          const cor_id = self_kind._0;
          const tcx = this.tcx;
          const parent_id = tcx.parent(cor_id);
          is_pub_fn_coroutine =
            tcx.def_kind(parent_id).$ === "Fn" && Asyncness.is_async(tcx.asyncness(parent_id) as Asyncness) && Visibility.is_public(tcx.visibility(parent_id));
          break;
        }
        case "Closure":
        case "CoroutineClosure":
          is_pub_fn_coroutine = false;
          break;
        default:
          unreachable("");
      }
      if (
        (this.strategy === MonoItemCollectionStrategy.Eager || is_pub_fn_coroutine) &&
        !(this.tcx.generics_of(this.tcx.typeck_root_def_id_local(def_id)) as Generics).requires_monomorphization(this.tcx)
      ) {
        const instance_kind = self_ty().kind();
        let instance: Instance;
        switch (instance_kind.$) {
          case "Closure":
          case "Coroutine":
          case "CoroutineClosure":
            instance = Instance.new_raw(instance_kind._0, this.tcx.erase_and_anonymize_regions(instance_kind._1, fold_GenericArgs));
            break;
          default:
            unreachable("");
        }
        const r = this.tcx.try_normalize_erasing_regions(TypingEnv.fully_monomorphized(), Unnormalized.new_wip(instance), d_Instance);
        if (r.$ !== "Ok") {
          // Don't ICE on an impossible-to-normalize closure.
          return;
        }
        const mono_item = create_fn_mono_item(this.tcx, r._0, DUMMY_SP);
        if (MonoItem.is_instantiable(mono_item.node, this.tcx)) {
          this.output.push(mono_item);
        }
      }
    }
  }

  // rustc: compiler/rustc_monomorphize/src/collector.rs:1753 is_root
  is_root(def_id: LocalDefId): boolean {
    if ((this.tcx.generics_of(def_id) as Generics).requires_monomorphization(this.tcx)) {
      return false;
    }
    switch (this.strategy) {
      case "Eager": {
        if ((this.tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs).inline.$ === "Force") {
          return false;
        }
        // comptime fns can't be codegenned, so we need to prevent collecting them even
        // with link-dead-code. Lazy mode prevents them by them not showing up in
        // `is_reachable_non_generic` (and `entry_fn` can't be comptime).
        const kind = this.tcx.def_kind(def_id);
        if (kind.$ === "Fn" || kind.$ === "AssocFn") {
          const constness = this.tcx.constness(def_id) as Constness;
          return !(constness.$ === "Const" && constness.always === true);
        }
        return true;
      }
      case "Lazy": {
        if (this.entry_fn !== undefined && this.entry_fn[0].as_local() === def_id) {
          return true;
        }
        if (this.tcx.is_reachable_non_generic(def_id)) {
          return true;
        }
        const flags = (this.tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs).flags;
        return CodegenFnAttrFlags.intersects(
          flags,
          CodegenFnAttrFlags.union(CodegenFnAttrFlags.RUSTC_STD_INTERNAL_SYMBOL, CodegenFnAttrFlags.EXTERNALLY_IMPLEMENTABLE_ITEM),
        );
      }
    }
  }

  /// If `def_id` represents a root, pushes it onto the list of
  /// outputs. (Note that all roots must be monomorphic.)
  // #[instrument(skip(self), level = "debug")]
  // rustc: compiler/rustc_monomorphize/src/collector.rs:1785 push_if_root
  push_if_root(def_id: LocalDefId): void {
    if (this.is_root(def_id)) {
      // debug!("found root");

      const instance = Instance.mono(this.tcx, LocalDefId.to_def_id(def_id));
      this.output.push(create_fn_mono_item(this.tcx, instance, DUMMY_SP));
    }
  }

  /// As a special case, when/if we encounter the
  /// `main()` function, we also have to generate a
  /// monomorphized copy of the start lang item based on
  /// the return type of `main`. This is not needed when
  /// the user writes their own `start` manually.
  // rustc: compiler/rustc_monomorphize/src/collector.rs:1799 push_extra_entry_roots
  push_extra_entry_roots(): void {
    if (this.entry_fn === undefined || this.entry_fn[1].$ !== "Main") {
      return;
    }
    const main_def_id = this.entry_fn[0];

    const main_instance = Instance.mono(this.tcx, main_def_id);
    if (this.tcx.should_codegen_locally(main_instance)) {
      this.output.push(create_fn_mono_item(this.tcx, main_instance, this.tcx.def_span(main_def_id)));
    }

    const start_def_id = this.tcx.lang_items().start_fn();
    if (start_def_id === undefined) {
      return this.tcx.dcx().emit_fatal(StartNotFound_diagnostic({}));
    }
    const main_ret_ty = PolyFnSigC.output(unwrap(EarlyBinder.no_bound_vars(this.tcx.fn_sig(main_def_id) as EarlyBinder<PolyFnSig>, fold_PolyFnSig)));

    // Given that `main()` has no arguments,
    // then its return type cannot have
    // late-bound regions, since late-bound
    // regions must appear in the argument
    // listing.
    const main_ret_ty_bound = unwrap(Binder.no_bound_vars(main_ret_ty, fold_Ty));
    const main_ret_ty_norm = this.tcx.normalize_erasing_regions(TypingEnv.fully_monomorphized(), Unnormalized.new_wip(main_ret_ty_bound), fold_Ty);

    const start_instance = Instance.expect_resolve(
      this.tcx,
      TypingEnv.fully_monomorphized(),
      start_def_id,
      this.tcx.mk_args([main_ret_ty_norm]),
      DUMMY_SP,
    );

    this.output.push(create_fn_mono_item(this.tcx, start_instance, DUMMY_SP));
  }
}

// #[instrument(level = "debug", skip(tcx, output))]
// rustc: compiler/rustc_monomorphize/src/collector.rs:1841 create_mono_items_for_default_impls
function create_mono_items_for_default_impls(tcx: TyCtxt, item: ItemId, output: MonoItems): void {
  const impl_ = tcx.impl_trait_header(item.owner_id) as ImplTraitHeader;

  if (impl_.polarity === "Negative") {
    return;
  }

  if ((tcx.generics_of(item.owner_id) as Generics).own_requires_monomorphization()) {
    return;
  }

  // Lifetimes never affect trait selection, so we are allowed to eagerly
  // instantiate an instance of an impl method if the impl (and method,
  // which we check below) is only parameterized over lifetime. In that case,
  // we use the ReErased, which has no lifetime information associated with
  // it, to validate whether or not the impl is legal to instantiate at all.
  const only_region_params = (param: GenericParamDef, _: unknown) => {
    switch (param.kind.$) {
      case "Lifetime":
        return tcx.lifetimes.re_erased as GenericArg;
      case "Type":
      case "Const":
        unreachable("`own_requires_monomorphization` check means that we should have no type/const params");
    }
  };
  const impl_args = RawList.for_item(tcx, item.owner_id.to_def_id(), only_region_params);
  const trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(impl_.trait_ref, tcx, impl_args, d_TraitRef));

  // Unlike 'lazy' monomorphization that begins by collecting items transitively
  // called by `main` or other global items, when eagerly monomorphizing impl
  // items, we never actually check that the predicates of this impl are satisfied
  // in a empty param env (i.e. with no assumptions).
  //
  // Even though this impl has no type or const generic parameters, because we don't
  // consider higher-ranked predicates such as `for<'a> &'a mut [u8]: Copy` to
  // be trivially false. We must now check that the impl has no impossible-to-satisfy
  // clauses.
  if (tcx.instantiate_and_check_impossible_clauses([item.owner_id.to_def_id(), impl_args])) {
    return;
  }

  const typing_env = TypingEnv.fully_monomorphized();
  const trait_ref_ = tcx.normalize_erasing_regions(typing_env, Unnormalized.new_wip(trait_ref), d_TraitRef);
  const overridden_methods = tcx.impl_item_implementor_ids(item.owner_id);
  for (const method of tcx.provided_trait_methods(trait_ref_.def_id)) {
    if (overridden_methods.has(method.def_id)) {
      continue;
    }

    if ((tcx.generics_of(method.def_id) as Generics).own_requires_monomorphization()) {
      continue;
    }

    // As mentioned above, the method is legal to eagerly instantiate if it
    // only has lifetime generic parameters. This is validated by calling
    // `own_requires_monomorphization` on both the impl and method.
    const args = trait_ref_.args.extend_to(tcx, method.def_id, only_region_params);
    const instance = Instance.expect_resolve(tcx, typing_env, method.def_id, args, DUMMY_SP);

    const mono_item = create_fn_mono_item(tcx, instance, DUMMY_SP);
    if (MonoItem.is_instantiable(mono_item.node, tcx) && tcx.should_codegen_locally(instance)) {
      output.push(mono_item);
    }
  }
}

//=-----------------------------------------------------------------------------
// Top-level entry point, tying it all together
//=-----------------------------------------------------------------------------

// #[instrument(skip(tcx, strategy), level = "debug")]
// rustc: compiler/rustc_monomorphize/src/collector.rs:1916 collect_crate_mono_items
export function collect_crate_mono_items(tcx: TyCtxt, strategy: MonoItemCollectionStrategy): [MonoItem[], UsageMap] {
  // let _prof_timer = tcx.prof.generic_activity("monomorphization_collector");

  const roots = tcx.sess.time("monomorphization_collector_root_collections", () => collect_roots(tcx, strategy));

  // debug!("building mono item graph, beginning at roots");

  const state: SharedState = {
    visited: new KeyedSet<MonoItem>(intern_key),
    mentioned: new KeyedSet<MonoItem>(intern_key),
    usage_map: UsageMap.new(),
  };
  const recursion_limit = tcx.recursion_limit();

  tcx.sess.time("monomorphization_collector_graph_walk", () => {
    par_for_each_in(roots, (root) => {
      collect_items_root(tcx, dummy_spanned(root), state, recursion_limit);
    });
  });

  // The set of MonoItems was created in an inherently indeterministic order because
  // of parallelism. We sort it here to ensure that the output is deterministic.
  const mono_items = tcx.with_stable_hashing_context((hcx) => {
    // `state.visited.into_inner().into_sorted(&mut hcx, true)`: `sort_by_cached_key` on `to_stable_hash_key`. The keys
    // are 128-bit fingerprints of distinct items; bigint order is `Fingerprint`'s derived `Ord`.
    const keyed = [...state.visited].map((item): [Fingerprint, MonoItem] => [
      MonoItem.to_stable_hash_key(item, hcx),
      item,
    ]);
    keyed.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return keyed.map(([_, item]) => item);
  });

  if (tcx.sess.opts.unstable_opts.offload.some((o) => o.$ === "Device" && o._0 === "")) {
    unported("rustc_monomorphize::offload::check_offload_kernels_instantiated");
  }

  return [mono_items, state.usage_map];
}

// rustc: compiler/rustc_monomorphize/src/collector.rs:1961 provide
export function provide(providers: Providers): void {
  providers.hooks.should_codegen_locally = should_codegen_locally as Providers["hooks"]["should_codegen_locally"];
  providers.queries.items_of_instance = items_of_instance as Providers["queries"]["items_of_instance"];
}
