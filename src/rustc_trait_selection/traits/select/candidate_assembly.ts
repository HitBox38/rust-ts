// Port of compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs (lane old-candidates-confirm, wave 18b).
//
// Contract stub (lane selcx-contract): the candidate assembly methods of `SelectionContext` (candidate_assembly.rs:29
// `impl<'cx, 'tcx> SelectionContext<'cx, 'tcx>`) are `unported` placeholders.
// How to fill a stub (docs/handoff/selcx-contract.md): port each fn in upstream order as
// `SelectionContext.prototype.<name> = function (this: SelectionContext, ..) { .. };` with its
// `// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:<line> <name>` marker directly above, then delete the name
// from the `unported_methods(..)` list below (and the call when the list is empty). The signatures are declared in
// ../../decls.ts (`declare module "./traits/select/mod.gen.ts"`); do not change one (a wrong one goes in your handoff, or a
// local `declare module` marked `// PORT(decls): pending root`).
//
// Init order: top-level code here touches only ./mod.gen.ts and other crates; other rustc_trait_selection modules are
// read inside function bodies only. ../../lib.ts imports this file after ./mod.ts.

//! Candidate assembly.
//!
//! The selection process begins by examining all in-scope impls,
//! caller obligations, and so forth and assembling a list of
//! candidates. See the [rustc dev guide] for more details.
//!
//! [rustc dev guide]:https://rustc-dev-guide.rust-lang.org/traits/resolution.html#candidate-assembly

import { unported_methods } from "../../../rust_ts/stubs.ts";
import { SelectionContext } from "./mod.gen.ts";

unported_methods(SelectionContext.prototype, "rustc_trait_selection::traits::select::candidate_assembly::SelectionContext", [
  "assemble_candidates",
  "assemble_candidates_from_projected_tys",
  "assemble_candidates_from_caller_bounds",
  "assemble_coroutine_candidates",
  "assemble_future_candidates",
  "assemble_iterator_candidates",
  "assemble_fused_iterator_candidates",
  "assemble_async_iterator_candidates",
  "assemble_closure_candidates",
  "assemble_async_closure_candidates",
  "assemble_async_fn_kind_helper_candidates",
  "assemble_fn_pointer_candidates",
  "assemble_candidates_from_impls",
  "reject_fn_ptr_impls",
  "assemble_candidates_from_auto_impls",
  "assemble_candidates_from_object_ty",
  "assemble_candidates_for_unsizing",
  "assemble_candidates_for_transmutability",
  "assemble_candidates_for_trait_alias",
  "assemble_builtin_copy_clone_candidate",
  "assemble_builtin_sized_candidate",
  "assemble_const_destruct_candidates",
  "assemble_candidate_for_tuple",
  "assemble_candidates_for_fn_ptr_trait",
  "assemble_candidates_for_bikeshed_guaranteed_no_drop_trait",
  "assemble_candidates_for_try_as_dyn",
  "assemble_candidates_for_field_trait",
]);
