// Stub module (lane mt-shim): compiler/rustc_mir_transform/src/shim.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../std/panic.ts";
import type { Providers } from "../rustc_middle/util/mod.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import type { Ty } from "../rustc_middle/ty/decls.ts";
import type { TypingEnv } from "../rustc_middle/ty/mod.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";

// stub: compiler/rustc_mir_transform/src/shim.rs:28 provide (lane mt-shim)
// Not ported yet: sets nothing, so `mir_shims` keep rustc_interface's default `unported("<query> provider (not
// ported)")` providers (passes.ts `install_unported_providers`).
export function provide(_providers: Providers["queries"]): void {}

// stub: compiler/rustc_mir_transform/src/shim.rs:258 build_drop_shim (lane mt-shim)
export function build_drop_shim(_tcx: TyCtxt, _def_id: DefId, _ty: Ty | undefined, _typing_env: TypingEnv): Body {
  return unported("rustc_mir_transform::shim::build_drop_shim");
}

// stub: compiler/rustc_mir_transform/src/shim.rs:994 build_adt_ctor (lane mt-shim)
export function build_adt_ctor(_tcx: TyCtxt, _ctor_id: DefId): Body {
  return unported("rustc_mir_transform::shim::build_adt_ctor");
}
