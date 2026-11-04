// Port of compiler/rustc_monomorphize/src/mono_checks/mod.rs (lane mono-collector).
//! This implements a single query, `check_mono_fn`, that gets fired for each
//! monomorphization of all functions. This lets us implement monomorphization-time
//! checks in a way that is friendly to incremental compilation.
import type { Providers } from "../../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Instance } from "../../rustc_middle/ty/instance.ts";
import * as abi_check from "./abi_check.ts";
import * as move_check from "./move_check.ts";

// rustc: compiler/rustc_monomorphize/src/mono_checks/mod.rs:11 check_mono_item
function check_mono_item(tcx: TyCtxt, instance: Instance): null {
  const body = tcx.instance_mir(instance.def);
  abi_check.check_feature_dependent_abi(tcx, instance, body);
  move_check.check_moves(tcx, instance, body);
  return null;
}

// rustc: compiler/rustc_monomorphize/src/mono_checks/mod.rs:17 provide
export function provide(providers: Providers): void {
  providers.check_mono_item = check_mono_item;
}
