// Test helper of src/rustc_hir_typeck/demand_adjust.test.ts (lane typeck-demand-adjust).
//
// Runs the ported driver through the tydump probe's analysis prefix (src/rust_ts/tydump_dump.ts
// `run_required_analyses_prefix`: everything up to and including type checking of every body), with
// `RUST_TS_TEST_MODE` selecting what the error-reporting placeholders of other wave-19 lanes do:
//
// - `adjust`: `TypeErrCtxt::report_fulfillment_errors` (lane errrep-traits-a) is replaced by a recorder that emits one
//   stand-in error per fulfillment error at the obligation's cause span after
//   `adjust_fulfillment_errors_for_expr_obligation` (this lane's fn_ctxt/adjust_fulfillment_errors.rs). The one later
//   span change rustc makes before emitting is reproduced: `note_function_argument_obligation`
//   (rustc_trait_selection error_reporting/traits/suggestions.rs:5459) replaces a primary span equal to a method call's
//   receiver span by the method name's span.
// - `demand`: `TypeErrCtxt::report_mismatched_types` (lane errrep-infer-a) returns a bare `error: mismatched types`
//   diagnostic at the cause span (no code, no labels: `note_type_err` is not reached), and the fn_ctxt/suggestions.rs
//   predicates `emit_type_mismatch_suggestions` / `emit_coerce_suggestions` call (lanes typeck-fnsugg-a/-b) answer
//   "no suggestion" (`false` / no-op). What else the port emits (secondary labels, notes, helps, suggestions) is this
//   lane's demand.rs.
//
// PORT (test): these stand-ins exist only in this process; the real methods stay placeholders until their lanes merge.
//
//   RUST_TS_TEST_MODE=adjust|demand bun run.ts <rustc arguments...>
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";

/** fn_ctxt/suggestions.rs (and method/suggest.rs) predicates reached from demand.rs, answered "no suggestion". */
const NO_SUGGESTION_BOOL = [
  "suggest_missing_parentheses",
  "suggest_missing_unwrap_expect",
  "suggest_remove_last_method_call",
  "suggest_associated_const",
  "suggest_semicolon_in_repeat_expr",
  "suggest_deref_ref_or_into",
  "suggest_option_to_bool",
  "suggest_collect",
  "suggest_compatible_variants",
  "suggest_non_zero_new_unwrap",
  "suggest_calling_boxed_future_when_appropriate",
  "suggest_closure_to_fn_ptr_coercion",
  "suggest_boxing_when_appropriate",
  "suggest_block_to_brackets_peeling_refs",
  "suggest_copied_cloned_or_as_ref",
  "suggest_clone_for_ref",
  "suggest_into",
  "suggest_floating_point_literal",
  "suggest_null_ptr_for_literal_zero_given_to_ptr_arg",
  "suggest_coercing_result_via_try_operator",
  "suggest_returning_value_after_loop",
] as const;
const NO_SUGGESTION_VOID = [
  "note_type_is_not_clone",
  "note_internal_mutation_in_method",
  "suggest_method_call_on_range_literal",
  "suggest_return_binding_for_missing_tail_expr",
] as const;

async function main(argv: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  await import("../lib.ts");
  const { FnCtxt } = await import("../decls.ts");
  const { TypeErrCtxt } = await import("../../rustc_trait_selection/decls.ts");
  const { run_required_analyses_prefix } = await import("../../rust_ts/tydump_dump.ts");
  const mode = process.env.RUST_TS_TEST_MODE;

  const proto = TypeErrCtxt.prototype as unknown as Record<string, unknown>;
  if (mode === "adjust") {
    proto.report_fulfillment_errors = function (this: InstanceType<typeof TypeErrCtxt>, errors: import("../../rustc_trait_selection/traits/mod.gen.ts").FulfillmentError[]) {
      let guar;
      for (const e of errors) {
        let span = e.obligation.cause.span;
        // As rustc_trait_selection error_reporting/traits/suggestions.rs:5459: receiver span -> method name span.
        const code = e.obligation.cause.code_();
        if (code.$ === "FunctionArg") {
          const call_node = this.tcx.hir_node(code.call_hir_id);
          if (call_node.$ === "Expr" && call_node._0.kind.$ === "MethodCall" && call_node._0.kind._1.span === span) {
            span = call_node._0.kind._0.ident.span;
          }
        }
        guar = this.dcx().struct_span_err(span, "stand-in for report_fulfillment_errors").emit();
      }
      return guar;
    };
  } else if (mode === "demand") {
    proto.report_mismatched_types = function (this: InstanceType<typeof TypeErrCtxt>, cause: { span: import("../../rustc_span/lib.ts").Span }) {
      return this.dcx().struct_span_err(cause.span, "mismatched types");
    };
    const fproto = FnCtxt.prototype as unknown as Record<string, unknown>;
    for (const m of NO_SUGGESTION_BOOL) fproto[m] = () => false;
    for (const m of NO_SUGGESTION_VOID) fproto[m] = () => undefined;
  } else {
    throw new Error(`RUST_TS_TEST_MODE must be adjust or demand, not ${mode}`);
  }

  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(c: Config): void {
      c.opts.trimmed_def_paths = true;
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      run_required_analyses_prefix(tcx);
      return "Stop" as const;
    },
  };
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...argv], callbacks));
}

const { Unported } = await import("../../std/panic.ts");
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  // Unported code exits 70 (UNPORTED), like the harness runners.
  if (e instanceof Unported) {
    process.stderr.write(`rust-ts: unported: ${e.what}\n`);
    process.exitCode = 70;
  } else {
    throw e;
  }
}
