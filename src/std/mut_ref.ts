// `&mut T` places. TS values have no addresses, so a `&mut` to a slot is a view onto it.

/// PORT: `&mut T` for a primitive/handle `T` (e.g. `&mut SyntaxContext`): callers pass `{ value }`
/// and read the updated `value` back.
export interface MutRef<T> {
  value: T;
}

/** `&mut o.<k>`: a `MutRef` view whose reads and writes go to `o[k]`. */
// PORT: (perf) the view is a `FieldMut` instance (accessors on the prototype), not an object literal with its own
// accessor closures: the literal allocated two closures per call.
export function field_mut<O, K extends keyof O>(o: O, k: K): MutRef<O[K]> {
  return new FieldMut(o, k);
}

class FieldMut<O, K extends keyof O> implements MutRef<O[K]> {
  constructor(
    private readonly o: O,
    private readonly k: K,
  ) {}
  get value(): O[K] {
    return this.o[this.k];
  }
  set value(v: O[K]) {
    this.o[this.k] = v;
  }
}

/**
 * `*dst = src` where `dst: &mut T` is an object passed by identity (the "`&mut Node` -> `Node`, replace
 * in place" convention of rustc_ast/mut_visit.ts): `dst` takes `src`'s prototype and own fields, and
 * fields `src` lacks (another enum variant's) are removed. `src` is moved: it must not be used after.
 */
export function replace_in_place<T extends object>(dst: T, src: T): void {
  if (dst === src) return;
  if (Object.getPrototypeOf(dst) !== Object.getPrototypeOf(src)) Object.setPrototypeOf(dst, Object.getPrototypeOf(src));
  const d = dst as Record<string, unknown>;
  for (const k of Object.keys(d)) if (!Object.hasOwn(src, k)) delete d[k];
  Object.assign(dst, src);
}
