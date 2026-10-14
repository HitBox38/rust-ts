// Contract stub for compiler/rustc_middle/src/ty/util.rs (lane ty-contract; the file belongs to lane ty-util).
//
// The methods this file defines upstream on `Ty`, `TyCtxt` are declared in ty/decls.ts (`// ty/util.rs:<line>`
// lines). Until they are ported, the calls below install `unported(..)` placeholders for them. To fill one:
// assign `<Class>.prototype.<name> = function (this: <Class>, ..) { .. }` (a static: `<Class>.<name> = function ..`)
// with the `// rustc:` marker above it, in upstream order, and delete the name from its list (the call when the list
// is empty). The free fns, types and other impls of the upstream file are not stubbed: port them here.
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes;
// its top-level code may touch only the classes it imports, never another extension module.
import { Ty } from "./mod.ts";
import { TyCtxt } from "./context.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";

unported_methods(Ty.prototype, "rustc_middle::ty::util::Ty", [
  "primitive_size",
  "int_size_and_signed",
  "numeric_min_and_max_as_bits",
  "numeric_max_val",
  "numeric_min_val",
  "is_sized",
  "is_freeze",
  "is_trivially_freeze",
  "is_unsafe_unpin",
  "is_unpin",
  "is_trivially_unpin",
  "is_async_drop",
  "is_trivially_not_async_drop",
  "needs_drop",
  "needs_async_drop",
  "has_significant_drop",
  "is_structural_eq_shallow",
  "peel_refs",
]);
unported_methods(TyCtxt.prototype, "rustc_middle::ty::util::TyCtxt", [
  "type_id_hash",
  "res_generics_def_id",
  "type_is_copy_modulo_regions",
  "type_is_use_cloned_modulo_regions",
  "struct_tail_for_codegen",
  "type_has_metadata",
  "struct_tail_raw",
  "struct_lockstep_tails_for_codegen",
  "struct_lockstep_tails_raw",
  "calculate_dtor",
  "calculate_async_dtor",
  "destructor_constraints",
  "uses_unique_generic_params",
  "is_closure_like",
  "is_typeck_child",
  "is_trait",
  "is_trait_alias",
  "is_constructor",
  "typeck_root_def_id",
  "typeck_root_def_id_local",
  "closure_env_ty",
  "is_static",
  "static_mutability",
  "is_thread_local_static",
  "is_mutable_static",
  "needs_thread_local_shim",
  "thread_local_ptr_ty",
  "static_ptr_ty",
  "try_expand_impl_trait_type",
  "def_descr",
  "def_kind_descr",
  "def_descr_article",
  "def_kind_descr_article",
  "is_user_visible_dep",
  "expand_free_alias_tys",
  "peel_off_free_alias_tys",
  "opt_alias_variances",
]);
