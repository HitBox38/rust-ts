// Port of compiler/rustc_query_impl/src/lib.rs.
//
// PORT: no dep graph (D3): no `dep_kind_vtables`, no `on_disk_cache` (always `None` in non-incremental
// compilation), no query arenas (erased) and no `side_effects`; see rustc_middle/query/system.ts.
import "../rustc_middle/lib.ts";
import type { Providers as UtilProviders } from "../rustc_middle/util/mod.ts";
import type { ExternProviders, Providers } from "../rustc_middle/queries.gen.ts";
import { QuerySystem } from "../rustc_middle/query/system.ts";
import { make_query_vtables } from "./query_vtables.ts";
import * as incremental_ from "./incremental.ts";
import * as self_profile from "./self_profile.ts";

export { type CollectActiveJobsKind, collect_active_query_jobs, print_query_stack, type QueryJobMap } from "./job.ts";
export * as diagnostics from "./diagnostics.ts";
export * as execution from "./execution.ts";
export * as handle_cycle_error from "./handle_cycle_error.ts";
export * as query_vtables from "./query_vtables.ts";

// rustc: compiler/rustc_query_impl/src/lib.rs:29 query_system
export function query_system(local_providers: Providers, extern_providers: ExternProviders, on_disk_cache: undefined, incremental: boolean, track_present: boolean): QuerySystem {
  void on_disk_cache;
  return new QuerySystem(make_query_vtables(incremental, track_present), new Map(), local_providers, extern_providers, 1, 0);
}

// rustc: compiler/rustc_query_impl/src/lib.rs:51 provide
export function provide(providers: UtilProviders): void {
  providers.hooks.alloc_self_profile_query_strings = self_profile.alloc_self_profile_query_strings;
  providers.hooks.verify_query_key_hashes = incremental_.verify_query_key_hashes;
  providers.hooks.encode_query_values = incremental_.encode_query_values;
}
