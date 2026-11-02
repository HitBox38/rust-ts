// Port of src/tools/miri/src/shims/mod.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-shims-a` (plan-m6 wave 37): ported.
// Its types are generated into mod.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT:
// - The `mod` / `pub use` lines of mod.rs are src/miri/lib.ts's (the skeleton loads every shim module and re-exports
//   the `pub use` items there).
// - `impl EmulateItemResult` is a method of the companion const (PORTING §8: enum methods live on the companion).
// - `jump_to_next_block<T: Default>`: every upstream `T` is an `Option<..>` (foreign_items.rs:77, intrinsics/mod.rs:57
//   / :250), whose `Default` is `None` (`undefined`), so `T::default()` is `undefined` and the result is
//   `InterpResult<T | undefined>`.
import * as gen from "./mod.gen.ts";
import { type MiriInterpCx } from "../machine.ts";
import { type PlaceTy } from "../lib.ts";
import { type InterpResult, interp_ok } from "../../rustc_middle/mir/interpret/mod.ts";
import { type BasicBlock, type UnwindAction } from "../../rustc_middle/mir/mod.ts";
import { unwrap } from "../../std/panic.ts";
export * from "./mod.gen.ts";

interface EmulateItemResult_methods {
  jump_to_next_block<T>(
    self: EmulateItemResult,
    ecx: MiriInterpCx,
    dest: PlaceTy,
    ret: BasicBlock | undefined,
    unwind: UnwindAction | undefined,
    not_supported: (ecx: MiriInterpCx) => InterpResult<T | undefined>,
  ): InterpResult<T | undefined>;
}

/// What needs to be done after emulating an item (a shim or an intrinsic) is done.
export type EmulateItemResult = gen.EmulateItemResult;
export const EmulateItemResult = gen.EmulateItemResult as typeof gen.EmulateItemResult & EmulateItemResult_methods;

// rustc: src/tools/miri/src/shims/mod.rs:46 jump_to_next_block
(EmulateItemResult as EmulateItemResult_methods).jump_to_next_block = function <T>(
  self: EmulateItemResult,
  ecx: MiriInterpCx,
  dest: PlaceTy,
  ret: BasicBlock | undefined,
  unwind: UnwindAction | undefined,
  not_supported: (ecx: MiriInterpCx) => InterpResult<T | undefined>,
): InterpResult<T | undefined> {
  switch (self) {
    case "NeedsReturn": {
      // trace!("{:?}", ecx.dump_place(dest));
      void dest;
      const r = ecx.return_to_block(ret);
      if (r.$ === "Err") return r;
      return interp_ok(undefined);
    }
    case "NeedsUnwind": {
      // Jump to the unwind block to begin unwinding.
      const r = ecx.unwind_to_block(unwrap(unwind));
      if (r.$ === "Err") return r;
      return interp_ok(undefined);
    }
    case "AlreadyJumped":
      return interp_ok(undefined);
    case "NotSupported":
      return not_supported(ecx);
  }
};
