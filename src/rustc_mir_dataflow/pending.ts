// PORT(contract): stand-ins for types and fns that two lanes running in parallel with dataflow-contract (wave 21) own.
// This file is not a port of an upstream file; root deletes it at merge and repoints its importers
// (docs/handoff/dataflow-contract.md, "For root"):
//
// 1. `pending mir-contract`: the MIR types the framework reads (rustc_middle mir/{mod, basic_blocks, terminator,
//    syntax}.rs). Only the members the dataflow crate touches are declared, with upstream's names: classes (`Body`,
//    `BasicBlocks`, D3) take methods (`body.index(bb)` is `body[bb]`, `body.basic_blocks.predecessors()`), the
//    generated plain-object types (`BasicBlockData`, `Terminator`, `SwitchTargets`) are declared with their methods as
//    members too (`block_data.terminator()`, `terminator.edges()`, `targets.all_targets()`); if mir-contract puts those
//    on companions instead, the call sites become `BasicBlockData.terminator(bbd)` etc. The opaque types are branded so
//    nothing constructs them by accident.
// 2. `pending index-ds`: the `DenseBitSet` methods the framework needs that rustc_index bit_set.ts does not have yet
//    (`union`, `clone`, `clone_from`, `first_set_at_or_after`, `clear`, derived `PartialEq`), plus `MixedBitSet` /
//    `ChunkedBitSet`. They are declared by module augmentation and, when the method is missing at load, installed as
//    shims written against the public `DenseBitSet` API only (never the words, which index-ds is switching to 32-bit
//    `number`s, plan-m4 D6). `MixedBitSet` is the upstream enum (`Small` / `Large`) with its methods on the companion
//    (PORTING §8); its `Large` arm (`ChunkedBitSet`) stops UNPORTED here.
import { DenseBitSet } from "../rustc_index/bit_set.ts";
import { newtype_index } from "../rustc_index/newtype_index.ts";
import type { Debug } from "../std/fmt.ts";
import { assert, assert_eq, panic, unported } from "../std/panic.ts";

// ==== pending mir-contract =========================================================================================

/** A MIR type that mir-contract declares; opaque here. */
type PendingMir<N extends string> = { readonly __pending_mir: N };

// pending: compiler/rustc_middle/src/mir/mod.rs:1299 BasicBlock
export type BasicBlock = number & { readonly __brand: "BasicBlock" };
export const BasicBlock = {
  ...newtype_index<BasicBlock>((n) => `bb${n}`),

  // (mir-contract) mir/mod.rs:1311 start_location
  start_location(self: BasicBlock): Location {
    return { block: self, statement_index: 0 };
  },
};
/** `BasicBlock::START_BLOCK` (`const START_BLOCK = 0`). */
export const START_BLOCK = 0 as BasicBlock;

// pending: compiler/rustc_middle/src/mir/mod.rs Local (`#[debug_format = "_{}"]`)
export type Local = number & { readonly __brand: "Local" };
export const Local = newtype_index<Local>((n) => `_${n}`);
/** `RETURN_PLACE` (`const RETURN_PLACE = 0`). */
export const RETURN_PLACE = 0 as Local;

/// `Location` represents the position of the start of the statement; or, if
/// `statement_index` equals the number of statements, then the start of the
/// terminator.
// pending: compiler/rustc_middle/src/mir/mod.rs:1586 Location
export interface Location {
  /// The block that the location is within.
  block: BasicBlock;

  statement_index: number;
}
/** `impl fmt::Debug for Location` (mir/mod.rs:1594): `{:?}[{}]`. */
export const debug_Location: Debug<Location> = (self, f) => `${BasicBlock.debug(self.block, f)}[${self.statement_index}]`;
/** The derived `PartialOrd` / `Ord` of `Location` (`block`, then `statement_index`). */
export function Location_cmp(a: Location, b: Location): -1 | 0 | 1 {
  if (a.block !== b.block) return a.block < b.block ? -1 : 1;
  if (a.statement_index !== b.statement_index) return a.statement_index < b.statement_index ? -1 : 1;
  return 0;
}

export type Statement = PendingMir<"Statement">;
export type StatementKind = PendingMir<"StatementKind">;
export type Operand = PendingMir<"Operand">;
export type Place = PendingMir<"Place">;
export type PlaceRef = PendingMir<"PlaceRef">;
export type PlaceElem = PendingMir<"PlaceElem">;
/** `ProjectionKind` = `ProjectionElem<(), ()>`. */
export type ProjectionKind = PendingMir<"ProjectionKind">;
export type Rvalue = PendingMir<"Rvalue">;
export type InlineAsmOperand = PendingMir<"InlineAsmOperand">;
export type SourceInfo = PendingMir<"SourceInfo">;
export type LocalDecl = PendingMir<"LocalDecl">;
export type VarDebugInfo = PendingMir<"VarDebugInfo">;
export type BorrowKind = PendingMir<"BorrowKind">;
export type TerminatorKind = PendingMir<"TerminatorKind">;

/// List of places that are written to after a successful (non-unwind) return
/// from a `Call`, `Yield` or `InlineAsm`.
// pending: compiler/rustc_middle/src/mir/terminator.rs:711 CallReturnPlaces
export type CallReturnPlaces =
  | { $: "Call"; _0: Place }
  | { $: "Yield"; _0: Place }
  | { $: "InlineAsm"; _0: readonly InlineAsmOperand[] };

// pending: compiler/rustc_middle/src/mir/syntax.rs SwitchTargets
export interface SwitchTargets {
  /** `SwitchTargets::iter` (terminator.rs:58): `(value, target)` pairs, without the otherwise target. */
  iter(): Iterable<[bigint, BasicBlock]>;
  /** `SwitchTargets::otherwise` (terminator.rs:47). */
  otherwise(): BasicBlock;
  /** `SwitchTargets::all_targets` (terminator.rs:64). */
  all_targets(): readonly BasicBlock[];
}

// pending: compiler/rustc_middle/src/mir/terminator.rs:688 TerminatorEdges
export type TerminatorEdges =
  /// For terminators that have no successor, like `return`.
  | { $: "None" }
  /// For terminators that have a single successor, like `goto`, and `assert` without a cleanup
  /// block.
  | { $: "Single"; _0: BasicBlock }
  /// For terminators that have two successors, like `assert` with a cleanup block, and
  /// `falseEdge`.
  | { $: "Double"; _0: BasicBlock; _1: BasicBlock }
  /// Special action for `Yield`, `Call` and `InlineAsm` terminators.
  | {
      $: "AssignOnReturn";
      return_: readonly BasicBlock[];
      /// The cleanup block, if it exists.
      cleanup: BasicBlock | undefined;
      place: CallReturnPlaces;
    }
  /// Special edge for `SwitchInt`.
  | { $: "SwitchInt"; targets: SwitchTargets; discr: Operand };

// pending: compiler/rustc_middle/src/mir/syntax.rs Terminator
export interface Terminator {
  /** `Terminator::edges` (terminator.rs:735). */
  edges(): TerminatorEdges;
}

// pending: compiler/rustc_middle/src/mir/mod.rs BasicBlockData
export interface BasicBlockData {
  /// List of statements in this block.
  statements: Statement[];
  /** `BasicBlockData::terminator` (mir/mod.rs:1372). */
  terminator(): Terminator;
}

// pending: compiler/rustc_middle/src/mir/basic_blocks.rs BasicBlocks
export interface BasicBlocks {
  /** `IndexSlice::len` through `Deref`. */
  len(): number;
  /** `BasicBlocks::predecessors` (basic_blocks.rs:44): `IndexVec<BasicBlock, SmallVec<[BasicBlock; 4]>>`. */
  predecessors(): readonly (readonly BasicBlock[])[];
  /** `BasicBlocks::reverse_postorder` (basic_blocks.rs:64). */
  reverse_postorder(): readonly BasicBlock[];
}

// pending: compiler/rustc_middle/src/mir/mod.rs Body
export interface Body {
  basic_blocks: BasicBlocks;
  /** `impl Index<BasicBlock> for Body` (mir/mod.rs:760): `body[bb]`. */
  index(bb: BasicBlock): BasicBlockData;
  /** `Body::terminator_loc` (mir/mod.rs:543). */
  terminator_loc(bb: BasicBlock): Location;
}

// ==== pending index-ds =============================================================================================

declare module "../rustc_index/bit_set.ts" {
  interface DenseBitSet<T extends number = number> {
    /** `DenseBitSet::clear` (bit_set.rs:119). */
    clear(): void;
    /** `DenseBitSet::first_set_at_or_after` (bit_set.rs:260). */
    first_set_at_or_after(elem: T): T | undefined;
    /** `DenseBitSet::union` (bit_set.rs:320): returns true if `self` was modified. */
    union(other: DenseBitSet<T>): boolean;
    /** `DenseBitSet::subtract` (bit_set.rs:326): returns true if `self` was modified. */
    subtract(other: DenseBitSet<T>): boolean;
    /** `impl Clone for DenseBitSet` (bit_set.rs:338). */
    clone(): DenseBitSet<T>;
    /** `impl Clone for DenseBitSet` `clone_from` (bit_set.rs:347). */
    clone_from(from: DenseBitSet<T>): void;
  }
}

/** The derived `PartialEq` of `DenseBitSet` (`domain_size`, then the words: equal sets of one domain). */
export function DenseBitSet_eq<T extends number>(a: DenseBitSet<T>, b: DenseBitSet<T>): boolean {
  if (a.domain_size() !== b.domain_size()) return false;
  const xs = [...a.iter()];
  const ys = [...b.iter()];
  return xs.length === ys.length && xs.every((x, i) => x === ys[i]);
}

/** `impl Debug for DenseBitSet` (bit_set.rs:353): `debug_list` of the elements. */
export function debug_DenseBitSet<T extends number>(elem: Debug<T>): Debug<DenseBitSet<T>> {
  return (self, f) => {
    const items = [...self.iter()].map((e) => elem(e, f));
    if (f.alternate) return items.length === 0 ? "[]" : `[\n${items.map((s) => `    ${s},\n`).join("")}]`;
    return `[${items.join(", ")}]`;
  };
}

type Shims = { [K in "clear" | "first_set_at_or_after" | "union" | "subtract" | "clone" | "clone_from"]: unknown };
const shims: Shims = {
  clear(this: DenseBitSet) {
    for (const e of [...this.iter()]) this.remove(e);
  },
  first_set_at_or_after(this: DenseBitSet, elem: number) {
    assert(elem < this.domain_size(), "assertion failed: elem.index() < self.domain_size");
    for (let i = elem; i < this.domain_size(); i++) if (this.contains(i)) return i;
    return undefined;
  },
  union(this: DenseBitSet, other: DenseBitSet) {
    assert_eq(this.domain_size(), other.domain_size(), String);
    let changed = false;
    for (const e of [...other.iter()]) changed = this.insert(e) || changed;
    return changed;
  },
  subtract(this: DenseBitSet, other: DenseBitSet) {
    assert_eq(this.domain_size(), other.domain_size(), String);
    let changed = false;
    for (const e of [...other.iter()]) changed = this.remove(e) || changed;
    return changed;
  },
  clone(this: DenseBitSet) {
    const r = DenseBitSet.new_empty(this.domain_size());
    for (const e of this.iter()) r.insert(e);
    return r;
  },
  clone_from(this: DenseBitSet, from: DenseBitSet) {
    // The shim keeps the domain size (every dataflow caller clones between sets of one domain).
    assert_eq(this.domain_size(), from.domain_size(), String);
    for (const e of [...this.iter()]) this.remove(e);
    for (const e of from.iter()) this.insert(e);
  },
};
for (const [name, f] of Object.entries(shims)) {
  const proto = DenseBitSet.prototype as unknown as Record<string, unknown>;
  if (typeof proto[name] !== "function") proto[name] = f;
}

const CHUNK_BITS = 2048;

/// A fixed-size bitset type with a partially dense, partially sparse
/// representation. (bit_set.rs:466; pending index-ds: every method stops UNPORTED.)
// pending: compiler/rustc_index/src/bit_set.rs:466 ChunkedBitSet
export class ChunkedBitSet<T extends number = number> {
  declare readonly __t?: T;
  private constructor() {}
  static new_empty<T extends number>(_domain_size: number): ChunkedBitSet<T> {
    return unported("rustc_index::bit_set::ChunkedBitSet (pending index-ds)");
  }
  domain_size(): number {
    return unported("rustc_index::bit_set::ChunkedBitSet (pending index-ds)");
  }
  contains(_elem: T): boolean {
    return unported("rustc_index::bit_set::ChunkedBitSet (pending index-ds)");
  }
  iter(): Iterable<T> {
    return unported("rustc_index::bit_set::ChunkedBitSet (pending index-ds)");
  }
}

// pending: compiler/rustc_index/src/bit_set.rs:1068 MixedBitSet
export type MixedBitSet<T extends number = number> = { $: "Small"; _0: DenseBitSet<T> } | { $: "Large"; _0: ChunkedBitSet<T> };
export const MixedBitSet = {
  domain_size<T extends number>(self: MixedBitSet<T>): number {
    return self._0.domain_size();
  },
  new_empty<T extends number>(domain_size: number): MixedBitSet<T> {
    if (domain_size <= CHUNK_BITS) {
      return { $: "Small", _0: DenseBitSet.new_empty<T>(domain_size) };
    } else {
      return { $: "Large", _0: ChunkedBitSet.new_empty<T>(domain_size) };
    }
  },
  is_empty<T extends number>(self: MixedBitSet<T>): boolean {
    return self.$ === "Small" ? self._0.is_empty() : unported("rustc_index::bit_set::ChunkedBitSet (pending index-ds)");
  },
  contains<T extends number>(self: MixedBitSet<T>, elem: T): boolean {
    return self._0.contains(elem);
  },
  insert<T extends number>(self: MixedBitSet<T>, elem: T): boolean {
    return self.$ === "Small" ? self._0.insert(elem) : unported("rustc_index::bit_set::ChunkedBitSet (pending index-ds)");
  },
  remove<T extends number>(self: MixedBitSet<T>, elem: T): boolean {
    return self.$ === "Small" ? self._0.remove(elem) : unported("rustc_index::bit_set::ChunkedBitSet (pending index-ds)");
  },
  iter<T extends number>(self: MixedBitSet<T>): Iterable<T> {
    return self._0.iter();
  },
  union<T extends number>(self: MixedBitSet<T>, other: MixedBitSet<T>): boolean {
    if (self.$ === "Small" && other.$ === "Small") return self._0.union(other._0);
    if (self.$ === "Large" && other.$ === "Large") return unported("rustc_index::bit_set::ChunkedBitSet (pending index-ds)");
    return panic("MixedBitSet size mismatch");
  },
  clone<T extends number>(self: MixedBitSet<T>): MixedBitSet<T> {
    return self.$ === "Small" ? { $: "Small", _0: self._0.clone() } : unported("rustc_index::bit_set::ChunkedBitSet (pending index-ds)");
  },
  clone_from<T extends number>(self: MixedBitSet<T>, from: MixedBitSet<T>): void {
    if (self.$ === "Small" && from.$ === "Small") return self._0.clone_from(from._0);
    if (self.$ === "Large" && from.$ === "Large") return unported("rustc_index::bit_set::ChunkedBitSet (pending index-ds)");
    return panic("MixedBitSet size mismatch");
  },
  /** The derived `PartialEq`. */
  eq<T extends number>(a: MixedBitSet<T>, b: MixedBitSet<T>): boolean {
    if (a.$ === "Small" && b.$ === "Small") return DenseBitSet_eq(a._0, b._0);
    if (a.$ === "Large" && b.$ === "Large") return unported("rustc_index::bit_set::ChunkedBitSet (pending index-ds)");
    return false;
  },
};
