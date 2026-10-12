// Port of compiler/rustc_ast/src/expand/allocator.rs
// Types and derived Debug impls are generated into allocator.gen.ts (tools/codegen/types.ts).
import { display_Symbol, sym, type Symbol } from "../../rustc_span/symbol.ts";
import type { AllocatorMethod } from "./allocator.gen.ts";

export * from "./allocator.gen.ts";

// rustc: compiler/rustc_ast/src/expand/allocator.rs:12 global_fn_name
export function global_fn_name(base: Symbol): string {
  return `__rust_${display_Symbol(base)}`;
}

// rustc: compiler/rustc_ast/src/expand/allocator.rs:16 default_fn_name
export function default_fn_name(base: Symbol): string {
  return `__rdl_${display_Symbol(base)}`;
}

export const ALLOC_ERROR_HANDLER: Symbol = sym.alloc_error_handler;
export const NO_ALLOC_SHIM_IS_UNSTABLE: string = "__rust_no_alloc_shim_is_unstable_v2";

export const ALLOCATOR_METHODS: readonly AllocatorMethod[] = [
  {
    name: sym.alloc,
    special: "Alloc",
    inputs: [{ name: "layout", ty: "Layout" }],
    output: "ResultPtr",
  },
  {
    name: sym.dealloc,
    special: "Dealloc",
    inputs: [
      { name: "ptr", ty: "Ptr" },
      { name: "layout", ty: "Layout" },
    ],
    output: "Unit",
  },
  {
    name: sym.realloc,
    special: "Realloc",
    inputs: [
      { name: "ptr", ty: "Ptr" },
      { name: "layout", ty: "Layout" },
      { name: "new_size", ty: "Usize" },
    ],
    output: "ResultPtr",
  },
  {
    name: sym.alloc_zeroed,
    special: "AllocZeroed",
    inputs: [{ name: "layout", ty: "Layout" }],
    output: "ResultPtr",
  },
];
