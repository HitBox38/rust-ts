// Port of compiler/rustc_type_ir/src/search_graph/stack.rs (lane tyir-solve).
//
// PORT: `IndexVec<StackDepth, StackEntry<X>>` is a `StackEntry<X>[]` indexed by the `StackDepth` number (PORTING §5).
// PORT: `X::Input: Eq` is `===` (search_graph/mod.ts `Cx`: an input is an interned object or a primitive).
import { newtype_index } from "../../rustc_index/newtype_index.ts";
import type { Debug } from "../../std/fmt.ts";
import { unwrap } from "../../std/panic.ts";
import type {
  AvailableDepth,
  CandidateHeadUsages,
  CxTypes,
  CycleHeads,
  HeadUsages,
  NestedGoals,
  PathKind,
  RequiredDepth,
} from "./mod.ts";

// rustc_index::newtype_index! { #[orderable] #[gate_rustc_only] pub(super) struct StackDepth {} }
export type StackDepth = number & { readonly __brand: "StackDepth" };
export const StackDepth = newtype_index<StackDepth>((n) => `${n}`);
export const debug_StackDepth: Debug<StackDepth> = StackDepth.debug;

/// Stack entries of the evaluation stack. Its fields tend to be lazily updated
/// when popping a child goal or completely immutable.
export class StackEntry<X extends CxTypes> {
  constructor(
    public input: X["Input"],

    /// Whether proving this goal is a coinductive step.
    ///
    /// This is used when encountering a trait solver cycle to
    /// decide whether the initial provisional result of the cycle.
    public step_kind_from_parent: PathKind,

    /// The available depth of a given goal, immutable.
    public available_depth: AvailableDepth,

    /// The minimum available depth encountered while evaluating this goal's nested goals.
    /// If there's no nested goal, this is equal to the `available_depth`.
    public min_reached_available_depth: AvailableDepth,

    /// Starts out as `None` and gets set when rerunning this
    /// goal in case we encounter a cycle.
    public provisional_result: X["Result"] | undefined,

    /// All cycle heads this goal depends on. Lazily updated and only
    /// up-to date for the top of the stack.
    public heads: CycleHeads,

    /// Whether evaluating this goal encountered overflow. Lazily updated.
    public encountered_overflow: boolean,

    /// Whether and how this goal has been used as a cycle head. Lazily updated.
    public usages: HeadUsages | undefined,

    /// We want to be able to ignore head usages if they happen inside of candidates
    /// which don't impact the result of a goal. This enables us to avoid rerunning goals
    /// and is also used when rebasing provisional cache entries.
    ///
    /// To implement this, we track all usages while evaluating a candidate. If this candidate
    /// then ends up ignored, we manually remove its usages from `usages` and `heads`.
    public candidate_usages: CandidateHeadUsages | undefined,

    /// The nested goals of this goal, see the doc comment of the type.
    public nested_goals: NestedGoals<X>,
  ) {}

  // rustc: compiler/rustc_type_ir/src/search_graph/stack.rs:63 required_depth
  required_depth(): RequiredDepth {
    return (this.available_depth - this.min_reached_available_depth) as RequiredDepth;
  }
}

/// The stack of goals currently being computed.
///
/// An element is *deeper* in the stack if its index is *lower*.
///
/// Only the last entry of the stack is mutable. All other entries get
/// lazily updated in `update_parent_goal`.
export class Stack<X extends CxTypes> {
  constructor(public entries: StackEntry<X>[]) {}

  /** `#[derive_where(Default)]` */
  static default_<X extends CxTypes>(): Stack<X> {
    return new Stack<X>([]);
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/stack.rs:80 is_empty
  is_empty(): boolean {
    return this.entries.length === 0;
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/stack.rs:84 len
  len(): number {
    return this.entries.length;
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/stack.rs:88 last
  last(): StackEntry<X> | undefined {
    return this.entries[this.entries.length - 1];
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/stack.rs:92 last_mut
  last_mut(): StackEntry<X> | undefined {
    return this.entries[this.entries.length - 1];
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/stack.rs:96 last_mut_with_index
  last_mut_with_index(): [StackDepth, StackEntry<X>] | undefined {
    // `self.entries.last_index()`
    const idx = this.entries.length === 0 ? undefined : StackDepth.from_usize(this.entries.length - 1);
    return idx === undefined ? undefined : [idx, this.entries[idx]!];
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/stack.rs:100 next_index
  next_index(): StackDepth {
    return StackDepth.from_usize(this.entries.length);
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/stack.rs:104 push
  push(entry: StackEntry<X>): StackDepth {
    // PORT: `if cfg!(debug_assertions) && self.entries.iter().any(|e| e.input == entry.input) { panic!(..) }`:
    // the oracle is a release build, so the check is compiled out.
    // `IndexVec::push` returns the index of the new element.
    const idx = StackDepth.from_usize(this.entries.length);
    this.entries.push(entry);
    return idx;
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/stack.rs:111 pop
  pop(): StackEntry<X> {
    return unwrap(this.entries.pop());
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/stack.rs:115 cycle_step_kinds
  cycle_step_kinds(head: StackDepth): PathKind[] {
    return this.entries.slice(StackDepth.index(head) + 1).map((entry) => entry.step_kind_from_parent);
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/stack.rs:119 iter
  iter(): readonly StackEntry<X>[] {
    return this.entries;
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/stack.rs:123 find
  find(input: X["Input"]): StackDepth | undefined {
    const idx = this.entries.findIndex((e) => e.input === input);
    return idx === -1 ? undefined : StackDepth.from_usize(idx);
  }

  // impl Index<StackDepth> for Stack<X>
  // rustc: compiler/rustc_type_ir/src/search_graph/stack.rs:130 index
  index(index: StackDepth): StackEntry<X> {
    return unwrap(this.entries[index], `index out of bounds: the len is ${this.entries.length} but the index is ${index}`);
  }
}
