// `Result<T, E>` uses the same encoding as every ported enum: a `$`-tagged union with
// tuple fields `_0, _1, ...`. The `?` operator becomes `if (r.$ === "Err") return r;`.
import { debug_tuple, type Debug, type Fmt } from "./fmt.ts";
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

export function unwrap_result<T, E>(r: Result<T, E>): T {
  if (r.$ === "Err") throw new Panic("called `Result::unwrap()` on an `Err` value");
  return r._0;
}

export function debug_result<T, E>(r: Result<T, E>, f: Fmt, ok_: Debug<T>, err: Debug<E>): string {
  return r.$ === "Ok" ? debug_tuple(f, "Ok", [ok_(r._0, f)]) : debug_tuple(f, "Err", [err(r._0, f)]);
}
