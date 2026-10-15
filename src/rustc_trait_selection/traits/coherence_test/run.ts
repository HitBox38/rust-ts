// Test helper of src/rustc_trait_selection/traits/coherence.test.ts (lane trait-sel-traits-c).
//
// Runs the ported driver up to expansion (`after_expansion` -> `Stop`) with `override_queries` installing this lane's
// providers as `rustc_trait_selection::traits::provide` does (`specialization_graph_of`, `specializes`,
// `specialization_enabled_in`; traits/mod.rs is lane trait-sel-traits-a's, so nothing installs them in the driver yet),
// then
// - `facts <rustc arguments...>`: prints the lines of coherence_test/probe.rs (see its header) from the port. A fact
//   whose computation stops prints `<fact prefix> STOP <what>` instead of its value (`UNPORTED: <text>` for an
//   `unported(..)`);
// - `coherence <rustc arguments...>`: `tcx.ensure_result().specialization_graph_of(trait)` for every local trait, in
//   `hir_crate_items(()).definitions()` order (rustc_hir_analysis `coherent_trait` asks for it per trait after the
//   orphan checks, which pass on these crates). Diagnostics go to stderr as rustc's do, so on a crate whose only errors
//   are coherence errors of one trait, stderr equals the oracle rustc's.
//
//   bun run.ts facts|coherence <rustc arguments...>
import type { Compiler, Config } from "../../../rustc_interface/interface.ts";
import type { ModuleItems } from "../../../rustc_middle/hir/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Graph } from "../../../rustc_middle/traits/specialization_graph.ts";
import { OverlapMode } from "../../../rustc_middle/traits/specialization_graph.ts";
import { debug_SimplifiedType } from "../../../rustc_middle/ty/fast_reject.ts";
import { debug_GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import { RawList } from "../../../rustc_middle/ty/list.ts";
import { ParamEnv } from "../../../rustc_middle/ty/mod.ts";
import { with_no_trimmed_paths } from "../../../rustc_middle/ty/print/pretty.ts";
import { debug_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { debug_DefId, type DefId, DefId_eq, LocalDefId } from "../../../rustc_span/def_id.ts";
import { DUMMY_SP, type ErrorGuaranteed } from "../../../rustc_span/lib.ts";
import { FatalErrorMarker } from "../../../rustc_span/fatal_error.ts";
import { EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { TypingMode } from "../../../rustc_type_ir/infer_ctxt.ts";
import { fold_with_TraitRef, try_fold_with_TraitRef, visit_with_TraitRef } from "../../../rustc_type_ir/predicate.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { debug_vec, PLAIN } from "../../../std/fmt.ts";
import { Unported } from "../../../std/panic.ts";
import { Ok, type Result } from "../../../std/result.ts";

type Lane = {
  coherence: typeof import("../coherence.ts");
  specialize: typeof import("../specialize/mod.ts");
};

const d = (v: DefId): string => debug_DefId(v, PLAIN);

function stop(e: unknown): string {
  return e instanceof Unported ? `UNPORTED: ${e.what}` : e instanceof FatalErrorMarker ? "FATAL" : `ERROR: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`;
}

/** `prefix value`, or `prefix STOP <what>` when computing the value stops. */
function fact(out: string[], prefix: string, f: () => string): void {
  try {
    out.push(`${prefix} ${f()}`);
  } catch (e) {
    out.push(`${prefix} STOP ${stop(e)}`);
  }
}

/** `{:?}` of `Result<Result<(), E>, ()>` (the orphan check / knowability results). */
function debug_rr<E>(r: Result<Result<undefined, E>, null>, debug_E: (e: E) => string): string {
  if (r.$ === "Err") return "Err(())";
  return r._0.$ === "Ok" ? "Ok(Ok(()))" : `Ok(Err(${debug_E(r._0._0)}))`;
}

function graph_lines(out: string[], g: Graph): void {
  const parents = [...g.parent].sort((a, b) => a[0].index - b[0].index);
  for (const [c, p] of parents) out.push(`  graph parent ${d(c)} -> ${d(p)}`);
  const nodes = [...g.children.keys()].sort((a, b) => a.index - b.index);
  for (const n of nodes) {
    const ch = g.children.get(n)!;
    out.push(`  graph children ${d(n)} blanket ${debug_vec(ch.blanket_impls, PLAIN, debug_DefId)}`);
    for (const [st, v] of ch.non_blanket_impls) out.push(`    ${debug_SimplifiedType(st, PLAIN)} => ${debug_vec(v, PLAIN, debug_DefId)}`);
  }
}

function dump(tcx: TyCtxt, lane: Lane): string {
  const out: string[] = [];
  try {
    dump_into(out, tcx, lane);
  } catch (e) {
    // A stop outside the per-fact guards (`def_kind`, `impl_trait_id`, ...) ends the dump.
    out.push(`STOP ${stop(e)}`);
  }
  return out.join("\n") + "\n";
}

function dump_into(out: string[], tcx: TyCtxt, lane: Lane): void {
  const { coherence, specialize } = lane;
  const defs = (tcx.hir_crate_items(null) as ModuleItems).definitions().map((l) => LocalDefId.to_def_id(l));
  const kind = (x: DefId): ReturnType<TyCtxt["def_kind"]> => tcx.def_kind(x);
  const trait_impls = defs.filter((x) => {
    const k = kind(x);
    return k.$ === "Impl" && k.of_trait;
  });
  const inherent_impls = defs.filter((x) => {
    const k = kind(x);
    return k.$ === "Impl" && !k.of_trait;
  });

  for (const trait_id of defs.filter((x) => kind(x).$ === "Trait")) {
    out.push(`== trait ${d(trait_id)}`);
    try {
      const r = tcx.specialization_graph_of(trait_id) as Result<Graph, ErrorGuaranteed>;
      if (r.$ === "Err") out.push("  graph Err");
      else graph_lines(out, r._0);
    } catch (e) {
      out.push(`  graph STOP ${stop(e)}`);
    }
    const impls = trait_impls.filter((i) => DefId_eq(tcx.impl_trait_id(i), trait_id));
    const mode = OverlapMode.get(tcx, trait_id);
    for (let i = 0; i < impls.length; i++) {
      for (const b of impls.slice(i + 1)) {
        const a = impls[i]!;
        fact(out, `  overlap ${d(a)} ${d(b)}`, () => String(coherence.overlapping_trait_impls(tcx, a, b, "No", mode) !== undefined));
      }
    }
    for (const a of impls) {
      for (const b of impls) {
        if (!DefId_eq(a, b)) fact(out, `  specializes ${d(a)} ${d(b)}`, () => String(tcx.specializes([a, b])));
      }
    }
  }

  const d_TraitRef = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
  const debug_err = (e: import("../coherence.ts").OrphanCheckErr<import("../../../rustc_middle/ty/mod.ts").Ty>): string =>
    coherence.debug_OrphanCheckErr(e, PLAIN, debug_Ty);
  for (const impl_id of trait_impls) {
    out.push(`== impl ${d(impl_id)}`);
    const infcx = tcx.infer_ctxt().build(TypingMode.Coherence);
    const args = infcx.fresh_args_for_item(DUMMY_SP, impl_id);
    const trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.impl_trait_ref(impl_id), tcx, args, d_TraitRef));
    const lazily = (ty: import("../../../rustc_middle/ty/mod.ts").Ty): Result<import("../../../rustc_middle/ty/mod.ts").Ty, null> => Ok(ty);
    fact(out, "  orphan local-proper", () => debug_rr(coherence.orphan_check_trait_ref(infcx, trait_ref, { $: "Local", mode: "Proper" }, lazily), debug_err));
    fact(out, "  orphan local-compat", () => debug_rr(coherence.orphan_check_trait_ref(infcx, trait_ref, { $: "Local", mode: "Compat" }, lazily), debug_err));
    fact(out, "  orphan remote", () => debug_rr(coherence.orphan_check_trait_ref(infcx, trait_ref, { $: "Remote" }, lazily), debug_err));
    fact(out, "  knowable", () => debug_rr(coherence.trait_ref_is_knowable(infcx, trait_ref, lazily), (c) => c));

    const infcx2 = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
    const param_env = ParamEnv.empty();
    const identity = RawList.identity_for_item(tcx, impl_id);
    const trait_id = tcx.impl_trait_id(impl_id);
    fact(out, "  translate_args trait", () => debug_GenericArgs(specialize.translate_args(infcx2, param_env, impl_id, identity, { $: "Trait", _0: trait_id }), PLAIN));
    fact(out, "  translate_args self", () => debug_GenericArgs(specialize.translate_args(infcx2, param_env, impl_id, identity, { $: "Impl", _0: impl_id }), PLAIN));
  }

  for (let i = 0; i < inherent_impls.length; i++) {
    for (const b of inherent_impls.slice(i + 1)) {
      const a = inherent_impls[i]!;
      fact(out, `== inherent ${d(a)} ${d(b)}`, () => String(coherence.overlapping_inherent_impls(tcx, a, b, "No", "Stable") !== undefined));
    }
  }
}

async function main(args: string[]): Promise<number> {
  const mode = args[0];
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../rustc_driver_impl/lib.ts");
  const { std_print } = await import("../../../rustc_session/config.ts");
  await import("../../lib.ts");
  const lane: Lane = { coherence: await import("../coherence.ts"), specialize: await import("../specialize/mod.ts") };
  const config = (c: Config): void => {
    // `rustc_trait_selection::traits::provide` (traits/mod.rs), the three providers of this lane.
    c.override_queries = (_sess, providers) => {
      const p = providers.queries;
      p.specialization_graph_of = lane.specialize.specialization_graph_provider;
      p.specializes = lane.specialize.specializes;
      p.specialization_enabled_in = lane.specialize.specialization_enabled_in;
    };
  };
  if (mode === "facts") {
    const callbacks = {
      config,
      after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
        std_print(with_no_trimmed_paths(() => dump(tcx, lane)));
        return "Stop" as const;
      },
    };
    return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args.slice(1)], callbacks));
  }
  if (mode === "coherence") {
    const callbacks = {
      config,
      after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
        for (const def_id of (tcx.hir_crate_items(null) as ModuleItems).definitions()) {
          if (tcx.def_kind(def_id).$ === "Trait") tcx.ensure_result().specialization_graph_of(LocalDefId.to_def_id(def_id));
        }
        return "Stop" as const;
      },
    };
    return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args.slice(1)], callbacks));
  }
  console.error(`ERROR: unknown mode ${mode}`);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
