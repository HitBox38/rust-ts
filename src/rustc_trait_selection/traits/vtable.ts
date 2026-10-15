// Port of compiler/rustc_trait_selection/src/traits/vtable.rs (lane old-vtable-liveness, wave 18b).
//
// Contract stub (lane selcx-contract). `VtblSegment` is generated (./vtable.gen.ts). The pub fns are signature-typed
// stubs; the private fns (vtable.rs:36 prepare_vtable_segments_inner, :190 maybe_iter, :194
// has_own_existential_vtable_entries, :198 own_existential_vtable_entries, :202 own_existential_vtable_entries_iter, :233
// vtable_entries) are ported as module-local functions. `provide` (vtable.rs:439) is not wired into `traits::provide`
// (mod.ts) until the providers are real: the queries keep the driver's "<query> provider (not ported)" placeholders.
// Fill: replace the stub bodies, markers `// rustc: compiler/rustc_trait_selection/src/traits/vtable.rs:<line> <name>`
// directly above; then uncomment `vtable::provide(providers)` in mod.ts's `provide`.
// PORT: `segment_visitor: impl FnMut(VtblSegment) -> ControlFlow<T>` is a closure; `Option<T>` is `T | undefined`.
// Init order: top-level code here touches only ./vtable.gen.ts and other crates.

import type { ControlFlow } from "../../rustc_ast_ir/visit.ts";
import type { Providers } from "../../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/decls.ts";
import type { TraitRef } from "../../rustc_type_ir/decls.ts";
import { unported } from "../../std/panic.ts";
import type { VtblSegment } from "./vtable.gen.ts";

export * from "./vtable.gen.ts";

function stub(name: string): never {
  return unported(`rustc_trait_selection::traits::vtable::${name}`);
}

// vtable.rs:26 (stub)
export function prepare_vtable_segments<T>(_tcx: TyCtxt, _trait_ref: TraitRef, _segment_visitor: (segment: VtblSegment) => ControlFlow<T>): T | undefined {
  return stub("prepare_vtable_segments");
}

/// Given a `dyn Subtrait: Supertrait` trait ref, find corresponding first slot
/// for `Supertrait`'s methods in the vtable of `Subtrait`.
// vtable.rs:312 (stub)
export function first_method_vtable_slot(_tcx: TyCtxt, _key: TraitRef): number {
  return stub("first_method_vtable_slot");
}

/// Given a `dyn Subtrait` and `dyn Supertrait` trait object, find the slot of
/// the trait vptr in the subtrait's vtable.
///
/// A return value of `None` means that the original vtable can be reused.
// vtable.rs:365 (stub)
export function supertrait_vtable_slot(_tcx: TyCtxt, _key: [Ty, Ty]): number | undefined {
  return stub("supertrait_vtable_slot");
}

// vtable.rs:439 (stub; not wired, see the header)
export function provide(_providers: Providers): void {
  stub("provide");
}
