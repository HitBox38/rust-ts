// Port of compiler/rustc_ty_utils/src/lib.rs (the modules ported so far).
//! Various checks
//!
//! # Note
//!
//! This API is completely unstable and subject to change.
import type { Providers } from "../rustc_middle/queries.gen.ts";
import * as assoc from "./assoc.ts";
import * as common_traits from "./common_traits.ts";
import * as implied_bounds from "./implied_bounds.ts";
import * as layout from "./layout.ts";
import * as needs_drop from "./needs_drop.ts";
import * as nested_bodies from "./nested_bodies.ts";
import * as opaque_types from "./opaque_types.ts";
import * as representability from "./representability.ts";
import * as structural_match from "./structural_match.ts";
import * as ty from "./ty.ts";

// mod abi;                 (not ported: codegen-era, M4+)
// mod assoc;
// mod common_traits;
// mod consts;              (not ported)
// mod diagnostics;         (generated: diagnostics.gen.ts, re-exported by diagnostics.ts)
// mod implied_bounds;
// mod instance;            (not ported: codegen-era, M4+)
// mod layout;              (lane layout-contract: `provide` and the `layout_of` provider; the rest are stubs)
// mod needs_drop;
// mod nested_bodies;
// mod opaque_types;
// mod representability;
// mod structural_match;
// mod ty;

// rustc: compiler/rustc_ty_utils/src/lib.rs:30 provide
export function provide(providers: Providers): void {
  // PORT: the `provide` fns of the modules not ported yet are skipped (their queries keep the default provider).
  // abi::provide(providers);
  assoc.provide(providers);
  common_traits.provide(providers);
  // consts::provide(providers);
  implied_bounds.provide(providers);
  layout.provide(providers);
  needs_drop.provide(providers);
  opaque_types.provide(providers);
  representability.provide(providers);
  ty.provide(providers);
  // instance::provide(providers);
  structural_match.provide(providers);
  nested_bodies.provide(providers);
}
