// The canonical key of a value for hash-consing and for struct-keyed maps (docs/plan-m3.md D2, D5).
//
// Upstream interns `TyKind`, `RegionKind`, `ConstKind`, `Binder<PredicateKind>`, slices of handles, ...
// in hash sets that compare by the *value's* derived `Hash` + `PartialEq` (rustc_middle ty/context.rs
// `InternedInSet`). Inside such a value every interned child (`Ty`, `Region`, `Const`, `&List<T>`,
// `AdtDef`, ...) compares by pointer (rustc_data_structures `Interned`), every other field by value.
//
// PORT: `intern_key(v)` is that equality as a string: two values get the same key exactly when the Rust
// values are `==`, given the PORTING §5 representation:
// - an interned object (anything carrying `INTERNED`, see rustc_data_structures/intern.ts) is `#<id>`;
// - numbers (`u8..u64` that fit, branded handles: `Symbol`, `Span`, `LocalDefId`, newtype indices),
//   bigints (`u128`), strings (fieldless enums, `String`s), booleans, `null` (`()`) by value;
// - arrays (`Vec`, slices, tuples) element-wise, in order;
// - objects (data enums `{ $, _0, .. }`, structs, small classes such as `DefId` / `HirId`) by their own
//   enumerable fields, sorted by name, skipping `undefined` (`None`, so a missing optional field and an
//   explicit `undefined` agree).
// It is generic, not generated: tools/codegen may later emit per-type `key_<T>` functions (D5); they must
// agree with this one. `Map`/`Set`/functions inside a key are a bug (no Rust intern key holds them).
//
// PORT (perf-intern): the key text is unchanged from the first version (an array of pieces joined at the end,
// `Object.keys(v).sort()`, `JSON.stringify` of every string); intern_key.test.ts keeps that version as the
// reference and checks both give the same string on generated values and on every value of real compilations.
// This one builds the string by concatenation, sorts the (few) field names by insertion sort with `<` (the same
// UTF-16 code-unit order as the default `sort`; field names are distinct, so stability does not matter) and
// quotes a string without `JSON.stringify` when JSON would not escape any of its characters.
import { panic } from "../std/panic.ts";
import { INTERNED } from "../rustc_data_structures/intern.ts";

/** `JSON.stringify(s)` for a string: the same text, without the call when nothing needs escaping. */
function quote(s: string): string {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // JSON escapes `"`, `\`, controls below U+0020 and lone surrogates; surrogates take the slow path too.
    if (c < 0x20 || c === 0x22 || c === 0x5c || (c >= 0xd800 && c <= 0xdfff)) return JSON.stringify(s);
  }
  return '"' + s + '"';
}

/** The object's own enumerable field names in `Array.prototype.sort` order (UTF-16 code units). */
function sorted_keys(v: object): string[] {
  const keys = Object.keys(v);
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i]!;
    let j = i - 1;
    while (j >= 0 && keys[j]! > k) {
      keys[j + 1] = keys[j]!;
      j--;
    }
    keys[j + 1] = k;
  }
  return keys;
}

function key_of(v: unknown): string {
  switch (typeof v) {
    case "number":
      return v === 0 && 1 / v < 0 ? "-0" : "" + v;
    case "string":
      return quote(v);
    case "boolean":
      return v ? "t" : "f";
    case "bigint":
      return v + "n";
    case "undefined":
      return "~";
    case "object": {
      if (v === null) return "()";
      const o = v as { readonly [INTERNED]?: true; readonly id?: number };
      if (o[INTERNED] === true) return "#" + o.id;
      if (Array.isArray(v)) {
        let s = "[";
        for (let i = 0; i < v.length; i++) {
          if (i > 0) s += ",";
          s += key_of(v[i]);
        }
        return s + "]";
      }
      if (v instanceof Map || v instanceof Set) panic("intern_key: a Map/Set inside an intern key");
      const keys = sorted_keys(v);
      let s = "{";
      let first = true;
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i]!;
        const f = (v as Record<string, unknown>)[k];
        if (f === undefined) continue;
        if (!first) s += ",";
        first = false;
        s += k + ":" + key_of(f);
      }
      return s + "}";
    }
    default:
      return panic(`intern_key: a ${typeof v} inside an intern key`);
  }
}

// `intern_key_eq(a, b)` is `intern_key(a) === intern_key(b)` without building the keys. The key text is uniquely
// decodable when every field name is made of `[A-Za-z0-9_$]` (a name then holds no `:`, every leaf is
// self-delimiting: quoted string, `#id`, number, `n`-suffixed bigint, `t`, `f`, `~`, `()`), so two keys are equal
// exactly when the values are equal leaf by leaf: numbers by `Object.is` (`String` is injective on numbers but for
// `-0`, which the key spells apart), other primitives by `===`, interned objects by id, arrays element-wise,
// objects by their own enumerable fields that are not `undefined`. Anything else falls back to comparing the keys:
// a field name outside that set (`check_name`), or a value `intern_key` rejects (`Map`/`Set`/function/symbol), so
// such a value panics exactly as before. The walk never stops at the first difference: it visits every node of
// both values, so a rejected value anywhere is always found.

/** Thrown inside `eq_rec` / `walk`: compare the keys instead. */
const FALLBACK: unique symbol = Symbol("intern_key_eq fallback");

/** Field names made of `[A-Za-z0-9_$]` (and not empty); any other name: `FALLBACK`. */
function check_name(k: string): void {
  if (k.length === 0) throw FALLBACK;
  for (let i = 0; i < k.length; i++) {
    const c = k.charCodeAt(i);
    if (
      !(
        (c >= 0x61 && c <= 0x7a) || // a-z
        c === 0x5f || // _
        (c >= 0x30 && c <= 0x39) || // 0-9
        (c >= 0x41 && c <= 0x5a) || // A-Z
        c === 0x24 // $
      )
    ) {
      throw FALLBACK;
    }
  }
}

/** Visits every node of `v` as `eq_rec` would (rejected values and unsafe names throw `FALLBACK`). */
function walk(v: unknown): void {
  switch (typeof v) {
    case "number":
    case "string":
    case "boolean":
    case "bigint":
    case "undefined":
      return;
    case "object": {
      if (v === null) return;
      if ((v as { readonly [INTERNED]?: true })[INTERNED] === true) return;
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) walk(v[i]);
        return;
      }
      if (v instanceof Map || v instanceof Set) throw FALLBACK;
      const keys = Object.keys(v);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i]!;
        check_name(k);
        walk((v as Record<string, unknown>)[k]);
      }
      return;
    }
    default:
      throw FALLBACK;
  }
}

function eq_rec(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    walk(a);
    return true;
  }
  const t = typeof a;
  if (t !== typeof b) {
    walk(a);
    walk(b);
    return false;
  }
  switch (t) {
    case "number":
    case "string":
    case "boolean":
    case "bigint":
    case "undefined":
      // not `Object.is`-equal: different keys (for numbers, `String` tells them apart but for `0` / `-0`, which the
      // key spells `0` / `-0`)
      return false;
    case "object":
      return eq_obj(a as object | null, b as object | null);
    default:
      throw FALLBACK;
  }
}

function eq_obj(a: object | null, b: object | null): boolean {
  if (a === null || b === null) {
    walk(a);
    walk(b);
    return false;
  }
  const ia = (a as { readonly [INTERNED]?: true })[INTERNED] === true;
  const ib = (b as { readonly [INTERNED]?: true })[INTERNED] === true;
  if (ia || ib) {
    // PORT: (perf) ids are integers, on which `String` is injective: `===` gives the same answer as comparing the
    // `#<id>` key texts, without building them.
    if (ia && ib) return (a as { readonly id?: number }).id === (b as { readonly id?: number }).id;
    walk(a);
    walk(b);
    return false;
  }
  const aa = Array.isArray(a);
  if (aa !== Array.isArray(b)) {
    walk(a);
    walk(b);
    return false;
  }
  if (aa) {
    const xa = a as unknown[];
    const xb = b as unknown[];
    let eq = xa.length === xb.length;
    const n = Math.min(xa.length, xb.length);
    for (let i = 0; i < n; i++) eq = eq_rec(xa[i], xb[i]) && eq;
    for (let i = n; i < xa.length; i++) walk(xa[i]);
    for (let i = n; i < xb.length; i++) walk(xb[i]);
    return eq;
  }
  if (a instanceof Map || a instanceof Set || b instanceof Map || b instanceof Set) throw FALLBACK;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  let eq = true;
  if (same_names(ka, kb)) {
    // PORT: (perf) the usual case, both objects with the same field names in the same order: the two loops below
    // pair up field by field. Same result and the same nodes visited (only `FALLBACK` can be thrown, so the
    // visiting order does not matter).
    for (let i = 0; i < ka.length; i++) {
      const k = ka[i]!;
      check_name(k);
      const fa = ra[k];
      const fb = rb[k];
      if (fa === undefined) {
        if (fb !== undefined) {
          walk(fb);
          eq = false;
        }
      } else if (fb === undefined) {
        walk(fa);
        eq = false;
      } else {
        eq = eq_rec(fa, fb) && eq;
      }
    }
    return eq;
  }
  for (let i = 0; i < ka.length; i++) {
    const k = ka[i]!;
    check_name(k);
    const fa = ra[k];
    if (fa === undefined) continue;
    const fb = kb.includes(k) ? rb[k] : undefined;
    if (fb === undefined) {
      walk(fa);
      eq = false;
    } else {
      eq = eq_rec(fa, fb) && eq;
    }
  }
  for (let i = 0; i < kb.length; i++) {
    const k = kb[i]!;
    check_name(k);
    const fb = rb[k];
    if (fb === undefined) continue;
    // a defined field of `b` that `a` lacks (the pairs present in both were compared above)
    if (!ka.includes(k) || ra[k] === undefined) {
      walk(fb);
      eq = false;
    }
  }
  return eq;
}

function same_names(ka: readonly string[], kb: readonly string[]): boolean {
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return false;
  return true;
}

/** `intern_key(a) === intern_key(b)` (same result, same panics), without building the keys (comment above). */
export function intern_key_eq(a: unknown, b: unknown): boolean {
  try {
    return eq_rec(a, b);
  } catch (e) {
    if (e !== FALLBACK) throw e;
    return intern_key(a) === intern_key(b);
  }
}

/** Test hook (intern_key.test.ts): sees every value and its key. */
let observer: ((v: unknown, key: string) => void) | undefined;
export function set_intern_key_observer(f: ((v: unknown, key: string) => void) | undefined): void {
  observer = f;
}

/** The canonical key of `v`: equal exactly when the Rust values are `==` (module comment). */
export function intern_key(v: unknown): string {
  const k = key_of(v);
  if (observer !== undefined) observer(v, k);
  return k;
}
