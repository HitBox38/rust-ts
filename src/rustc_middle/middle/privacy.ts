//! A pass that checks to make sure private fields and methods aren't used
//! outside their scopes. This pass will also generate a set of exported items
//! which are available for use externally when compiled as a library.
// Port of compiler/rustc_middle/src/middle/privacy.rs.
//
// PORT: hand-written types (the typedefs probe cannot parse this file's `const impl`). `&mut Visibility`
// returned by `at_level_mut` is the field name (`EffectiveVisibilityField`); callers assign through it.
// `EffectiveVisibilities<Id>` keys a JS `Map` by `Id` (`LocalDefId` numbers, or interned objects in
// rustc_resolve, compared by identity like upstream's interned pointers); `Map` keeps insertion order like
// `FxIndexMap`.
import { CRATE_DEF_ID, debug_LocalDefId, debug_LocalModId, type LocalDefId } from "../../rustc_span/def_id.ts";
import { type Debug, type Fmt, debug_map, debug_struct } from "../../std/fmt.ts";
import type { StableHashCtxt, StableHasher } from "../../rustc_data_structures/stable_hash.ts";
import { unported } from "../../std/panic.ts";
import type { TyCtxt } from "../ty/context.ts";
import { debug_Visibility, Visibility, Visibility_eq } from "../ty/mod.ts";

/// Represents the levels of effective visibility an item can have.
///
/// The variants are sorted in ascending order of directness.
export type Level =
  /// Superset of `Reachable` including items leaked through return position `impl Trait`.
  | "ReachableThroughImplTrait"
  /// Item is either reexported, or leaked through any kind of interface.
  /// For example, if function `fn f() -> T {...}` is directly public, then type `T` is publicly
  /// reachable and its values can be obtained by other crates even if the type itself is not
  /// nameable.
  | "Reachable"
  /// Item is accessible either directly, or with help of `use` reexports.
  | "Reexported"
  /// Item is directly accessible, without help of reexports.
  | "Direct";
/** `#[derive(PartialOrd, Ord)]`: declaration order */
export const Level_discriminant: Record<Level, number> = { ReachableThroughImplTrait: 0, Reachable: 1, Reexported: 2, Direct: 3 };
export const debug_Level = (v: Level, _f: Fmt): string => v;

export const Level = {
  ReachableThroughImplTrait: "ReachableThroughImplTrait",
  Reachable: "Reachable",
  Reexported: "Reexported",
  Direct: "Direct",

  // rustc: compiler/rustc_middle/src/middle/privacy.rs:37 all_levels
  all_levels(): [Level, Level, Level, Level] {
    return ["Direct", "Reexported", "Reachable", "ReachableThroughImplTrait"];
  },
} as const;

type EffectiveVisibilityField = "direct" | "reexported" | "reachable" | "reachable_through_impl_trait";

export class EffectiveVisibility {
  constructor(
    public direct: Visibility,
    public reexported: Visibility,
    public reachable: Visibility,
    public reachable_through_impl_trait: Visibility,
  ) {}

  // rustc: compiler/rustc_middle/src/middle/privacy.rs:51 at_level
  at_level(level: Level): Visibility {
    return this[this.at_level_mut(level)];
  }

  // rustc: compiler/rustc_middle/src/middle/privacy.rs:60 at_level_mut
  private at_level_mut(level: Level): EffectiveVisibilityField {
    switch (level) {
      case "Direct":
        return "direct";
      case "Reexported":
        return "reexported";
      case "Reachable":
        return "reachable";
      case "ReachableThroughImplTrait":
        return "reachable_through_impl_trait";
    }
  }

  /** `*self.at_level_mut(level) = vis` */
  set_at_level(level: Level, vis: Visibility): void {
    this[this.at_level_mut(level)] = vis;
  }

  // rustc: compiler/rustc_middle/src/middle/privacy.rs:69 public_at_level
  public_at_level(): Level | undefined {
    return Level.all_levels().find((level) => this.is_public_at_level(level));
  }

  // rustc: compiler/rustc_middle/src/middle/privacy.rs:73 is_public_at_level
  is_public_at_level(level: Level): boolean {
    return Visibility.is_public(this.at_level(level));
  }

  // rustc: compiler/rustc_middle/src/middle/privacy.rs:77 from_vis
  static from_vis(vis: Visibility): EffectiveVisibility {
    return new EffectiveVisibility(vis, vis, vis, vis);
  }

  // rustc: compiler/rustc_middle/src/middle/privacy.rs:87 min
  min(lhs: EffectiveVisibility, tcx: TyCtxt): EffectiveVisibility {
    // `mut self` is a copy.
    const self = new EffectiveVisibility(this.direct, this.reexported, this.reachable, this.reachable_through_impl_trait);
    for (const l of Level.all_levels()) {
      const rhs_vis = self.at_level(l);
      const lhs_vis = lhs.at_level(l);
      // FIXME: figure out why unordered visibilities occur here,
      // and what the behavior for them should be.
      if (Visibility.partial_cmp(rhs_vis, lhs_vis, tcx) === "Greater") {
        self.set_at_level(l, lhs_vis);
      }
    }
    return self;
  }
}

/** `#[derive(Debug)]` */
export const debug_EffectiveVisibility: Debug<EffectiveVisibility> = (v, f) =>
  debug_struct(f, "EffectiveVisibility", [
    ["direct", debug_Visibility(v.direct, f, debug_LocalModId)],
    ["reexported", debug_Visibility(v.reexported, f, debug_LocalModId)],
    ["reachable", debug_Visibility(v.reachable, f, debug_LocalModId)],
    ["reachable_through_impl_trait", debug_Visibility(v.reachable_through_impl_trait, f, debug_LocalModId)],
  ]);

/** `#[derive(PartialEq)]` */
export function EffectiveVisibility_eq(a: EffectiveVisibility, b: EffectiveVisibility): boolean {
  return (
    Visibility_eq(a.direct, b.direct) &&
    Visibility_eq(a.reexported, b.reexported) &&
    Visibility_eq(a.reachable, b.reachable) &&
    Visibility_eq(a.reachable_through_impl_trait, b.reachable_through_impl_trait)
  );
}

/// Holds a map of effective visibilities for reachable HIR nodes.
export class EffectiveVisibilities<Id = LocalDefId> {
  constructor(public map: Map<Id, EffectiveVisibility>) {}

  // rustc: compiler/rustc_middle/src/middle/privacy.rs:108 is_public_at_level
  is_public_at_level(this: EffectiveVisibilities<LocalDefId>, id: LocalDefId, level: Level): boolean {
    const effective_vis = this.effective_vis(id);
    return effective_vis !== undefined && effective_vis.is_public_at_level(level);
  }

  /// See `Level::Reachable`.
  // rustc: compiler/rustc_middle/src/middle/privacy.rs:113 is_reachable
  is_reachable(this: EffectiveVisibilities<LocalDefId>, id: LocalDefId): boolean {
    return this.is_public_at_level(id, "Reachable");
  }

  /// See `Level::Reexported`.
  // rustc: compiler/rustc_middle/src/middle/privacy.rs:118 is_exported
  is_exported(this: EffectiveVisibilities<LocalDefId>, id: LocalDefId): boolean {
    return this.is_public_at_level(id, "Reexported");
  }

  /// See `Level::Direct`.
  // rustc: compiler/rustc_middle/src/middle/privacy.rs:123 is_directly_public
  is_directly_public(this: EffectiveVisibilities<LocalDefId>, id: LocalDefId): boolean {
    return this.is_public_at_level(id, "Direct");
  }

  // rustc: compiler/rustc_middle/src/middle/privacy.rs:127 public_at_level
  public_at_level(this: EffectiveVisibilities<LocalDefId>, id: LocalDefId): Level | undefined {
    return this.effective_vis(id)?.public_at_level();
  }

  // rustc: compiler/rustc_middle/src/middle/privacy.rs:131 update_root
  update_root(this: EffectiveVisibilities<LocalDefId>): void {
    this.map.set(CRATE_DEF_ID, EffectiveVisibility.from_vis(Visibility.Public));
  }

  // FIXME: Share code with `fn update`.
  // rustc: compiler/rustc_middle/src/middle/privacy.rs:136 update_eff_vis
  update_eff_vis(this: EffectiveVisibilities<LocalDefId>, def_id: LocalDefId, eff_vis: EffectiveVisibility, tcx: TyCtxt): void {
    const old_eff_vis = this.map.get(def_id);
    if (old_eff_vis !== undefined) {
      for (const l of Level.all_levels()) {
        const vis_at_level = eff_vis.at_level(l);
        const old_vis_at_level = old_eff_vis.at_level(l);
        if (Visibility.greater_than(vis_at_level, old_vis_at_level, tcx)) {
          old_eff_vis.set_at_level(l, vis_at_level);
        }
      }
    } else {
      // `vacant.insert(*eff_vis)`: a copy.
      this.map.set(def_id, new EffectiveVisibility(eff_vis.direct, eff_vis.reexported, eff_vis.reachable, eff_vis.reachable_through_impl_trait));
    }
  }

  // rustc: compiler/rustc_middle/src/middle/privacy.rs:158 check_invariants
  check_invariants(this: EffectiveVisibilities<LocalDefId>, _tcx: TyCtxt): void {
    // `if !cfg!(debug_assertions) { return; }`: rustc ships without debug assertions, so the
    // invariant checks below the early return never run (and are not ported).
    return;
  }

  // rustc: compiler/rustc_middle/src/middle/privacy.rs:212 iter
  iter(): IterableIterator<[Id, EffectiveVisibility]> {
    return this.map.entries();
  }

  // rustc: compiler/rustc_middle/src/middle/privacy.rs:216 effective_vis
  effective_vis(id: Id): EffectiveVisibility | undefined {
    return this.map.get(id);
  }

  // rustc: compiler/rustc_middle/src/middle/privacy.rs:220 effective_vis_or_private
  effective_vis_or_private(id: Id, lazy_private_vis: () => Visibility): EffectiveVisibility {
    let e = this.map.get(id);
    if (e === undefined) {
      e = EffectiveVisibility.from_vis(lazy_private_vis());
      this.map.set(id, e);
    }
    return e;
  }

  // rustc: compiler/rustc_middle/src/middle/privacy.rs:228 update
  update(id: Id, max_vis: Visibility | undefined, private_vis: Visibility, inherited_effective_vis: EffectiveVisibility, level: Level, tcx: TyCtxt): boolean {
    let changed = false;
    const current_effective_vis = this.effective_vis_or_private(id, () => private_vis);

    let inherited_effective_vis_at_prev_level = inherited_effective_vis.at_level(level);
    let calculated_effective_vis = inherited_effective_vis_at_prev_level;
    for (const l of Level.all_levels()) {
      if (Level_discriminant[level] >= Level_discriminant[l]) {
        const inherited_effective_vis_at_level = inherited_effective_vis.at_level(l);
        const current_effective_vis_at_level = current_effective_vis.at_level(l);
        // effective visibility for id shouldn't be recalculated if
        // inherited from parent_id effective visibility isn't changed at next level
        if (!(Visibility_eq(inherited_effective_vis_at_prev_level, inherited_effective_vis_at_level) && level !== l)) {
          // FIXME: figure out why unordered visibilities occur here,
          // and what the behavior for them should be.
          calculated_effective_vis =
            max_vis !== undefined && Visibility.partial_cmp(inherited_effective_vis_at_level, max_vis, tcx) === "Greater" ? max_vis : inherited_effective_vis_at_level;
        }
        // effective visibility can't be decreased at next update call for the
        // same id
        // FIXME: figure out why unordered visibilities occur here,
        // and what the behavior for them should be.
        if (Visibility.partial_cmp(calculated_effective_vis, current_effective_vis_at_level, tcx) === "Greater") {
          changed = true;
          current_effective_vis.set_at_level(l, calculated_effective_vis);
        }
        inherited_effective_vis_at_prev_level = inherited_effective_vis_at_level;
      }
    }

    return changed;
  }

  // rustc: compiler/rustc_middle/src/middle/privacy.rs:281 default
  static default<Id>(): EffectiveVisibilities<Id> {
    return new EffectiveVisibilities<Id>(new Map());
  }
}

/** `#[derive(Debug)]`: `EffectiveVisibilities { map: {..} }` (FxIndexMap: insertion order). */
export function debug_EffectiveVisibilities<Id>(v: EffectiveVisibilities<Id>, f: Fmt, debug_id?: Debug<Id>): string {
  const did = debug_id ?? ((x: Id, f: Fmt) => debug_LocalDefId(x as unknown as LocalDefId, f));
  return debug_struct(f, "EffectiveVisibilities", [["map", debug_map(f, [...v.map].map(([k, x]) => [did(k, f), debug_EffectiveVisibility(x, f)]))]]);
}

// rustc: compiler/rustc_middle/src/middle/privacy.rs:287 stable_hash
export function stable_hash_EffectiveVisibilities(_self: EffectiveVisibilities, _hcx: StableHashCtxt, _hasher: StableHasher): void {
  // `map.stable_hash(hcx, hasher)`: `FxIndexMap<LocalDefId, EffectiveVisibility>` (derive(StableHash) of
  // `EffectiveVisibility` / `Visibility`): not generated yet.
  unported("StableHash of rustc_middle::middle::privacy::EffectiveVisibilities");
}
