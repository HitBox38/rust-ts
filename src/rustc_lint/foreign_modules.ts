// Port of compiler/rustc_lint/src/foreign_modules.rs: `provide` and `lint_vec`; the
// `clashing_extern_declarations` query and its helpers need the HIR and `ty` (M3): stubs, no markers.
// The `declare_lint!` static is generated (foreign_modules.lints.gen.ts).
import type { LintVec } from "../rustc_lint_defs/lib.ts";
import type { Providers as QueryProviders } from "../rustc_middle/queries.gen.ts";
import { unported } from "../std/panic.ts";
import { CLASHING_EXTERN_DECLARATIONS } from "./foreign_modules.lints.gen.ts";

export * from "./foreign_modules.lints.gen.ts";

// rustc: compiler/rustc_lint/src/foreign_modules.rs:15 provide
export function provide(providers: QueryProviders): void {
  providers.clashing_extern_declarations = clashing_extern_declarations;
}

// rustc: compiler/rustc_lint/src/foreign_modules.rs:19 lint_vec
export function lint_vec(): LintVec {
  return [CLASHING_EXTERN_DECLARATIONS];
}

/** `fn clashing_extern_declarations` (foreign_modules.rs:23). PORT: stub (HIR, M3). */
function clashing_extern_declarations(_tcx: unknown, _: null): never {
  return unported("rustc_lint::foreign_modules::clashing_extern_declarations (HIR, M3)");
}
