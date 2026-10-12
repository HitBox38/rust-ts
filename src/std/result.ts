// `Result<T, E>` uses the same encoding as every ported enum: a `$`-tagged union with
// tuple fields `_0, _1, ...`. The `?` operator becomes `if (r.$ === "Err") return r;`.
import { debug_tuple, PLAIN, type Debug, type Fmt } from "./fmt.ts";
import { Panic } from "./panic.ts";

export type Result<T, E> = { readonly $: "Ok"; readonly _0: T } | { readonly $: "Err"; readonly _0: E };

export function Ok<const T>(v: T): { readonly $: "Ok"; readonly _0: T } {
  return { $: "Ok", _0: v };
}

export function Err<const E>(e: E): { readonly $: "Err"; readonly _0: E } {
  return { $: "Err", _0: e };
}

/** `Result::ok` */
export function ok<T, E>(r: Result<T, E>): T | undefined {
  return r.$ === "Ok" ? r._0 : undefined;
}

/**
 * `core::result::unwrap_failed(msg, &error)`: `panic!("{msg}: {error:?}")` (library/core/src/result.rs).
 * `debug_err` is `E`'s `Debug` (`{:?}`, i.e. rendered with `PLAIN`).
 */
function unwrap_failed<E>(msg: string, error: E, debug_err: Debug<E>): never {
  throw new Panic(`${msg}: ${debug_err(error, PLAIN)}`);
}

/**
 * `Result::unwrap` (`E: Debug`). Panics with core's exact text
 * ``called `Result::unwrap()` on an `Err` value: {e:?}``, which needs `E`'s Debug.
 *
 * PORT: Rust's bound `E: Debug` becomes the `debug_err` parameter (the error's `debug_<Type>`).
 * The one-argument overload exists for unit tests only (their panic text never reaches compiler
 * output) and panics without the `: {e:?}` suffix; src/std/result.test.ts fails if a non-test file
 * calls it. Ported code always passes `debug_err`.
 */
export function unwrap_result<T, E>(r: Result<T, E>, debug_err: Debug<E>): T;
export function unwrap_result<T, E>(r: Result<T, E>): T;
export function unwrap_result<T, E>(r: Result<T, E>, debug_err?: Debug<E>): T {
  if (r.$ === "Err") {
    if (debug_err === undefined) throw new Panic("called `Result::unwrap()` on an `Err` value");
    return unwrap_failed("called `Result::unwrap()` on an `Err` value", r._0, debug_err);
  }
  return r._0;
}

/** `Result::expect` (`E: Debug`): panics with `{msg}: {e:?}`. See `unwrap_result` for `debug_err`. */
export function expect_result<T, E>(r: Result<T, E>, msg: string, debug_err: Debug<E>): T {
  if (r.$ === "Err") return unwrap_failed(msg, r._0, debug_err);
  return r._0;
}

export function debug_result<T, E>(r: Result<T, E>, f: Fmt, ok_: Debug<T>, err: Debug<E>): string {
  return r.$ === "Ok" ? debug_tuple(f, "Ok", [ok_(r._0, f)]) : debug_tuple(f, "Err", [err(r._0, f)]);
}
