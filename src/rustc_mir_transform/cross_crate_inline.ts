// Stub module (lane mt-inline): compiler/rustc_mir_transform/src/cross_crate_inline.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import type { Providers } from "../rustc_middle/util/mod.ts";

// stub: compiler/rustc_mir_transform/src/cross_crate_inline.rs:14 provide (lane mt-inline)
// Not ported yet: sets nothing, so `cross_crate_inlinable` keep rustc_interface's default `unported("<query> provider
// (not ported)")` providers (passes.ts `install_unported_providers`).
export function provide(_providers: Providers["queries"]): void {}
