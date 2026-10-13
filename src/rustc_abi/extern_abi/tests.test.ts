// compiler/rustc_abi/src/extern_abi/tests.rs
import { expect, test } from "bun:test";
import { ExternAbi } from "../extern_abi.ts";

// rustc: compiler/rustc_abi/src/extern_abi/tests.rs:8 lookup_Rust
test("lookup_Rust", () => {
  const abi = ExternAbi.from_str("Rust");
  expect(abi.$ === "Ok" && ExternAbi.as_str(abi._0) === "Rust").toBe(true);
});

// rustc: compiler/rustc_abi/src/extern_abi/tests.rs:14 lookup_cdecl
test("lookup_cdecl", () => {
  const abi = ExternAbi.from_str("cdecl");
  expect(abi.$ === "Ok" && ExternAbi.as_str(abi._0) === "cdecl").toBe(true);
});

// rustc: compiler/rustc_abi/src/extern_abi/tests.rs:20 lookup_baz
test("lookup_baz", () => {
  const abi = ExternAbi.from_str("baz");
  expect(abi).toEqual({ $: "Err", _0: "Unknown" });
});

// rustc: compiler/rustc_abi/src/extern_abi/tests.rs:26 guarantee_lexicographic_ordering
test("guarantee_lexicographic_ordering", () => {
  const abis = ExternAbi.ALL_VARIANTS;
  const sorted_abis = abis.slice();
  sorted_abis.sort((a, b) => ExternAbi.cmp(a, b));
  expect(sorted_abis).toEqual([...abis]);
});
