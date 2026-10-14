// Test helper of src/rustc_trait_selection/traits/wf_dyn.test.ts (lane trait-sel-traits-b; not a port).
//
// Runs the ported driver up to expansion (`after_expansion` -> `Stop`, as probe.rs) and prints probe.rs's lines from the
// port: per trait the dyn-compatibility facts, per type alias `wf::obligations` / `wf::unnormalized_obligations`, per
// trait impl `wf::trait_obligations`, per fn `wf::clause_obligations` of each of its clauses (probe.rs's header says which and how). A fact whose computation
// stops prints `  <fact> STOP <what>` (one line, in place of the fact's line(s)).
//
// Scaffolding (not a port): `override_queries` installs `traits::dyn_compatibility::provide`, as upstream's
// `rustc_trait_selection::traits::provide` does (traits/mod.rs:982, lane trait-sel-traits-a; rustc_interface's
// `default_query_providers` does not call it yet).
//
//   bun run.ts dump <rustc arguments...>
//   bun run.ts e0038 <rustc arguments...>: lowers every type alias (`tcx.type_of`); its diagnostics go to stderr as rustc's
//     do, and a stop prints `type_of STOP <what>` on stdout.
import { def } from "../../../rustc_hir/lib.ts";
import type { Compiler, Config } from "../../../rustc_interface/interface.ts";
import type { ModuleItems } from "../../../rustc_middle/hir/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { PredicateObligations } from "../../../rustc_infer/traits/mod.ts";
import { debug_DynCompatibilityViolation, debug_ObligationCauseCode } from "../../../rustc_middle/traits/mod.ts";
import { AssocItem, AssocItems } from "../../../rustc_middle/ty/assoc.ts";
import type { GenericClauses, Generics } from "../../../rustc_middle/ty/generics.ts";
import { ParamEnv, Ty } from "../../../rustc_middle/ty/mod.ts";
import { Term } from "../../../rustc_middle/ty/mod.ts";
import { with_no_trimmed_paths } from "../../../rustc_middle/ty/print/pretty.ts";
import { debug_Clause, debug_Predicate } from "../../../rustc_middle/ty/structural_impls.ts";
import { CRATE_DEF_ID, debug_DefId, LocalDefId } from "../../../rustc_span/def_id.ts";
import { FatalErrorMarker } from "../../../rustc_span/fatal_error.ts";
import { DUMMY_SP } from "../../../rustc_span/lib.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { TypingMode } from "../../../rustc_type_ir/infer_ctxt.ts";
import { as_interner, type ClausePolarity, ExistentialTraitRef, type TraitClause } from "../../../rustc_type_ir/predicate.ts";
import { type ExistentialPredicate, visit_with_ExistentialPredicate } from "../../../rustc_type_ir/predicate.gen.ts";
import { debug_Region } from "../../../rustc_type_ir/sty/mod.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { debug_vec, PLAIN } from "../../../std/fmt.ts";
import { Panic, Unported } from "../../../std/panic.ts";
import { ensure_stack } from "../../../rust_ts/stack.ts";

/** The modules under test, imported after the driver (init order). */
interface Lazy {
  wf: typeof import("../wf.ts");
  dyn_compatibility: typeof import("../dyn_compatibility.ts");
}

function stop_text(e: unknown): string {
  if (e instanceof Unported) return `UNPORTED: ${e.what}`;
  if (e instanceof FatalErrorMarker) return "FATAL";
  if (e instanceof Panic) return `PANIC: ${e.message.split("\n")[0]}`;
  return `ERROR: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`;
}

/** One fact: its line(s), or `  <name> STOP <what>`. */
function fact(out: string[], name: string, f: () => string[]): void {
  try {
    out.push(...f());
  } catch (e) {
    out.push(`  ${name} STOP ${stop_text(e)}`);
  }
}

function obls(name: string, o: PredicateObligations | undefined): string[] {
  if (o === undefined) return [`  ${name} None`];
  return [
    `  ${name} (${o.length})`,
    ...o.map((ob) => `    ${debug_Predicate(ob.predicate, PLAIN)} | ${debug_ObligationCauseCode(ob.cause.code_(), PLAIN)} | depth ${ob.recursion_depth}`),
  ];
}

function dump(tcx: TyCtxt, m: Lazy): string {
  const { wf, dyn_compatibility } = m;
  const out: string[] = [];
  for (const local_id of (tcx.hir_crate_items(null) as ModuleItems).definitions()) {
    const def_id = LocalDefId.to_def_id(local_id);
    const kind = tcx.def_kind(def_id);
    const header = `== ${debug_DefId(def_id, PLAIN)} ${def.debug_DefKind(kind, PLAIN)}`;
    switch (kind.$) {
      case "Trait": {
        out.push(header);
        fact(out, "generics_require_sized_self", () => [`  generics_require_sized_self ${tcx.generics_require_sized_self(def_id)}`]);
        fact(out, "dyn_compatibility_violations", () => [
          `  dyn_compatibility_violations ${debug_vec(tcx.dyn_compatibility_violations(def_id), PLAIN, debug_DynCompatibilityViolation)}`,
        ]);
        fact(out, "is_dyn_compatible", () => [`  is_dyn_compatible ${tcx.is_dyn_compatible(def_id)}`]);
        fact(out, "hir_ty_lowering_dyn_compatibility_violations", () => [
          `  hir_ty_lowering_dyn_compatibility_violations ${debug_vec(dyn_compatibility.hir_ty_lowering_dyn_compatibility_violations(tcx, def_id), PLAIN, debug_DynCompatibilityViolation)}`,
        ]);
        if ((tcx.generics_of(def_id) as Generics).count() === 1) {
          fact(out, "object_region_bounds", () => {
            const ep: ExistentialPredicate = { $: "Trait", _0: ExistentialTraitRef.new(as_interner(tcx), def_id, []) };
            const pred = Binder.dummy(ep, { visit_with: visit_with_ExistentialPredicate });
            const list = tcx.mk_poly_existential_predicates([pred]);
            return [`  object_region_bounds ${debug_vec(wf.object_region_bounds(tcx, list), PLAIN, debug_Region)}`];
          });
        }
        for (const item of AssocItems.in_definition_order(tcx.associated_items(def_id) as AssocItems)) {
          const name = Symbol.as_str(AssocItem.name(item));
          fact(out, `assoc ${name} dyn_compatibility_violations_for_assoc_item`, () => [
            `  assoc ${name} dyn_compatibility_violations_for_assoc_item ${debug_vec(dyn_compatibility.dyn_compatibility_violations_for_assoc_item(tcx, def_id, item), PLAIN, debug_DynCompatibilityViolation)}`,
          ]);
          if (AssocItem.is_fn(item)) {
            fact(out, `assoc ${name} is_vtable_safe_method`, () => [`  assoc ${name} is_vtable_safe_method ${dyn_compatibility.is_vtable_safe_method(tcx, def_id, item)}`]);
          }
        }
        break;
      }
      case "TyAlias": {
        out.push(header);
        fact(out, "type_of", () => {
          const ty: Ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>));
          const lines: string[] = [];
          const infcx = tcx.infer_ctxt().with_next_trait_solver(true).build(TypingMode.non_body_analysis());
          const pe = ParamEnv.empty();
          fact(lines, "obligations", () => obls("obligations", wf.obligations(infcx, pe, local_id, 0, Term.from_Ty(ty), DUMMY_SP)));
          fact(lines, "unnormalized_obligations", () => obls("unnormalized_obligations", wf.unnormalized_obligations(infcx, pe, Term.from_Ty(ty), DUMMY_SP, local_id)));
          return lines;
        });
        break;
      }
      case "Impl": {
        if (!kind.of_trait) break;
        out.push(header);
        fact(out, "trait_obligations", () => {
          const trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.impl_trait_ref(def_id)));
          const polarity: ClausePolarity = tcx.impl_polarity(def_id) === "Negative" ? "Negative" : "Positive";
          const trait_pred: TraitClause = { trait_ref, polarity };
          const infcx = tcx.infer_ctxt().with_next_trait_solver(true).build(TypingMode.non_body_analysis());
          const pe = ParamEnv.empty();
          const item = tcx.hir_expect_item(local_id);
          return obls("trait_obligations", wf.trait_obligations(infcx, pe, local_id, trait_pred, DUMMY_SP, item));
        });
        break;
      }
      case "Fn": {
        out.push(header);
        fact(out, "clauses_of", () => {
          const lines: string[] = [];
          const infcx = tcx.infer_ctxt().with_next_trait_solver(true).build(TypingMode.non_body_analysis());
          const pe = ParamEnv.empty();
          for (const [clause, span] of (tcx.clauses_of(def_id) as GenericClauses).clauses) {
            lines.push(`  clause ${debug_Clause(clause, PLAIN)}`);
            fact(lines, "clause_obligations", () => obls("clause_obligations", wf.clause_obligations(infcx, pe, local_id, clause, span)));
          }
          return lines;
        });
        break;
      }
      default:
        break;
    }
  }
  hand_built(tcx, m, out);
  return out.join("\n") + "\n";
}

/** probe.rs `hand_built`. */
function hand_built(tcx: TyCtxt, m: Lazy, out: string[]): void {
  const { wf } = m;
  out.push("== hand-built");
  const infcx = tcx.infer_ctxt().with_next_trait_solver(true).build(TypingMode.non_body_analysis());
  const pe = ParamEnv.empty();
  const body = CRATE_DEF_ID;
  const v = infcx.next_ty_var(DUMMY_SP);
  const i = infcx.next_int_var();
  const c = infcx.next_const_var(DUMMY_SP);
  const r = Ty.new_imm_ref(tcx, tcx.lifetimes.re_static, v);
  const t = Ty.new_tup(tcx, [i, r, tcx.types.bool]);
  fact(out, "obligations ?0", () => obls("obligations ?0", wf.obligations(infcx, pe, body, 0, Term.from_Ty(v), DUMMY_SP)));
  fact(out, "obligations ?c", () => obls("obligations ?c", wf.obligations(infcx, pe, body, 0, Term.from_Const(c), DUMMY_SP)));
  fact(out, "obligations ?int", () => obls("obligations ?int", wf.obligations(infcx, pe, body, 0, Term.from_Ty(i), DUMMY_SP)));
  fact(out, "obligations &'static ?0", () => obls("obligations &'static ?0", wf.obligations(infcx, pe, body, 0, Term.from_Ty(r), DUMMY_SP)));
  fact(out, "obligations (?int, &'static ?0, bool) depth 3", () =>
    obls("obligations (?int, &'static ?0, bool) depth 3", wf.obligations(infcx, pe, body, 3, Term.from_Ty(t), DUMMY_SP)),
  );
  fact(out, "unnormalized_obligations ?0", () => obls("unnormalized_obligations ?0", wf.unnormalized_obligations(infcx, pe, Term.from_Ty(v), DUMMY_SP, body)));
  fact(out, "unnormalized_obligations &'static ?0", () =>
    obls("unnormalized_obligations &'static ?0", wf.unnormalized_obligations(infcx, pe, Term.from_Ty(r), DUMMY_SP, body)),
  );
}

async function main(args: string[]): Promise<number> {
  ensure_stack();
  const [mode, ...rustc_args] = args;
  if (mode !== "dump" && mode !== "e0038") {
    console.error(`ERROR: unknown mode ${mode}`);
    return 2;
  }
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../rustc_driver_impl/lib.ts");
  const { std_print } = await import("../../../rustc_session/config.ts");
  await import("../../lib.ts");
  const m: Lazy = { wf: await import("../wf.ts"), dyn_compatibility: await import("../dyn_compatibility.ts") };
  const callbacks = {
    config(c: Config): void {
      c.override_queries = (_sess, providers) => {
        m.dyn_compatibility.provide(providers.queries);
      };
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      if (mode === "dump") {
        std_print(with_no_trimmed_paths(() => dump(tcx, m)));
      } else {
        // `e0038`: lower every type alias (`type_of`), as collect's `type_of` provider does when rustc checks the crate.
        const out: string[] = [];
        for (const local_id of (tcx.hir_crate_items(null) as ModuleItems).definitions()) {
          if (tcx.def_kind(local_id).$ !== "TyAlias") continue;
          fact(out, "type_of", () => {
            tcx.type_of(local_id);
            return [];
          });
        }
        std_print(out.map((l) => l.trimStart() + "\n").join(""));
      }
      return "Stop" as const;
    },
  };
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...rustc_args], callbacks));
}

process.exitCode = await main(process.argv.slice(2));
