// Port of src/tools/miri/src/shims/foreign_items.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-a` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into foreign_items.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type MPlaceTy, type OpTy, type PlaceTy, type Pointer } from "../lib.ts";
import { type MiriInterpCx } from "../machine.ts";
import { DynSym } from "./foreign_items.gen.ts";
import { type EmulateItemResult } from "./mod.ts";
import { stub_methods, stub_statics } from "../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type BasicBlock, type Body, type UnwindAction } from "../../rustc_middle/mir/mod.ts";
import { type FnAbi } from "../../rustc_middle/ty/decls.ts";
import { type Instance } from "../../rustc_middle/ty/instance.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { type Symbol } from "../../rustc_span/symbol.ts";
export * from "./foreign_items.gen.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/foreign_items.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/foreign_items.rs:44
    emulate_foreign_item(this: MiriInterpCx, link_name: Symbol, abi: FnAbi<Ty>, args: readonly OpTy[], dest: PlaceTy, ret: BasicBlock | undefined, unwind: UnwindAction): InterpResult<[Body, Instance] | undefined>;
    // shims/foreign_items.rs:89
    is_dyn_sym(this: MiriInterpCx, name: string): boolean;
    // shims/foreign_items.rs:99
    emulate_dyn_sym(this: MiriInterpCx, sym: DynSym, abi: FnAbi<Ty>, args: readonly OpTy[], dest: PlaceTy, ret: BasicBlock | undefined, unwind: UnwindAction): InterpResult;
    // shims/foreign_items.rs:114
    lookup_exported_symbol(this: MiriInterpCx, link_name: Symbol): InterpResult<Instance | undefined>;
    // shims/foreign_items.rs:217
    lookup_exported_fn(this: MiriInterpCx, link_name: Symbol): InterpResult<[Body, Instance] | undefined>;
    // shims/foreign_items.rs:237
    lookup_exported_static(this: MiriInterpCx, link_name: Symbol): InterpResult<Instance | undefined>;
    // ---- shims/foreign_items.rs: `trait EvalContextExtPriv` (impl for `MiriInterpCx`) ----
    // shims/foreign_items.rs:256
    emulate_foreign_item_inner(this: MiriInterpCx, link_name: Symbol, abi: FnAbi<Ty>, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult>;
    // shims/foreign_items.rs:937
    memchr(this: MiriInterpCx, ptr: Pointer, idxs: Iterable<bigint>, needle: number): InterpResult<[bigint, Pointer] | undefined>;
  }
}

declare module "./foreign_items.gen.ts" {
  namespace DynSym {
    // shims/foreign_items.rs:31
    export let from_str: (name: string) => DynSym;
  }
}

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::foreign_items::EvalContextExt", "src/tools/miri/src/shims/foreign_items.rs", "miri-shims-a", () => InterpCx.prototype, ["emulate_foreign_item", "is_dyn_sym", "emulate_dyn_sym", "lookup_exported_symbol", "lookup_exported_fn", "lookup_exported_static"]);
stub_methods("miri::shims::foreign_items::EvalContextExtPriv", "src/tools/miri/src/shims/foreign_items.rs", "miri-shims-a", () => InterpCx.prototype, ["emulate_foreign_item_inner", "memchr"]);
stub_statics("miri::shims::foreign_items::DynSym", "src/tools/miri/src/shims/foreign_items.rs", "miri-shims-a", () => DynSym, ["from_str"]);
