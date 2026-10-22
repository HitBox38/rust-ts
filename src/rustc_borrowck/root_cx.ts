// Port of compiler/rustc_borrowck/src/root_cx.rs (lane borrowck-contract: the whole file, part of the `mir_borrowck`
// hub, plan-m4 wave 23). Conventions: lib.ts's header (and docs/handoff/borrowck-contract.md).
//
// PORT: `tainted_by_errors: &'diag Cell<Option<ErrorGuaranteed>>` is the generated field `tainted_by_errors`
// (the `Cell`'s value): only the root context reads and writes it (`mir_borrowck` hands in a fresh `None` and reads
// it back through `finalize`). `dcx()`'s `into_taintable(&self.tainted_by_errors)` gets a `MutRef` view of the field.
// PORT: `mem::take(&mut map)` of an `FxIndexMap` / `Vec` field is "read the field, store a fresh empty one".
import type { FieldIdx } from "../rustc_abi/layout.ts";
import type { DiagCtxtHandle } from "../rustc_errors/lib.ts";
import { ConstraintCategory } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { DefinitionSiteHiddenType } from "../rustc_middle/ty/mod.ts";
import type { GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../rustc_span/lib.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { assert, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { KeyedMap } from "../rust_ts/keyed.ts";
import type { BorrowckConsumer } from "./consumers.gen.ts";
import { BorrowckDiagnosticsBuffer } from "./diagnostics/mod.gen.ts";
import type { MoveOutIndex } from "../rustc_mir_dataflow/move_paths/mod.ts";
import type { ClosureRegionRequirements, CollectRegionConstraintsResult, PropagatedBorrowCheckResults } from "./lib.gen.ts";
import { compute_closure_requirements_modulo_opaques } from "./nll.ts";
import {
  apply_definition_site_hidden_types,
  clone_and_resolve_opaque_types,
  compute_definition_site_hidden_types,
  detect_opaque_types_added_while_handling_opaque_types,
  handle_unconstrained_hidden_type_errors,
} from "./region_infer/opaque_types/mod.ts";
import { BorrowCheckRootCtxt } from "./root_cx.gen.ts";
import { ConstraintConversion } from "./type_check/constraint_conversion.gen.ts";
import "./type_check/constraint_conversion.ts";
import type { Locations } from "./type_check/mod.gen.ts";

export * from "./root_cx.gen.ts";

declare module "./root_cx.gen.ts" {
  interface BorrowCheckRootCtxt {
    // root_cx.rs:70
    root_def_id_(): LocalDefId;
    // root_cx.rs:74
    set_tainted_by_errors(guar: ErrorGuaranteed): void;
    // root_cx.rs:78
    dcx(): DiagCtxtHandle;
    // root_cx.rs:82
    used_mut_upvars(nested_body_def_id: LocalDefId): FieldIdx[];
    // root_cx.rs:89
    finalize(): Result<Map<LocalDefId, DefinitionSiteHiddenType>, ErrorGuaranteed>;
    // root_cx.rs:100
    handle_opaque_type_uses(): void;
    // root_cx.rs:168
    apply_closure_requirements_modulo_opaques(diags_buffer: BorrowckDiagnosticsBuffer): void;
    // root_cx.rs:269
    do_mir_borrowck(): void;
  }
  namespace BorrowCheckRootCtxt {
    // root_cx.rs:52
    function new_(tcx: TyCtxt, root_def_id: LocalDefId, consumer: BorrowckConsumer | undefined, tainted_by_errors: ErrorGuaranteed | undefined): BorrowCheckRootCtxt;
    export { new_ as new };
    // root_cx.rs:235
    export function compute_closure_requirements_modulo_opaques(input: CollectRegionConstraintsResult): ClosureRegionRequirements | undefined;
    // root_cx.rs:247
    export function apply_closure_requirements(
      input: CollectRegionConstraintsResult,
      closure_requirements: ClosureRegionRequirements | undefined,
      closure_def_id: LocalDefId,
      args: GenericArgs,
      locations: Locations,
    ): void;
  }
}
type BorrowCheckRootCtxt_statics = {
  new: typeof BorrowCheckRootCtxt.new;
  compute_closure_requirements_modulo_opaques: typeof BorrowCheckRootCtxt.compute_closure_requirements_modulo_opaques;
  apply_closure_requirements: typeof BorrowCheckRootCtxt.apply_closure_requirements;
};
const statics = BorrowCheckRootCtxt as unknown as BorrowCheckRootCtxt_statics;

// PORT: `tainted_by_errors: &'diag Cell<Option<ErrorGuaranteed>>` is the initial value of the field (see header).
// rustc: compiler/rustc_borrowck/src/root_cx.rs:52 new
statics.new = function (
  tcx: TyCtxt,
  root_def_id: LocalDefId,
  consumer: BorrowckConsumer | undefined,
  tainted_by_errors: ErrorGuaranteed | undefined,
): BorrowCheckRootCtxt {
  return new BorrowCheckRootCtxt(
    tcx,
    root_def_id,
    new Map<LocalDefId, DefinitionSiteHiddenType>(),
    [],
    new Map<LocalDefId, CollectRegionConstraintsResult>(),
    new Map<LocalDefId, PropagatedBorrowCheckResults>(),
    tainted_by_errors,
    consumer,
  );
};

// rustc: compiler/rustc_borrowck/src/root_cx.rs:70 root_def_id
BorrowCheckRootCtxt.prototype.root_def_id_ = function (this: BorrowCheckRootCtxt): LocalDefId {
  return this.root_def_id;
};

// rustc: compiler/rustc_borrowck/src/root_cx.rs:74 set_tainted_by_errors
BorrowCheckRootCtxt.prototype.set_tainted_by_errors = function (this: BorrowCheckRootCtxt, guar: ErrorGuaranteed): void {
  this.tainted_by_errors = guar;
};

// rustc: compiler/rustc_borrowck/src/root_cx.rs:78 dcx
BorrowCheckRootCtxt.prototype.dcx = function (this: BorrowCheckRootCtxt): DiagCtxtHandle {
  const self = this;
  const tainted: MutRef<ErrorGuaranteed | undefined> = {
    get value() {
      return self.tainted_by_errors;
    },
    set value(v: ErrorGuaranteed | undefined) {
      self.tainted_by_errors = v;
    },
  };
  return this.tcx.dcx().into_taintable(tainted);
};

// rustc: compiler/rustc_borrowck/src/root_cx.rs:82 used_mut_upvars
BorrowCheckRootCtxt.prototype.used_mut_upvars = function (this: BorrowCheckRootCtxt, nested_body_def_id: LocalDefId): FieldIdx[] {
  return unwrap(this.propagated_borrowck_results.get(nested_body_def_id)).used_mut_upvars;
};

// rustc: compiler/rustc_borrowck/src/root_cx.rs:89 finalize
BorrowCheckRootCtxt.prototype.finalize = function (this: BorrowCheckRootCtxt): Result<Map<LocalDefId, DefinitionSiteHiddenType>, ErrorGuaranteed> {
  const guar = this.tainted_by_errors;
  if (guar !== undefined) {
    return Err(guar);
  } else {
    return Ok(this.hidden_types);
  }
};

// rustc: compiler/rustc_borrowck/src/root_cx.rs:100 handle_opaque_type_uses
BorrowCheckRootCtxt.prototype.handle_opaque_type_uses = function (this: BorrowCheckRootCtxt): void {
  const per_body_info: [ReturnType<typeof clone_and_resolve_opaque_types>[0], ReturnType<typeof clone_and_resolve_opaque_types>[1]][] = [];
  for (const [def_id, input] of this.collect_region_constraints_results) {
    const [num_entries, opaque_types] = clone_and_resolve_opaque_types(input.infcx, input.universal_region_relations, input.constraints);
    input.deferred_opaque_type_errors = compute_definition_site_hidden_types(
      def_id,
      input.infcx,
      input.universal_region_relations,
      input.constraints,
      input.location_map,
      this.hidden_types,
      this.unconstrained_hidden_type_errors,
      opaque_types,
    );
    per_body_info.push([num_entries, opaque_types]);
  }

  handle_unconstrained_hidden_type_errors(this.tcx, this.hidden_types, this.unconstrained_hidden_type_errors, this.collect_region_constraints_results);

  // `values_mut().zip(per_body_info)`
  let i = 0;
  for (const input of this.collect_region_constraints_results.values()) {
    if (i >= per_body_info.length) break;
    const [opaque_types_storage_num_entries, opaque_types] = per_body_info[i++]!;
    if (input.deferred_opaque_type_errors.length === 0) {
      input.deferred_opaque_type_errors = apply_definition_site_hidden_types(
        input.infcx,
        input.body_owned,
        input.universal_region_relations.universal_regions,
        input.region_bound_pairs,
        input.known_type_outlives_obligations,
        input.constraints,
        this.hidden_types,
        opaque_types,
      );
    }

    detect_opaque_types_added_while_handling_opaque_types(input.infcx.infcx, opaque_types_storage_num_entries);
  }
};

/// Computing defining uses of opaques may depend on the propagated region
/// requirements of nested bodies, while applying defining uses may introduce
/// additional region requirements we need to propagate.
///
/// This results in cyclic dependency. To compute the defining uses in parent
/// bodies, we need the closure requirements of its nested bodies, but to check
/// non-defining uses in nested bodies, we may rely on the defining uses in the
/// parent.
///
/// We handle this issue by applying closure requirements twice. Once using the
/// region constraints from before we've handled opaque types in the nested body
/// - which is used by the parent to handle its defining uses - and once after.
///
/// As a performance optimization, we also eagerly finish borrowck for bodies
/// which don't depend on opaque types. In this case they get removed from
/// `collect_region_constraints_results` and the final result gets put into
/// `propagated_borrowck_results`.
// rustc: compiler/rustc_borrowck/src/root_cx.rs:168 apply_closure_requirements_modulo_opaques
BorrowCheckRootCtxt.prototype.apply_closure_requirements_modulo_opaques = function (this: BorrowCheckRootCtxt, diags_buffer: BorrowckDiagnosticsBuffer): void {
  const closure_requirements_modulo_opaques = new Map<LocalDefId, ClosureRegionRequirements | undefined>();
  // We need to `mem::take` both `self.collect_region_constraints_results` and
  // `input.deferred_closure_requirements` as we otherwise can't iterate over
  // them while mutably using the containing struct.
  const collect_region_constraints_results = this.collect_region_constraints_results;
  this.collect_region_constraints_results = new Map();
  // We iterate over all bodies here, visiting nested bodies before their parent.
  for (const [def_id, input] of collect_region_constraints_results) {
    // A body depends on opaque types if it either has any opaque type uses itself,
    // or it has a nested body which does.
    //
    // If the current body does not depend on any opaque types, we eagerly compute
    // its final result and write it into `self.propagated_borrowck_results`. This
    // avoids having to compute its closure requirements modulo regions, as they
    // are just the same as its final closure requirements.
    let depends_on_opaques = input.infcx.has_opaque_types_in_storage();

    // Iterate over all nested bodies of `input`. If that nested body depends on
    // opaque types, we apply its closure requirements modulo opaques. Otherwise
    // we use the closure requirements from its final borrowck result.
    //
    // In case we've only applied the closure requirements modulo opaques, we have
    // to later apply its closure requirements considering opaques, so we put that
    // nested body back into `deferred_closure_requirements`.
    const deferred = input.deferred_closure_requirements;
    input.deferred_closure_requirements = [];
    for (const [def_id, args, locations] of deferred) {
      let closure_requirements: ClosureRegionRequirements | undefined;
      const result = this.propagated_borrowck_results.get(def_id);
      if (result === undefined) {
        depends_on_opaques = true;
        input.deferred_closure_requirements.push([def_id, args, locations]);
        assert(closure_requirements_modulo_opaques.has(def_id), "IndexMap: key not found");
        closure_requirements = closure_requirements_modulo_opaques.get(def_id);
      } else {
        closure_requirements = result.closure_requirements;
      }

      statics.apply_closure_requirements(input, closure_requirements, def_id, args, locations);
    }

    // In case the current body does depend on opaques and is a nested body,
    // we need to compute its closure requirements modulo opaques so that
    // we're able to use it when visiting its parent later in this function.
    //
    // If the current body does not depend on opaque types, we finish borrowck
    // and write its result into `propagated_borrowck_results`.
    if (depends_on_opaques) {
      if (def_id !== this.root_def_id) {
        const req = statics.compute_closure_requirements_modulo_opaques(input);
        closure_requirements_modulo_opaques.set(def_id, req);
      }
      this.collect_region_constraints_results.set(def_id, input);
    } else {
      assert(input.deferred_closure_requirements.length === 0, "assertion failed: input.deferred_closure_requirements.is_empty()");
      const result = borrowck_check_region_constraints()(this, diags_buffer, input);
      this.propagated_borrowck_results.set(def_id, result);
    }
  }
};

// rustc: compiler/rustc_borrowck/src/root_cx.rs:235 compute_closure_requirements_modulo_opaques
statics.compute_closure_requirements_modulo_opaques = function (input: CollectRegionConstraintsResult): ClosureRegionRequirements | undefined {
  return compute_closure_requirements_modulo_opaques(input.infcx, input.body_owned, input.location_map, input.universal_region_relations, input.constraints);
};

// rustc: compiler/rustc_borrowck/src/root_cx.rs:247 apply_closure_requirements
statics.apply_closure_requirements = function (
  input: CollectRegionConstraintsResult,
  closure_requirements: ClosureRegionRequirements | undefined,
  closure_def_id: LocalDefId,
  args: GenericArgs,
  locations: Locations,
): void {
  if (closure_requirements !== undefined) {
    ConstraintConversion.new(
      input.infcx,
      input.universal_region_relations.universal_regions,
      input.region_bound_pairs,
      input.known_type_outlives_obligations,
      locations,
      input.body_owned.span, // irrelevant; will be overridden.
      ConstraintCategory.Boring, // same as above.
      input.constraints,
    ).apply_closure_requirements(closure_requirements, closure_def_id, args);
  }
};

// rustc: compiler/rustc_borrowck/src/root_cx.rs:269 do_mir_borrowck
BorrowCheckRootCtxt.prototype.do_mir_borrowck = function (this: BorrowCheckRootCtxt): void {
  // The list of all bodies we need to borrowck. This first looks at
  // nested bodies, and then their parents. This means accessing e.g.
  // `used_mut_upvars` for a closure can assume that we've already
  // checked that closure.
  const all_bodies = [...(this.tcx.nested_bodies_within(this.root_def_id) as readonly LocalDefId[]), this.root_def_id];
  for (const def_id of all_bodies) {
    const result = borrowck_collect_region_constraints()(this, def_id);
    this.collect_region_constraints_results.set(def_id, result);
  }

  // PORT: `BorrowckDiagnosticsBuffer::default()` (derived `Default`): `buffered_move_errors` is a `BTreeMap` keyed by
  // `Vec<MoveOutIndex>` (a `KeyedMap` on the indices; its users iterate it in key order), `buffered_mut_errors` an
  // `FxIndexMap<Span, _>`, `buffered_diags` a `Vec`.
  const diags_buffer = new BorrowckDiagnosticsBuffer(new KeyedMap<MoveOutIndex[], never>((k) => k.join(",")), new Map(), []);

  // We now apply the closure requirements of nested bodies modulo
  // opaques. In case a body does not depend on opaque types, we
  // eagerly check its region constraints and use the final closure
  // requirements.
  //
  // We eagerly finish borrowck for bodies which don't depend on
  // opaques.
  this.apply_closure_requirements_modulo_opaques(diags_buffer);

  // We handle opaque type uses for all bodies together.
  this.handle_opaque_type_uses();

  // Now walk over all bodies which depend on opaque types and finish borrowck.
  //
  // We first apply the final closure requirements from nested bodies which also
  // depend on opaque types and then finish borrow checking the parent. Bodies
  // which don't depend on opaques have already been fully borrowchecked in
  // `apply_closure_requirements_modulo_opaques` as an optimization.
  const collect_region_constraints_results = this.collect_region_constraints_results;
  this.collect_region_constraints_results = new Map();
  for (const [def_id, input] of collect_region_constraints_results) {
    const deferred = input.deferred_closure_requirements;
    input.deferred_closure_requirements = [];
    for (const [def_id, args, locations] of deferred) {
      // We visit nested bodies before their parent, so we're already
      // done with nested bodies at this point.
      const closure_requirements = unwrap(this.propagated_borrowck_results.get(def_id)).closure_requirements;
      statics.apply_closure_requirements(input, closure_requirements, def_id, args, locations);
    }

    const result = borrowck_check_region_constraints()(this, diags_buffer, input);
    this.propagated_borrowck_results.set(def_id, result);
  }
  diags_buffer.emit_errors();
};

// PORT: lib.ts (the crate root, which imports this module) is read lazily: a static import would close the cycle
// lib.ts -> root_cx.ts -> lib.ts and evaluate this module first when it is the entry point.
let lib__m: typeof import("./lib.ts") | undefined;
function lib(): typeof import("./lib.ts") {
  return (lib__m ??= require("./lib.ts") as typeof import("./lib.ts"));
}
function borrowck_collect_region_constraints(): typeof import("./lib.ts").borrowck_collect_region_constraints {
  return lib().borrowck_collect_region_constraints;
}
function borrowck_check_region_constraints(): typeof import("./lib.ts").borrowck_check_region_constraints {
  return lib().borrowck_check_region_constraints;
}
