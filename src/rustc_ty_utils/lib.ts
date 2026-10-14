// Port of compiler/rustc_ty_utils/src/lib.rs (the modules ported so far).
//! Various checks
//!
//! # Note
//!
//! This API is completely unstable and subject to change.
import type { Providers } from "../rustc_middle/queries.gen.ts";
import * as assoc from "./assoc.ts";

// mod abi;                 (not ported)
// mod assoc;
// mod common_traits;       (not ported)
// mod consts;              (not ported)
// mod diagnostics;         (not ported)
// mod implied_bounds;      (not ported)
// mod instance;            (not ported)
// mod layout;              (not ported)
// mod needs_drop;          (not ported)
// mod nested_bodies;       (not ported)
// mod opaque_types;        (not ported)
// mod representability;    (not ported)
// mod structural_match;    (not ported)
// mod ty;                  (not ported)

// rustc: compiler/rustc_ty_utils/src/lib.rs:30 provide
export function provide(providers: Providers): void {
  // PORT: the `provide` fns of the modules not ported yet are skipped (their queries keep the default provider).
  // abi::provide(providers);
  assoc.provide(providers);
  // common_traits::provide(providers);
  // consts::provide(providers);
  // implied_bounds::provide(providers);
  // layout::provide(providers);
  // needs_drop::provide(providers);
  // opaque_types::provide(providers);
  // representability::provide(providers);
  // ty::provide(providers);
  // instance::provide(providers);
  // structural_match::provide(providers);
  // nested_bodies::provide(providers);
}
