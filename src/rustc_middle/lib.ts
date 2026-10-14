// Port of compiler/rustc_middle/src/lib.rs (module list) for the M2 subset: the query system
// (docs/plan-m2.md D3), `TyCtxt`, hooks and the name-resolution types.
//
// Load order (PORTING §5 "Methods defined in another file"): the defining modules first, then the
// installers that put the generated query methods and the hooks on the `TyCtxt` family of classes.
import "./ty/context.ts";
// ty extension modules (lane ty-contract; docs/handoff/ty-contract.md "Init order"): they put the methods of
// `Ty`, `RawList`, `Const`, `TyCtxt`, ... defined in other upstream files on the prototypes, so they load after
// the defining modules (context.ts pulls in mod.ts, list.ts, generic_args.ts, predicate.ts and rustc_type_ir's
// sty/*.ts). Alphabetical, then context/impl_interner.ts.
import "./ty/abstract_const.ts";
import "./ty/assoc.ts";
import "./ty/closure.ts";
import "./ty/consts.ts";
import "./ty/diagnostics.ts";
import "./ty/erase_regions.ts";
import "./ty/error.ts";
import "./ty/fold.ts";
import "./ty/inhabitedness/mod.ts";
import "./ty/intrinsic.ts";
import "./ty/normalize_erasing_regions.ts";
import "./ty/print/pretty.ts";
import "./ty/sty.ts";
import "./ty/trait_def.ts";
import "./ty/util.ts";
import "./ty/visit.ts";
import "./ty/context/impl_interner.ts";
// hir/mod.rs + hir/map.rs (lane middle-hir): the `impl TyCtxt` blocks of HIR access, attached to the prototype.
import "./hir/mod.ts";
// rustc_middle/src/middle extension modules (`impl TyCtxt` in middle/*.rs).
import "./middle/lang_items.ts";
import { define_hooks } from "./hooks.ts";
import { define_query_api } from "./query/query_api.ts";

define_query_api();
define_hooks();

export * as dep_graph from "./dep_graph/graph.ts";
export * as hir from "./hir/mod.ts";
export * as hooks from "./hooks.ts";
export * as ich from "./ich.ts";
export * as queries from "./queries.ts";
export * as query from "./query/mod.ts";
export * as diagnostics from "./diagnostics.ts";
export * as lang_items from "./middle/lang_items.ts";
export * as resolve from "./middle/resolve.ts";
export * as privacy from "./middle/privacy.ts";
export * as stability from "./middle/stability.ts";
export * as region from "./middle/region.ts";
export * as thir from "./thir.ts";
export * as traits from "./traits/mod.ts";
export * as ty from "./ty/mod.ts";
export * as tls from "./ty/context/tls.ts";
export { CurrentGcx, GlobalCtxt, TyCtxt, TyCtxtFeed } from "./ty/context.ts";
export type { Providers } from "./util/mod.ts";
