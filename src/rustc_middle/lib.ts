// Port of compiler/rustc_middle/src/lib.rs (module list) for the M2 subset: the query system
// (docs/plan-m2.md D3), `TyCtxt`, hooks and the name-resolution types.
//
// Load order (PORTING §5 "Methods defined in another file"): the defining modules first, then the
// installers that put the generated query methods and the hooks on the `TyCtxt` family of classes.
import "./ty/context.ts";
import { define_hooks } from "./hooks.ts";
import { define_query_api } from "./query/query_api.ts";

define_query_api();
define_hooks();

export * as dep_graph from "./dep_graph/graph.ts";
export * as hooks from "./hooks.ts";
export * as ich from "./ich.ts";
export * as queries from "./queries.ts";
export * as query from "./query/mod.ts";
export * as resolve from "./middle/resolve.ts";
export * as privacy from "./middle/privacy.ts";
export * as stability from "./middle/stability.ts";
export * as ty from "./ty/mod.ts";
export * as tls from "./ty/context/tls.ts";
export { CurrentGcx, GlobalCtxt, TyCtxt, TyCtxtFeed } from "./ty/context.ts";
export type { Providers } from "./util/mod.ts";
