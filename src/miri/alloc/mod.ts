// Port of src/tools/miri/src/alloc/mod.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-alloc` (plan-m6 wave 36).
// Its types are generated into mod.gen.ts (tools/codegen set `miri`); this module re-exports them.
import { isolated_alloc } from "./mod.gen.ts";
import { type Layout } from "./alloc_bytes.ts";
import { unreachable } from "../../std/panic.ts";
export * from "./mod.gen.ts";

// mod alloc_bytes;
// #[cfg(all(feature = "native-lib", unix))] pub mod isolated_alloc;  (PORT: built without `native-lib`, decision C6: the
// file alloc/isolated_alloc.rs is not compiled; the inline stub module below is, generated as the namespace `isolated_alloc`)
// PORT: the generated modules name `crate::alloc::isolated_alloc::IsolatedAlloc` as `IsolatedAlloc` of this module.
export type IsolatedAlloc = isolated_alloc.IsolatedAlloc;
export const debug_IsolatedAlloc = isolated_alloc.debug_IsolatedAlloc;

// #[cfg(not(all(feature = "native-lib", unix)))]
// pub mod isolated_alloc {
//     /// Stub allocator to avoid `cfg`s in the rest of Miri.
//     #[derive(Debug)]
//     pub struct IsolatedAlloc(!);
// PORT: `IsolatedAlloc(!)` has no values, so its methods' `match self.0 {}` is `return this._0` (type `never`). The
// pointers are alloc_bytes.ts's host buffers (`*mut u8` = `ArrayBuffer | undefined`, its header).
declare module "./mod.gen.ts" {
  namespace isolated_alloc {
    interface IsolatedAlloc {
      alloc(_layout: Layout): ArrayBuffer | undefined;
      alloc_zeroed(_layout: Layout): ArrayBuffer | undefined;
      dealloc(_ptr: number, _layout: Layout): void;
    }
    namespace IsolatedAlloc {
      function new_(): IsolatedAlloc;
      export { new_ as new };
    }
  }
}

// rustc: src/tools/miri/src/alloc/mod.rs:13 new
(isolated_alloc.IsolatedAlloc as unknown as { new: () => IsolatedAlloc }).new = function (): IsolatedAlloc {
  return unreachable();
};

// rustc: src/tools/miri/src/alloc/mod.rs:17 alloc
isolated_alloc.IsolatedAlloc.prototype.alloc = function (this: IsolatedAlloc, _layout: Layout): ArrayBuffer | undefined {
  // match self.0 {}
  return this._0;
};

// rustc: src/tools/miri/src/alloc/mod.rs:21 alloc_zeroed
isolated_alloc.IsolatedAlloc.prototype.alloc_zeroed = function (this: IsolatedAlloc, _layout: Layout): ArrayBuffer | undefined {
  // match self.0 {}
  return this._0;
};

// rustc: src/tools/miri/src/alloc/mod.rs:25 dealloc
isolated_alloc.IsolatedAlloc.prototype.dealloc = function (this: IsolatedAlloc, _ptr: number, _layout: Layout): void {
  // match self.0 {}
  return this._0;
};
// }

// pub use self::alloc_bytes::{MiriAllocBytes, MiriAllocParams};
export { MiriAllocBytes, MiriAllocParams } from "./alloc_bytes.ts";
