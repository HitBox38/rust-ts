// Test helper of src/rustc_trait_selection/traits/old_solve.test.ts (fixer lane merge-w18c).
//
// Runs the ported driver up to expansion (`after_expansion` -> `Stop`, as ../../solve_test/run.ts), then prints, for
// every `env_<name>` / `goals_<name>` pair of free fns, exactly what old_solve_test/probe.rs prints with rustc's own
// old trait solver (its header documents the lines). A case whose computation stops prints `  STOP <what>` and the
// next case starts: the test compares case by case.
//
//   bun run.ts <rustc arguments...>    (with -Znext-solver=coherence)
import type { Compiler } from "../../../rustc_interface/interface.ts";
import type { InferCtxt } from "../../../rustc_infer/decls.ts";
import { Obligation, type PolyTraitObligation, type PredicateObligation, type PredicateObligations, type Selection, type TraitErrors } from "../../../rustc_infer/traits/mod.ts";
import { debug_Obligation } from "../../../rustc_infer/traits/structural_impls.ts";
import type { ModuleItems } from "../../../rustc_middle/hir/mod.ts";
import { debug_ImplSource, ObligationCause, debug_SelectionError, type SelectionResult } from "../../../rustc_middle/traits/mod.ts";
import { debug_EvaluationResult, debug_OverflowError, type EvaluationResult, type OverflowError } from "../../../rustc_middle/traits/select.gen.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { type GenericArgs, debug_GenericArgs, fold_GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import { GenericClauses } from "../../../rustc_middle/ty/generics.ts";
import { debug_Term, ParamEnv } from "../../../rustc_middle/ty/mod.ts";
import type { Clause, Predicate } from "../../../rustc_middle/ty/predicate.ts";
import { debug_Clause, debug_Predicate, fold_Predicate } from "../../../rustc_middle/ty/structural_impls.ts";
import { RawList } from "../../../rustc_middle/ty/list.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import type { DefId } from "../../../rustc_span/def_id.ts";
import { DUMMY_SP } from "../../../rustc_span/lib.ts";
import { FatalErrorMarker } from "../../../rustc_span/fatal_error.ts";
import { Binder } from "../../../rustc_type_ir/binder.ts";
import { debug_TypeError } from "../../../rustc_type_ir/error.gen.ts";
import { TypingMode } from "../../../rustc_type_ir/infer_ctxt.ts";
import { debug_NoSolution } from "../../../rustc_type_ir/solve/mod.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { debug_option, debug_vec, PLAIN } from "../../../std/fmt.ts";
import { Panic, Unported, assert } from "../../../std/panic.ts";
import { debug_result, type Result } from "../../../std/result.ts";
import type { FulfillmentError, FulfillmentErrorCode } from "../mod.gen.ts";

type Lane = {
  select: typeof import("../select/mod.ts");
  project: typeof import("../project.ts");
  engine: typeof import("../engine.ts");
};

function code_str(code: FulfillmentErrorCode): string {
  switch (code.$) {
    case "Cycle":
      return `Cycle(${code._0.length})`;
    case "Select":
      return `Select(${debug_SelectionError(code._0, PLAIN)})`;
    case "Project":
      return `Project(${debug_TypeError(code._0.err, PLAIN)})`;
    case "Ambiguity":
      return `Ambiguity(overflow=${debug_option(code.overflow, PLAIN, (b) => String(b))})`;
    default:
      return code.$;
  }
}

const res_eval = (r: Result<EvaluationResult, OverflowError>): string => debug_result(r, PLAIN, debug_EvaluationResult, debug_OverflowError);
const preds = (os: readonly PredicateObligation[]): string =>
  debug_vec(
    os.map((o) => o.predicate),
    PLAIN,
    debug_Predicate,
  );

function case_(out: string[], tcx: TyCtxt, lane: Lane, name: string, env_fn: DefId, goals_fn: DefId): void {
  const { SelectionContext } = lane.select;
  out.push(`case ${name}`);
  const infcx: InferCtxt = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  assert(!infcx.next_trait_solver(), "run the probe with -Znext-solver=coherence");
  const param_env = ParamEnv.new(
    tcx,
    [...GenericClauses.instantiate_identity(tcx.clauses_of(env_fn) as GenericClauses, tcx).into_iter()].map(([c]) => Unnormalized.skip_norm_wip(c)),
  );
  out.push(`  env: ${debug_vec([...param_env.caller_bounds()], PLAIN, debug_Clause)}`);
  const args: GenericArgs = RawList.for_item(tcx, goals_fn, (param, _) =>
    Symbol.as_str(param.name).startsWith("I") ? infcx.var_for_def(DUMMY_SP, param) : tcx.mk_param_from_def(param),
  );
  out.push(`  args: ${debug_GenericArgs(args, PLAIN)}`);
  const goals: Clause[] = [...GenericClauses.instantiate(tcx.clauses_of(goals_fn) as GenericClauses, tcx, args).into_iter()].map(([c]) =>
    Unnormalized.skip_norm_wip(c),
  );
  for (let i = 0; i < goals.length; i++) {
    const clause = goals[i]!;
    const predicate: Predicate = clause.as_predicate();
    out.push(`  goal ${i}: ${debug_Predicate(predicate, PLAIN)}`);
    const obligation: PredicateObligation = Obligation.new(tcx, ObligationCause.dummy(), param_env, predicate, (p) => p);
    const r1 = infcx.probe((_) => SelectionContext.new(infcx).evaluate_root_obligation(obligation));
    out.push(`    eval_root: ${res_eval(r1)}`);
    const r2 = infcx.probe((_) => infcx.evaluate_obligation(obligation));
    out.push(`    evaluate: ${res_eval(r2)}`);
    const r3 = infcx.probe((_) => {
      const n = infcx.at(ObligationCause.dummy(), param_env).query_normalize(predicate, fold_Predicate);
      return n.$ === "Ok" ? `Ok(${debug_Predicate(n._0.value, PLAIN)} ${preds(n._0.obligations)})` : `Err(${debug_NoSolution(n._0, PLAIN)})`;
    });
    out.push(`    query_normalize: ${r3}`);
    const trait_pred = clause.as_trait_clause();
    if (trait_pred !== undefined) {
      const o: PolyTraitObligation = Obligation.new(tcx, ObligationCause.dummy(), param_env, trait_pred, (p) => p);
      const sel = infcx.probe((_) => SelectionContext.new(infcx).poly_select(o)) as SelectionResult<Selection>;
      out.push(
        `    select: ${debug_result(sel, PLAIN, (v, f) => debug_option(v, f, (x, f) => debug_ImplSource(x, f, (o, f) => debug_Obligation(o, f, debug_Predicate))), debug_SelectionError)}`,
      );
    }
    const proj = clause.as_projection_clause();
    if (proj !== undefined) {
      const line = infcx.probe((_) => {
        const selcx = SelectionContext.new(infcx);
        const obligations: PredicateObligations = [];
        const term = lane.project.normalize_projection_term(selcx, param_env, Binder.skip_binder(proj).projection_term, ObligationCause.dummy(), 0, obligations);
        return `${debug_Term(term, PLAIN)} ${preds(obligations)}`;
      });
      out.push(`    normalize: ${line}`);
    }
  }
  const { FulfillmentEngine, FulfillmentErrorKinds_FulfillmentError } = lane.engine;
  const engine = FulfillmentEngine.new<FulfillmentError>(infcx, FulfillmentErrorKinds_FulfillmentError);
  for (const clause of goals) {
    const o: PredicateObligation = Obligation.new(tcx, ObligationCause.dummy(), param_env, clause.as_predicate(), (p) => p);
    engine.register_predicate_obligation(infcx, o);
  }
  errors(out, "try_evaluate", engine.try_evaluate_obligations(infcx));
  out.push(`  pending: ${engine.pending_obligations().length}`);
  errors(out, "remaining", engine.collect_remaining_errors(infcx));
  out.push(`  resolved: ${debug_GenericArgs(infcx.deeply_resolve_ignoring_regions(args, fold_GenericArgs), PLAIN)}`);
}

function errors(out: string[], label: string, errs: TraitErrors<FulfillmentError>): void {
  if (errs.$ === "NoErrors") {
    out.push(`  ${label}: []`);
    return;
  }
  for (const e of errs._0) {
    out.push(`  ${label}: ${debug_Predicate(e.obligation.predicate, PLAIN)} code=${code_str(e.code)} root=${debug_Predicate(e.root_obligation.predicate, PLAIN)}`);
  }
}

function dump(tcx: TyCtxt, lane: Lane): string {
  const out: string[] = [];
  // The free fns, by name.
  const items: [DefId, string][] = [];
  for (const id of (tcx.hir_crate_items(null) as ModuleItems).free_items()) {
    const d = id.owner_id.to_def_id();
    if (tcx.def_kind(d).$ !== "Fn") continue;
    items.push([d, Symbol.as_str(tcx.item_name(d))]);
  }
  for (const [goals_fn, goals_name] of items) {
    if (!goals_name.startsWith("goals_")) continue;
    const name = goals_name.slice("goals_".length);
    const env = items.find(([, n]) => n === `env_${name}`);
    if (env === undefined) continue;
    const lines: string[] = [];
    try {
      case_(lines, tcx, lane, name, env[0], goals_fn);
    } catch (e) {
      const what =
        e instanceof Unported
          ? `UNPORTED: ${e.what}`
          : e instanceof FatalErrorMarker
            ? "FATAL"
            : e instanceof Panic
              ? `PANIC: ${e.message.split("\n")[0]}`
              : `ERROR: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`;
      lines.push(`  STOP ${what}`);
    }
    out.push(...lines);
  }
  return out.map((l) => l + "\n").join("");
}

async function main(args: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../rustc_driver_impl/lib.ts");
  const { std_print } = await import("../../../rustc_session/config.ts");
  const lane: Lane = {
    select: await import("../select/mod.ts"),
    project: await import("../project.ts"),
    engine: await import("../engine.ts"),
  };
  const callbacks = {
    config(): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      std_print(dump(tcx, lane));
      return "Stop" as const;
    },
  };
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args], callbacks));
}

process.exitCode = await main(process.argv.slice(2));
