// Port of fluent-bundle 0.16.0, src/args.rs.
// PORT: `K: Into<Cow<str>>` / `V: Into<FluentValue>` bounds: callers pass the converted `string`
// and `FluentValue` (e.g. `FluentValue.from_str("John")`, `FluentValue_from_num(5)`).
import { debug_str, debug_tuple, debug_vec, type Fmt } from "../../std/fmt.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { debug_FluentValue, type FluentValue } from "./types/mod.ts";

/// Fluent messages can use arguments in order to programmatically add values to a
/// translated string. For instance, in a localized application you may wish to display
/// a user's email count. This could be done with the following message.
///
/// `msg-key = Hello, { $user }. You have { $emailCount } messages.`
///
/// Here `$user` and `$emailCount` are the arguments, which can be filled with values.
///
/// The [`FluentArgs`] struct is the map from the argument name (for example `$user`) to
/// the argument value (for example "John".) The logic to apply these to write these
/// to messages is elsewhere, this struct just stores the value.
///
/// # Example
///
/// ```
/// use fluent_bundle::{FluentArgs, FluentBundle, FluentResource};
///
/// let mut args = FluentArgs::new();
/// args.set("user", "John");
/// args.set("emailCount", 5);
///
/// let res = FluentResource::try_new(r#"
///
/// msg-key = Hello, { $user }. You have { $emailCount } messages.
///
/// "#.to_string())
///     .expect("Failed to parse FTL.");
///
/// let mut bundle = FluentBundle::default();
///
/// // For this example, we'll turn on BiDi support.
/// // Please, be careful when doing it, it's a risky move.
/// bundle.set_use_isolating(false);
///
/// bundle.add_resource(res)
///     .expect("Failed to add a resource.");
///
/// let mut err = vec![];
///
/// let msg = bundle.get_message("msg-key")
///     .expect("Failed to retrieve a message.");
/// let value = msg.value()
///     .expect("Failed to retrieve a value.");
///
/// assert_eq!(
///     bundle.format_pattern(value, Some(&args), &mut err),
///     "Hello, John. You have 5 messages."
/// );
/// ```
// #[derive(Debug, Default)]
export class FluentArgs {
  constructor(public _0: [string, FluentValue][]) {}

  /** `#[derive(Default)]` */
  static default(): FluentArgs {
    return new FluentArgs([]);
  }

  /// Creates a new empty argument map.
  // crate: fluent-bundle-0.16.0/src/args.rs:60 new
  static new(): FluentArgs {
    return FluentArgs.default();
  }

  /// Pre-allocates capacity for arguments.
  // crate: fluent-bundle-0.16.0/src/args.rs:65 with_capacity
  static with_capacity(_capacity: number): FluentArgs {
    return new FluentArgs([]); // `Vec::with_capacity`
  }

  /// Gets the [`FluentValue`] at the `key` if it exists.
  // crate: fluent-bundle-0.16.0/src/args.rs:70 get
  get(key: string): FluentValue | undefined {
    const r = binary_search_by(this._0, ([k, _]) => str_cmp(k, key));
    if (r.$ === "Ok") {
      return this._0[r._0]![1];
    } else {
      return undefined;
    }
  }

  /// Sets the key value pair.
  // crate: fluent-bundle-0.16.0/src/args.rs:83 set
  set(key: string, value: FluentValue): void {
    const r = binary_search_by(this._0, ([k, _]) => str_cmp(k, key));
    switch (r.$) {
      case "Ok":
        this._0[r._0] = [key, value];
        break;
      case "Err":
        this._0.splice(r._0, 0, [key, value]);
        break;
    }
  }

  /// Iterate over a tuple of the key an [`FluentValue`].
  // crate: fluent-bundle-0.16.0/src/args.rs:96 iter
  *iter(): Generator<[string, FluentValue]> {
    for (const [k, v] of this._0) yield [k, v];
  }

  /**
   * `impl FromIterator<(K, V)> for FluentArgs`. PORT: `iter.size_hint().1` is `size_hint_upper`
   * (it only picks `with_capacity` over `new`).
   */
  // crate: fluent-bundle-0.16.0/src/args.rs:106 from_iter
  static from_iter(iter: Iterable<[string, FluentValue]>, size_hint_upper?: number): FluentArgs {
    let args: FluentArgs;
    if (size_hint_upper !== undefined) {
      const size = size_hint_upper;
      args = FluentArgs.with_capacity(size);
    } else {
      args = FluentArgs.new();
    }

    for (const [k, v] of iter) {
      args.set(k, v);
    }

    return args;
  }

  /** `impl IntoIterator for FluentArgs` */
  // crate: fluent-bundle-0.16.0/src/args.rs:129 into_iter
  into_iter(): IterableIterator<[string, FluentValue]> {
    return this._0[Symbol.iterator]();
  }
}

/** `#[derive(Debug)]` (`FluentArgs([("k", v), ..])`) */
export function debug_FluentArgs(v: FluentArgs, f: Fmt): string {
  return debug_tuple(f, "FluentArgs", [
    debug_vec(v._0, f, ([k, val], f) => debug_tuple(f, "", [debug_str(k), debug_FluentValue(val, f)])),
  ]);
}

/**
 * PORT: `<str as Ord>::cmp` (byte-wise UTF-8 order = code point order; JS `<` compares UTF-16
 * code units, which differs for supplementary characters). Belongs in src/std.
 */
export function str_cmp(a: string, b: string): -1 | 0 | 1 {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x === y) continue;
    // Compare the code points at the first differing code unit (a shared high surrogate
    // followed by different low surrogates compares the low surrogates, which orders the same).
    const cx = a.codePointAt(i)!;
    const cy = b.codePointAt(i)!;
    return cx < cy ? -1 : 1;
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}

/**
 * PORT: `<[T]>::binary_search_by_key(&b, f)` = `binary_search_by(|k| f(k).cmp(b))`; this is
 * `core::slice::binary_search_by` at the pin (same probe sequence). Belongs in src/std (copies in
 * intl_pluralrules/lib.ts, unic_langid_impl/likelysubtags/mod.ts, rustc_span/lib.ts).
 */
function binary_search_by<T>(v: readonly T[], f: (x: T) => -1 | 0 | 1): Result<number, number> {
  let size = v.length;
  if (size === 0) {
    return Err(0);
  }
  let base = 0;

  // This loop intentionally doesn't have an early exit if the comparison
  // returns Equal. We want the number of loop iterations to depend *only*
  // on the size of the input slice so that the CPU can reliably predict
  // the loop count.
  while (size > 1) {
    const half = Math.floor(size / 2);
    const mid = base + half;

    const cmp = f(v[mid]!);

    base = cmp === 1 ? base : mid;

    size -= half;
  }

  const cmp = f(v[base]!);
  if (cmp === 0) {
    return Ok(base);
  } else {
    const result = base + (cmp === -1 ? 1 : 0);
    return Err(result);
  }
}
