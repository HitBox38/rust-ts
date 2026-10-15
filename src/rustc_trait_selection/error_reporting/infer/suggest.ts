// Port of compiler/rustc_trait_selection/src/error_reporting/infer/suggest.rs (lane errrep-infer-b; contract stub of lane errctxt-contract).
//
// How to fill this stub (docs/handoff/errctxt-contract.md "How to fill a stub"):
// - Every fn of this file is declared in src/rustc_trait_selection/decls.ts under `// error_reporting/infer/suggest.rs:<line>`:
//   `interface TypeErrCtxt` (methods), `NiceRegionError` (methods / statics), `Fns_<module>` (free fns) or a comment-only
//   declaration (trait impls, helper types: pick the TS form). Do not change a real signature; write a needed change in
//   your handoff (or a local `declare module` marked `// PORT(decls): pending root`).
// - Methods: in upstream order, `TypeErrCtxt.prototype.<name> = function (this: TypeErrCtxt, ..): R { .. };` with
//   `// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/suggest.rs:<line> <name>` directly above, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty). In a split file edit only your lane's list.
// - Free fns: replace `export const f = ((): never => unported(..)) as Fns_..["f"]` by `export function f(..)` with the
//   declared signature and the marker. `self.tcx` / `self.infcx` / InferCtxt methods are read through the Deref forwarders
//   (`this.tcx`, `this.next_ty_var(..)`); a `&TypeErrCtxt` passed as `&InferCtxt` is `this.infcx`.
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other
// crates; other rustc_trait_selection modules are read inside function bodies only.
export * from "./suggest.gen.ts";
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { TypeErrCtxt } from "../../decls.ts";

unported_methods(TypeErrCtxt.prototype, "rustc_trait_selection::error_reporting::infer::suggest::TypeErrCtxt", [
  "suggest_remove_semi_or_return_binding", "suggest_tuple_pattern", "suggest_await_on_expect_found", "suggest_add_async_for_tail_return_expr", "suggest_accessing_field_where_appropriate", "suggest_turning_stmt_into_expr", "consider_removing_semicolon", "suggest_function_pointers_impl", "suggest_function_pointers", "should_suggest_as_ref_kind", "should_suggest_as_ref", "suggest_let_for_letchains", "suggest_for_all_lifetime_closure", "could_remove_semicolon", "consider_returning_binding_diag", "consider_returning_binding",
]);
