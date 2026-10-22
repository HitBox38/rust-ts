// Port of compiler/rustc_mir_build/src/builder/matches/user_ty.rs: DECLARED (lane builder-contract, plan-m4 wave 22). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// mb-matches-c; docs/handoff/builder-contract.md has the split table, the conventions and "How to fill a stub"
// (builder/mod.ts's header has the representation notes).
import { type UserTypeProjections } from "../../../rustc_middle/mir/mod.ts";
import { type AdtDef, type FieldIdx, type VariantIdx } from "../../../rustc_middle/ty/decls.ts";
import { type ProjectedUserTypesOp, type UserTypeIndices } from "./user_ty.gen.ts";
import { Builder } from "../mod.ts";
import { unported } from "../../../std/panic.ts";
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
  iter_ops_reversed(self: ProjectedUserTypesNode): Iterable<ProjectedUserTypesOp>;
  // user_ty.rs:96 (lane mb-matches-c)
  build_user_type_projections(self: ProjectedUserTypesNode): UserTypeProjections | undefined;
}
export type ProjectedUserTypesNode = gen.ProjectedUserTypesNode;
export const ProjectedUserTypesNode = gen.ProjectedUserTypesNode as typeof gen.ProjectedUserTypesNode & ProjectedUserTypesNode_methods;

// stub: compiler/rustc_mir_build/src/builder/matches/user_ty.rs:39 push_user_types (lane mb-matches-c)
ProjectedUserTypesNode.push_user_types = function (self: ProjectedUserTypesNode, base_types: UserTypeIndices): ProjectedUserTypesNode {
  return unported("rustc_mir_build::builder::matches::user_ty::ProjectedUserTypesNode::push_user_types");
};

// stub: compiler/rustc_mir_build/src/builder/matches/user_ty.rs:46 maybe_push (lane mb-matches-c)
ProjectedUserTypesNode.maybe_push = function (self: ProjectedUserTypesNode, op_fn: () => ProjectedUserTypesOp): ProjectedUserTypesNode {
  return unported("rustc_mir_build::builder::matches::user_ty::ProjectedUserTypesNode::maybe_push");
};

// stub: compiler/rustc_mir_build/src/builder/matches/user_ty.rs:53 index (lane mb-matches-c)
ProjectedUserTypesNode.index = function (self: ProjectedUserTypesNode): ProjectedUserTypesNode {
  return unported("rustc_mir_build::builder::matches::user_ty::ProjectedUserTypesNode::index");
};

// stub: compiler/rustc_mir_build/src/builder/matches/user_ty.rs:57 subslice (lane mb-matches-c)
ProjectedUserTypesNode.subslice = function (self: ProjectedUserTypesNode, from: number, to: number): ProjectedUserTypesNode {
  return unported("rustc_mir_build::builder::matches::user_ty::ProjectedUserTypesNode::subslice");
};

// stub: compiler/rustc_mir_build/src/builder/matches/user_ty.rs:61 deref (lane mb-matches-c)
ProjectedUserTypesNode.deref = function (self: ProjectedUserTypesNode): ProjectedUserTypesNode {
  return unported("rustc_mir_build::builder::matches::user_ty::ProjectedUserTypesNode::deref");
};

// stub: compiler/rustc_mir_build/src/builder/matches/user_ty.rs:65 leaf (lane mb-matches-c)
ProjectedUserTypesNode.leaf = function (self: ProjectedUserTypesNode, field: FieldIdx): ProjectedUserTypesNode {
  return unported("rustc_mir_build::builder::matches::user_ty::ProjectedUserTypesNode::leaf");
};

// stub: compiler/rustc_mir_build/src/builder/matches/user_ty.rs:69 variant (lane mb-matches-c)
ProjectedUserTypesNode.variant = function (self: ProjectedUserTypesNode, adt_def: AdtDef, variant: VariantIdx, field: FieldIdx): ProjectedUserTypesNode {
  return unported("rustc_mir_build::builder::matches::user_ty::ProjectedUserTypesNode::variant");
};

// stub: compiler/rustc_mir_build/src/builder/matches/user_ty.rs:84 iter_ops_reversed (lane mb-matches-c)
ProjectedUserTypesNode.iter_ops_reversed = function (self: ProjectedUserTypesNode): Iterable<ProjectedUserTypesOp> {
  return unported("rustc_mir_build::builder::matches::user_ty::ProjectedUserTypesNode::iter_ops_reversed");
};

// stub: compiler/rustc_mir_build/src/builder/matches/user_ty.rs:96 build_user_type_projections (lane mb-matches-c)
ProjectedUserTypesNode.build_user_type_projections = function (self: ProjectedUserTypesNode): UserTypeProjections | undefined {
  return unported("rustc_mir_build::builder::matches::user_ty::ProjectedUserTypesNode::build_user_type_projections");
};
