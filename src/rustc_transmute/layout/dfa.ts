// Port of compiler/rustc_transmute/src/layout/dfa.rs (lane transmute, wave 30).
//
// PORT:
// - `State(u32)` is a branded number (PORTING §5, interned handles); `State(n)` is `State.of(n)`. The process-wide
//   `AtomicU32` counter of `State::new` is a module-level `let`.
// - `Map<State, _>` is a `Map`; `Map<Reference<R, T>, State>` and the tuple-keyed maps / sets of `union` are
//   `KeyedMap` / `KeyedSet` (rust_ts/keyed.ts) over the intern key / the pair of state numbers.
// - `Byte` is `Copy`: `EdgeSet::iter` (`.copied()`) yields fresh copies, which `UnionIter` writes through `peek_mut`
//   (layout/mod.ts module comment).
// - Iterators are lazy as upstream (generators); `UnionIter` implements the JS iterator protocol (`next` returns an
//   `IteratorResult` where Rust returns an `Option`). `Peekable` is a local minimal port of `std::iter::Peekable`
//   (`peek_mut` / `next`).
// - `R: Region` / `T: Type` are erased (lib.ts crate comment); `Debug` takes `debug_R` / `debug_T`.

import { intern_key, intern_key_eq } from "../../rust_ts/intern_key.ts";
import { KeyedMap, KeyedSet } from "../../rust_ts/keyed.ts";
import { debug_struct, debug_tuple, debug_vec, type Debug, type Fmt } from "../../std/fmt.ts";
import { assert, assert_eq, unreachable } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { Byte, Byte_cmp, Byte_eq, clone_Byte, debug_Byte, debug_Reference, type RangeInclusive_u8, type Reference, Uninhabited } from "./mod.ts";
import type { Tree } from "./tree.ts";

// #[cfg(test)]
// mod tests;

/** The `Map<Reference<R, T>, State>` of `Transitions::ref_transitions` (module comment). */
function ref_map<R, T>(entries?: Iterable<readonly [Reference<R, T>, State]>): Map<Reference<R, T>, State> {
  return new KeyedMap<Reference<R, T>, State>(intern_key, entries);
}

/** The key of an `(Option<State>, Option<State>)` / `(State, State)` pair (module comment). PORT (perf): a number
 * while both states are below 2^26 (`None` is 0, `Some(s)` is `s + 1`), else a string; the two kinds never collide. */
export function state_pair_key([a, b]: readonly [State | undefined, State | undefined]): number | string {
  const x = a === undefined ? 0 : a + 1;
  const y = b === undefined ? 0 : b + 1;
  return x <= 0x4000000 && y <= 0x4000000 ? x * 0x8000000 + y : `${x},${y}`;
}

// #[derive(PartialEq)]
// #[cfg_attr(test, derive(Clone))]
export class Dfa<R, T> {
  constructor(
    public transitions: Map<State, Transitions<R, T>>,
    public start: State,
    public accept: State,
  ) {}

  // #[cfg(test)]
  // rustc: compiler/rustc_transmute/src/layout/dfa.rs:68 bool
  static bool<R, T>(): Dfa<R, T> {
    return Dfa.from_transitions((accept) => new Transitions(EdgeSet.new(Byte.new([0x00, 0x01]), accept), ref_map()));
  }

  // rustc: compiler/rustc_transmute/src/layout/dfa.rs:75 unit
  static unit<R, T>(): Dfa<R, T> {
    const transitions: Map<State, Transitions<R, T>> = new Map();
    const start = State.new();
    const accept = start;

    return new Dfa(transitions, start, accept);
  }

  // rustc: compiler/rustc_transmute/src/layout/dfa.rs:83 from_byte
  static from_byte<R, T>(byte: Byte): Dfa<R, T> {
    return Dfa.from_transitions((accept) => new Transitions(EdgeSet.new(byte, accept), ref_map()));
  }

  // rustc: compiler/rustc_transmute/src/layout/dfa.rs:90 from_ref
  static from_ref<R, T>(r: Reference<R, T>): Dfa<R, T> {
    return Dfa.from_transitions((accept) => new Transitions(EdgeSet.empty(), ref_map([[r, accept]])));
  }

  // rustc: compiler/rustc_transmute/src/layout/dfa.rs:97 from_transitions
  static from_transitions<R, T>(f: (s: State) => Transitions<R, T>): Dfa<R, T> {
    const start = State.new();
    const accept = State.new();

    return new Dfa(new Map([[start, f(accept)]]), start, accept);
  }

  // rustc: compiler/rustc_transmute/src/layout/dfa.rs:104 from_tree
  static from_tree<R, T>(tree: Tree<never, R, T>): Result<Dfa<R, T>, Uninhabited> {
    switch (tree.$) {
      case "Byte":
        return Ok(Dfa.from_byte(tree._0));
      case "Ref":
        return Ok(Dfa.from_ref(tree._0));
      case "Alt": {
        // Convert and filter the inhabited alternatives.
        // PORT: `alts.into_iter().map(Self::from_tree).filter_map(Result::ok)`, then `alts.next()` and
        // `alts.fold(dfa, |dfa, alt| dfa.union(alt, State::new))`, in the same (lazy) order.
        let dfa: Dfa<R, T> | undefined = undefined;
        for (const alt_ of tree._0) {
          const alt_r = Dfa.from_tree(alt_);
          if (alt_r.$ !== "Ok") continue;
          const alt = alt_r._0;
          if (dfa === undefined) {
            dfa = alt;
          } else {
            // Combine the remaining alternatives with `dfa`.
            dfa = dfa.union(alt, State.new);
          }
        }
        // If there are no alternatives, return `Uninhabited`.
        if (dfa === undefined) return Err(Uninhabited.INSTANCE);
        return Ok(dfa);
      }
      case "Seq": {
        let dfa = Dfa.unit<R, T>();
        for (const elt_ of tree._0) {
          const elt = Dfa.from_tree(elt_);
          if (elt.$ === "Err") return elt;
          dfa = dfa.concat(elt._0);
        }
        return Ok(dfa);
      }
      case "Def":
        // `Tree<!, R, T>` has no `Def` nodes.
        return unreachable();
    }
  }

  /// Concatenate two `Dfa`s.
  // rustc: compiler/rustc_transmute/src/layout/dfa.rs:127 concat
  concat(other: Dfa<R, T>): Dfa<R, T> {
    if (this.start === this.accept) {
      return other;
    } else if (other.start === other.accept) {
      return this;
    }

    const start = this.start;
    const accept = other.accept;

    const transitions: Map<State, Transitions<R, T>> = this.transitions;

    for (const [source, transition] of other.transitions) {
      const fix_state = (state: State): State => (state === other.start ? this.accept : state);
      const byte_transitions = transition.byte_transitions.map_states(fix_state);
      const ref_transitions = ref_map<R, T>([...transition.ref_transitions].map(([r, state]) => [r, fix_state(state)] as const));

      const key = fix_state(source);
      const old = transitions.get(key);
      transitions.set(key, new Transitions(byte_transitions, ref_transitions));
      assert(old === undefined, "assertion failed: old.is_none()");
    }

    return new Dfa(transitions, start, accept);
  }

  /// Compute the union of two `Dfa`s.
  // rustc: compiler/rustc_transmute/src/layout/dfa.rs:157 union
  union(other: Dfa<R, T>, new_state: () => State): Dfa<R, T> {
    // We implement `union` by lazily initializing a set of states
    // corresponding to the product of states in `self` and `other`, and
    // then add transitions between these states that correspond to where
    // they exist between `self` and `other`.

    const a = this;
    const b = other;

    const accept = new_state();

    const mapping = new KeyedMap<[State | undefined, State | undefined], State>(state_pair_key);

    const mapped = ([a_state, b_state]: [State | undefined, State | undefined]): State => {
      if (a.accept === a_state || b.accept === b_state) {
        // If either `a_state` or `b_state` are accepting, map to a
        // common `accept` state.
        return accept;
      } else {
        // `*mapping.entry((a_state, b_state)).or_insert_with(&mut new_state)`
        const k: [State | undefined, State | undefined] = [a_state, b_state];
        let s = mapping.get(k);
        if (s === undefined) {
          s = new_state();
          mapping.set(k, s);
        }
        return s;
      }
    };

    const start = mapped([a.start, b.start]);
    const transitions: Map<State, Transitions<R, T>> = new Map();
    const empty_transitions = Transitions.default_<R, T>();

    class WorkQueue {
      constructor(
        public queue: [State | undefined, State | undefined][],
        // Track all entries ever enqueued to avoid duplicating work. This
        // gives us a guarantee that a given (a_state, b_state) pair will
        // only ever be visited once.
        public enqueued: KeyedSet<[State | undefined, State | undefined]>,
      ) {}

      // rustc: compiler/rustc_transmute/src/layout/dfa.rs:192 enqueue
      enqueue(a_state: State | undefined, b_state: State | undefined): void {
        // `if self.enqueued.insert((a_state, b_state))`
        const k: [State | undefined, State | undefined] = [a_state, b_state];
        const len = this.enqueued.size;
        this.enqueued.add(k);
        if (this.enqueued.size !== len) {
          this.queue.push([a_state, b_state]);
        }
      }
    }
    const queue = new WorkQueue([], new KeyedSet<[State | undefined, State | undefined]>(state_pair_key));
    queue.enqueue(a.start, b.start);

    while (queue.queue.length > 0) {
      const [a_src, b_src] = queue.queue.pop()!;
      const src = mapped([a_src, b_src]);
      if (src === accept) {
        // While it's possible to have a DFA whose accept state has
        // out-edges, these do not affect the semantics of the DFA, and
        // so there's no point in processing them. Continuing here also
        // has the advantage of guaranteeing that we only ever process a
        // given node in the output DFA once. In particular, with the
        // exception of the accept state, we ensure that we only push a
        // given node to the `queue` once. This allows the following
        // code to assume that we're processing a node we've never
        // processed before, which means we never need to merge two edge
        // sets - we only ever need to construct a new edge set from
        // whole cloth.
        continue;
      }

      const a_transitions = (a_src !== undefined ? a.transitions.get(a_src) : undefined) ?? empty_transitions;
      const b_transitions = (b_src !== undefined ? b.transitions.get(b_src) : undefined) ?? empty_transitions;

      const byte_transitions = a_transitions.byte_transitions.union(b_transitions.byte_transitions, (a_dst, b_dst) => {
        assert(a_dst !== undefined || b_dst !== undefined, "assertion failed: a_dst.is_some() || b_dst.is_some()");

        queue.enqueue(a_dst, b_dst);
        return mapped([a_dst, b_dst]);
      });

      const ref_transitions_keys = [...a_transitions.ref_transitions.keys(), ...b_transitions.ref_transitions.keys()];

      const ref_transitions = ref_map<R, T>(
        ref_transitions_keys.map((ref_transition) => {
          const a_dst = a_transitions.ref_transitions.get(ref_transition);
          const b_dst = b_transitions.ref_transitions.get(ref_transition);

          assert(a_dst !== undefined || b_dst !== undefined, "assertion failed: a_dst.is_some() || b_dst.is_some()");

          queue.enqueue(a_dst, b_dst);
          return [ref_transition, mapped([a_dst, b_dst])] as const;
        }),
      );

      const old = transitions.get(src);
      transitions.set(src, new Transitions(byte_transitions, ref_transitions));
      // See `if src == accept { ... }` above. The comment there explains
      // why this assert is valid.
      assert_eq(old, undefined, (v) => (v === undefined ? "None" : "Some(..)"));
    }

    return new Dfa(transitions, start, accept);
  }

  // rustc: compiler/rustc_transmute/src/layout/dfa.rs:257 get_uninit_edge_dst
  get_uninit_edge_dst(state: State): State | undefined {
    const transitions = this.transitions.get(state);
    if (transitions === undefined) return undefined;
    return transitions.byte_transitions.get_uninit_edge_dst();
  }

  // rustc: compiler/rustc_transmute/src/layout/dfa.rs:262 bytes_from
  bytes_from(start: State): IterableIterator<[Byte, State]> {
    const transitions = this.transitions.get(start);
    return transitions !== undefined ? transitions.byte_transitions.iter() : [][Symbol.iterator]();
  }

  // rustc: compiler/rustc_transmute/src/layout/dfa.rs:269 refs_from
  *refs_from(start: State): Generator<[Reference<R, T>, State]> {
    const transitions = this.transitions.get(start);
    if (transitions !== undefined) {
      for (const [r, s] of transitions.ref_transitions) yield [r, s];
    }
  }

  // #[cfg(test)]
  // rustc: compiler/rustc_transmute/src/layout/dfa.rs:278 from_edges
  static from_edges<R, T>(start_: number, accept_: number, edges: readonly (readonly [number, RangeInclusive_u8 | number | Byte, number])[]): Dfa<R, T> {
    const start = State.of(start_);
    const accept = State.of(accept_);
    const transitions_: Map<State, [Byte, State][]> = new Map();

    for (const [src, edge, dst] of edges) {
      // `transitions.entry(State(src)).or_default().push((edge.clone().into(), State(dst)))`
      let v = transitions_.get(State.of(src));
      if (v === undefined) {
        v = [];
        transitions_.set(State.of(src), v);
      }
      v.push([edge instanceof Byte ? clone_Byte(edge) : Byte.from(edge), State.of(dst)]);
    }

    const transitions: Map<State, Transitions<R, T>> = new Map(
      [...transitions_].map(([src, edges]) => [src, new Transitions<R, T>(EdgeSet.from_edges(edges), ref_map())] as const),
    );

    return new Dfa(transitions, start, accept);
  }
}

/** derive(PartialEq): `IndexMap`'s `PartialEq` ignores the order of the entries. */
export function Dfa_eq<R, T>(a: Dfa<R, T>, b: Dfa<R, T>): boolean {
  if (a.transitions.size !== b.transitions.size) return false;
  for (const [k, v] of a.transitions) {
    const w = b.transitions.get(k);
    if (w === undefined || !Transitions_eq(v, w)) return false;
  }
  return a.start === b.start && a.accept === b.accept;
}

/** derive(Clone) (`#[cfg_attr(test, derive(Clone))]`) */
export function clone_Dfa<R, T>(v: Dfa<R, T>): Dfa<R, T> {
  return new Dfa(
    new Map([...v.transitions].map(([s, t]) => [s, new Transitions(new EdgeSet(t.byte_transitions.runs.map(([b, d]) => [clone_Byte(b), d])), ref_map([...t.ref_transitions]))] as const)),
    v.start,
    v.accept,
  );
}

// #[derive(PartialEq, Clone, Debug)]
export class Transitions<R, T> {
  constructor(
    public byte_transitions: EdgeSet<State>,
    public ref_transitions: Map<Reference<R, T>, State>,
  ) {}

  // impl<R, T> Default for Transitions<R, T>
  // rustc: compiler/rustc_transmute/src/layout/dfa.rs:38 default
  static default_<R, T>(): Transitions<R, T> {
    return new Transitions(EdgeSet.empty(), ref_map());
  }
}
/** derive(PartialEq) */
export function Transitions_eq<R, T>(a: Transitions<R, T>, b: Transitions<R, T>): boolean {
  if (!EdgeSet_eq(a.byte_transitions, b.byte_transitions)) return false;
  if (a.ref_transitions.size !== b.ref_transitions.size) return false;
  for (const [k, v] of a.ref_transitions) {
    if (b.ref_transitions.get(k) !== v) return false;
  }
  return true;
}

/// An identifier for a node in a [`Dfa`].
///
/// The numeric identifier does not encode a byte offset.
// #[derive(Hash, Eq, PartialEq, PartialOrd, Ord, Copy, Clone)]
export type State = number & { readonly __brand: "State" };

/** `static COUNTER: AtomicU32 = AtomicU32::new(0);` (in `State::new`) */
let COUNTER = 0;

export const State = {
  /** `State(n)` */
  of(n: number): State {
    return n as State;
  },

  // rustc: compiler/rustc_transmute/src/layout/dfa.rs:50 new
  new(): State {
    // `COUNTER.fetch_add(1, Ordering::SeqCst)`: the previous value (wrapping at `u32::MAX`).
    const s = COUNTER;
    COUNTER = (COUNTER + 1) >>> 0;
    return s as State;
  },
};

// impl fmt::Debug for State
// rustc: compiler/rustc_transmute/src/layout/dfa.rs:57 fmt
export const debug_State: Debug<State> = (self) => `S_${self}`;

/// Serialize the DFA using the Graphviz DOT format.
// impl<R, T> fmt::Debug for Dfa<R, T>
// rustc: compiler/rustc_transmute/src/layout/dfa.rs:314 fmt
export function debug_Dfa<R, T>(self: Dfa<R, T>, f: Fmt, debug_R: Debug<R>, debug_T: Debug<T>): string {
  let out = "";
  out += "digraph {\n";
  out += "    start [shape = point, style = invis]\n";
  out += `    start -> ${debug_State(self.start, f)}\n`;
  out += `    ${debug_State(self.accept, f)} [shape = doublecircle]\n`;

  for (const [src, transitions] of self.transitions) {
    for (const [t, dst] of transitions.byte_transitions.iter()) {
      out += `    ${debug_State(src, f)} -> ${debug_State(dst, f)} [label="${debug_Byte(t, f)}"]\n`;
    }

    for (const [t, dst] of transitions.ref_transitions) {
      out += `    ${debug_State(src, f)} -> ${debug_State(dst, f)} [label="${debug_Reference(t, f, debug_R, debug_T)}"]\n`;
    }
  }

  out += "}\n";
  return out;
}

// use edge_set::EdgeSet;
// ---- mod edge_set ----
// use smallvec::SmallVec;

/// The set of outbound byte edges associated with a DFA node.
// #[derive(Eq, PartialEq, Clone, Debug)]
export class EdgeSet<S = State> {
  constructor(
    // A sequence of byte edges with contiguous byte values and a common
    // destination is stored as a single run.
    //
    // Runs are non-empty, non-overlapping, and stored in ascending order.
    public runs: [Byte, S][],
  ) {}

  // rustc: compiler/rustc_transmute/src/layout/dfa.rs:351 new
  static new<S>(range: Byte, dst: S): EdgeSet<S> {
    const this_ = new EdgeSet<S>([]);
    if (!range.is_empty()) {
      this_.runs.push([range, dst]);
    }
    return this_;
  }

  // rustc: compiler/rustc_transmute/src/layout/dfa.rs:359 empty
  static empty<S>(): EdgeSet<S> {
    return new EdgeSet<S>([]);
  }

  // #[cfg(test)]
  // PORT: `S: Ord` is a number here (the tests' `u8` / `State`).
  // rustc: compiler/rustc_transmute/src/layout/dfa.rs:364 from_edges
  static from_edges<S extends number>(edges: [Byte, S][]): EdgeSet<S> {
    // `edges.sort()`: tuples compare lexicographically (stable sort).
    edges.sort((x, y) => Byte_cmp(x[0], y[0]) || x[1] - y[1]);
    return new EdgeSet(edges);
  }

  // rustc: compiler/rustc_transmute/src/layout/dfa.rs:372 iter
  iter(): IterableIterator<[Byte, S]> {
    // `self.runs.iter().copied()`
    // PORT (perf): the copies are made up front (an array iterator, not a generator); copying has no side effects.
    return this.runs.map(([b, s]): [Byte, S] => [clone_Byte(b), s])[Symbol.iterator]();
  }

  // rustc: compiler/rustc_transmute/src/layout/dfa.rs:379 get_uninit_edge_dst
  get_uninit_edge_dst(): S | undefined {
    // Uninit is ordered last.
    const last = this.runs[this.runs.length - 1];
    if (last === undefined) return undefined;
    const [range, dst] = last;
    if (range.contains_uninit()) {
      return dst;
    } else {
      return undefined;
    }
  }

  // rustc: compiler/rustc_transmute/src/layout/dfa.rs:388 map_states
  map_states<SS>(f: (s: S) => SS): EdgeSet<SS> {
    return new EdgeSet(this.runs.map(([b, s]): [Byte, SS] => [b, f(s)]));
  }

  /// Unions two edge sets together.
  ///
  /// If `u = a.union(b)`, then for each byte value, `u` will have an edge
  /// with that byte value and with the destination `join(Some(_), None)`,
  /// `join(None, Some(_))`, or `join(Some(_), Some(_))` depending on whether `a`,
  /// `b`, or both have an edge with that byte value.
  ///
  /// If neither `a` nor `b` have an edge with a particular byte value,
  /// then no edge with that value will be present in `u`.
  // rustc: compiler/rustc_transmute/src/layout/dfa.rs:401 union
  union(other: EdgeSet<S>, join: (x: S | undefined, y: S | undefined) => S): EdgeSet<S> {
    const runs: [Byte, S][] = [];
    const xs = this.iter();
    const ys = other.iter();
    for (const [range, [x, y]] of union(xs, ys)) {
      const state = join(x, y);
      const last = runs[runs.length - 1];
      // Merge contiguous runs with a common destination.
      if (last !== undefined && last[0].end === range.start && last[1] === state) {
        last[0].end = range.end;
      } else {
        runs.push([range, state]);
      }
    }
    return new EdgeSet(runs);
  }
}
/** derive(PartialEq) */
export function EdgeSet_eq<S>(a: EdgeSet<S>, b: EdgeSet<S>): boolean {
  return a.runs.length === b.runs.length && a.runs.every(([x, s], i) => Byte_eq(x, b.runs[i]![0]) && intern_key_eq(s, b.runs[i]![1]));
}
// derive(Debug)
export function debug_EdgeSet<S>(v: EdgeSet<S>, f: Fmt, debug_S: Debug<S>): string {
  return debug_struct(f, "EdgeSet", [["runs", debug_vec(v.runs, f, ([b, s], f) => debug_tuple(f, "", [debug_Byte(b, f), debug_S(s, f)]))]]);
}

/// Partitions two sequences of byte edges into sorted, non-overlapping ranges.
///
/// Within each input, ranges must be non-empty, non-overlapping, and sorted by
/// ascending start. Each output item contains a range and the destination of the
/// edge from each input that covers it. An input with no edge covering the range
/// contributes `None`. Ranges covered by neither input are omitted. Adjacent
/// output ranges are not coalesced.
// rustc: compiler/rustc_transmute/src/layout/dfa.rs:436 union
export function union<S>(xs: Iterator<[Byte, S]>, ys: Iterator<[Byte, S]>): UnionIter<S> {
  return new UnionIter(new Peekable(xs), new Peekable(ys));
}

/** A minimal `std::iter::Peekable` (module comment). */
class Peekable<I> {
  /** `Option<Option<I>>`: `undefined` = not peeked; `{ v: undefined }` = peeked the end. */
  private peeked: { v: I | undefined } | undefined = undefined;

  constructor(private iter: Iterator<I>) {}

  peek_mut(): I | undefined {
    if (this.peeked === undefined) {
      const n = this.iter.next();
      this.peeked = { v: n.done ? undefined : n.value };
    }
    return this.peeked.v;
  }

  next(): I | undefined {
    const p = this.peeked;
    if (p !== undefined) {
      this.peeked = undefined;
      return p.v;
    }
    const n = this.iter.next();
    return n.done ? undefined : n.value;
  }
}

export type UnionItem<S> = [Byte, [S | undefined, S | undefined]];

export class UnionIter<S> implements IterableIterator<UnionItem<S>> {
  constructor(
    private xs: Peekable<[Byte, S]>,
    private ys: Peekable<[Byte, S]>,
  ) {}

  [Symbol.iterator](): UnionIter<S> {
    return this;
  }

  // FIXME(jswrenn) we'd likely benefit from specializing try_fold here.
  // rustc: compiler/rustc_transmute/src/layout/dfa.rs:454 next
  next(): IteratorResult<UnionItem<S>> {
    // use std::cmp::{self, Ordering};

    let ret: UnionItem<S> | undefined;
    const x = this.xs.peek_mut();
    const y = this.ys.peek_mut();
    if (x === undefined && y === undefined) {
      ret = undefined;
    } else if (x !== undefined && y === undefined) {
      ret = [x[0], [x[1], undefined]];
      this.xs.next();
    } else if (x === undefined && y !== undefined) {
      ret = [y[0], [undefined, y[1]]];
      this.ys.next();
    } else {
      const x_ = x!;
      const y_ = y!;
      let start: number;
      let end: number;
      let dst: [S | undefined, S | undefined];
      if (x_[0].start < y_[0].start) {
        start = x_[0].start;
        end = Math.min(x_[0].end, y_[0].start);
        dst = [x_[1], undefined];
      } else if (x_[0].start > y_[0].start) {
        start = y_[0].start;
        end = Math.min(x_[0].start, y_[0].end);
        dst = [undefined, y_[1]];
      } else {
        start = x_[0].start;
        end = Math.min(x_[0].end, y_[0].end);
        dst = [x_[1], y_[1]];
      }
      ret = [new Byte(start, end), dst];
      if (start === x_[0].start) {
        x_[0].start = end;
      }
      if (start === y_[0].start) {
        y_[0].start = end;
      }
      if (x_[0].is_empty()) {
        this.xs.next();
      }
      if (y_[0].is_empty()) {
        this.ys.next();
      }
    }
    return ret === undefined ? { done: true, value: undefined } : { done: false, value: ret };
  }
}
