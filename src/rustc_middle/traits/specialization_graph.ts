// Port of compiler/rustc_middle/src/traits/specialization_graph.rs (lane middle-traits-thir). The types are generated
// (specialization_graph.gen.ts, set rustc_middle_traits_thir); `Graph` / `Ancestors` / `LeafDef` are the generated
// classes, the enum methods live on the companion consts (PORTING §8).
import type { Attribute } from "../../rustc_attr_ir/lib.ts";
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import { Defaultness } from "../../rustc_hir/lib.ts";
import { type DefId, DefId_eq, DefIdMap } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import type { SimplifiedType } from "../../rustc_type_ir/fast_reject.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import type { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { EarlyBinder as EarlyBinderC } from "../../rustc_type_ir/binder.ts";
import { standin_fold_Ty } from "../../rustc_type_ir/fold.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { panic } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { StrictCoherenceNeedsNegativeCoherence_diagnostic } from "../diagnostics.ts";
import type { AssocItem } from "../ty/assoc.gen.ts";
import type { TyCtxt } from "../ty/context.ts";
import type { Ty } from "../ty/mod.ts";
import { debug_DefId } from "../../rustc_span/def_id.ts";
import { PLAIN } from "../../std/fmt.ts";
import * as gen from "./specialization_graph.gen.ts";
import { Ancestors, Graph, LeafDef } from "./specialization_graph.gen.ts";

export * from "./specialization_graph.gen.ts";

declare module "./specialization_graph.gen.ts" {
  interface Graph {
    parent_(child: DefId): DefId;
  }
  namespace Graph {
    function new_(): Graph;
    export { new_ as new };
  }
  interface Ancestors {
    next(): Node | undefined;
    leaf_def(tcx: TyCtxt, trait_item_def_id: DefId): LeafDef | undefined;
  }
  interface LeafDef {
    is_final(): boolean;
  }
}

/// A per-trait graph of impls in specialization order. At the moment, this
/// graph forms a tree rooted with the trait itself, with all other nodes
/// representing impls, and parent-child relationships representing
/// specializations.
Object.assign(Graph, {
  // rustc: compiler/rustc_middle/src/traits/specialization_graph.rs:37 new
  new(): Graph {
    return new Graph(new DefIdMap(), new DefIdMap());
  },
});

/// The parent of a given impl, which is the `DefId` of the trait when the
/// impl is a "specialization root".
// PORT: `fn parent` is `parent_()`: the generated class has the field `parent` (precedent: rustc_hir hir.ts `args_`).
// rustc: compiler/rustc_middle/src/traits/specialization_graph.rs:44 parent
Graph.prototype.parent_ = function (this: Graph, child: DefId): DefId {
  const p = this.parent.get(child);
  if (p === undefined) return panic(`Failed to get parent for ${debug_DefId(child, PLAIN)}`);
  return p;
};

/// What kind of overlap check are we doing -- this exists just for testing and feature-gating
/// purposes.
export type OverlapMode = gen.OverlapMode;
export const OverlapMode = {
  ...gen.OverlapMode,

  // rustc: compiler/rustc_middle/src/traits/specialization_graph.rs:62 get
  get(tcx: TyCtxt, trait_id: DefId): OverlapMode {
    const with_negative_coherence = tcx.features().with_negative_coherence();
    // `find_attr!(tcx, trait_id, RustcStrictCoherence(span) => *span)`
    const strict_coherence = find_attr(ty_mod().HasAttrs_DefId.get_attrs(trait_id, tcx), (k) =>
      k.$ === "RustcStrictCoherence" ? k._0 : undefined,
    );

    if (with_negative_coherence) {
      if (strict_coherence !== undefined) {
        return "Strict";
      } else {
        return "WithNegative";
      }
    } else {
      if (strict_coherence !== undefined) {
        const span: Span = strict_coherence;
        tcx.dcx().emit_err(
          StrictCoherenceNeedsNegativeCoherence_diagnostic({
            span: tcx.def_span(trait_id),
            attr_span: span,
          }),
        );
      }
      return "Stable";
    }
  },

  // rustc: compiler/rustc_middle/src/traits/specialization_graph.rs:79 use_negative_impl
  use_negative_impl(self: OverlapMode): boolean {
    return self === "Strict" || self === "WithNegative";
  },

  // rustc: compiler/rustc_middle/src/traits/specialization_graph.rs:83 use_implicit_negative
  use_implicit_negative(self: OverlapMode): boolean {
    return self === "Stable" || self === "WithNegative";
  },
};

/// Children of a given impl, grouped into blanket/non-blanket varieties as is
/// done in `TraitDef`.
export type Children = gen.Children;
export const Children = {
  /** `#[derive(Default)]`. PORT: `FxIndexMap<SimplifiedType, ..>` keys compare by value: a `KeyedMap` on the canonical
   *  `intern_key` (rust_ts/intern_key.ts). */
  default_(): Children {
    return { non_blanket_impls: new KeyedMap<SimplifiedType<DefId>, DefId[]>(intern_key), blanket_impls: [] };
  },
};

/// A node in the specialization graph is either an impl or a trait
/// definition; either can serve as a source of item definitions.
/// There is always exactly one trait definition node: the root.
export type Node = gen.Node;
export const Node = {
  // rustc: compiler/rustc_middle/src/traits/specialization_graph.rs:118 is_from_trait
  is_from_trait(self: Node): boolean {
    return self.$ === "Trait";
  },

  /// Tries to find the associated item that implements `trait_item_def_id`
  /// defined in this node.
  ///
  /// If this returns `None`, the item can potentially still be found in
  /// parents of this node.
  // rustc: compiler/rustc_middle/src/traits/specialization_graph.rs:127 item
  item(self: Node, tcx: TyCtxt, trait_item_def_id: DefId): AssocItem | undefined {
    switch (self.$) {
      case "Trait":
        // PORT: the query value is typed `unknown` until queries.gen.ts knows `ty::AssocItem`.
        return tcx.associated_item(trait_item_def_id) as AssocItem;
      case "Impl": {
        const impl_def_id = self._0;
        const id = tcx.impl_item_implementor_ids(impl_def_id).get(trait_item_def_id);
        if (id === undefined) return undefined;
        return tcx.associated_item(id) as AssocItem;
      }
    }
  },

  // rustc: compiler/rustc_middle/src/traits/specialization_graph.rs:137 def_id
  def_id(self: Node): DefId {
    switch (self.$) {
      case "Impl":
        return self._0;
      case "Trait":
        return self._0;
    }
  },
};

// `impl Iterator for Ancestors<'_>`
// rustc: compiler/rustc_middle/src/traits/specialization_graph.rs:155 next
Ancestors.prototype.next = function (this: Ancestors): Node | undefined {
  const cur = this.current_source;
  this.current_source = undefined;
  if (cur !== undefined && cur.$ === "Impl") {
    const cur_impl = cur._0;
    // Graph construction may skip foreign impls, so resolve a foreign impl's
    // parent from crate metadata instead; recorded foreign impls use the same
    // value (see `record_impl_from_cstore`).
    const parent = cur_impl.is_local()
      ? this.specialization_graph.parent_(cur_impl)
      : (this.tcx.impl_parent(cur_impl) ?? this.trait_def_id);

    this.current_source = DefId_eq(parent, this.trait_def_id) ? { $: "Trait", _0: parent } : { $: "Impl", _0: parent };
  }
  return cur;
};

// `LeafDef`: information about the most specialized definition of an associated item.
/// Returns whether this definition is known to not be further specializable.
// rustc: compiler/rustc_middle/src/traits/specialization_graph.rs:215 is_final
LeafDef.prototype.is_final = function (this: LeafDef): boolean {
  return this.finalizing_node !== undefined;
};

/// Finds the bottom-most (i.e. most specialized) definition of an associated
/// item.
// rustc: compiler/rustc_middle/src/traits/specialization_graph.rs:223 leaf_def
Ancestors.prototype.leaf_def = function (this: Ancestors, tcx: TyCtxt, trait_item_def_id: DefId): LeafDef | undefined {
  let finalizing_node: Node | undefined = undefined;

  // `self.find_map(|node| ..)`
  for (let node = this.next(); node !== undefined; node = this.next()) {
    const item = Node.item(node, tcx, trait_item_def_id);
    let found: LeafDef | undefined;
    if (item !== undefined) {
      if (finalizing_node === undefined) {
        const is_specializable =
          Defaultness.is_default(ty_assoc().AssocItem.defaultness(item, tcx)) ||
          Defaultness.is_default(tcx.defaultness(Node.def_id(node)) as Defaultness);

        if (!is_specializable) {
          finalizing_node = node;
        }
      }

      found = new LeafDef(item, node, finalizing_node);
    } else {
      // Item not mentioned. This "finalizes" any defaulted item provided by an ancestor.
      finalizing_node = node;
      found = undefined;
    }
    if (found !== undefined) return found;
  }
  return undefined;
};

/// Walk up the specialization ancestors of a given impl, starting with that
/// impl itself.
///
/// Returns `Err` if an error was reported while building the specialization
/// graph.
// rustc: compiler/rustc_middle/src/traits/specialization_graph.rs:252 ancestors
export function ancestors(tcx: TyCtxt, trait_def_id: DefId, start_from_impl: DefId): Result<Ancestors, ErrorGuaranteed> {
  // PORT: the query value is typed `unknown` until queries.gen.ts knows `specialization_graph::Graph`.
  const specialization_graph_r = tcx.specialization_graph_of(trait_def_id) as Result<Graph, ErrorGuaranteed>;
  if (specialization_graph_r.$ === "Err") return specialization_graph_r;
  const specialization_graph = specialization_graph_r._0;

  const type_of = tcx.type_of(start_from_impl) as EarlyBinder<Ty>;
  const r = TypeVisitableExt.error_reported(
    Unnormalized.skip_normalization(EarlyBinderC.instantiate_identity(type_of)),
    standin_fold_Ty,
  );
  if (r.$ === "Err") {
    const reported = r._0;
    return Err(reported);
  } else {
    return Ok(new Ancestors(tcx, trait_def_id, specialization_graph, { $: "Impl", _0: start_from_impl }));
  }
}

// ---- merge-w15b: lazy loads of the ty modules (ty/mod.ts is a defining module; ty/assoc.ts an extension module) ----
function ty_mod(): typeof import("../ty/mod.ts") {
  return require("../ty/mod.ts") as typeof import("../ty/mod.ts");
}
function ty_assoc(): typeof import("../ty/assoc.ts") {
  return require("../ty/assoc.ts") as typeof import("../ty/assoc.ts");
}


