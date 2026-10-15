// Test helper of src/rustc_trait_selection/solve.test.ts (lane trait-sel-solve).
//
// Runs the ported driver up to expansion (`after_expansion` -> `Stop`, as rustc_hir_analysis's variance_outlives_test),
// then prints, for every `env_<name>` / `goals_<name>` pair of free fns, exactly what solve_test/probe.rs prints with
// rustc's own rustc_trait_selection (its header documents the lines). A case whose computation stops prints
// `  STOP <what>` and the next case starts: the test compares case by case.
//
//   bun run.ts <rustc arguments...>
import type { Compiler } from "../../rustc_interface/interface.ts";
import type { InferCtxt } from "../../rustc_infer/decls.ts";
import { Obligation, type PredicateObligation, type Selection, type TraitErrors } from "../../rustc_infer/traits/mod.ts";
import { debug_Obligation } from "../../rustc_infer/traits/structural_impls.ts";
import type { ModuleItems } from "../../rustc_middle/hir/mod.ts";
import { debug_ImplSource, ObligationCause, debug_SelectionError, type SelectionResult } from "../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type GenericArgs, debug_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { GenericClauses } from "../../rustc_middle/ty/generics.ts";
import { ParamEnv } from "../../rustc_middle/ty/mod.ts";
import type { Clause, Predicate } from "../../rustc_middle/ty/predicate.ts";
import { debug_Clause, debug_Predicate } from "../../rustc_middle/ty/structural_impls.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { FatalErrorMarker } from "../../rustc_span/fatal_error.ts";
import { VisitorResult } from "../../rustc_ast_ir/visit.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { as_interner } from "../../rustc_type_ir/predicate.ts";
import { debug_CandidateSource, debug_Certainty, debug_GoalSource, debug_NoSolution, Goal, type Certainty, type NoSolution } from "../../rustc_type_ir/solve/mod.ts";
import type { ProbeKind } from "../../rustc_type_ir/solve/inspect.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { debug_option, debug_vec, PLAIN } from "../../std/fmt.ts";
import { Panic, Unported } from "../../std/panic.ts";
import { debug_result, type Result } from "../../std/result.ts";

type Fulfill = typeof import("../solve/fulfill.ts");
type Analyse = typeof import("../solve/inspect/analyse.ts");

function kind_str(kind: ProbeKind): string {
  switch (kind.$) {
    case "Root":
      return "Root";
    case "TraitCandidate":
      return `TraitCandidate(${debug_CandidateSource(kind.source, PLAIN)})`;
    case "OpaqueTypeStorageLookup":
    case "RigidAlias":
    case "NormalizedSelfTyAssembly":
    case "UnsizeAssembly":
    case "ProjectionCompatibility":
    case "ShadowedEnvProbing":
      return kind.$;
  }
}

function code_str(code: import("../traits/mod.gen.ts").FulfillmentErrorCode): string {
  switch (code.$) {
    case "Select":
      return `Select(${debug_SelectionError(code._0, PLAIN)})`;
    case "Ambiguity":
      return `Ambiguity(overflow=${debug_option(code.overflow, PLAIN, (b) => String(b))})`;
    default:
      return code.$;
  }
}

const res_certainty = (r: Result<Certainty, NoSolution>): string => debug_result(r, PLAIN, debug_Certainty, debug_NoSolution);

function case_(out: string[], tcx: TyCtxt, an: Analyse, fu: Fulfill, name: string, env_fn: DefId, goals_fn: DefId): void {
  out.push(`case ${name}`);
  const infcx: InferCtxt = tcx.infer_ctxt().with_next_trait_solver(true).build(TypingMode.non_body_analysis());
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
  const identity = (p: Predicate): Predicate => p;
  for (let i = 0; i < goals.length; i++) {
    const clause = goals[i]!;
    const predicate = clause.as_predicate();
    out.push(`  goal ${i}: ${debug_Predicate(predicate, PLAIN)}`);
    const dump = new Dump(an);
    infcx.probe((_) => infcx.visit_proof_tree(Goal.new(as_interner(tcx), param_env, predicate, identity), dump));
    out.push(...dump.out);
    const trait_pred = clause.as_trait_clause();
    if (trait_pred !== undefined) {
      const obligation = Obligation.new(tcx, ObligationCause.dummy(), param_env, trait_pred, (p) => p);
      const sel = infcx.probe((_) => infcx.select_in_new_trait_solver(obligation)) as SelectionResult<Selection>;
      out.push(
        `    select: ${debug_result(sel, PLAIN, (v, f) => debug_option(v, f, (x, f) => debug_ImplSource(x, f, (o, f) => debug_Obligation(o, f, debug_Predicate))), debug_SelectionError)}`,
      );
    }
  }
  const fcx = fu.FulfillmentCtxt.new(infcx, fu.FromSolverError_FulfillmentError);
  for (const clause of goals) {
    const o: PredicateObligation = Obligation.new(tcx, ObligationCause.dummy(), param_env, clause.as_predicate(), (p) => p);
    fcx.register_predicate_obligation(infcx, o);
  }
  errors(out, "try_evaluate", fcx.try_evaluate_obligations(infcx));
  out.push(`  pending: ${fcx.pending_obligations().length}`);
  errors(out, "remaining", fcx.collect_remaining_errors(infcx));
  out.push(`  resolved: ${debug_GenericArgs(infcx.deeply_resolve_ignoring_regions(args, fold_GenericArgs_()), PLAIN)}`);
}

function fold_GenericArgs_(): import("../../rustc_type_ir/fold.ts").TypeFoldable<GenericArgs> {
  return (require("../../rustc_middle/ty/generic_args.ts") as typeof import("../../rustc_middle/ty/generic_args.ts")).fold_GenericArgs;
}

function errors(out: string[], label: string, errs: TraitErrors<unknown>): void {
  if (errs.$ === "NoErrors") {
    out.push(`  ${label}: []`);
    return;
  }
  for (const e0 of errs._0) {
    const e = e0 as import("../traits/mod.gen.ts").FulfillmentError;
    out.push(`  ${label}: ${debug_Predicate(e.obligation.predicate, PLAIN)} code=${code_str(e.code)} root=${debug_Predicate(e.root_obligation.predicate, PLAIN)}`);
  }
}

/** Prints the root result, the candidates and the unique candidate's nested goals (probe.rs `Dump`). */
class Dump {
  readonly Result = VisitorResult.unit;
  out: string[] = [];
  constructor(public an: Analyse) {}
  span() {
    return DUMMY_SP;
  }
  config() {
    return this.an.ProofTreeVisitor_provided.config(this);
  }
  on_recursion_limit(): undefined {
    return this.an.ProofTreeVisitor_provided.on_recursion_limit(this);
  }
  visit_goal(goal: import("../solve/inspect/analyse.ts").InspectGoal): undefined {
    this.out.push(`    result: ${res_certainty(goal.result())}`);
    for (const cand of goal.candidates()) {
      this.out.push(`    candidate: ${kind_str(cand.kind())} ${res_certainty(cand.result())} shallow=${debug_Certainty(cand.shallow_certainty(), PLAIN)}`);
    }
    const cand = goal.unique_applicable_candidate();
    if (cand !== undefined) {
      goal.infcx().probe((_) => {
        for (const nested of cand.instantiate_nested_goals(DUMMY_SP)) {
          this.out.push(`    nested: ${debug_GoalSource(nested.source(), PLAIN)} ${debug_Predicate(nested.goal().predicate, PLAIN)} ${res_certainty(nested.result())}`);
        }
      });
    }
    return undefined;
  }
}

function dump(tcx: TyCtxt, an: Analyse, fu: Fulfill): string {
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
      case_(lines, tcx, an, fu, name, env[0], goals_fn);
    } catch (e) {
      const what =
        e instanceof Unported ? `UNPORTED: ${e.what}` : e instanceof FatalErrorMarker ? "FATAL" : e instanceof Panic ? `PANIC: ${e.message.split("\n")[0]}` : `ERROR: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`;
      lines.push(`  STOP ${what}`);
    }
    out.push(...lines);
  }
  return out.map((l) => l + "\n").join("");
}

async function main(args: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { std_print } = await import("../../rustc_session/config.ts");
  const an: Analyse = await import("../solve/inspect/analyse.ts");
  const fu: Fulfill = await import("../solve/fulfill.ts");
  const callbacks = {
    config(): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      std_print(dump(tcx, an, fu));
      return "Stop" as const;
    },
  };
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args], callbacks));
}


process.exitCode = await main(process.argv.slice(2));
