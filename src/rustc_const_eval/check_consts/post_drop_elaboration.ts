// Stub module (lane mt-promote): compiler/rustc_const_eval/src/check_consts/post_drop_elaboration.rs is not ported yet.
// Declared by lane const-check (check.rs's `Drop` arm calls `checking_enabled`); mt-promote's port replaces this file.
import { unported } from "../../std/panic.ts";
import type { ConstCx } from "./mod.ts";

/// Returns `true` if we should use the more precise live drop checker that runs after drop
/// elaboration.
// stub: compiler/rustc_const_eval/src/check_consts/post_drop_elaboration.rs:14 checking_enabled (lane mt-promote)
export function checking_enabled(_ccx: ConstCx): boolean {
  return unported("rustc_const_eval::check_consts::post_drop_elaboration::checking_enabled");
}
