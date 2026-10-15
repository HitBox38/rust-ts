// Port of compiler/rustc_hir_typeck/src/fn_ctxt/inspect_obligations.rs (STUB, lane typeck-checks-a): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// fn_ctxt/inspect_obligations.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/inspect_obligations.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./inspect_obligations.gen.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import { FnCtxt } from "../decls.ts";

/** fn_ctxt/inspect_obligations.rs `struct NestedObligationsForSelfTy` (`impl ProofTreeVisitor`; hand type, lane typeck-checks-a). */
export type NestedObligationsForSelfTy = unknown;
/** fn_ctxt/inspect_obligations.rs `struct FindFromFloatForF32RootVids` (`impl ProofTreeVisitor`; hand type, lane typeck-checks-a). */
export type FindFromFloatForF32RootVids = unknown;

unported_methods(FnCtxt.prototype, "rustc_hir_typeck::fn_ctxt::inspect_obligations::FnCtxt", ["obligations_for_self_ty", "predicate_has_self_ty", "type_matches_expected_vid", "obligations_for_self_ty_next", "from_float_for_f32_root_vids", "predicate_from_float_for_f32_root_vid", "from_float_for_f32_root_vids_next"]);
