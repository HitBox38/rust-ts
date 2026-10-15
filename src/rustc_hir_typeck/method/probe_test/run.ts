// Test helper of src/rustc_hir_typeck/method/probe.test.ts (lane typeck-probe).
//
// Runs the ported driver up to expansion (`after_expansion` -> `Stop`), lowers the crate (`hir_crate_items`), then for
// every local `fn` whose name starts with `ms_` (DefIndex order) and every input type of its `fn_sig` (identity args,
// late-bound regions erased with `instantiate_bound_regions_with_erased`), canonicalizes
// `tcx.param_env(fn).and(MethodAutoderefSteps { predefined_opaques_in_body: List::empty(), self_ty })` on a
// `non_body_analysis` InferCtxt and calls the `method_autoderef_steps` provider (method/probe.rs:635); two more cases
// use a fresh type variable (`infer`) and `&'erased ?T` (`ref_infer`) under `ParamEnv::empty()`. Prints
//   `<name>#<input>: limit=<reached_recursion_limit> steps=<n>`, one line per `CandidateStep` (its flags and
//   `self_ty` by `{:?}`) and the `opt_bad_ty`,
// under `with_no_trimmed_paths!`. The expected files come from the pinned rustc_driver running the same loop with
// `tcx.method_autoderef_steps(goal)` (docs/handoff/typeck-probe.md, "Oracle check"). PORT: ours calls the provider
// directly: the query's `QueryKey` for `CanonicalMethodAutoderefStepsGoal` is not ported (rustc_middle query/keys.rs).
// An `unported(..)` stop exits 70 with `UNPORTED: <what>` on stderr.
//
//   bun run.ts <rustc arguments...>
import type { Compiler } from "../../../rustc_interface/interface.ts";
import type { InferCtxt } from "../../../rustc_infer/decls.ts";
import { OriginalQueryValues, type Canonical } from "../../../rustc_middle/infer/canonical.ts";
import { debug_QueryResponse, type QueryResponse } from "../../../rustc_middle/infer/canonical.gen.ts";
import type { MethodAutoderefSteps, MethodAutoderefStepsResult } from "../../../rustc_middle/traits/query.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { ParamEnv, Ty } from "../../../rustc_middle/ty/mod.ts";
import { with_no_trimmed_paths } from "../../../rustc_middle/ty/print/pretty.ts";
import { debug_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { DUMMY_SP } from "../../../rustc_span/lib.ts";
import { type LocalDefId, LocalDefId as LocalDefIdC } from "../../../rustc_span/def_id.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { debug_CanonicalVarKind } from "../../../rustc_type_ir/canonical.gen.ts";
import { debug_UniverseIndex } from "../../../rustc_type_ir/lib.gen.ts";
import { debug_RawList, RawList } from "../../../rustc_middle/ty/list.ts";
import type { PolyFnSig } from "../../../rustc_type_ir/decls.ts";
import { TypingMode } from "../../../rustc_type_ir/infer_ctxt.ts";
import { FnSig, fold_FnSig } from "../../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { debug_struct, PLAIN } from "../../../std/fmt.ts";
import { Unported } from "../../../std/panic.ts";

let probe: typeof import("../probe.ts");

/**
 * `{:?}` of a `Canonical<QueryResponse<Ty>>`. PORT (test helper): the derived Debug of `Canonical` (rustc_type_ir
 * canonical.gen.ts) stops at `unported_debug` for `var_kinds: CanonicalVarKinds` (codegen follow-up); this is the same
 * derived output with `var_kinds` printed as the list it is.
 */
function debug_canonical_ty(c: Canonical<QueryResponse<Ty>>): string {
  return debug_struct(PLAIN, "Canonical", [
    ["value", debug_QueryResponse(c.value, PLAIN, debug_Ty)],
    ["max_universe", debug_UniverseIndex(c.max_universe, PLAIN)],
    ["var_kinds", debug_RawList(c.var_kinds, PLAIN, debug_CanonicalVarKind)],
  ]);
}

function print(name: string, r: MethodAutoderefStepsResult): void {
  with_no_trimmed_paths(() => {
    let out = `${name}: limit=${r.reached_recursion_limit} steps=${r.steps.length}\n`;
    r.steps.forEach((s, i) => {
      out += `  step ${i}: opaque=${s.self_ty_is_opaque} autoderefs=${s.autoderefs} unsafe=${s.from_unsafe_deref} unsize=${s.unsize} via_deref=${s.reachable_via_deref} self_ty=${debug_canonical_ty(s.self_ty as Canonical<QueryResponse<Ty>>)}\n`;
    });
    const b = r.opt_bad_ty;
    out += b !== undefined ? `  bad: reached_raw_pointer=${b.reached_raw_pointer} ty=${debug_canonical_ty(b.ty as Canonical<QueryResponse<Ty>>)}\n` : "  bad: none\n";
    process.stdout.write(out);
  });
}

function run(tcx: TyCtxt, name: string, param_env: ParamEnv, f: (infcx: InferCtxt) => Ty): void {
  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  const self_ty = f(infcx);
  const orig_values = OriginalQueryValues.default_();
  const goal = infcx.canonicalize_query(param_env.and<MethodAutoderefSteps>({ predefined_opaques_in_body: RawList.empty(), self_ty }), orig_values, probe.fold_MethodAutoderefSteps);
  print(name, probe.method_autoderef_steps(tcx, goal));
}

function report(tcx: TyCtxt): void {
  tcx.hir_crate_items(null);
  const n = tcx.definitions_untracked().num_definitions();
  for (let i = 0; i < n; i++) {
    const id = i as LocalDefId;
    if (tcx.def_kind(id).$ !== "Fn") continue;
    const name = Symbol.as_str(tcx.item_name(LocalDefIdC.to_def_id(id)));
    if (!name.startsWith("ms_")) continue;
    const sig_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(id) as EarlyBinder<PolyFnSig>));
    const sig = tcx.instantiate_bound_regions_with_erased(sig_, fold_FnSig);
    const param_env = tcx.param_env(id) as ParamEnv;
    FnSig.inputs(sig).forEach((ty, j) => run(tcx, `${name}#${j}`, param_env, () => ty));
  }
  run(tcx, "infer", ParamEnv.empty(), (infcx) => infcx.next_ty_var(DUMMY_SP));
  run(tcx, "ref_infer", ParamEnv.empty(), (infcx) => Ty.new_imm_ref(tcx, tcx.lifetimes.re_erased, infcx.next_ty_var(DUMMY_SP)));
}

async function main(args: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../rustc_driver_impl/lib.ts");
  await import("../../lib.ts");
  probe = await import("../probe.ts");
  const callbacks = {
    config(): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      report(tcx);
      return "Stop" as const;
    },
  };
  try {
    return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args], callbacks));
  } catch (e) {
    // As the port's main (src/rust_ts): an `unported(..)` stop is exit 70 with its text on stderr.
    if (e instanceof Unported) {
      process.stderr.write(`UNPORTED: ${e.what}\n`);
      return 70;
    }
    throw e;
  }
}

process.exitCode = await main(process.argv.slice(2));
