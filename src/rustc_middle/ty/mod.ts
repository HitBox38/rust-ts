// Partial port of compiler/rustc_middle/src/ty/mod.rs: `Visibility` (and its impls) and the `TyCtxt`
// def-id tree helpers name resolution needs (`opt_parent`, `parent`, `opt_local_parent`, `local_parent`,
// `def_id_partial_cmp`, `is_descendant_of`, `opt_item_name`, `item_name`). The rest of ty/mod.rs
// (types, generics, ADTs, ...) is M3+.
//
// PORT: `Visibility<Id>` is generic over `LocalModId` (a number) and `ModId` (a class); conversions
// `Id: Into<ModId>` / `impl Into<DefId>` dispatch on the runtime shape (`into_ModId`,
// `into_query_key_DefId`). `Option<Ordering>` is `Ordering | undefined` with
// `Ordering = "Less" | "Equal" | "Greater"`.
import { type DefPath, debug_DefPath } from "../../rustc_hir_id/definitions.ts";
import { DefId, type DefId as DefIdT, debug_DefId, debug_LocalModId, debug_ModId, type LocalDefId, LocalModId, ModId, ModId_eq } from "../../rustc_span/def_id.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import { type Debug, debug_tuple, PLAIN } from "../../std/fmt.ts";
import { panic } from "../../std/panic.ts";
import { type IntoQueryKey, into_query_key_DefId } from "../query/into_query_key.ts";
import { TyCtxt } from "./context.ts";

export type Ordering = "Less" | "Equal" | "Greater";

export type Visibility<Id = LocalModId> =
  /// Visible everywhere (including in other crates).
  | { readonly $: "Public" }
  /// Visible only in the given crate-local module.
  | { readonly $: "Restricted"; readonly _0: Id };

/** `Into<ModId>` for the two `Id`s used with `Visibility` (`LocalModId`, `ModId`). */
function into_ModId(id: LocalModId | ModId): ModId {
  return id instanceof ModId ? id : LocalModId.to_mod_id(id);
}

const PUBLIC: { readonly $: "Public" } = Object.freeze({ $: "Public" as const });

export const Visibility = {
  Public: PUBLIC,
  Restricted<Id>(id: Id): Visibility<Id> {
    return { $: "Restricted", _0: id };
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:257 to_string
  to_string(self: Visibility<LocalModId>, def_id: LocalDefId, tcx: TyCtxt): string {
    switch (self.$) {
      case "Restricted": {
        const restricted_id = self._0;
        if (LocalModId.is_top_level_module(restricted_id)) {
          return "pub(crate)";
        } else if (restricted_id === tcx.parent_module_from_def_id(def_id)) {
          return "pub(self)";
        } else {
          const p: DefPath = tcx.def_path(LocalModId.to_def_id(restricted_id));
          return `pub(in crate${p.to_string_no_crate_verbose()})`;
        }
      }
      case "Public":
        return "pub";
    }
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:414 is_public
  is_public<Id>(self: Visibility<Id>): boolean {
    return self.$ === "Public";
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:418 map_id
  map_id<Id, OutId>(self: Visibility<Id>, f: (id: Id) => OutId): Visibility<OutId> {
    switch (self.$) {
      case "Public":
        return PUBLIC;
      case "Restricted":
        return Visibility.Restricted(f(self._0));
    }
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:427 to_mod_id
  to_mod_id(self: Visibility<LocalModId>): Visibility<ModId> {
    return Visibility.map_id(self, LocalModId.to_mod_id);
  },

  /// Returns `true` if an item with this visibility is accessible from the given definition.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:434 is_accessible_from
  is_accessible_from(self: Visibility<LocalModId | ModId>, def_id: IntoQueryKey<DefIdT>, tcx: TyCtxt): boolean {
    switch (self.$) {
      // Public items are visible everywhere.
      case "Public":
        return true;
      case "Restricted":
        return tcx.is_descendant_of(def_id, into_ModId(self._0));
    }
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:442 partial_cmp
  partial_cmp(self: Visibility<LocalModId | ModId>, vis: Visibility<LocalModId | ModId>, tcx: TyCtxt): Ordering | undefined {
    if (self.$ === "Public" && vis.$ === "Public") return "Equal";
    if (self.$ === "Public" && vis.$ === "Restricted") return "Greater";
    if (self.$ === "Restricted" && vis.$ === "Public") return "Less";
    const [lhs_id, rhs_id] = [into_ModId((self as { _0: LocalModId | ModId })._0), into_ModId((vis as { _0: LocalModId | ModId })._0)];
    return tcx.def_id_partial_cmp(lhs_id.to_def_id(), rhs_id.to_def_id());
  },

  /// Returns `true` if this visibility is strictly larger than the given visibility.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:462 greater_than
  greater_than(self: Visibility<LocalModId | ModId>, vis: Visibility<LocalModId | ModId>, tcx: TyCtxt): boolean {
    const ord = Visibility.partial_cmp(self, vis, tcx);
    if (ord !== undefined) {
      return ord === "Greater";
    } else {
      tcx.dcx().delayed_bug(`unordered visibilities: ${debug_Visibility_any(self)} and ${debug_Visibility_any(vis)}`);
      return false;
    }
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:478 expect_local
  expect_local(self: Visibility<ModId>): Visibility<LocalModId> {
    return Visibility.map_id(self, (id) => id.expect_local());
  },

  /// Returns `true` if this item is visible anywhere in the local crate.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:483 is_visible_locally
  is_visible_locally(self: Visibility<ModId>): boolean {
    switch (self.$) {
      case "Public":
        return true;
      case "Restricted":
        return self._0.is_local();
    }
  },
};

/** `#[derive(Debug)]` */
export function debug_Visibility<Id>(v: Visibility<Id>, f: Parameters<Debug<Id>>[1], debug_id: Debug<Id>): string {
  switch (v.$) {
    case "Public":
      return "Public";
    case "Restricted":
      return debug_tuple(f, "Restricted", [debug_id(v._0, f)]);
  }
}
function debug_Visibility_any(v: Visibility<LocalModId | ModId>): string {
  return debug_Visibility(v, PLAIN, (id, f) => (id instanceof ModId ? debug_ModId(id, f) : debug_LocalModId(id, f)));
}

/** `#[derive(PartialEq)]` */
export function Visibility_eq<Id>(a: Visibility<Id>, b: Visibility<Id>): boolean {
  if (a.$ !== b.$) return false;
  if (a.$ === "Public") return true;
  const x = a._0;
  const y = (b as { _0: Id })._0;
  return x instanceof ModId ? ModId_eq(x, y as ModId) : x === y;
}

// ---- impl TyCtxt (ty/mod.rs) -------------------------------------------------------------------

declare module "./context.ts" {
  interface TyCtxt {
    opt_parent(id: DefIdT): DefIdT | undefined;
    parent(id: DefIdT): DefIdT;
    opt_local_parent(id: LocalDefId): LocalDefId | undefined;
    local_parent(id: LocalDefId | LocalModId): LocalDefId;
    def_id_partial_cmp(lhs: DefIdT, rhs: DefIdT): Ordering | undefined;
    is_descendant_of(descendant: IntoQueryKey<DefIdT>, ancestor: IntoQueryKey<DefIdT>): boolean;
    opt_item_name(def_id: IntoQueryKey<DefIdT>): Symbol | undefined;
    item_name(id: IntoQueryKey<DefIdT>): Symbol;
  }
}

// rustc: compiler/rustc_middle/src/ty/mod.rs:347 opt_parent
TyCtxt.prototype.opt_parent = function (this: TyCtxt, id: DefIdT): DefIdT | undefined {
  const index = this.def_key(id).parent;
  return index === undefined ? undefined : new DefId(index, id.krate);
};

// rustc: compiler/rustc_middle/src/ty/mod.rs:353 parent
TyCtxt.prototype.parent = function (this: TyCtxt, id: DefIdT): DefIdT {
  const p = this.opt_parent(id);
  if (p !== undefined) {
    return p;
  }
  // not `unwrap_or_else` to avoid breaking caller tracking
  return panic(`${debug_DefId(id, PLAIN)} doesn't have a parent`);
};

// rustc: compiler/rustc_middle/src/ty/mod.rs:363 opt_local_parent
TyCtxt.prototype.opt_local_parent = function (this: TyCtxt, id: LocalDefId): LocalDefId | undefined {
  return this.opt_parent(into_query_key_DefId(id))?.expect_local();
};

// rustc: compiler/rustc_middle/src/ty/mod.rs:369 local_parent
TyCtxt.prototype.local_parent = function (this: TyCtxt, id: LocalDefId | LocalModId): LocalDefId {
  return this.parent(into_query_key_DefId(id)).expect_local();
};

/// Compare def-ids based on their position in def-id tree, ancestor def-ids are considered
/// larger than descendant def-ids, and two different def-ids are considered unordered if
/// neither of them is an ancestor of the other.
// rustc: compiler/rustc_middle/src/ty/mod.rs:376 def_id_partial_cmp
TyCtxt.prototype.def_id_partial_cmp = function (this: TyCtxt, lhs: DefIdT, rhs: DefIdT): Ordering | undefined {
  // Def-ids from different crates are always unordered.
  if (lhs.krate !== rhs.krate) {
    return undefined;
  }

  // Def-ids of parent nodes are always created before def-ids of child nodes
  // and have a smaller index, so we only need to search in one direction,
  // either from lhs to rhs, or vice versa.
  const search = (start: DefIdT, finish: DefIdT, ord: Ordering): Ordering | undefined => {
    while (start.index !== finish.index) {
      const parent = this.opt_parent(start);
      if (parent !== undefined) {
        start = new DefId(parent.index, start.krate);
      } else {
        return undefined;
      }
    }
    return ord;
  };
  if (lhs.index === rhs.index) return "Equal";
  if (lhs.index < rhs.index) return search(rhs, lhs, "Greater");
  return search(lhs, rhs, "Less");
};

// rustc: compiler/rustc_middle/src/ty/mod.rs:401 is_descendant_of
TyCtxt.prototype.is_descendant_of = function (this: TyCtxt, descendant: IntoQueryKey<DefIdT>, ancestor: IntoQueryKey<DefIdT>): boolean {
  const o = this.def_id_partial_cmp(into_query_key_DefId(descendant), into_query_key_DefId(ancestor));
  return o === "Less" || o === "Equal";
};

/// Look up the name of a definition across crates. This does not look at HIR.
// rustc: compiler/rustc_middle/src/ty/mod.rs:1689 opt_item_name
TyCtxt.prototype.opt_item_name = function (this: TyCtxt, def_id_: IntoQueryKey<DefIdT>): Symbol | undefined {
  const def_id = into_query_key_DefId(def_id_);
  const cnum = def_id.as_crate_root();
  if (cnum !== undefined) {
    return this.crate_name(cnum);
  } else {
    const def_key = this.def_key(def_id);
    switch (def_key.disambiguated_data.data.$) {
      // The name of a constructor is that of its parent.
      case "Ctor": {
        const parent = def_key.parent;
        if (parent === undefined) panic("called `Option::unwrap()` on a `None` value");
        return this.opt_item_name(new DefId(parent, def_id.krate));
      }
      default:
        return def_key.get_opt_name();
    }
  }
};

/// Look up the name of a definition across crates. This does not look at HIR.
///
/// This method will ICE if the corresponding item does not have a name. In these cases, use
/// [`opt_item_name`] instead.
///
/// [`opt_item_name`]: Self::opt_item_name
// rustc: compiler/rustc_middle/src/ty/mod.rs:1710 item_name
TyCtxt.prototype.item_name = function (this: TyCtxt, id_: IntoQueryKey<DefIdT>): Symbol {
  const id = into_query_key_DefId(id_);
  const n = this.opt_item_name(id);
  if (n !== undefined) return n;
  return panic(`item_name: no name for ${debug_DefPath(this.def_path(id), PLAIN)}`);
};

