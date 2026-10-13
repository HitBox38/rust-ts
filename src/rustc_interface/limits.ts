//! Registering limits:
//! - recursion_limit: there are various parts of the compiler that must impose arbitrary limits
//!   on how deeply they recurse to prevent stack overflow.
//! - move_size_limit
//! - type_length_limit
//! - pattern_complexity_limit
//!
//! Users can override these limits via an attribute on the crate like
//! `#![recursion_limit="22"]`. This pass just looks for those attributes.
// Port of compiler/rustc_interface/src/limits.rs (lane driver-m2).
import "../rustc_session/options.ts"; // LOAD ORDER: see rustc_session/config.ts
import { type Attribute, find_attr } from "../rustc_attr_ir/lib.ts";
import type { Limits, TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { Session } from "../rustc_session/session.ts";
import { Limit } from "../rustc_structures/limit.ts";
import { unported } from "../std/panic.ts";

/**
 * `tcx.hir_krate_attrs()` (rustc_middle/src/hir/mod.rs): the crate root's HIR attributes.
 * PORT: pending HIR (M3).
 */
function hir_krate_attrs(_tcx: TyCtxt): readonly Attribute[] {
  return unported("rustc_middle::hir::TyCtxt::hir_krate_attrs (HIR, M3)");
}

// rustc: compiler/rustc_interface/src/limits.rs:16 provide
export function provide(providers: Providers): void {
  providers.limits = (tcx, _): Limits => {
    const attrs = hir_krate_attrs(tcx);
    return {
      recursion_limit: get_recursion_limit(hir_krate_attrs(tcx), tcx.sess),
      move_size_limit:
        find_attr(attrs, (k) => (k.$ === "MoveSizeLimit" ? k.limit : undefined)) ?? Limit.new(tcx.sess.opts.unstable_opts.move_size_limit ?? 0),
      type_length_limit: find_attr(attrs, (k) => (k.$ === "TypeLengthLimit" ? k.limit : undefined)) ?? Limit.new(2 ** 24),
      pattern_complexity_limit: find_attr(attrs, (k) => (k.$ === "PatternComplexityLimit" ? k.limit : undefined)) ?? Limit.unlimited(),
    };
  };
}

// This one is separate because it must be read prior to macro expansion.
// rustc: compiler/rustc_interface/src/limits.rs:32 get_recursion_limit
export function get_recursion_limit(attrs: readonly Attribute[], sess: Session): Limit {
  const limit_from_crate = find_attr(attrs, (k) => (k.$ === "RecursionLimit" ? k.limit._0 : undefined)) ?? 128;
  const min = sess.opts.unstable_opts.min_recursion_limit;
  return Limit.new(min === undefined ? limit_from_crate : Math.max(min, limit_from_crate));
}
