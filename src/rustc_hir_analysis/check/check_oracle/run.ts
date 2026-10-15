// Test driver for src/rustc_hir_analysis/check/check.oracle.test.ts (lane check-check; not a port).
//   bun run.ts <mode> <rustc arguments...>
//
// Runs the ported driver; in `after_expansion` it runs the mode's checks, then stops (`Compilation::Stop`). The diagnostics
// go through the session's emitter and the driver prints the error count at exit, so stderr and the exit code must equal
// plain `rustc` on the same file (whose later passes emit nothing for these cases).
//
// Mode `wf`: what upstream's `check_type_wf` (check/wfcheck.rs:2614, lanes
// check-wf-a/-b) does for these crates: `check_well_formed` of every free item, impl item, trait item, foreign item,
// nested body and opaque, in that order; `check_well_formed` (wfcheck.rs:221) is `check::check::check_item_type` (this
// lane) plus `check_param_wf` of the item's own params.
//
// Mode `abi`: only the `check_abi` calls of that walk, made by their upstream callers, in the same item order: for a type
// alias, `check_item_type`'s `tcx.ensure_ok().type_of(def_id)` (the `type_of` provider lowers the type; a fn pointer goes
// through `lower_fn_ty`, which calls `check_abi`); for a struct, the same for each field (`tcx.ensure_ok().type_of(f.did)`);
// for an extern block, `check_item_type`'s `check_abi(tcx, it.hir_id(), it.span, abi)`. Mode `wf` reaches these too, but
// `check_item_type` first asks for queries of other lanes (e.g. `clauses_of` -> `inferred_outlives_of`, lane
// variance-outlives-implwf) that stop before; mode `abi` shows what `check_abi` itself emits meanwhile.
//
// Scaffolding (none of it is a port; it stands for code of other lanes that is not ported yet):
// - the walk stands for `check_type_wf` / `check_well_formed` (wfcheck.rs). Without the cases' items having generic
//   params, `check_param_wf` has nothing to check;
// - `check_item_type` reaches the wfcheck.rs stand-ins of check.ts (`enter_wf_checking_ctxt`, `check_type_defn`, ...) after
//   the checks of this lane ran. Such a stop (an `Unported` whose text names `rustc_hir_analysis::check::wfcheck::`) ends
//   that item's check and the loop goes on with the next item; any other `Unported` propagates (exit 70).
//
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
import type { Compiler, Config } from "../../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { LocalDefId } from "../../../rustc_span/def_id.ts";
import { ensure_stack } from "../../../rust_ts/stack.ts";

async function main(args: string[]): Promise<number> {
  ensure_stack();
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../rustc_driver_impl/lib.ts");
  const { Unported } = await import("../../../std/panic.ts");
  const [mode, ...rustc_args] = args;
  const { check_abi, check_item_type } = await import("../check.ts");
  const { LocalDefId: LocalDefIdC } = await import("../../../rustc_span/def_id.ts");
  await import("../../lib.ts");

  /** Mode `abi`: the `check_abi` callers of `check_item_type` (check.rs:763) for this item. */
  function abi_checks(tcx: TyCtxt, def_id: LocalDefId): void {
    switch (tcx.def_kind(def_id).$) {
      case "TyAlias":
        tcx.ensure_ok().type_of(def_id);
        break;
      case "Struct":
      case "Union":
        for (const f of (tcx.adt_def(def_id) as import("../../../rustc_middle/ty/adt.ts").AdtDef).non_enum_variant().fields) {
          tcx.ensure_ok().type_of(f.did);
        }
        break;
      case "ForeignMod": {
        const it = tcx.hir_expect_item(def_id);
        if (it.kind.$ === "ForeignMod") check_abi(tcx, it.hir_id(), it.span, it.kind.abi);
        break;
      }
      default:
        break;
    }
  }

  function check_well_formed(tcx: TyCtxt, def_id: LocalDefId): void {
    if (mode === "abi") return abi_checks(tcx, def_id);
    try {
      check_item_type(tcx, def_id);
    } catch (e) {
      if (e instanceof Unported && e.what.startsWith("rustc_hir_analysis::check::wfcheck::")) return;
      throw e;
    }
  }

  const callbacks = {
    config(_config: Config): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      const items = tcx.hir_crate_items(null) as import("../../../rustc_middle/hir/mod.ts").ModuleItems;
      for (const item of items.free_items()) check_well_formed(tcx, item.owner_id.def_id);
      for (const item of items.impl_items()) check_well_formed(tcx, item.owner_id.def_id);
      for (const item of items.trait_items()) check_well_formed(tcx, item.owner_id.def_id);
      for (const item of items.foreign_items()) check_well_formed(tcx, item.owner_id.def_id);
      for (const item of items.nested_bodies()) check_well_formed(tcx, item);
      for (const item of items.opaques()) check_well_formed(tcx, item);
      return "Stop";
    },
  };
  if (mode !== "wf" && mode !== "abi") {
    console.error(`ERROR: unknown mode ${mode}`);
    return 2;
  }
  void LocalDefIdC;
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...rustc_args], callbacks));
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  // As src/rust_ts/main.ts.
  const { Unported } = await import("../../../std/panic.ts");
  if (e instanceof Unported) {
    process.stderr.write(`rust-ts: unported: ${e.what}\n`);
    process.exitCode = 70;
  } else {
    process.stderr.write(`rust-ts: internal compiler error: ${String(e)}\n${e instanceof Error ? e.stack : ""}\n`);
    process.exitCode = 101;
  }
}
