// Test helper of src/rustc_hir_analysis/coherence.test.ts (lane coherence).
//
// Runs the ported driver up to expansion (`after_expansion` -> `Stop`, as variance_outlives_test/run.ts), then:
// - `check <rustc arguments...>`: lib.rs:148 `check_crate`'s "coherence_checking" block without `check_type_wf` (wave 17
//   check-wf-a/-b): `coherent_trait` for every key of `all_local_trait_impls`, then `crate_inherent_impls_validity_check`
//   and `crate_inherent_impls_overlap_check`. Today `coherent_trait` stops at `specialization_graph_of`
//   (rustc_trait_selection specialize, wave 17).
// - `pieces <rustc arguments...>`: the same block, but each trait runs the body of `coherent_trait` (coherence/mod.rs:164)
//   without its two calls into other lanes' stubs: `specialization_graph_of` (emits only overlap errors, E0119) and
//   `always_applicable::check_negative_auto_trait_impl` (emits only for negative impls of auto traits). On a crate that
//   has neither, rustc's stderr is exactly what these per-impl checks emit. The traits are visited in the order of
//   their first impl among the free items, as rustc's `check_type_wf` (check.rs:856 `coherent_trait` per trait impl)
//   reaches them before lib.rs's loop.
// - `inherent <rustc arguments...>`: `crate_inherent_impls_validity_check` and `crate_inherent_impls_overlap_check`, then
//   prints to stdout, for every local struct / enum / union / trait / foreign type in DefIndex order, `<def_path_str>:`
//   followed by the `def_path_str` of each of its `inherent_impls` in order (`impl#N` paths), and
//   `crate_inherent_impls`' incoherent map in insertion order. Items are printed as `#<DefIndex>`.
// - `extern <rustc arguments...>`: the same `inherent_impls` lines for the first `--extern` crate, from its metadata
//   (rustc_metadata's decoder): built by the oracle, they are rustc's `inherent_impls`.
// - `incoherent` / `extern-incoherent <rustc arguments...>`: `crate_incoherent_impls((krate, simp))` for the simplified
//   self type of each inherent impl of the local / first extern crate (each type once, in DefIndex order of its first
//   impl). The extern side decodes the impls' `type_of`, so the crate must not have inherent impls on ADTs (decoding an
//   `AdtDef` is not ported).
//
//   bun run.ts check|pieces|inherent|extern|incoherent|extern-incoherent <rustc arguments...>
import type { Compiler } from "../../rustc_interface/interface.ts";
import type { ModuleItems } from "../../rustc_middle/hir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { ImplTraitHeader, Ty } from "../../rustc_middle/ty/mod.ts";
import { SimplifiedType_key } from "../../rustc_middle/ty/fast_reject.ts";
import type { TraitDef } from "../../rustc_middle/ty/trait_def.ts";
import { type CrateNum, type DefId, DefId as DefIdC, type DefIndex, DefIdSet, LOCAL_CRATE, LocalDefId } from "../../rustc_span/def_id.ts";
import { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { as_interner, fold_with_TraitRef, try_fold_with_TraitRef, visit_with_TraitRef } from "../../rustc_type_ir/predicate.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";

/** `tcx.all_local_trait_impls(()).keys()`. */
function all_local_trait_impls_keys(tcx: TyCtxt): DefId[] {
  return [...tcx.all_local_trait_impls(null).keys()];
}

type SimplifyType = typeof import("../../rustc_type_ir/fast_reject.ts").simplify_type;

/** `<DefIndex>` of a `DefId` (the same in the crate and in its metadata). */
function idx(d: DefId): string {
  return `#${d.index}`;
}

/** Is `k` a kind whose `inherent_impls` the report prints (the targets of `InherentCollect::check_def_id`)? */
function has_inherent_impls(k: { $: string }): boolean {
  return k.$ === "Struct" || k.$ === "Enum" || k.$ === "Union" || k.$ === "Trait" || k.$ === "ForeignTy";
}

function inherent_report(tcx: TyCtxt): string {
  const lines: string[] = [];
  const n = tcx.definitions_untracked().num_definitions();
  for (let i = 0; i < n; i++) {
    const def_id = LocalDefId.to_def_id(i as LocalDefId);
    if (!has_inherent_impls(tcx.def_kind(def_id))) continue;
    lines.push(`${idx(def_id)} ${tcx.def_path_str(def_id)}: ${tcx.inherent_impls(def_id).map(idx).join(" ")}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * `crate_incoherent_impls((krate, simp))` for the simplified self type of every inherent impl of `krate` (in DefIndex
 * order, each type once), printed as `incoherent #<first impl>: <impls>`.
 */
function incoherent_lines(tcx: TyCtxt, krate: CrateNum, n: number, lines: string[], simplify_type: SimplifyType): void {
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const def_id = new DefIdC(i as DefIndex, krate);
    const k = tcx.def_kind(def_id);
    if (!(k.$ === "Impl" && !k.of_trait)) continue;
    const self_ty = tcx.peel_off_free_alias_tys(EarlyBinder.skip_binder(tcx.type_of(def_id) as EarlyBinder<Ty>));
    const simp = simplify_type(as_interner(tcx), self_ty, "InstantiateWithInfer");
    if (simp === undefined) continue;
    const key = SimplifiedType_key(simp);
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`incoherent ${idx(def_id)}: ${tcx.crate_incoherent_impls([krate, simp]).map(idx).join(" ")}`);
  }
}

/** The same lines for the first extern crate, decoded from its (oracle-built) metadata. */
function extern_report(tcx: TyCtxt): string {
  const lines: string[] = [];
  const krate = tcx.crates(null)[0]!;
  const n = tcx.num_extern_def_ids(krate);
  for (let i = 0; i < n; i++) {
    const def_id = new DefIdC(i as DefIndex, krate);
    if (!has_inherent_impls(tcx.def_kind(def_id))) continue;
    lines.push(`${idx(def_id)} ${tcx.def_path_str(def_id)}: ${tcx.inherent_impls(def_id).map(idx).join(" ")}`);
  }
  return lines.join("\n") + "\n";
}

async function main(args: string[]): Promise<number> {
  const mode = args[0];
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { std_print } = await import("../../rustc_session/config.ts");
  const { with_no_trimmed_paths } = await import("../../rustc_middle/ty/print/pretty.ts");
  const { simplify_type } = await import("../../rustc_type_ir/fast_reject.ts");
  const run = (f: (tcx: TyCtxt) => void): number => {
    const callbacks = {
      config(): void {},
      after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
        f(tcx);
        return "Stop" as const;
      },
    };
    return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args.slice(1)], callbacks));
  };
  const coherence = await import("../coherence/mod.ts");
  if (mode === "check") {
    return run((tcx) => {
      for (const trait_def_id of all_local_trait_impls_keys(tcx)) {
        tcx.ensure_result().coherent_trait(trait_def_id);
      }
      tcx.ensure_result().crate_inherent_impls_validity_check(null);
      tcx.ensure_result().crate_inherent_impls_overlap_check(null);
    });
  }
  if (mode === "pieces") {
    return run((tcx) => {
      const seen = new DefIdSet();
      const visit = (trait_def_id: DefId): void => {
        if (seen.has(trait_def_id)) return;
        seen.add(trait_def_id);
        coherent_trait_pieces(tcx, trait_def_id, coherence);
      };
      for (const id of (tcx.hir_crate_items(null) as ModuleItems).free_items()) {
        const dk = tcx.def_kind(id.owner_id);
        if (dk.$ === "Impl" && dk.of_trait) {
          const header = tcx.impl_trait_header(id.owner_id.def_id) as ImplTraitHeader;
          visit(EarlyBinder.skip_binder(header.trait_ref).def_id);
        }
      }
      for (const trait_def_id of all_local_trait_impls_keys(tcx)) visit(trait_def_id);
      tcx.ensure_result().crate_inherent_impls_validity_check(null);
      tcx.ensure_result().crate_inherent_impls_overlap_check(null);
    });
  }
  if (mode === "inherent") {
    return run((tcx) => {
      tcx.ensure_result().crate_inherent_impls_validity_check(null);
      tcx.ensure_result().crate_inherent_impls_overlap_check(null);
      std_print(with_no_trimmed_paths(() => inherent_report(tcx)));
    });
  }
  if (mode === "extern") {
    return run((tcx) => {
      std_print(with_no_trimmed_paths(() => extern_report(tcx)));
    });
  }
  if (mode === "incoherent") {
    return run((tcx) => {
      const lines: string[] = [];
      incoherent_lines(tcx, LOCAL_CRATE, tcx.definitions_untracked().num_definitions(), lines, simplify_type);
      std_print(lines.join("\n") + "\n");
    });
  }
  if (mode === "extern-incoherent") {
    return run((tcx) => {
      const lines: string[] = [];
      const krate = tcx.crates(null)[0]!;
      incoherent_lines(tcx, krate, tcx.num_extern_def_ids(krate), lines, simplify_type);
      std_print(lines.join("\n") + "\n");
    });
  }
  console.error(`ERROR: unknown mode ${mode}`);
  return 2;
}

/** `coherent_trait` (coherence/mod.rs:164) without `specialization_graph_of` and `check_negative_auto_trait_impl`. */
function coherent_trait_pieces(tcx: TyCtxt, def_id: DefId, coherence: typeof import("../coherence/mod.ts")): void {
  const d_TraitRef = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
  for (const impl_def_id of tcx.local_trait_impls(def_id)) {
    const impl_header = tcx.impl_trait_header(impl_def_id) as ImplTraitHeader;
    const trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(impl_header.trait_ref));
    const trait_def = tcx.trait_def(trait_ref.def_id) as TraitDef;
    // `check_impl` without `check_negative_auto_trait_impl`.
    if (TypeVisitableExt.error_reported(trait_ref, d_TraitRef).$ === "Ok") {
      coherence.enforce_trait_manually_implementable(tcx, impl_def_id, trait_ref.def_id, trait_def);
      coherence.enforce_empty_impls_for_marker_traits(tcx, impl_def_id, trait_ref.def_id, trait_def);
    }
    coherence.check_object_overlap(tcx, impl_def_id, trait_ref);
    coherence.unsafety.check_item(tcx, impl_def_id, impl_header, trait_def);
    tcx.ensure_result().orphan_check_impl(impl_def_id);
    coherence.builtin.check_trait(tcx, trait_ref.def_id, impl_def_id, impl_header);
  }
}

process.exitCode = await main(process.argv.slice(2));
