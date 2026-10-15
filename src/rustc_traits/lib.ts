//! Queries that are independent from the main solver code.
//
// Port of compiler/rustc_traits/src/lib.rs (lane selcx-contract). The crate's providers sit on rustc_trait_selection's
// old solver (traits/{select,project,query}); where a callee is still a wave-18b stub, the provider stops there as
// UNPORTED. Load order: rustc_trait_selection first (its extension methods on rustc_infer's types must exist).
import "../rustc_trait_selection/lib.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import * as codegen from "./codegen.ts";
import * as coroutine_witnesses from "./coroutine_witnesses.ts";
import * as dropck_outlives from "./dropck_outlives.ts";
import * as evaluate_obligation from "./evaluate_obligation.ts";
import * as implied_outlives_bounds from "./implied_outlives_bounds.ts";
import * as normalize_erasing_regions from "./normalize_erasing_regions.ts";
import * as normalize_projection_ty from "./normalize_projection_ty.ts";
import * as type_op from "./type_op.ts";

// mod codegen;
// mod coroutine_witnesses;
// mod dropck_outlives;
// mod evaluate_obligation;
// mod implied_outlives_bounds;
// mod normalize_erasing_regions;
// mod normalize_projection_ty;
// mod type_op;

// rustc: compiler/rustc_traits/src/lib.rs:18 provide
export function provide(p: Providers): void {
  dropck_outlives.provide(p);
  evaluate_obligation.provide(p);
  implied_outlives_bounds.provide(p);
  normalize_projection_ty.provide(p);
  normalize_erasing_regions.provide(p);
  type_op.provide(p);
  p.codegen_select_candidate = codegen.codegen_select_candidate as Providers["codegen_select_candidate"];
  p.coroutine_hidden_types = coroutine_witnesses.coroutine_hidden_types;
}
