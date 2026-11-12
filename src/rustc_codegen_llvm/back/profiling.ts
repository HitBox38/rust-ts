// compiler/rustc_codegen_llvm/src/back/profiling.rs (lane cg-write, plan-m7 wave 42). Ported whole.
//
// PORT: the self-profiler (`-Z self-profile`: rustc_data_structures::profiling's `SelfProfiler` and `TimingGuard`, and the
// measureme crate) is not ported: `SelfProfilerRef` is a stand-in that never holds a profiler (rustc_session/stand_ins.ts), so
// `llvm_optimize` never builds an `LlvmSelfProfiler` (`prof.llvm_recording_enabled()` is false). The types below are placeholders
// with upstream's names; what only the profiler or measureme could answer stops with `unported(..)`. The callbacks are
// `unsafe extern "C" fn`s LLVM calls through `LLVMRustOptimize`, which is the IR model's stop.
import { unported } from "../../std/panic.ts";
import { display_Demangle, demangle } from "../../vendor/rustc_demangle/lib.ts";

/** Placeholder: measureme's `StringId` (a `u32` newtype). */
export type StringId = number & { readonly __brand: "StringId" };
/** Placeholder: measureme's `EventId(StringId)`. */
export type EventId = StringId & { readonly __event: true };
/** measureme's `StringComponent<'s>`. */
export type StringComponent = { readonly $: "Value"; readonly _0: string } | { readonly $: "Ref"; readonly _0: StringId };
/** measureme `event_id.rs:19`: `pub const SEPARATOR_BYTE: &str = "\x1E";` */
const SEPARATOR_BYTE = "\x1E";

/** Placeholder: the part of rustc_data_structures::profiling's `SelfProfiler` this file calls. Never constructed (header). */
export interface SelfProfiler {
  get_or_alloc_cached_string(s: string): StringId;
  alloc_string(s: string | readonly StringComponent[]): StringId;
}
/** Placeholder: rustc_data_structures::profiling's `TimingGuard<'a>`; dropping it records the event's end. */
export interface TimingGuard {
  drop(): void;
}

/** measureme's `EventId::from_label`: `EventId(label)`. */
function EventId_from_label(label: StringId): EventId {
  return label as EventId;
}

/** rustc_data_structures::profiling's `TimingGuard::start` (not ported, header). */
function TimingGuard_start(_profiler: SelfProfiler, _event_kind: StringId, _event_id: EventId): TimingGuard {
  return unported("rustc_data_structures: compiler/rustc_data_structures/src/profiling.rs TimingGuard::start (-Z self-profile)");
}

// rustc: compiler/rustc_codegen_llvm/src/back/profiling.rs:9 llvm_args_to_string_id
function llvm_args_to_string_id(profiler: SelfProfiler, pass_name: string, ir_name: string): EventId {
  const pass_name_ = profiler.get_or_alloc_cached_string(pass_name);
  const components: StringComponent[] = [{ $: "Ref", _0: pass_name_ }];
  // handle that LazyCallGraph::SCC is a comma separated list within parentheses
  // let parentheses: &[_] = &['(', ')'];
  // let trimmed = ir_name.trim_matches(parentheses);
  const trimmed = ir_name.replace(/^[()]+/, "").replace(/[()]+$/, "");
  for (const part of trimmed.split(", ")) {
    const demangled_ir_name = display_Demangle(demangle(part), false);
    const ir_name_ = profiler.get_or_alloc_cached_string(demangled_ir_name);
    components.push({ $: "Value", _0: SEPARATOR_BYTE });
    components.push({ $: "Ref", _0: ir_name_ });
  }
  return EventId_from_label(profiler.alloc_string(components));
}

export class LlvmSelfProfiler {
  constructor(
    /** `profiler: Arc<SelfProfiler>` */
    public profiler: SelfProfiler,
    /** `stack: Vec<TimingGuard<'a>>` */
    public stack: TimingGuard[],
    public llvm_pass_event_kind: StringId,
  ) {}

  // rustc: compiler/rustc_codegen_llvm/src/back/profiling.rs:31 new
  static new(profiler: SelfProfiler): LlvmSelfProfiler {
    const llvm_pass_event_kind = profiler.alloc_string("LLVM Pass");
    return new LlvmSelfProfiler(profiler, [], llvm_pass_event_kind);
  }

  // rustc: compiler/rustc_codegen_llvm/src/back/profiling.rs:36 before_pass_callback
  before_pass_callback(pass_name: string, ir_name: string): void {
    const event_id = llvm_args_to_string_id(this.profiler, pass_name, ir_name);

    this.stack.push(TimingGuard_start(this.profiler, this.llvm_pass_event_kind, event_id));
  }
  // rustc: compiler/rustc_codegen_llvm/src/back/profiling.rs:41 after_pass_callback
  after_pass_callback(): void {
    // self.stack.pop(); (the popped guard drops)
    this.stack.pop()?.drop();
  }
}

/** `unsafe extern "C" fn(llvm_self_profiler: *mut c_void, pass_name: *const c_char, ir_name: *const c_char)`. */
// rustc: compiler/rustc_codegen_llvm/src/back/profiling.rs:46 selfprofile_before_pass_callback
export function selfprofile_before_pass_callback(llvm_self_profiler: unknown, pass_name: string, ir_name: string): void {
  // unsafe {
  const llvm_self_profiler_ = llvm_self_profiler as LlvmSelfProfiler;
  // PORT: `CStr::from_ptr(..).to_str().expect("valid UTF-8")`: the strings arrive as JS text, so the `expect` cannot fail.
  llvm_self_profiler_.before_pass_callback(pass_name, ir_name);
  // }
}

/** `unsafe extern "C" fn(llvm_self_profiler: *mut c_void)`. */
// rustc: compiler/rustc_codegen_llvm/src/back/profiling.rs:59 selfprofile_after_pass_callback
export function selfprofile_after_pass_callback(llvm_self_profiler: unknown): void {
  const llvm_self_profiler_ = llvm_self_profiler as LlvmSelfProfiler;
  llvm_self_profiler_.after_pass_callback();
}
