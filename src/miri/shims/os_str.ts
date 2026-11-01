// Port of src/tools/miri/src/shims/os_str.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-a` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into os_str.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type Pointer } from "../lib.ts";
import { type MemoryKind, type MiriInterpCx } from "../machine.ts";
import { type PathConversion } from "./os_str.gen.ts";
import { stub_methods } from "../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { unported } from "../../std/panic.ts";
export * from "./os_str.gen.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/os_str.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/os_str.rs:36
    read_os_str_from_c_str(this: MiriInterpCx, ptr: Pointer): InterpResult<string>;
    // shims/os_str.rs:47
    read_os_str_from_wide_str(this: MiriInterpCx, ptr: Pointer): InterpResult<string>;
    // shims/os_str.rs:69
    write_os_str_to_c_str(this: MiriInterpCx, os_str: string, ptr: Pointer, size: bigint): InterpResult<[boolean, bigint]>;
    // shims/os_str.rs:81
    write_os_str_to_wide_str_helper(this: MiriInterpCx, os_str: string, ptr: Pointer, size: bigint, truncate: boolean): InterpResult<[boolean, bigint]>;
    // shims/os_str.rs:119
    write_os_str_to_wide_str(this: MiriInterpCx, os_str: string, ptr: Pointer, size: bigint): InterpResult<[boolean, bigint]>;
    // shims/os_str.rs:130
    write_os_str_to_wide_str_truncated(this: MiriInterpCx, os_str: string, ptr: Pointer, size: bigint): InterpResult<[boolean, bigint]>;
    // shims/os_str.rs:140
    alloc_os_str_as_c_str(this: MiriInterpCx, os_str: string, memkind: MemoryKind): InterpResult<Pointer>;
    // shims/os_str.rs:156
    alloc_os_str_as_wide_str(this: MiriInterpCx, os_str: string, memkind: MemoryKind): InterpResult<Pointer>;
    // shims/os_str.rs:172
    read_path_from_c_str(this: MiriInterpCx, ptr: Pointer): InterpResult<string>;
    // shims/os_str.rs:186
    read_path_from_wide_str(this: MiriInterpCx, ptr: Pointer): InterpResult<string>;
    // shims/os_str.rs:197
    write_path_to_c_str(this: MiriInterpCx, path: string, ptr: Pointer, size: bigint): InterpResult<[boolean, bigint]>;
    // shims/os_str.rs:211
    write_path_to_wide_str(this: MiriInterpCx, path: string, ptr: Pointer, size: bigint): InterpResult<[boolean, bigint]>;
    // shims/os_str.rs:225
    write_path_to_wide_str_truncated(this: MiriInterpCx, path: string, ptr: Pointer, size: bigint): InterpResult<[boolean, bigint]>;
    // shims/os_str.rs:239
    alloc_path_as_c_str(this: MiriInterpCx, path: string, memkind: MemoryKind): InterpResult<Pointer>;
    // shims/os_str.rs:252
    alloc_path_as_wide_str(this: MiriInterpCx, path: string, memkind: MemoryKind): InterpResult<Pointer>;
    // shims/os_str.rs:263
    convert_path(this: MiriInterpCx, os_str: string, direction: PathConversion): string;
  }
}

// shims/os_str.rs:21 (pub)
export function bytes_to_os_str(bytes: Uint8Array): InterpResult<string> {
  return unported("miri::shims::os_str::bytes_to_os_str (src/tools/miri/src/shims/os_str.rs:21; lane miri-shims-a)");
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// fn bytes_to_os_str (shims/os_str.rs:25): a `#[cfg]` variant of the one at :21 (the fill lane ports the variant the component is built with)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::os_str::EvalContextExt", "src/tools/miri/src/shims/os_str.rs", "miri-shims-a", () => InterpCx.prototype, ["read_os_str_from_c_str", "read_os_str_from_wide_str", "write_os_str_to_c_str", "write_os_str_to_wide_str_helper", "write_os_str_to_wide_str", "write_os_str_to_wide_str_truncated", "alloc_os_str_as_c_str", "alloc_os_str_as_wide_str", "read_path_from_c_str", "read_path_from_wide_str", "write_path_to_c_str", "write_path_to_wide_str", "write_path_to_wide_str_truncated", "alloc_path_as_c_str", "alloc_path_as_wide_str", "convert_path"]);
