// The prefix and the dump of the `tydump-*` suites (src/rust_ts/tydump.ts), and the prefix of the `thirdump-*` suites
// (src/rust_ts/thirdump.ts): tools/probes/tydump/prefix.rs (`run_required_analyses_prefix`, its inlined `check_crate`,
// `check_crate_typecks`) and tools/probes/tydump/main.rs (`should_encode_*`, `defs_with_hir`, `dump`, `table`,
// `dump_typeck`), step by step, in the probe's order. The probe headers document the stop point (D1/D1a), every
// difference from upstream, the sections, their line formats and sort keys. Loaded by tydump.ts / thirdump.ts after
// the driver (load order and the stack re-exec, as src/rust_ts/main.ts).
//
// This is our own code (not a port): the upstream statements the probe runs are called through their ported fns and
// queries; what is not ported stops there as UNPORTED (a query provider: `<query> provider (not ported)`).
import "../rustc_session/options.ts"; // LOAD ORDER: see rustc_session/config.ts
import "../rustc_session/lib.ts";
import "../rustc_middle/lib.ts";
// LOAD ORDER: rustc_hir_analysis is imported through its lib.ts first; collect/dump.ts (crate-private upstream, as
// in the probe) is then imported directly.
import "../rustc_hir_analysis/lib.ts";
import * as collect_dump from "../rustc_hir_analysis/collect/dump.ts";
import { emit_delayed_lints } from "../rustc_interface/passes.ts";
import { creader } from "../rustc_metadata/lib.ts";
import { check_glob_and_list_delegations_target_expr } from "../rustc_passes/delegation.ts";
import { Defaultness, type MaybeOwner, MaybeOwner as MaybeOwnerC } from "../rustc_hir/lib.ts";
import type { OwnerInfo } from "../rustc_hir/hir.gen.ts";
import { debug_DefKind, type DefKind } from "../rustc_hir/def.ts";
import { CRATE_OWNER_ID, debug_HirId, debug_OwnerId, HirId, type ItemLocalId } from "../rustc_hir_id/lib.ts";
import { debug_ItemLocalId } from "../rustc_hir_id/lib.gen.ts";
import type { ModuleItems } from "../rustc_middle/hir/mod.ts";
import { TyCtxt_typeck } from "../rustc_middle/query/calls.ts";
import type { AssocItem } from "../rustc_middle/ty/assoc.ts";
import { AssocItem as AssocItemC } from "../rustc_middle/ty/assoc.ts";
import { debug_CapturedPlace } from "../rustc_middle/ty/closure.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { debug_GenericClauses, debug_Generics, type GenericClauses, type Generics } from "../rustc_middle/ty/generics.ts";
import { debug_RawList } from "../rustc_middle/ty/list.ts";
import { debug_DefinitionSiteHiddenType, debug_ImplTraitHeader, type ImplTraitHeader, type ImplTraitInTraitData, type Ty } from "../rustc_middle/ty/mod.ts";
import type { Clause } from "../rustc_middle/ty/predicate.ts";
import { with_no_trimmed_paths } from "../rustc_middle/ty/print/pretty.ts";
import { debug_Adjustment, debug_Clause, debug_GenericArg, debug_PatAdjustment, debug_Predicate, debug_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { debug_UserType, type TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { debug_ObligationCause } from "../rustc_middle/traits/mod.gen.ts";
import { debug_BindingMode } from "../rustc_ast/lib.ts";
import { debug_DefId, debug_LocalDefId, DefIndex, type DefId, LOCAL_CRATE, LocalDefId } from "../rustc_span/def_id.ts";
import { debug_ErrorGuaranteed, debug_Span, type Span } from "../rustc_span/lib.ts";
import { debug_Binder } from "../rustc_type_ir/binder.gen.ts";
import { debug_EarlyBinder } from "../rustc_type_ir/binder.gen.ts";
import type { Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import { debug_Canonical } from "../rustc_type_ir/canonical.gen.ts";
import type { AnonConstKind } from "../rustc_type_ir/const_kind.gen.ts";
import { debug_Variance } from "../rustc_type_ir/lib.ts";
import { debug_FnSig, type FnSig } from "../rustc_type_ir/ty_kind.ts";
import { type Debug, debug_option, debug_tuple, debug_vec, type Fmt, PLAIN } from "../std/fmt.ts";
import { unported, unreachable } from "../std/panic.ts";
import { bug } from "../rustc_span/macros.ts";
import type { Result } from "../std/result.ts";

// ---------------------------------------------------------------------------------------------------------------
// tools/probes/tydump/prefix.rs
// ---------------------------------------------------------------------------------------------------------------

/**
 * prefix.rs `run_required_analyses_prefix`: rustc_interface/src/passes.rs:1100 `run_required_analyses`, up to and
 * including `definitions.freeze()`, with `rustc_hir_analysis::check_crate` replaced by [`check_crate`]. Returns the
 * number of definitions right after `hir_crate_items` (the probe's observation).
 */
export function run_required_analyses_prefix(tcx: TyCtxt): number {
  if (tcx.sess.opts.unstable_opts.input_stats) {
    unported("rustc_passes::input_stats::print_hir_stats");
  }
  // (passes.rs:1104-1107 `rustc_passes::hir_id_validator::check_crate(tcx)`: debug assertions
  // only, see the header.)

  // Prefetch this to prevent multiple threads from blocking on it later.
  // This is needed since the `hir_id_validator::check_crate` call above is not guaranteed
  // to use `hir_crate_items`.
  tcx.ensure_done().hir_crate_items(null);
  // (Probe observation, not upstream.)
  const num_definitions_after_lowering = tcx.definitions_untracked().num_definitions();

  tcx.untracked().definitions.commit_end_of_determinism();

  check_glob_and_list_delegations_target_expr(tcx);

  const sess = tcx.sess;
  sess.time("misc_checking_1", () => {
    // `par_fns(&mut [..])`: sequential, in order, with the default `-Zthreads=1`.
    {
      sess.time("looking_for_entry_point", () => tcx.ensure_ok().entry_fn(null));
      sess.time("check_externally_implementable_items", () => {
        tcx.ensure_ok().check_externally_implementable_items(null);
      });

      sess.time("looking_for_derive_registrar", () => {
        tcx.ensure_ok().proc_macro_decls_static(null);
      });

      creader.CStore.from_tcx(tcx).report_unused_deps(tcx);
    }
    {
      tcx.ensure_ok().exportable_items(LOCAL_CRATE);
      tcx.ensure_ok().stable_order_of_exportable_impls(LOCAL_CRATE);
      tcx.par_hir_for_each_module((module) => {
        tcx.ensure_ok().check_mod_attrs(module);
        tcx.ensure_ok().check_mod_unstable_api_usage(module);
      });
    }
    {
      // We force these queries to run,
      // since they might not otherwise get called.
      // This marks the corresponding crate-level attributes
      // as used, and ensures that their values are valid.
      tcx.ensure_ok().limits(null);
    }
  });

  sess.time("emit_ast_lowering_delayed_lints", () => {
    emit_delayed_lints(tcx);
  });

  check_crate(tcx);
  // Freeze definitions as we don't add new ones at this point.
  // We need to wait until now since we synthesize a by-move body
  // for all coroutine-closures.
  //
  // This improves performance by allowing lock-free access to them.
  // PORT: `FreezeLock::freeze` is a no-op (PORTING §5: the lock is its inner value).
  return num_definitions_after_lowering;
}

/** prefix.rs `check_crate`: rustc_hir_analysis/src/lib.rs:145 `check_crate` without the const-eval arm (D1a). */
export function check_crate(tcx: TyCtxt): void {
  const _prof_timer = tcx.sess.timer("type_check_crate");

  tcx.sess.time("coherence_checking", () => {
    // When discarding query call results, use an explicit type to indicate
    // what we are intending to discard, to help future type-based refactoring.
    tcx.ensure_result().check_type_wf(null);

    for (const trait_def_id of tcx.all_local_trait_impls(null).keys()) {
      tcx.ensure_result().coherent_trait(trait_def_id);
    }
    // these queries are executed for side-effects (error reporting):
    tcx.ensure_result().crate_inherent_impls_validity_check(null);
    tcx.ensure_result().crate_inherent_impls_overlap_check(null);
  });

  tcx.par_hir_body_owners((item_def_id) => {
    const def_kind = tcx.def_kind(item_def_id);
    // (lib.rs:166-184: the `DefKind::Static` / `DefKind::Const` const-eval arm is left out, D1a.)
    // Skip `AnonConst`s and type system `InlineConst`s because we feed their `type_of` in
    // `feed_anon_const_type`.
    // Also skip items for which typeck forwards to parent typeck.
    if (
      !(
        (def_kind.$ === "AnonConst" && (tcx.anon_const_kind(LocalDefId.to_def_id(item_def_id)) as AnonConstKind) !== "NonTypeSystemInline") ||
        tcx.is_typeck_child(LocalDefId.to_def_id(item_def_id))
      )
    ) {
      tcx.ensure_ok().typeck(item_def_id);
    }
  });

  // This has to be a second pass over the body owners, after every body has been
  // type-checked above. `needs_coroutine_by_move_body_def_id` asks for `type_of`, and for a
  // body owner nested inside a const argument's anon const that goes through `typeck` of the
  // anon const, which needs the anon const's own type. That type is never computed, only fed
  // while the enclosing body is type-checked. Doing this in the pass above lets the parallel
  // front end reach the nested body owner first, computing (and caching) an error type for
  // the anon const that then conflicts with the type fed later on.
  //
  // This must not be parallelized since `coroutine_by_move_body_def_id` creates new `DefId`-s
  // inside, which must be done in deterministic order to have reproducible binaries.
  for (const item_def_id of tcx.hir_body_owners()) {
    // Ensure we generate the new `DefId` before finishing `check_crate`.
    // Afterwards we freeze the list of `DefId`s.
    if (tcx.needs_coroutine_by_move_body_def_id(LocalDefId.to_def_id(item_def_id))) {
      tcx.ensure_done().coroutine_by_move_body_def_id(item_def_id);
    }
  }

  if (tcx.features().rustc_attrs()) {
    tcx.sess.time("dumping_rustc_attr_data", () => {
      // tidy-alphabetical-start
      collect_dump.clauses_and_item_bounds(tcx);
      collect_dump.def_parents(tcx);
      collect_dump.generics(tcx);
      collect_dump.object_lifetime_defaults(tcx);
      collect_dump.opaque_hidden_types(tcx);
      collect_dump.vtables(tcx);
      outlives_dump_inferred_outlives(tcx);
      variance_dump_variances(tcx);
      // tidy-alphabetical-end
    });
  }

  tcx.ensure_ok().check_unused_traits(null);
}

/** prefix.rs `check_crate_typecks`: the condition around `check_crate`'s `typeck`, unchanged. */
export function check_crate_typecks(tcx: TyCtxt, item_def_id: LocalDefId): boolean {
  const def_kind = tcx.def_kind(item_def_id);
  return !(
    (def_kind.$ === "AnonConst" && (tcx.anon_const_kind(LocalDefId.to_def_id(item_def_id)) as AnonConstKind) !== "NonTypeSystemInline") ||
    tcx.is_typeck_child(LocalDefId.to_def_id(item_def_id))
  );
}

/** prefix.rs `outlives_dump::inferred_outlives` (rustc_hir_analysis/src/outlives/dump.rs:5, not ported). */
function outlives_dump_inferred_outlives(_tcx: TyCtxt): void {
  unported("rustc_hir_analysis::outlives::dump::inferred_outlives (wave 17: variance-outlives-implwf)");
}

/** prefix.rs `variance_dump::variances` (rustc_hir_analysis/src/variance/dump.rs:26, not ported). */
function variance_dump_variances(_tcx: TyCtxt): void {
  unported("rustc_hir_analysis::variance::dump::variances (wave 17: variance-outlives-implwf)");
}

// ---------------------------------------------------------------------------------------------------------------
// tools/probes/tydump/main.rs
// ---------------------------------------------------------------------------------------------------------------

/** `fn di`: the `DefIndex` of a LocalDefId. */
function di(id: LocalDefId): number {
  return id as unknown as number;
}

/** `fn dbg`: `{:?}` under `with_no_trimmed_paths!`. */
function dbg<T>(v: T, d: Debug<T>): string {
  return with_no_trimmed_paths(() => d(v, PLAIN));
}

/** `fn fact`: one fact line, `  <name> <value:?>`. */
function fact<T>(out: string[], name: string, v: T, d: Debug<T>): void {
  const s = dbg(v, d);
  out.push(`  ${name} ${s}\n`);
}

// rustc_metadata/src/rmeta/encoder.rs:1213 should_encode_variances, as the probe copies it.
function should_encode_variances(tcx: TyCtxt, def_id: DefId, def_kind: DefKind): boolean {
  switch (def_kind.$) {
    case "Struct":
    case "Union":
    case "Enum":
    case "OpaqueTy":
    case "Fn":
    case "Ctor":
    case "AssocFn":
      return true;
    case "AssocTy": {
      // Only encode variances for RPITITs (for traits)
      const info = tcx.opt_rpitit_info(def_id) as ImplTraitInTraitData | undefined;
      return info !== undefined && info.$ === "Trait";
    }
    case "Mod":
    case "Variant":
    case "Field":
    case "AssocConst":
    case "TyParam":
    case "ConstParam":
    case "Static":
    case "Const":
    case "ForeignMod":
    case "TyAlias":
    case "Impl":
    case "Trait":
    case "TraitAlias":
    case "Macro":
    case "ForeignTy":
    case "Use":
    case "LifetimeParam":
    case "AnonConst":
    case "GlobalAsm":
    case "Closure":
    case "ExternCrate":
    case "SyntheticCoroutineBody":
    case "TestBinderConstraints":
      return false;
  }
}

// rustc_metadata/src/rmeta/encoder.rs:1252 should_encode_generics, as the probe copies it.
function should_encode_generics(def_kind: DefKind): boolean {
  switch (def_kind.$) {
    case "Struct":
    case "Union":
    case "Enum":
    case "Variant":
    case "Trait":
    case "TyAlias":
    case "ForeignTy":
    case "TraitAlias":
    case "AssocTy":
    case "Fn":
    case "Const":
    case "Static":
    case "Ctor":
    case "AssocFn":
    case "AssocConst":
    case "AnonConst":
    case "OpaqueTy":
    case "Impl":
    case "Field":
    case "TyParam":
    case "Closure":
    case "SyntheticCoroutineBody":
      return true;
    case "Mod":
    case "ForeignMod":
    case "ConstParam":
    case "Macro":
    case "Use":
    case "LifetimeParam":
    case "GlobalAsm":
    case "ExternCrate":
    case "TestBinderConstraints":
      return false;
  }
}

// rustc_metadata/src/rmeta/encoder.rs:1288 should_encode_type, as the probe copies it.
function should_encode_type(tcx: TyCtxt, def_id: LocalDefId, def_kind: DefKind): boolean {
  switch (def_kind.$) {
    case "Struct":
    case "Union":
    case "Enum":
    case "Variant":
    case "Ctor":
    case "Field":
    case "Fn":
    case "Const":
    case "TyAlias":
    case "ForeignTy":
    case "Impl":
    case "AssocFn":
    case "AssocConst":
    case "Closure":
    case "ConstParam":
    case "AnonConst":
    case "SyntheticCoroutineBody":
      return true;
    // `DefKind::Static { nested: false, .. } => true`, `DefKind::Static { nested: true, .. } => false`
    case "Static":
      return !def_kind.nested;

    case "OpaqueTy": {
      const origin = tcx.local_opaque_ty_origin(def_id);
      if (origin.$ === "FnReturn" || origin.$ === "AsyncFn") {
        const node = tcx.hir_node_by_def_id(origin.parent);
        if (node.$ === "TraitItem" && node._0.expect_fn()[1].$ === "Required") {
          return false;
        }
      }
      return true;
    }

    case "AssocTy": {
      const assoc_item = tcx.associated_item(LocalDefId.to_def_id(def_id)) as AssocItem;
      switch (assoc_item.container.$) {
        case "InherentImpl":
        case "TraitImpl":
          return true;
        case "Trait":
          return Defaultness.has_value(AssocItemC.defaultness(assoc_item, tcx));
      }
      return unreachable();
    }
    case "TyParam": {
      const node = tcx.hir_node_by_def_id(def_id);
      if (node.$ !== "GenericParam") return bug();
      const param = node._0;
      if (param.kind.$ !== "Type") return bug();
      return param.kind.default !== undefined;
    }

    case "Trait":
    case "TraitAlias":
    case "Mod":
    case "ForeignMod":
    case "Macro":
    case "Use":
    case "LifetimeParam":
    case "GlobalAsm":
    case "ExternCrate":
    case "TestBinderConstraints":
      return false;
  }
}

// rustc_metadata/src/rmeta/encoder.rs:1349 should_encode_fn_sig, as the probe copies it.
function should_encode_fn_sig(def_kind: DefKind): boolean {
  switch (def_kind.$) {
    case "Fn":
    case "AssocFn":
      return true;
    case "Ctor":
      // `DefKind::Ctor(_, CtorKind::Fn) => true`, `DefKind::Ctor(..) => false`
      return def_kind._1 === "Fn";
    default:
      return false;
  }
}

/**
 * main.rs `defs_with_hir`: every HIR owner and every key of its `lower_to_hir(..).children` (what `lower_to_hir`'s
 * `fallback_to_ancestor` looks a non-owner DefId up in).
 */
function defs_with_hir(tcx: TyCtxt): Set<LocalDefId> {
  const set = new Set<LocalDefId>();
  const owners = [CRATE_OWNER_ID, ...(tcx.hir_crate_items(null) as ModuleItems).owners()];
  for (const owner of owners) {
    set.add(owner.def_id);
    const info: OwnerInfo | undefined = MaybeOwnerC.as_owner(tcx.lower_to_hir(owner.def_id) as MaybeOwner);
    if (info !== undefined) {
      for (const id of info.children.keys()) set.add(id);
    }
  }
  return set;
}

const debug_explicit_item_bounds: Debug<EarlyBinder<readonly [Clause, Span][]>> = (v, f) =>
  debug_EarlyBinder(v, f, (xs, f) => debug_vec(xs, f, (x, f) => debug_tuple(f, "", [debug_Clause(x[0], f), debug_Span(x[1], f)])));
const debug_poly_fn_sig_binder: Debug<EarlyBinder<Binder<FnSig>>> = (v, f) => debug_EarlyBinder(v, f, (b, f) => debug_Binder(b, f, debug_FnSig));

/** main.rs `dump`. */
export function dump(tcx: TyCtxt, num_definitions_after_lowering: number): string {
  const out: string[] = [];
  const num_definitions = tcx.definitions_untracked().num_definitions();
  const typecked = new Set(tcx.hir_body_owners().filter((id) => check_crate_typecks(tcx, id)));
  const with_hir = defs_with_hir(tcx);

  out.push(`== items (${num_definitions})\n`);
  for (let i = 0; i < num_definitions; i++) {
    const local_id = DefIndex.from_usize(i) as unknown as LocalDefId;
    const def_id = LocalDefId.to_def_id(local_id);
    const def_kind = tcx.def_kind(local_id);
    out.push(`${dbg(local_id, debug_LocalDefId)} ${dbg(def_kind, debug_DefKind)}\n`);

    // A DefId without HIR that lowering did not create either (e.g. one defined inside an
    // attribute's expression, which is never lowered) has none of the facts: its queries would
    // ICE in `lower_to_hir`.
    if (!(with_hir.has(local_id) || i >= num_definitions_after_lowering)) {
      continue;
    }

    // As `encode_def_ids`: these DefIds are never used.
    if (def_kind.$ === "AnonConst") {
      const node = tcx.hir_node_by_def_id(local_id);
      if (node.$ === "ConstArg" || (node.$ === "Infer" && node._0.kind === "Const")) {
        continue;
      }
    }

    if (should_encode_generics(def_kind)) {
      fact(out, "generics_of", tcx.generics_of(def_id) as Generics, debug_Generics);
      fact(out, "clauses_of", tcx.clauses_of(def_id) as GenericClauses, debug_GenericClauses);
    }
    if (should_encode_type(tcx, local_id, def_kind)) {
      fact(out, "type_of", tcx.type_of(def_id) as EarlyBinder<Ty>, (v, f) => debug_EarlyBinder(v, f, debug_Ty));
    }
    if (should_encode_fn_sig(def_kind)) {
      fact(out, "fn_sig", tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>, debug_poly_fn_sig_binder);
    }
    if (should_encode_variances(tcx, def_id, def_kind)) {
      fact(out, "variances_of", tcx.variances_of(def_id) as readonly Parameters<typeof debug_Variance>[0][], (v, f) => debug_vec(v, f, debug_Variance));
    }
    const trait_assoc_ty = def_kind.$ === "AssocTy" && (tcx.associated_item(def_id) as AssocItem).container.$ === "Trait";
    if (def_kind.$ === "OpaqueTy" || trait_assoc_ty) {
      fact(out, "explicit_item_bounds", tcx.explicit_item_bounds(def_id) as EarlyBinder<readonly [Clause, Span][]>, debug_explicit_item_bounds);
    }
    if (def_kind.$ === "Impl" && def_kind.of_trait) {
      fact(out, "impl_trait_header", tcx.impl_trait_header(local_id) as ImplTraitHeader, debug_ImplTraitHeader);
    }
    if (typecked.has(local_id)) {
      out.push("  typeck\n");
      dump_typeck(out, tcx, TyCtxt_typeck(tcx, local_id) as TypeckResults);
    }
  }
  return out.join("");
}

/** main.rs `table`: `    <name> <a> <b>` lines of an `items_in_stable_order` table. */
function table<V>(out: string[], name: string, items: [ItemLocalId, V][], d: Debug<V>): void {
  for (const [id, v] of items) {
    const a = dbg(id, debug_ItemLocalId);
    const b = dbg(v, d);
    out.push(`    ${name} ${a} ${b}\n`);
  }
}

/** `{:?}` of a `Result<T, E>` (derived: `Ok(..)` / `Err(..)`). */
function debug_result<T, E>(dt: Debug<T>, de: Debug<E>): Debug<Result<T, E>> {
  return (v, f) => (v.$ === "Ok" ? debug_tuple(f, "Ok", [dt(v._0, f)]) : debug_tuple(f, "Err", [de(v._0, f)]));
}

/** `{:?}` of a tuple. */
function debug_tuple_of<T extends readonly unknown[]>(...ds: { [K in keyof T]: Debug<T[K]> }): Debug<T> {
  return (v, f: Fmt) => debug_tuple(f, "", ds.map((d, i) => (d as Debug<unknown>)(v[i], f)));
}

/** `newtype_index!` types without `#[debug_format]` (`FieldIdx`, `VariantIdx`): `{}` of the index. */
const debug_idx: Debug<number> = (v) => String(v);

/** A value whose `Debug` impl is not ported yet: the dump stops here when such a value is present. */
function unported_debug(what: string): Debug<unknown> {
  return () => unported(`Debug of ${what} (tydump typeck section)`);
}

/** main.rs `dump_typeck`. */
function dump_typeck(out: string[], tcx: TyCtxt, r: TypeckResults): void {
  const owner = r.hir_owner;
  const n_nodes = tcx.hir_owner_nodes(owner).nodes.length;
  const hir_id = (i: number): HirId => new HirId(owner, i as ItemLocalId);

  out.push(`    hir_owner ${dbg(owner, debug_OwnerId)}\n`);
  out.push(`    tainted_by_errors ${dbg(r.tainted_by_errors, (v, f) => debug_option(v, f, debug_ErrorGuaranteed))}\n`);
  table(out, "type_dependent_defs", r.type_dependent_defs().items_in_stable_order(), debug_result(debug_tuple_of<[DefKind, DefId]>(debug_DefKind, debug_DefId), debug_ErrorGuaranteed));
  table(out, "field_indices", r.field_indices().items_in_stable_order(), debug_idx);
  table(out, "node_types", r.node_types().items_in_stable_order(), debug_Ty);
  // No listing accessor (only `node_args_mut`): every ItemLocalId of the owner, in order (7).
  for (let i = 0; i < n_nodes; i++) {
    const args = r.node_args_opt(hir_id(i));
    if (args !== undefined) {
      out.push(`    node_args ${dbg(i as ItemLocalId, debug_ItemLocalId)} ${dbg(args, (v, f) => debug_RawList(v, f, debug_GenericArg))}\n`);
    }
  }
  table(out, "user_provided_types", r.user_provided_types().items_in_stable_order(), (v, f) => debug_Canonical(v, f, debug_UserType));
  for (const [id, sig] of [...r.user_provided_sigs].sort(([a], [b]) => di(a) - di(b))) {
    out.push(`    user_provided_sigs ${dbg(id, debug_LocalDefId)} ${dbg(sig, (v, f) => debug_Canonical(v, f, (b, f) => debug_Binder(b, f, debug_FnSig)))}\n`);
  }
  table(out, "adjustments", r.adjustments().items_in_stable_order(), (v, f) => debug_vec(v, f, debug_Adjustment));
  table(out, "pat_binding_modes", r.pat_binding_modes().items_in_stable_order(), debug_BindingMode);
  table(out, "rust_2024_migration_desugared_pats", r.rust_2024_migration_desugared_pats().items_in_stable_order(), unported_debug("rustc_middle::ty::typeck_results::Rust2024IncompatiblePatInfo"));
  table(out, "pat_adjustments", r.pat_adjustments().items_in_stable_order(), (v, f) => debug_vec(v, f, debug_PatAdjustment));
  // No listing accessor: every ItemLocalId of the owner, in order (7).
  const skipped = r.skipped_ref_pats();
  for (let i = 0; i < n_nodes; i++) {
    if (skipped.contains(hir_id(i))) {
      out.push(`    skipped_ref_pats ${dbg(i as ItemLocalId, debug_ItemLocalId)}\n`);
    }
  }
  table(out, "closure_kind_origins", r.closure_kind_origins().items_in_stable_order(), unported_debug("(Span, rustc_middle::hir::place::Place)"));
  table(out, "liberated_fn_sigs", r.liberated_fn_sigs().items_in_stable_order(), debug_FnSig);
  table(out, "fru_field_types", r.fru_field_types().items_in_stable_order(), (v, f) => debug_vec(v, f, debug_Ty));
  for (const id of [...r.coercion_casts()].sort((a, b) => a - b)) {
    out.push(`    coercion_casts ${dbg(id, debug_ItemLocalId)}\n`);
  }
  for (const id of [...r.used_trait_imports].sort((a, b) => di(a) - di(b))) {
    out.push(`    used_trait_imports ${dbg(id, debug_LocalDefId)}\n`);
  }
  for (const [id, h] of r.hidden_types) {
    out.push(`    hidden_types ${dbg(id, debug_LocalDefId)} ${dbg(h as unknown as Parameters<typeof debug_DefinitionSiteHiddenType>[0], debug_DefinitionSiteHiddenType)}\n`);
  }
  for (const [id, roots] of [...r.closure_min_captures].sort(([a], [b]) => di(a) - di(b))) {
    for (const [root, places] of roots) {
      out.push(`    closure_min_captures ${dbg(id, debug_LocalDefId)} ${dbg(root, debug_HirId)} ${dbg(places, (v, f) => debug_vec(v, f, debug_CapturedPlace))}\n`);
    }
  }
  for (const [id, reads] of [...r.closure_fake_reads].sort(([a], [b]) => di(a) - di(b))) {
    out.push(`    closure_fake_reads ${dbg(id, debug_LocalDefId)} ${dbg(reads as unknown, unported_debug("[(rustc_middle::hir::place::Place, rustc_middle::mir::FakeReadCause, HirId)]"))}\n`);
  }
  for (const p of r.coroutine_stalled_predicates) {
    out.push(`    coroutine_stalled_predicates ${dbg(p, debug_tuple_of<typeof p>(debug_Predicate, debug_ObligationCause))}\n`);
  }
  for (const t of r.transmutes_to_check) {
    out.push(`    transmutes_to_check ${dbg(t, debug_tuple_of<typeof t>(debug_Ty, debug_Ty, debug_HirId))}\n`);
  }
  table(out, "offset_of_data", r.offset_of_data().items_in_stable_order(), (v, f) => debug_vec(v, f, debug_tuple_of<(typeof v)[number]>(debug_Ty, debug_idx, debug_idx)));
}
