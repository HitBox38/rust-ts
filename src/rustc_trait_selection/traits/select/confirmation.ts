// Port of compiler/rustc_trait_selection/src/traits/select/confirmation.rs (lane old-candidates-confirm, wave 18b).
//
// Contract stub (lane selcx-contract): the confirmation methods of `SelectionContext` (confirmation.rs:33
// `impl<'cx, 'tcx> SelectionContext<'cx, 'tcx>`) are `unported` placeholders. `fn flatten_answer_tree` (:292) is a local
// function of `confirm_transmutability_candidate`.
// How to fill a stub (docs/handoff/selcx-contract.md): port each fn in upstream order as
// `SelectionContext.prototype.<name> = function (this: SelectionContext, ..) { .. };` with its
// `// rustc: compiler/rustc_trait_selection/src/traits/select/confirmation.rs:<line> <name>` marker directly above, then delete the name
// from the `unported_methods(..)` list below (and the call when the list is empty). The signatures are declared in
// ../../decls.ts (`declare module "./traits/select/mod.gen.ts"`); do not change one (a wrong one goes in your handoff, or a
// local `declare module` marked `// PORT(decls): pending root`).
//
// Init order: top-level code here touches only ./mod.gen.ts and other crates; other rustc_trait_selection modules are
// read inside function bodies only. ../../lib.ts imports this file after ./mod.ts.

//! Confirmation.
//!
//! Confirmation unifies the output type parameters of the trait
//! with the values found in the obligation, possibly yielding a
//! type error. See the [rustc dev guide] for more details.
//!
//! [rustc dev guide]:
//! https://rustc-dev-guide.rust-lang.org/traits/resolution.html#confirmation

import { unported_methods } from "../../../rust_ts/stubs.ts";
import { SelectionContext } from "./mod.gen.ts";

unported_methods(SelectionContext.prototype, "rustc_trait_selection::traits::select::confirmation::SelectionContext", [
  "confirm_candidate",
  "confirm_projection_candidate",
  "confirm_param_candidate",
  "confirm_builtin_candidate",
  "confirm_transmutability_candidate",
  "confirm_auto_impl_candidate",
  "confirm_impl_candidate",
  "vtable_impl",
  "confirm_object_candidate",
  "confirm_fn_pointer_candidate",
  "confirm_trait_alias_candidate",
  "confirm_coroutine_candidate",
  "confirm_future_candidate",
  "confirm_iterator_candidate",
  "confirm_async_iterator_candidate",
  "confirm_closure_candidate",
  "confirm_async_closure_candidate",
  "equate_trait_refs",
  "confirm_trait_upcasting_unsize_candidate",
  "confirm_builtin_unsize_candidate",
  "confirm_bikeshed_guaranteed_no_drop_candidate",
  "confirm_try_as_dyn_candidate",
]);
