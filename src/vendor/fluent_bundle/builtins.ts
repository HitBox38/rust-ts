// Port of fluent-bundle 0.16.0, src/builtins.rs.
import type { FluentArgs } from "./args.ts";
import type { FluentValue } from "./types/mod.ts";

// #[allow(non_snake_case)]
// crate: fluent-bundle-0.16.0/src/builtins.rs:4 NUMBER
export function NUMBER(positional: readonly FluentValue[], named: FluentArgs): FluentValue {
  const first = positional[0];
  if (first === undefined || first.$ !== "Number") {
    return { $: "Error" };
  }
  const n_ = first._0;

  const n = n_.clone();
  n.options.merge(named);

  return { $: "Number", _0: n };
}
