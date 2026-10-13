// Port of compiler/rustc_expand/src/placeholders.rs
// (API surface published first; bodies follow in the next commit of lane expand-base.)
import type { NodeId, Visibility } from "../rustc_ast/lib.ts";
import { MutVisitor } from "../rustc_ast/mut_visit.ts";
import { unported } from "../std/panic.ts";
import type { AstFragment, AstFragmentKind } from "./expand.ts";

export function placeholder(_kind: AstFragmentKind, _id: NodeId, _vis: Visibility | undefined): AstFragment {
  return unported("rustc_expand::placeholders::placeholder (expand-base, in progress)");
}

export class PlaceholderExpander extends MutVisitor {
  constructor(public expanded_fragments: Map<NodeId, AstFragment>) {
    super();
  }
  static with_capacity(_capacity: number): PlaceholderExpander {
    return unported("rustc_expand::placeholders::PlaceholderExpander::with_capacity (expand-base, in progress)");
  }
  add(_id: NodeId, _fragment: AstFragment): void {
    return unported("rustc_expand::placeholders::PlaceholderExpander::add (expand-base, in progress)");
  }
}
