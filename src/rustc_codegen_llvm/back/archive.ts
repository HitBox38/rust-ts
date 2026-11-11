// compiler/rustc_codegen_llvm/src/back/archive.rs: the SKELETON (lane cg-contract). The fill lane cg-write (plan-m7 §8
// wave 42) owns this file and ports archive.rs here, replacing each `Stub (cg-contract)` with its port.
//
// What is here: `LlvmArchiveBuilderBuilder` (a unit struct, so a const) with `impl ArchiveBuilderBuilder` as a stub, for
// back/llvm_backend.ts's `link`.
import type { ArchiveBuilder, ArchiveBuilderBuilder } from "../../rustc_codegen_ssa/back/archive.ts";
import type { Session } from "../../rustc_session/session.ts";
import { unported } from "../../std/panic.ts";

/** `pub(crate) struct LlvmArchiveBuilderBuilder;` with `impl ArchiveBuilderBuilder for LlvmArchiveBuilderBuilder`. */
export const LlvmArchiveBuilderBuilder: ArchiveBuilderBuilder = {
  // Stub (cg-contract): ArchiveBuilderBuilder::new_archive_builder
  new_archive_builder(_sess: Session): ArchiveBuilder {
    return unported("cg-write: compiler/rustc_codegen_llvm/src/back/archive.rs new_archive_builder");
  },
};
