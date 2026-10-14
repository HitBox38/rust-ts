// Port of compiler/rustc_middle/src/ty/predicate.rs: skeleton (lane codegen-tyir). The types with their derived Debug / TypeVisitable / TypeFoldable
// impls are generated into predicate.gen.ts (set rustc_ty of tools/codegen/types.ts); the fns and manual impls of this file
// are ported by the later tyir / ty lanes (plan-m3 §5 waves 14-15). The stubs below call `unported`.

export * from "./predicate.gen.ts";

// PORT: `Predicate` / `Clause` are interned types of lane ty-contract (plan-m3 D2); the stand-ins until it merges.
export type { Clause, Predicate } from "../../rust_ts/tyir_contract.ts";
