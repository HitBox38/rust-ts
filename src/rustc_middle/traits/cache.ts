//! Cache for candidate selection.
// Port of compiler/rustc_middle/src/traits/cache.rs (lane middle-traits-thir). The types are generated
// (cache.gen.ts, set rustc_middle_traits_thir); `WithDepNodeCache` is hand-written (types.sets.json `hand`).
import { intern_key } from "../../rust_ts/intern_key.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import type { DepNodeIndex } from "../dep_graph/graph.ts";
import type { TyCtxt } from "../ty/context.ts";
import { WithDepNode } from "./cache.gen.ts";

export * from "./cache.gen.ts";

declare module "./cache.gen.ts" {
  interface WithDepNode<T> {
    get(tcx: TyCtxt): T;
  }
  namespace WithDepNode {
    function new_<T>(dep_node: DepNodeIndex, cached_value: T): WithDepNode<T>;
    export { new_ as new };
  }
}

// PORT: `hashmap: Lock<FxHashMap<Key, WithDepNode<Value>>>` is the inner map (PORTING §5). The keys are tuples of
// interned values (`(TypingEnv, TraitClause)`, ...), compared by `Eq`: a `KeyedMap` on the canonical `intern_key`
// (rust_ts/intern_key.ts; interned children by id), the derived `Hash`+`Eq` of the key.
export class WithDepNodeCache<Key, Value> {
  constructor(public hashmap: Map<Key, WithDepNode<Value>>) {}

  // rustc: compiler/rustc_middle/src/traits/cache.rs:16 clone
  clone(clone_Key: (k: Key) => Key, clone_Value: (v: Value) => Value): WithDepNodeCache<Key, Value> {
    const hashmap = new KeyedMap<Key, WithDepNode<Value>>(intern_key);
    for (const [k, v] of this.hashmap) hashmap.set(clone_Key(k), new WithDepNode(v.dep_node, clone_Value(v.cached_value)));
    return new WithDepNodeCache(hashmap);
  }

  // rustc: compiler/rustc_middle/src/traits/cache.rs:22 default
  static default_<Key, Value>(): WithDepNodeCache<Key, Value> {
    return new WithDepNodeCache(new KeyedMap<Key, WithDepNode<Value>>(intern_key));
  }

  // rustc: compiler/rustc_middle/src/traits/cache.rs:28 get
  get(key: Key, tcx: TyCtxt): Value | undefined {
    const v = this.hashmap.get(key);
    if (v === undefined) return undefined;
    return v.get(tcx);
  }

  // rustc: compiler/rustc_middle/src/traits/cache.rs:32 insert
  insert(key: Key, dep_node: DepNodeIndex, value: Value): void {
    this.hashmap.set(key, WithDepNode.new(dep_node, value));
  }
}

Object.assign(WithDepNode, {
  // rustc: compiler/rustc_middle/src/traits/cache.rs:44 new
  new<T>(dep_node: DepNodeIndex, cached_value: T): WithDepNode<T> {
    return new WithDepNode(dep_node, cached_value);
  },
});

// rustc: compiler/rustc_middle/src/traits/cache.rs:48 get
WithDepNode.prototype.get = function <T>(this: WithDepNode<T>, tcx: TyCtxt): T {
  tcx.dep_graph.read_index(this.dep_node);
  // PORT: `self.cached_value.clone()`: the cached values (`SelectionResult`, `EvaluationResult`) are never mutated
  // after insertion, so the stored value is returned.
  return this.cached_value;
};
