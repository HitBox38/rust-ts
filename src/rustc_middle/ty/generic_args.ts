// Port of compiler/rustc_middle/src/ty/generic_args.rs: skeleton (lane codegen-tyir). The types with their derived Debug / TypeVisitable / TypeFoldable
// impls are generated into generic_args.gen.ts (set rustc_ty of tools/codegen/types.ts); the fns and manual impls of this file
// are ported by the later tyir / ty lanes (plan-m3 §5 waves 14-15). The stubs below call `unported`.
import { unported } from "../../std/panic.ts";
import type { Debug } from "../../std/fmt.ts";
import type { GenericArg } from "../../rust_ts/tyir_contract.ts";

export * from "./generic_args.gen.ts";

// PORT: `GenericArg` is an interned type of lane ty-contract (plan-m3 D2); the stand-in until it merges.
export type { GenericArg } from "../../rust_ts/tyir_contract.ts";
// manual `impl Debug for GenericArg` (compiler/rustc_middle/src/ty/generic_args.rs): ported by the later ty lanes
export const debug_GenericArg: Debug<GenericArg> = (_v, _f) => unported("Debug for GenericArg (manual impl, compiler/rustc_middle/src/ty/generic_args.rs)");
