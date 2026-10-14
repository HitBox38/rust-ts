// Port of compiler/rustc_infer/src/infer/context.rs (lane infer-relate).
//
// Contract stub (lane infcx-contract): every fn of this file that ../decls.ts declares is an `unported`
// placeholder below. Fill them per docs/handoff/infcx-contract.md "How to fill a stub": port each fn in upstream
// order with its `// rustc:` marker, then delete its name from the `unported_methods` list (and the call when
// the list is empty) or replace the stub `export const`. Init order: top-level code here may touch only
// ../decls.ts (or ../../decls.ts), this file's .gen.ts and other crates.

import { unported_methods } from "../../rust_ts/stubs.ts";
import { InferCtxt } from "../decls.ts";

export * from "./context.gen.ts";

unported_methods(InferCtxt.prototype, "rustc_infer::infer::context::InferCtxt", ["cx", "enable_next_solver_overflow_fcw", "ir_get_solver_region_constraint", "ir_overwrite_solver_region_constraint", "universe_of_ty", "ir_universe_of_region", "universe_of_const", "root_ty_var", "is_sub_unification_table_root_var", "shallow_resolve_region_var", "next_region_infer", "next_ty_infer", "next_const_infer", "ir_fresh_args_for_item", "instantiate_binder_with_infer", "enter_forall_without_assumptions", "enter_forall_with_empty_assumptions", "equate_ty_vids_raw", "equate_int_vids_raw", "equate_float_vids_raw", "equate_const_vids_raw", "instantiate_ty_var_raw", "instantiate_const_var_raw", "instantiate_int_var_raw", "instantiate_float_var_raw", "ir_sub_regions", "ir_equate_regions", "ir_register_solver_region_constraint", "register_ty_outlives", "opaque_types_storage_num_entries", "clone_opaque_types_lookup_table", "clone_duplicate_opaque_types", "clone_opaque_types_added_since", "ir_register_hidden_type_in_storage", "add_duplicate_opaque_type", "reset_opaque_types"]);
