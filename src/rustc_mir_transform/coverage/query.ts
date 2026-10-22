// Stub module (lane mt-coverage): compiler/rustc_mir_transform/src/coverage/query.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import type { Providers } from "../../rustc_middle/util/mod.ts";

// stub: compiler/rustc_mir_transform/src/coverage/query.rs:19 provide (lane mt-coverage)
// Not ported yet: sets nothing, so the coverage queries (`is_eligible_for_coverage`, `coverage_attr_on`,
// `coverage_codegen_info`, ...) keep rustc_interface's default `unported("<query> provider (not ported)")` providers
// (passes.ts `install_unported_providers`).
export function provide(_providers: Providers): void {}
