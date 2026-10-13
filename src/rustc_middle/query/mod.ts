// Port of compiler/rustc_middle/src/query/mod.rs (module list and re-exports).
export { DefaultCache, DefIdCache, type QueryCache, SingleCache, VecCache } from "./caches.ts";
export { TyCtxtAt, TyCtxtEnsureDone, TyCtxtEnsureOk, TyCtxtEnsureResult } from "./calls.ts";
export { type IntoQueryKey } from "./into_query_key.ts";
export { type ActiveKeyStatus, type QueryCycle, QueryJob, type QueryJobId, QueryLatch, type QueryStackFrame, QueryState, type QueryWaiter } from "./job.ts";
export { LocalCrate, type QueryKey } from "./keys.ts";
export { QueryMode, QuerySystem, QueryVTable } from "./system.ts";
export type { Providers } from "../queries.gen.ts";

export * as arena_cached from "./arena_cached.ts";
export * as calls from "./calls.ts";
export * as erase from "./erase.ts";
export * as query_api from "./query_api.ts";
// mod on_disk_cache: incremental only (PORT: no dep graph, D3).
// pub(crate) mod modifiers: documentation-only items for the query modifiers (no fns).
