// Port of compiler/rustc_mir_transform/src/check_packed_ref.rs (lane mt-built-lints).
//
// PORT: `PackedRefChecker` is a class extending rustc_middle mir/visit.ts's `Visitor` (D4); `crate::util` is
// rustc_const_eval's `util` (`use rustc_const_eval::util;` in lib.rs), whose alignment.rs is imported directly.
import { place_unalignment } from "../rustc_const_eval/util/alignment.ts";
import { type Body, type Location, type Place, SourceInfo, type Statement, type Terminator } from "../rustc_middle/mir/mod.ts";
import { PlaceContext, Visitor } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { InstanceKind } from "../rustc_middle/ty/instance.ts";
import type { TypingEnv } from "../rustc_middle/ty/mod.ts";
import { span_bug } from "../rustc_span/macros.ts";
import * as diagnostics from "./diagnostics.ts";
import { MirLint } from "./pass_manager.ts";

// rustc-type: compiler/rustc_mir_transform/src/check_packed_ref.rs:8 CheckPackedRef
export class CheckPackedRef extends MirLint {
  readonly type_name = "rustc_mir_transform::check_packed_ref::CheckPackedRef";

  // impl<'tcx> crate::MirLint<'tcx> for CheckPackedRef
  // rustc: compiler/rustc_mir_transform/src/check_packed_ref.rs:11 run_lint
  run_lint(tcx: TyCtxt, body: Body): void {
    const typing_env = body.typing_env(tcx);
    const source_info = SourceInfo.outermost(body.span);
    const checker = new PackedRefChecker(body, tcx, typing_env, source_info);
    checker.visit_body(body);
  }
}

// rustc-type: compiler/rustc_mir_transform/src/check_packed_ref.rs:19 PackedRefChecker
class PackedRefChecker extends Visitor {
  constructor(
    public body: Body,
    public tcx: TyCtxt,
    public typing_env: TypingEnv,
    public source_info: SourceInfo,
  ) {
    super();
  }

  // impl<'tcx> Visitor<'tcx> for PackedRefChecker<'_, 'tcx>
  // rustc: compiler/rustc_mir_transform/src/check_packed_ref.rs:27 visit_terminator
  override visit_terminator(terminator: Terminator, location: Location): void {
    // Make sure we know where in the MIR we are.
    this.source_info = terminator.source_info;
    this.super_terminator(terminator, location);
  }

  // rustc: compiler/rustc_mir_transform/src/check_packed_ref.rs:33 visit_statement
  override visit_statement(statement: Statement, location: Location): void {
    // Make sure we know where in the MIR we are.
    this.source_info = statement.source_info;
    this.super_statement(statement, location);
  }

  // rustc: compiler/rustc_mir_transform/src/check_packed_ref.rs:39 visit_place
  override visit_place(place: Place, context: PlaceContext, _location: Location): void {
    if (!PlaceContext.is_borrow(context)) return;
    const found = place_unalignment(this.tcx, this.body, this.typing_env, place);
    if (found !== undefined) {
      const [adt, pack] = found;
      const def_id = InstanceKind.def_id(this.body.source.instance);
      const impl_def_id = this.tcx.trait_impl_of_assoc(def_id);
      if (impl_def_id !== undefined && this.tcx.is_builtin_derived(impl_def_id)) {
        // If we ever reach here it means that the generated derive
        // code is somehow doing an unaligned reference, which it
        // shouldn't do.
        span_bug(this.source_info.span, "builtin derive created an unaligned reference");
      } else {
        this.tcx.dcx().emit_err(
          diagnostics.UnalignedPackedRef_diagnostic({
            span: this.source_info.span,
            ty_descr: adt.descr(),
            align: pack.bytes(),
          }),
        );
      }
    }
  }
}
