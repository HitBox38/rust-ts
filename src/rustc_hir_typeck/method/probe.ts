// Port of compiler/rustc_hir_typeck/src/method/probe.rs (STUB, lane typeck-probe): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// method/probe.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./probe.gen.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import { unported } from "../../std/panic.ts";
import { FnCtxt, register_deref } from "../decls.ts";
import { Pick, ProbeContext } from "./probe.gen.ts";
import type { CanonicalMethodAutoderefStepsGoal, MethodAutoderefStepsResult } from "../../rustc_middle/traits/query.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";

// method/probe.rs:105 `impl Deref for ProbeContext { type Target = FnCtxt }` (`&self.fcx`): forwarders installed by lib.ts (decls.ts `register_deref`).
register_deref(ProbeContext, "fcx", FnCtxt);
unported_methods(FnCtxt.prototype, "rustc_hir_typeck::method::probe::FnCtxt", ["probe_for_return_type_for_diagnostic", "probe_for_name", "probe_for_name_many", "probe_op"]);
unported_methods(Pick.prototype, "rustc_hir_typeck::method::probe::Pick", ["differs_from", "maybe_emit_unstable_name_collision_hint"]);
unported_methods(ProbeContext.prototype, "rustc_hir_typeck::method::probe::ProbeContext", ["deref", "reset", "variance", "push_candidate", "assemble_inherent_candidates", "assemble_probe", "assemble_inherent_candidates_for_incoherent_ty", "assemble_inherent_impl_candidates_for_type", "assemble_inherent_impl_probe", "assemble_inherent_candidates_from_object", "assemble_inherent_candidates_from_param", "assemble_candidates_for_bounds", "assemble_extension_candidates_for_traits_in_scope", "assemble_extension_candidates_for_all_traits", "matches_return_type", "assemble_extension_candidates_for_trait", "candidate_method_names", "pick", "pick_core", "pick_all_method", "check_for_shadowed_autorefd_method", "pick_by_value_method", "pick_autorefd_method", "pick_reborrow_pin_method", "pick_const_ptr_method", "pick_method", "consider_candidates", "select_trait_candidate_for_diagnostics", "candidate_source", "candidate_source_from_pick", "consider_probe", "should_reject_candidate_due_to_opaque_treated_as_rigid", "collapse_candidates_to_trait_pick", "collapse_candidates_to_subtrait_pick", "probe_for_similar_candidate", "has_applicable_self", "record_static_candidate", "xform_self_ty", "xform_method_sig", "is_relevant_kind_for_mode", "matches_by_doc_alias", "impl_or_trait_item"]);
unported_methods(ProbeContext, "rustc_hir_typeck::method::probe::ProbeContext", ["new"]);

// method/probe.rs:635 (stub; final signature: decls.ts `Fns_method_probe`)
export function method_autoderef_steps(tcx: TyCtxt, goal: CanonicalMethodAutoderefStepsGoal): MethodAutoderefStepsResult {
  return unported("rustc_hir_typeck::method::probe::method_autoderef_steps");
}
