// Maps and sets whose Rust key is a struct compared by value (`DefId`, `Ident`, rustc_resolve's
// `IdentKey` / `BindingKey`, tuples). PORTING §5 maps `FxHashMap`/`FxIndexMap` to a JS `Map`, which
// compares object keys by identity; these subclasses canonicalize every key through a key function
// (a string or number that is equal exactly when the Rust keys are `==`), and keep the first key
// object inserted for each canonical key. So they *are* `Map`s / `Set`s: insertion-ordered (the
// `FxIndexMap` order), iteration and `size` see the stored key objects, and `debug_*` helpers that
// take a `Map` work unchanged. Precedent: rustc_hir_id/definitions.ts `DefPathDataMap`.
//
// PORT: `IndexMap::swap_remove` is not a `Map` operation; `delete` is `shift_remove` (order kept).

/** A `Map` keyed by `key(k)` instead of `k`'s identity. */
export class KeyedMap<K, V> extends Map<K, V> {
  /** canonical key -> the stored key object */
  readonly #canon = new Map<string | number, K>();

  constructor(
    readonly key: (k: K) => string | number,
    entries?: Iterable<readonly [K, V]>,
  ) {
    super();
    if (entries) for (const [k, v] of entries) this.set(k, v);
  }

  /** The stored key object equal to `k`, if any. */
  stored_key(k: K): K | undefined {
    return this.#canon.get(this.key(k));
  }

  override get(k: K): V | undefined {
    const s = this.#canon.get(this.key(k));
    return s === undefined ? undefined : super.get(s);
  }

  override has(k: K): boolean {
    return this.#canon.has(this.key(k));
  }

  override set(k: K, v: V): this {
    const c = this.key(k);
    const s = this.#canon.get(c);
    if (s === undefined) {
      this.#canon.set(c, k);
      return super.set(k, v);
    }
    return super.set(s, v);
  }

  override delete(k: K): boolean {
    const c = this.key(k);
    const s = this.#canon.get(c);
    if (s === undefined) return false;
    this.#canon.delete(c);
    return super.delete(s);
  }

  override clear(): void {
    this.#canon.clear();
    super.clear();
  }
}

/** A `Set` of values compared by `key(v)` instead of identity. */
export class KeyedSet<K> extends Set<K> {
  readonly #canon = new Map<string | number, K>();

  constructor(
    readonly key: (k: K) => string | number,
    values?: Iterable<K>,
  ) {
    super();
    if (values) for (const v of values) this.add(v);
  }

  stored_key(k: K): K | undefined {
    return this.#canon.get(this.key(k));
  }

  override has(k: K): boolean {
    return this.#canon.has(this.key(k));
  }

  override add(k: K): this {
    const c = this.key(k);
    if (this.#canon.has(c)) return this;
    this.#canon.set(c, k);
    return super.add(k);
  }

  override delete(k: K): boolean {
    const c = this.key(k);
    const s = this.#canon.get(c);
    if (s === undefined) return false;
    this.#canon.delete(c);
    return super.delete(s);
  }

  override clear(): void {
    this.#canon.clear();
    super.clear();
  }
}
