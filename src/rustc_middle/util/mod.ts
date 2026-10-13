// Partial port of compiler/rustc_middle/src/util/mod.rs: the `Providers` bundle.
// (`bug`, `common` and friends are not ported.)
import type { Providers as HookProviders } from "../hooks.ts";
import type { ExternProviders, Providers as QueryProviders } from "../queries.gen.ts";

export interface Providers {
  queries: QueryProviders;
  extern_queries: ExternProviders;
  hooks: HookProviders;
}
