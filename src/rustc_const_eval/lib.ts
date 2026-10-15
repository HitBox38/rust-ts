// Port of compiler/rustc_const_eval/src/lib.rs (lane small-gaps-17): the crate root with `provide`. Only
// const_eval/fn_queries.rs is ported; the other modules (check_consts, interpret, util and the rest of const_eval) are
// M4/M6, and the providers they install are `unported` placeholders that name the upstream fn.

// pub mod check_consts;   (M4/M6)
// pub mod const_eval;
import * as const_eval from "./const_eval/mod.ts";
export { const_eval };
// mod diagnostics;        (M4/M6)
// pub mod interpret;      (M4/M6)
// pub mod util;           (M4/M6)

import type { Providers } from "../rustc_middle/util/mod.ts";
import { unported } from "../std/panic.ts";

// fn assert_typing_mode (lib.rs:28): not ported (const eval, M4/M6).

// rustc: compiler/rustc_const_eval/src/lib.rs:45 provide
export function provide(providers: Providers): void {
  const_eval.provide(providers.queries);
  // PORT: the providers below come from modules that are not ported (M4/M6); each stops as UNPORTED naming the
  // upstream fn it would call.
  providers.queries.tag_for_variant = () => unported("rustc_const_eval::const_eval::tag_for_variant_provider");
  providers.queries.eval_to_const_value_raw = () => unported("rustc_const_eval::const_eval::eval_to_const_value_raw_provider");
  providers.queries.eval_to_allocation_raw = () => unported("rustc_const_eval::const_eval::eval_to_allocation_raw_provider");
  providers.queries.eval_static_initializer = () => unported("rustc_const_eval::const_eval::eval_static_initializer_provider");
  providers.hooks.const_caller_location = () => unported("rustc_const_eval::util::caller_location::const_caller_location_provider");
  providers.queries.eval_to_valtree = () => unported("rustc_const_eval::const_eval::eval_to_valtree");
  providers.hooks.try_destructure_mir_constant_for_user_output = () =>
    unported("rustc_const_eval::const_eval::try_destructure_mir_constant_for_user_output");
  providers.queries.valtree_to_const_val = () => unported("rustc_const_eval::const_eval::valtree_to_const_value");
  providers.queries.check_validity_requirement = () => unported("rustc_const_eval::util::check_validity_requirement");
  providers.hooks.validate_scalar_in_layout = () => unported("rustc_const_eval::util::validate_scalar_in_layout");
}

// pub static CTRL_C_RECEIVED (lib.rs:69): not ported (read only by the interpreter, M4/M6).
