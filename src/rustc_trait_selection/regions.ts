// Port of compiler/rustc_trait_selection/src/regions.rs (lane trait-sel-traits-a).
//
// Contract stub (lane infcx-contract): only the `#[extension]` trait methods this file adds to rustc_infer's types are
// declared so far (rustc_trait_selection/decls.ts); they are `unported` placeholders below. The lane that ports this file
// assigns each method onto the prototype (marker above it) and deletes its name from the list; the rest of the file is
// ported as usual. Init order: top-level code here may touch only rustc_infer (loaded first by ../lib.ts) and other crates.

import { unported_methods } from "../rust_ts/stubs.ts";
import { InferCtxt } from "../rustc_infer/decls.ts";
import { OutlivesEnvironment } from "../rustc_infer/infer/outlives/env.ts";

unported_methods(InferCtxt.prototype, "rustc_trait_selection::regions::InferCtxt", ["resolve_regions"]);
unported_methods(OutlivesEnvironment, "rustc_trait_selection::regions::OutlivesEnvironment", ["new", "new_with_implied_bounds_compat"]);
