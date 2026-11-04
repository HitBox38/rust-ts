// Port of compiler/rustc_monomorphize/src/graph_checks/mod.rs (lane mono-partition).
//! Checks that need to operate on the entire mono item graph
import type { MonoItem } from "../../rustc_middle/mono.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { UsageMap } from "../collector.ts";
import { check_static_initializers_are_acyclic } from "./statics.ts";

// rustc: compiler/rustc_monomorphize/src/graph_checks/mod.rs:10 target_specific_checks
export function target_specific_checks(tcx: TyCtxt, mono_items: readonly MonoItem[], usage_map: UsageMap): void {
  if (tcx.sess.target.static_initializer_must_be_acyclic) {
    check_static_initializers_are_acyclic(tcx, mono_items, usage_map);
  }
}
