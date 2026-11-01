// Port of src/tools/miri/src/alloc_addresses/address_generator.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-alloc` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into address_generator.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { AddressGenerator } from "./address_generator.gen.ts";
import { stub_methods, stub_statics } from "../../rust_ts/miri_stub.ts";
import { type Align, type Size } from "../../rustc_abi/lib.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type Pending } from "../../rustc_type_ir/decls.ts";
export * from "./address_generator.gen.ts";

declare module "./address_generator.gen.ts" {
  interface AddressGenerator {
    // alloc_addresses/address_generator.rs:33
    get_remaining(): Pending<"Range<u64>">;
    // alloc_addresses/address_generator.rs:40
    generate<R>(size: Size, align: Align, rng: R): InterpResult<bigint>;
  }
  namespace AddressGenerator {
    // alloc_addresses/address_generator.rs:28
    function new_(addr_range: Pending<"Range<u64>">): AddressGenerator;
    export { new_ as new };
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// #[cfg(test)] mod tests (alloc_addresses/address_generator.rs:70): unit tests (port into a `.test.ts` next to this file)
// fn align_addr (alloc_addresses/address_generator.rs:10)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::alloc_addresses::address_generator::AddressGenerator", "src/tools/miri/src/alloc_addresses/address_generator.rs", "miri-alloc", () => AddressGenerator.prototype, ["get_remaining", "generate"]);
stub_statics("miri::alloc_addresses::address_generator::AddressGenerator", "src/tools/miri/src/alloc_addresses/address_generator.rs", "miri-alloc", () => AddressGenerator, ["new"]);
