// Port of compiler/rustc_codegen_llvm/src/value.rs (lane cg-contract).
//
// PORT (cg-contract): `llvm::Value` is the IR model's handle (ffi.ts). `PartialEq`/`Eq` are pointer identity, so `===`
// (`Value_eq`); value-keyed maps (`FxHashMap<&Value, _>`) key on the object itself (PORTING §5), so `Hash` is never
// called by ported code.
import type { Debug } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import { expect_result } from "../std/result.ts";
import * as llvm from "./llvm/mod.ts";
import type { Value } from "./llvm/mod.ts";

// impl PartialEq for Value
// rustc: compiler/rustc_codegen_llvm/src/value.rs:7 eq
export function Value_eq(self: Value, other: Value): boolean {
  // ptr::eq(self, other)
  return self === other;
}

// impl Eq for Value {}

// impl Hash for Value
// rustc: compiler/rustc_codegen_llvm/src/value.rs:15 hash
export function hash_Value(_self: Value, /** `&mut H` (`H: Hasher`) */ _hasher: unknown): void {
  // (self as *const Self).hash(hasher);
  // PORT: a pointer address has no TS form, and nothing hashes a `Value` (maps key on the object, header).
  return unported("rustc_codegen_llvm::value::<Value as Hash>::hash (pointer address)");
}

// impl fmt::Debug for Value
// rustc: compiler/rustc_codegen_llvm/src/value.rs:21 fmt
export const debug_Value: Debug<Value> = (self) => {
  return expect_result(
    llvm.build_string((s) => {
      llvm.LLVMRustWriteValueToString(self, s);
    }),
    "non-UTF8 value description from LLVM",
    llvm.debug_FromUtf8Error,
  );
};
