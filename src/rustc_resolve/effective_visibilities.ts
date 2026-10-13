// Port of compiler/rustc_resolve/src/effective_visibilities.rs
//
// Stub (contract-first, lane res-lib): the methods of this file are declared in ./decls.ts and
// installed below as `unported(..)` placeholders; companions and statics have their final signatures
// and `unported` bodies, without markers. The lane that ports effective_visibilities.rs replaces each
// stub in place (adding its `// rustc: ` marker) and removes the method's name from the
// `unported_methods` list (docs/handoff/res-lib.md, "How to fill a stub").
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other
// crates; another rustc_resolve module's exports are read inside function bodies only.
import { type Crate, visit } from "../rustc_ast/lib.ts";
import type { EffectiveVisibilities, Level } from "../rustc_middle/middle/privacy.ts";
import type { Visibility } from "../rustc_middle/ty/mod.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { unported } from "../std/panic.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { Resolver } from "./decls.ts";
import * as gen from "./effective_visibilities.gen.ts";
import type { Decl } from "./lib.ts";

export * from "./effective_visibilities.gen.ts";

export type ParentId = gen.ParentId;
export const ParentId = {
  /** Stub: `effective_visibilities.rs:23` `ParentId::level` (unported). */
  level(self: ParentId): Level {
    return unported("rustc_resolve::effective_visibilities::ParentId::level");
  },
};

// rustc-type: compiler/rustc_resolve/src/effective_visibilities.rs:31 EffectiveVisibilitiesVisitor
// PORT: `impl Visitor` -> extends the rustc_ast `Visitor` base class (hand type, types.sets.json).
export class EffectiveVisibilitiesVisitor extends visit.Visitor {
  constructor(
    public r: Resolver,
    public def_effective_visibilities: EffectiveVisibilities,
    /// While walking import chains we need to track effective visibilities per-decl, and def id
    /// keys in `Resolver::effective_visibilities` are not enough for that, because multiple
    /// declarations can correspond to a single def id in imports. So we keep a separate table.
    public import_effective_visibilities: EffectiveVisibilities<Decl>,
    // It's possible to recalculate this at any point, but it's relatively expensive.
    public current_private_vis: Visibility,
    /// A set of pairs corresponding to modules, where the first module is
    /// reachable via a macro that's defined in the second module. This cannot
    /// be represented as reachable because it can't handle the following case:
    ///
    /// pub mod n {                         // Should be `Public`
    ///     pub(crate) mod p {              // Should *not* be accessible
    ///         pub fn f() -> i32 { 12 }    // Must be `Reachable`
    ///     }
    /// }
    /// pub macro m() {
    ///     n::p::f()
    /// }
    /** `FxHashSet<(LocalDefId, LocalDefId)>`: a `KeyedSet` (pair key) */
    public macro_reachable: Set<[LocalDefId, LocalDefId]>,
    public changed: boolean,
  ) {
    super();
  }

  /// Fills the `Resolver::effective_visibilities` table with public & exported items
  /// For now, this doesn't resolve macros (FIXME) and cannot resolve Impl, as we
  /// need access to a TyCtxt for that. Returns the set of ambiguous re-exports.
  /** Stub: `effective_visibilities.rs:81` `EffectiveVisibilitiesVisitor::compute_effective_visibilities` (unported). */
  static compute_effective_visibilities(r: Resolver, krate: Crate): Set<Decl> {
    return unported("rustc_resolve::effective_visibilities::EffectiveVisibilitiesVisitor::compute_effective_visibilities");
  }
}

unported_methods(Resolver.prototype, "rustc_resolve::effective_visibilities::Resolver", ["private_vis_decl", "private_vis_def"]);
unported_methods(EffectiveVisibilitiesVisitor.prototype, "rustc_resolve::effective_visibilities::EffectiveVisibilitiesVisitor", [
  "set_bindings_effective_visibilities",
  "update_decl_chain",
  "effective_vis_or_private",
  "may_update",
  "update_import",
  "update_def",
  "update_field",
  "update_macro",
  "update_reachability_from_macro",
  "update_macro_reachable",
  "update_macro_reachable_def",
  "visit_item",
]);
