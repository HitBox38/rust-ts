// Stub module (lane mt-built-lints): compiler/rustc_mir_transform/src/ffi_unwind_calls.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import type { Providers } from "../rustc_middle/util/mod.ts";

// stub: compiler/rustc_mir_transform/src/ffi_unwind_calls.rs:175 provide (lane mt-built-lints)
// Not ported yet: sets nothing, so `has_ffi_unwind_calls` and `required_panic_strategy` keep rustc_interface's default
// `unported("<query> provider (not ported)")` providers (passes.ts `install_unported_providers`).
export function provide(_providers: Providers["queries"]): void {}
