// compiler/rustc_codegen_ssa/src/back/write.rs: NOT PORTED YET (lane ssa-write, plan-m7 wave 41 per the review's F2).
//
// PORT (ssa-contract): the type surface the traits (traits/write.ts) need, placed in the file lane ssa-write will
// port. `TargetMachineFactoryConfig`, `TargetMachineFactoryFn`, `FatLtoInput` and `ThinLtoInput` are their upstream
// shapes; `ModuleConfig`, `CodegenContext` and `SharedEmitter` are opaque placeholders (branded, never constructed)
// until ssa-write ports the structs.
import type { DiagCtxtHandle } from "../../rustc_errors/lib.ts";
import type { PathBuf } from "../../rustc_error_messages/lib.ts";
import type { ModuleCodegen } from "../lib.ts";
import type { WorkProduct, WriteBackendTypes } from "../traits/write.ts";
import type { SerializedModule } from "./lto.ts";

/// Module-specific configuration for `optimize_and_codegen`.
/** Placeholder (ssa-contract): `pub struct ModuleConfig` (back/write.rs:72), lane ssa-write. */
export interface ModuleConfig {
  readonly __ModuleConfig: never;
}

/// Configuration passed to the function returned by the `target_machine_factory`.
export interface TargetMachineFactoryConfig {
  /// Split DWARF is enabled in LLVM by checking that `TM.MCOptions.SplitDwarfFile` isn't empty,
  /// so the path to the dwarf object has to be provided when we create the target machine.
  /// This can be ignored by backends which do not need it for their Split DWARF support.
  split_dwarf_file: PathBuf | undefined;

  /// The name of the output object file. Used for setting OutputFilenames in target options
  /// so that LLVM can emit the CodeView S_OBJNAME record in pdb files
  output_obj_file: PathBuf | undefined;
}

/** `Arc<dyn Fn(DiagCtxtHandle<'_>, TargetMachineFactoryConfig) -> <B as WriteBackendMethods>::TargetMachine + Send + Sync>` */
export type TargetMachineFactoryFn<W extends WriteBackendTypes> = (
  dcx: DiagCtxtHandle,
  config: TargetMachineFactoryConfig,
) => W["TargetMachine"];

/// Additional resources used by optimize_and_codegen (not module specific)
/** Placeholder (ssa-contract): `pub struct CodegenContext` (back/write.rs:322), lane ssa-write. */
export interface CodegenContext {
  readonly __CodegenContext: never;
}

export type FatLtoInput<W extends WriteBackendTypes> =
  | { readonly $: "Serialized"; name: string; bitcode_path: PathBuf }
  | { readonly $: "InMemory"; _0: ModuleCodegen<W["Module"]> };

export type ThinLtoInput<W extends WriteBackendTypes> =
  | { readonly $: "Red"; name: string; buffer: SerializedModule<W["ModuleBuffer"]> }
  | { readonly $: "Green"; wp: WorkProduct; bitcode_path: PathBuf };

/** Placeholder (ssa-contract): `pub struct SharedEmitter` (back/write.rs:1961), lane ssa-write. */
export interface SharedEmitter {
  readonly __SharedEmitter: never;
}
