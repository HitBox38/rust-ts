// Port of compiler/rustc_mir_build/src/builder/matches/user_ty.rs (lane mb-matches-c; declared by builder-contract).
// The enums are generated (user_ty.gen.ts); `impl ProjectedUserTypesNode` goes on the companion (PORTING §8).
//! Helper code for building a linked list of user-type projections on the
//! stack while visiting a THIR pattern.
//!
//! This avoids having to repeatedly clone a partly-built [`UserTypeProjections`]
//! at every step of the traversal, which is what the previous code was doing.
import { ProjectionElem, type ProjectionKind, type UserTypeProjection, UserTypeProjections } from "../../../rustc_middle/mir/mod.ts";
import { type AdtDef, type FieldIdx, type VariantIdx } from "../../../rustc_middle/ty/decls.ts";
import { type ProjectedUserTypesOp, type UserTypeIndices, debug_ProjectedUserTypesOp } from "./user_ty.gen.ts";
import { assert, assert_matches } from "../../../std/panic.ts";
import { PLAIN, debug_option } from "../../../std/fmt.ts";
import * as gen from "./user_ty.gen.ts";
export * from "./user_ty.gen.ts";

export interface ProjectedUserTypesNode_methods {
  // user_ty.rs:39 (lane mb-matches-c)
  push_user_types(self: ProjectedUserTypesNode, base_types: UserTypeIndices): ProjectedUserTypesNode;
  // user_ty.rs:46 (lane mb-matches-c)
  maybe_push(self: ProjectedUserTypesNode, op_fn: () => ProjectedUserTypesOp): ProjectedUserTypesNode;
  // user_ty.rs:53 (lane mb-matches-c)
  index(self: ProjectedUserTypesNode): ProjectedUserTypesNode;
  // user_ty.rs:57 (lane mb-matches-c)
  subslice(self: ProjectedUserTypesNode, from: number, to: number): ProjectedUserTypesNode;
  // user_ty.rs:61 (lane mb-matches-c)
  deref(self: ProjectedUserTypesNode): ProjectedUserTypesNode;
  // user_ty.rs:65 (lane mb-matches-c)
  leaf(self: ProjectedUserTypesNode, field: FieldIdx): ProjectedUserTypesNode;
  // user_ty.rs:69 (lane mb-matches-c)
  variant(self: ProjectedUserTypesNode, adt_def: AdtDef, variant: VariantIdx, field: FieldIdx): ProjectedUserTypesNode;
  // user_ty.rs:84 (lane mb-matches-c)
  iter_ops_reversed(self: ProjectedUserTypesNode): Generator<ProjectedUserTypesOp>;
  // user_ty.rs:96 (lane mb-matches-c)
  build_user_type_projections(self: ProjectedUserTypesNode): UserTypeProjections | undefined;
}
export type ProjectedUserTypesNode = gen.ProjectedUserTypesNode;
export const ProjectedUserTypesNode = gen.ProjectedUserTypesNode as typeof gen.ProjectedUserTypesNode & ProjectedUserTypesNode_methods;

// rustc: compiler/rustc_mir_build/src/builder/matches/user_ty.rs:39 push_user_types
ProjectedUserTypesNode.push_user_types = function (self: ProjectedUserTypesNode, base_types: UserTypeIndices): ProjectedUserTypesNode {
  assert(!(base_types.length === 0), "assertion failed: !base_types.is_empty()");
  // Pushing one or more base user types always causes the chain to become non-empty.
  return { $: "Chain", parent: self, op: { $: "PushUserTypes", base_types } };
};

/// Push another projection op onto the chain, but only if it is already non-empty.
// rustc: compiler/rustc_mir_build/src/builder/matches/user_ty.rs:46 maybe_push
ProjectedUserTypesNode.maybe_push = function (self: ProjectedUserTypesNode, op_fn: () => ProjectedUserTypesOp): ProjectedUserTypesNode {
  switch (self.$) {
    case "None":
      return ProjectedUserTypesNode.None;
    case "Chain":
      return { $: "Chain", parent: self, op: op_fn() };
  }
};

// rustc: compiler/rustc_mir_build/src/builder/matches/user_ty.rs:53 index
ProjectedUserTypesNode.index = function (self: ProjectedUserTypesNode): ProjectedUserTypesNode {
  return ProjectedUserTypesNode.maybe_push(self, () => gen.ProjectedUserTypesOp.Index);
};

// rustc: compiler/rustc_mir_build/src/builder/matches/user_ty.rs:57 subslice
ProjectedUserTypesNode.subslice = function (self: ProjectedUserTypesNode, from: number, to: number): ProjectedUserTypesNode {
  return ProjectedUserTypesNode.maybe_push(self, () => ({ $: "Subslice", from, to }));
};

// rustc: compiler/rustc_mir_build/src/builder/matches/user_ty.rs:61 deref
ProjectedUserTypesNode.deref = function (self: ProjectedUserTypesNode): ProjectedUserTypesNode {
  return ProjectedUserTypesNode.maybe_push(self, () => gen.ProjectedUserTypesOp.Deref);
};

// rustc: compiler/rustc_mir_build/src/builder/matches/user_ty.rs:65 leaf
ProjectedUserTypesNode.leaf = function (self: ProjectedUserTypesNode, field: FieldIdx): ProjectedUserTypesNode {
  return ProjectedUserTypesNode.maybe_push(self, () => ({ $: "Leaf", field }));
};

// rustc: compiler/rustc_mir_build/src/builder/matches/user_ty.rs:69 variant
ProjectedUserTypesNode.variant = function (self: ProjectedUserTypesNode, adt_def: AdtDef, variant: VariantIdx, field: FieldIdx): ProjectedUserTypesNode {
  return ProjectedUserTypesNode.maybe_push(self, () => {
    const name = adt_def.variant(variant).name;
    return { $: "Variant", name, variant, field };
  });
};

/// Traverses the chain of nodes to yield each op in the chain.
/// Because this walks from child node to parent node, the ops are
/// naturally yielded in "reverse" order.
// rustc: compiler/rustc_mir_build/src/builder/matches/user_ty.rs:84 iter_ops_reversed
ProjectedUserTypesNode.iter_ops_reversed = function* (self: ProjectedUserTypesNode): Generator<ProjectedUserTypesOp> {
  let next = self;
  for (;;) {
    switch (next.$) {
      case "None":
        return;
      case "Chain": {
        const { parent, op } = next;
        next = parent;
        yield op;
      }
    }
  }
};

/// Assembles this chain of user-type projections into a proper data structure.
// rustc: compiler/rustc_mir_build/src/builder/matches/user_ty.rs:96 build_user_type_projections
ProjectedUserTypesNode.build_user_type_projections = function (self: ProjectedUserTypesNode): UserTypeProjections | undefined {
  // If we know there's nothing to do, just return None immediately.
  if (self.$ === "None") {
    return undefined;
  }

  const ops_reversed = [...ProjectedUserTypesNode.iter_ops_reversed(self)];
  // The "first" op should always be `PushUserType`.
  // Other projections are only added if there is at least one user type.
  const last = ops_reversed[ops_reversed.length - 1];
  assert_matches(last, last !== undefined && last.$ === "PushUserTypes", "Some(ProjectedUserTypesOp::PushUserTypes { .. })", (v) =>
    debug_option(v, PLAIN, debug_ProjectedUserTypesOp),
  );

  const projections: UserTypeProjection[] = [];
  for (let i = ops_reversed.length - 1; i >= 0; i--) {
    const op = ops_reversed[i]!;
    switch (op.$) {
      case "PushUserTypes": {
        const base_types = op.base_types;
        assert(!(base_types.length === 0), "assertion failed: !base_types.is_empty()");
        for (const base of base_types) {
          projections.push({ base, projs: [] });
        }
        break;
      }

      case "Index": {
        for (const p of projections) {
          p.projs.push({ $: "Index", _0: null } satisfies ProjectionKind);
        }
        break;
      }
      case "Subslice": {
        const { from, to } = op;
        for (const p of projections) {
          p.projs.push({ $: "Subslice", from, to, from_end: true });
        }
        break;
      }
      case "Deref": {
        for (const p of projections) {
          p.projs.push(ProjectionElem.Deref);
        }
        break;
      }
      case "Leaf": {
        const { field } = op;
        for (const p of projections) {
          p.projs.push({ $: "Field", _0: field, _1: null });
        }
        break;
      }
      case "Variant": {
        const { name, variant, field } = op;
        for (const p of projections) {
          p.projs.push({ $: "Downcast", _0: name, _1: variant });
          p.projs.push({ $: "Field", _0: field, _1: null });
        }
        break;
      }
    }
  }

  return new UserTypeProjections(projections);
};
