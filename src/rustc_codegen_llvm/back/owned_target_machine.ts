// compiler/rustc_codegen_llvm/src/back/owned_target_machine.rs: the SKELETON (lane cg-contract). The fill lane cg-write
// (plan-m7 §8 wave 42) owns this file and ports owned_target_machine.rs here.
//
// What is here: the struct `OwnedTargetMachine` (its field, and its `Drop` as a stub), the `TargetMachine` associated type of
// `impl WriteBackendMethods for LlvmCodegenBackend` (back/llvm_backend.ts).
import { unported } from "../../std/panic.ts";
import type { TargetMachine } from "../llvm/mod.ts";

/// Responsible for safely creating and disposing llvm::TargetMachine via ffi functions.
/// Not cloneable as there is no clone function for llvm::TargetMachine.
export class OwnedTargetMachine {
  constructor(
    /** `tm_unique: NonNull<llvm::TargetMachine>` (`phantom: PhantomData` erased) */
    public tm_unique: TargetMachine,
  ) {}

  // impl Drop for OwnedTargetMachine
  // Stub (cg-contract): OwnedTargetMachine::drop (owned_target_machine.rs)
  drop(): void {
    return unported("cg-write: compiler/rustc_codegen_llvm/src/back/owned_target_machine.rs drop");
  }
}
