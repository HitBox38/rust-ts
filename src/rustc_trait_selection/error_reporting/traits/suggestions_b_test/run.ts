// Test helper of ../suggestions_b.test.ts (lane errrep-sugg-b).
//
// Runs the ported driver up to expansion, then the tydump analysis prefix (src/rust_ts/tydump_dump.ts
// `run_required_analyses_prefix`: run_required_analyses up to type checking, wfcheck included), with
// `TypeErrCtxt::report_fulfillment_errors` (lane errrep-traits-a, not ported on this branch) replaced by a TEST
// stand-in: for each error it builds an `E0277` diagnostic with a placeholder primary message at
// `error.obligation.cause.span` and adds what `note_obligation_cause` (fulfillment_errors.rs:3144, lane errrep-traits-b)
// adds first: `maybe_note_obligation_cause_for_async_await`, else `note_obligation_cause_code` (this lane). The test
// compares only the sub-diagnostics these add (JSON `children`) with the oracle's.
//
//   bun run.ts <rustc arguments...>
import type { Compiler } from "../../../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../../../rustc_middle/ty/context.ts";

async function main(args: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../../rustc_driver_impl/lib.ts");
  await import("../../../lib.ts");
  const { TypeErrCtxt } = await import("../../../decls.ts");
  type TypeErrCtxt = import("../../../decls.ts").TypeErrCtxt;
  const { E0277 } = await import("../../../../rustc_errors/lib.ts");
  const { DefIdSet } = await import("../../../../rustc_span/def_id.ts");
  const { upcast_from_self } = await import("../../../../rustc_type_ir/upcast.ts");
  const { run_required_analyses_prefix } = await import("../../../../rust_ts/tydump_dump.ts");
  type FulfillmentError = import("../../../traits/mod.gen.ts").FulfillmentError;
  type ErrorGuaranteed = import("../../../../rustc_span/lib.ts").ErrorGuaranteed;

  // TEST stand-in (not a port): see the header.
  TypeErrCtxt.prototype.report_fulfillment_errors = function (this: TypeErrCtxt, errors: FulfillmentError[]): ErrorGuaranteed {
    let guar: ErrorGuaranteed | undefined;
    for (const error of errors) {
      const obligation = error.obligation;
      const err = this.dcx().struct_span_err(obligation.cause.span, "suggestions_b_test").with_code(E0277);
      if (!this.maybe_note_obligation_cause_for_async_await(err, obligation)) {
        this.note_obligation_cause_code(
          obligation.cause.body_def_id,
          err,
          obligation.predicate,
          obligation.param_env,
          obligation.cause.code_(),
          [],
          new DefIdSet(),
          upcast_from_self,
        );
      }
      guar = err.emit_err();
    }
    return guar ?? this.dcx().delayed_bug("suggestions_b_test: no fulfillment errors");
  };

  const callbacks = {
    config(): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      run_required_analyses_prefix(tcx);
      return "Stop" as const;
    },
  };
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args], callbacks));
}

process.exitCode = await main(process.argv.slice(2));
