// Test runner of lane collect-rbv (resolve_bound_vars.test.ts): runs the ported driver on a crate (real parsing, expansion,
// resolution and AST lowering) and, in `after_expansion`, computes `tcx.resolve_bound_vars(owner)` for every HIR owner of
// `tcx.hir_crate_items(())` (in `ModuleItems::owners` order), prints it, then `abort_if_errors` and stops.
//   bun src/rustc_hir_analysis/collect/rbv_oracle/run.ts <rustc arguments...>
//
// stdout, per owner (values in their upstream `{:?}`; maps in key order, `opaque_captured_lifetimes` by DefIndex):
//   <owner LocalDefId:?>
//     is_late_bound_map <None | [ItemLocalId, ..]>
//     def <ItemLocalId:?> <ResolvedArg:?>                       (`ResolveBoundVars::defs`)
//     late_bound_vars <ItemLocalId:?> <[BoundVariableKind]:?>    (`ResolveBoundVars::late_bound_vars`)
//     opaque <LocalDefId:?> <[(ResolvedArg, LocalDefId)]:?>     (`ResolveBoundVars::opaque_captured_lifetimes`)
// stderr: the diagnostics, as rustc renders them. Exit codes as src/rust_ts/main.ts (70 = unported, 101 = ICE).
import type { Compiler, Config } from "../../../rustc_interface/interface.ts";
import type { ModuleItems } from "../../../rustc_middle/hir/mod.ts";
import { debug_ResolvedArg, type ResolveBoundVars } from "../../../rustc_middle/middle/resolve_bound_vars.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { debug_ItemLocalId, type ItemLocalId } from "../../../rustc_hir_id/lib.ts";
import { debug_LocalDefId, LocalDefId } from "../../../rustc_span/def_id.ts";
import { debug_BoundVariableKind } from "../../../rustc_type_ir/binder.ts";
import { debug_tuple, debug_vec, PLAIN } from "../../../std/fmt.ts";
import { Panic, Unported } from "../../../std/panic.ts";

function dump(tcx: TyCtxt): string {
  const out: string[] = [];
  const items = tcx.hir_crate_items(null) as ModuleItems;
  for (const owner of items.owners()) {
    const rbv = tcx.resolve_bound_vars(owner) as ResolveBoundVars;
    out.push(debug_LocalDefId(owner.def_id, PLAIN));
    const lb = tcx.is_late_bound_map(owner) as Set<ItemLocalId> | undefined;
    out.push(`  is_late_bound_map ${lb === undefined ? "None" : debug_vec([...lb], PLAIN, debug_ItemLocalId)}`);
    for (const [k, v] of rbv.defs.iter()) out.push(`  def ${debug_ItemLocalId(k, PLAIN)} ${debug_ResolvedArg(v, PLAIN)}`);
    for (const [k, v] of rbv.late_bound_vars.iter()) out.push(`  late_bound_vars ${debug_ItemLocalId(k, PLAIN)} ${debug_vec(v, PLAIN, debug_BoundVariableKind)}`);
    const opaques = [...rbv.opaque_captured_lifetimes].sort(([a], [b]) => LocalDefId.index(a) - LocalDefId.index(b));
    for (const [k, v] of opaques) {
      const pairs = debug_vec(v, PLAIN, ([r, d], f) => debug_tuple(f, "", [debug_ResolvedArg(r, f), debug_LocalDefId(d, f)]));
      out.push(`  opaque ${debug_LocalDefId(k, PLAIN)} ${pairs}`);
    }
  }
  return out.join("\n") + "\n";
}

async function main(args: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../rustc_driver_impl/lib.ts");
  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes (src/rust_ts/tydump.ts).
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      const text = dump(tcx);
      process.stdout.write(text);
      tcx.dcx().abort_if_errors();
      return "Stop";
    },
  };
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args], callbacks));
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  if (e instanceof Unported) {
    process.stderr.write(`rust-ts: unported: ${e.what}\n`);
    process.exitCode = 70;
  } else {
    const msg = e instanceof Panic ? e.message : String(e);
    process.stderr.write(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
    process.exitCode = 101;
  }
}
