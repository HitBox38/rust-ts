// Port of compiler/rustc_codegen_ssa/src/traits/write.rs (lane ssa-contract).
//
// PORT (ssa-contract, plan-m6 D3 pattern, as backend.ts's `BackendTypes`):
// - The associated types (`Module`, `TargetMachine`, `ModuleBuffer`, `ThinData`) are the type record
//   `WriteBackendTypes`; `B: WriteBackendMethods` in a signature (`ThinModule<B>`, `FatLtoInput<B>`, ...) is
//   `W extends WriteBackendTypes`, and `B::Module` is `W["Module"]`.
// - The trait's associated fns without `self` (`thread_profiler`, `optimize_and_codegen_fat_lto`, `run_thin_lto`,
//   `optimize`, `optimize_and_codegen_thin`, `codegen`, `serialize_module`) are members of the same interface, called
//   on the backend value that stands for the type `B` (the QueryTypeOp descriptor pattern): where upstream writes
//   `B::codegen(..)`, generic code takes that value (`B_: WriteBackendMethods<W>`) and writes `B_.codegen(..)`.
// - `Clone + 'static`, `Send + Sync` are erased.
import type { SelfProfilerRef } from "../../rustc_session/stand_ins.ts";
import type { DiagCtxtHandle } from "../../rustc_errors/lib.ts";
import type { PathBuf } from "../../rustc_error_messages/lib.ts";
import type { OptLevel } from "../../rustc_session/config.ts";
import type { Session } from "../../rustc_session/session.ts";
import type { ThinModule } from "../back/lto.ts";
import type {
  CodegenContext,
  FatLtoInput,
  ModuleConfig,
  SharedEmitter,
  TargetMachineFactoryFn,
  ThinLtoInput,
} from "../back/write.ts";
import type { CompiledModule, ModuleCodegen } from "../lib.ts";

/** PORT (ssa-contract): `rustc_middle::dep_graph::WorkProduct` (incremental, out of scope; rustc_middle mono.ts says
 *  it is not ported): never constructed, so `Vec<WorkProduct>` is always empty. */
export type WorkProduct = never;

/** PORT (ssa-contract): the associated types of `WriteBackendMethods` (header). */
export interface WriteBackendTypes {
  /** `type Module: Send + Sync;` */
  Module: unknown;
  /** `type TargetMachine;` */
  TargetMachine: unknown;
  /** `type ModuleBuffer: ModuleBufferMethods;` */
  ModuleBuffer: ModuleBufferMethods;
  /** `type ThinData: Send + Sync;` */
  ThinData: unknown;
}

// rustc-trait: compiler/rustc_codegen_ssa/src/traits/write.rs:16 WriteBackendMethods
export interface WriteBackendMethods<W extends WriteBackendTypes> {
  /** PORT (plan-m6 D3): type-level only (never set): the associated types. */
  readonly __write_backend_types?: W;

  /// Returns `true` if this backend can be safely called from multiple threads.
  ///
  /// Defaults to `true`.
  // (provided) traits/write.rs:25 supports_parallel -> WriteBackendMethods_provided.supports_parallel
  supports_parallel(): boolean;
  /** Associated fn (no `self`). `-> Box<dyn Any>` */
  // (provided) traits/write.rs:28 thread_profiler -> WriteBackendMethods_provided.thread_profiler
  thread_profiler(): unknown;
  // rustc: compiler/rustc_codegen_ssa/src/traits/write.rs:31 target_machine_factory
  target_machine_factory(sess: Session, opt_level: OptLevel): TargetMachineFactoryFn<W>;
  /// Performs fat LTO by merging all modules into a single one, running autodiff
  /// if necessary and running any further optimizations
  /** Associated fn (no `self`). */
  // rustc: compiler/rustc_codegen_ssa/src/traits/write.rs:38 optimize_and_codegen_fat_lto
  optimize_and_codegen_fat_lto(
    sess: Session,
    cgcx: CodegenContext,
    shared_emitter: SharedEmitter,
    tm_factory: TargetMachineFactoryFn<W>,
    exported_symbols_for_lto: readonly string[],
    each_linked_rlib_for_lto: readonly PathBuf[],
    modules: FatLtoInput<W>[],
  ): CompiledModule;
  /// Performs thin LTO by performing necessary global analysis and returning two
  /// lists, one of the modules that need optimization and another for modules that
  /// can simply be copied over from the incr. comp. cache.
  /** Associated fn (no `self`). */
  // rustc: compiler/rustc_codegen_ssa/src/traits/write.rs:50 run_thin_lto
  run_thin_lto(
    cgcx: CodegenContext,
    prof: SelfProfilerRef,
    dcx: DiagCtxtHandle,
    exported_symbols_for_lto: readonly string[],
    each_linked_rlib_for_lto: readonly PathBuf[],
    modules: ThinLtoInput<W>[],
  ): [ThinModule<W>[], WorkProduct[]];
  /** Associated fn (no `self`). `module: &mut ModuleCodegen<Self::Module>` */
  // rustc: compiler/rustc_codegen_ssa/src/traits/write.rs:58 optimize
  optimize(
    cgcx: CodegenContext,
    prof: SelfProfilerRef,
    shared_emitter: SharedEmitter,
    module: ModuleCodegen<W["Module"]>,
    config: ModuleConfig,
  ): void;
  /** Associated fn (no `self`). */
  // rustc: compiler/rustc_codegen_ssa/src/traits/write.rs:65 optimize_and_codegen_thin
  optimize_and_codegen_thin(
    cgcx: CodegenContext,
    prof: SelfProfilerRef,
    shared_emitter: SharedEmitter,
    tm_factory: TargetMachineFactoryFn<W>,
    thin: ThinModule<W>,
  ): CompiledModule;
  /** Associated fn (no `self`). */
  // rustc: compiler/rustc_codegen_ssa/src/traits/write.rs:72 codegen
  codegen(
    cgcx: CodegenContext,
    prof: SelfProfilerRef,
    shared_emitter: SharedEmitter,
    module: ModuleCodegen<W["Module"]>,
    config: ModuleConfig,
  ): CompiledModule;
  /** Associated fn (no `self`). */
  // rustc: compiler/rustc_codegen_ssa/src/traits/write.rs:79 serialize_module
  serialize_module(module: W["Module"], is_thin: boolean): W["ModuleBuffer"];
}

/** The provided methods of `WriteBackendMethods` (PORTING §8; `self` first where upstream has one). */
export const WriteBackendMethods_provided = {
  /// Returns `true` if this backend can be safely called from multiple threads.
  ///
  /// Defaults to `true`.
  // rustc: compiler/rustc_codegen_ssa/src/traits/write.rs:25 supports_parallel
  supports_parallel<W extends WriteBackendTypes>(_self: WriteBackendMethods<W>): boolean {
    return true;
  },
  /** `Box::new(())`: the unit value. */
  // rustc: compiler/rustc_codegen_ssa/src/traits/write.rs:28 thread_profiler
  thread_profiler(): unknown {
    return undefined;
  },
};

// rustc-trait: compiler/rustc_codegen_ssa/src/traits/write.rs:82 ModuleBufferMethods
export interface ModuleBufferMethods {
  // rustc: compiler/rustc_codegen_ssa/src/traits/write.rs:83 data
  data(): Uint8Array;
}

/** `impl ModuleBufferMethods for Infallible`: `Infallible` is `never`, so this impl is never called. */
export const ModuleBufferMethods_for_Infallible = {
  // rustc: compiler/rustc_codegen_ssa/src/traits/write.rs:87 data
  data(self: never): Uint8Array {
    // match *self {}
    return self;
  },
};
