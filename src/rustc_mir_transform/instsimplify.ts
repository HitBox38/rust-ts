// Stub module (lane mt-opt1): compiler/rustc_mir_transform/src/instsimplify.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../std/panic.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, type PassPolicy } from "./pass_manager.ts";

// stub: compiler/rustc_mir_transform/src/instsimplify.rs:17 InstSimplify (lane mt-opt1)
// PORT: a pass enum (pass_manager.ts header): one frozen instance per variant, tagged `$`.
export type InstSimplify_variant = "BeforeInline" | "AfterSimplifyCfg";
export class InstSimplify extends MirPass {
  readonly type_name = "rustc_mir_transform::instsimplify::InstSimplify";

  private constructor(readonly $: InstSimplify_variant) {
    super();
    Object.freeze(this);
  }

  static readonly BeforeInline = new InstSimplify("BeforeInline");
  static readonly AfterSimplifyCfg = new InstSimplify("AfterSimplifyCfg");

  // rustc: compiler/rustc_mir_transform/src/instsimplify.rs:23 name
  override name(): string {
    switch (this.$) {
      case "BeforeInline":
        return "InstSimplify-before-inline";
      case "AfterSimplifyCfg":
        return "InstSimplify-after-simplifycfg";
    }
  }

  policy(_ctx: PassCtx): PassPolicy {
    return unported("rustc_mir_transform::instsimplify::InstSimplify (pass not ported)");
  }

  run_pass(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::instsimplify::InstSimplify (pass not ported)");
  }
}
