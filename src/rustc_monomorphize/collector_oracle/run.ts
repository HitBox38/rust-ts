// Test-only driver for src/rustc_monomorphize/collector.oracle.test.ts (lane mono-collector; not a port).
//   bun src/rustc_monomorphize/collector_oracle/run.ts <rustc arguments...>
//
// The ported driver, stopped after `tcx.ensure_ok().analysis(())` (the `after_analysis` callback, as
// rustc_interface/analysis_oracle/run.ts). It then does what `collect_and_partition_mono_items` does up to
// `collect_crate_mono_items` (rustc_monomorphize/src/partitioning.rs:1169-1178) and prints one line per item, in the
// collector's order: `<fingerprint as 32 hex digits> <item, as -Zprint-mono-items prints it without its @@ part>`.
//
// The CGU part of the oracle's `MONO_ITEM` lines is compared by partitioning_oracle (`collect_and_partition_mono_items`).
//
// It then prints, as `VT ` lines, what `tcx.vtable_allocation` holds for every vtable reachable from the crate's statics
// (the same walk as probe/main.rs).
//
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { AllocId, GlobalAlloc } from "../../rustc_middle/mir/interpret/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { ModuleItems } from "../../rustc_middle/hir/mod.ts";
import { ensure_stack } from "../../rust_ts/stack.ts";
import { write_stdout } from "../../std/io.ts";
import { Panic, Unported } from "../../std/panic.ts";

const EXIT_UNPORTED = 70;

async function main(): Promise<number> {
  ensure_stack();
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../../rustc_driver_impl/args.ts");
  const { EarlyDiagCtxt } = await import("../../rustc_session/session.ts");
  const { ErrorOutputType } = await import("../../rustc_session/config.ts");
  const { collect_crate_mono_items } = await import("../collector.ts");
  const { display_MonoItem, MonoItem } = await import("../../rustc_middle/mono.ts");
  const { with_no_trimmed_paths } = await import("../../rustc_middle/ty/print/pretty.ts");
  const { Fingerprint } = await import("../../rustc_data_structures/fingerprint.ts");
  const { Size, Size_cmp } = await import("../../rustc_abi/lib.ts");
  const { CtfeProvenance, GlobalAlloc: GlobalAllocC, Provenance_CtfeProvenance, alloc_range } = await import("../../rustc_middle/mir/interpret/mod.ts");
  const { display_Instance } = await import("../../rustc_middle/ty/instance.ts");
  const { display_List_PolyExistentialPredicate, display_Ty } = await import("../../rustc_middle/ty/print/pretty.ts");
  const { fold_with_ExistentialTraitRef, try_fold_with_ExistentialTraitRef, visit_with_ExistentialTraitRef } = await import("../../rustc_type_ir/predicate.gen.ts");
  const d_ExistentialTraitRef = { visit_with: visit_with_ExistentialTraitRef, try_fold_with: try_fold_with_ExistentialTraitRef, fold_with: fold_with_ExistentialTraitRef };

  function slot(tcx: TyCtxt, id: AllocId): string {
    const ga: GlobalAlloc = tcx.global_alloc(id);
    switch (ga.$) {
      case "Function":
        return `fn ${display_Instance(ga.instance)}`;
      case "VTable":
        return `vtable ${display_List_PolyExistentialPredicate(ga._1)} for ${display_Ty(ga._0)}`;
      case "Memory":
        return "memory";
      case "Static":
        return "static";
      case "TypeId":
        return "typeid";
    }
  }

  function walk(tcx: TyCtxt, id: AllocId, seen: Set<AllocId>, out: Map<string, string>): void {
    if (seen.has(id)) return;
    seen.add(id);
    const ga: GlobalAlloc = tcx.global_alloc(id);
    switch (ga.$) {
      case "Function":
      case "TypeId":
        break;
      case "Static": {
        const init = tcx.eval_static_initializer(ga._0);
        if (init.$ === "Ok") for (const [, prov] of init._0.inner().provenance.ptrs.data) walk(tcx, CtfeProvenance.alloc_id(prov), seen, out);
        break;
      }
      case "Memory":
        for (const [, prov] of ga._0.inner().provenance.ptrs.data) walk(tcx, CtfeProvenance.alloc_id(prov), seen, out);
        break;
      case "VTable": {
        const [ty, dyn_ty] = [ga._0, ga._1];
        const principal = dyn_ty.principal();
        const vtable_id = tcx.vtable_allocation([ty, principal !== undefined ? tcx.instantiate_bound_regions_with_erased(principal, d_ExistentialTraitRef) : undefined]);
        const inner = GlobalAllocC.unwrap_memory(tcx.global_alloc(vtable_id)).inner();
        const ptr_size = tcx.data_layout().pointer_size();
        let body = `size ${inner.size().bytes()} align ${inner.align.bytes()} ${inner.mutability}\n`;
        for (let off = Size.ZERO; Size_cmp(off, inner.size()) < 0; off = off.add(ptr_size)) {
          const r = inner.read_scalar(tcx, alloc_range(off, ptr_size), true, Provenance_CtfeProvenance);
          let text: string;
          if (r.$ === "Err") {
            text = "uninit";
          } else if (r._0.$ === "Int") {
            text = `int ${r._0._0.to_bits(ptr_size)}`;
          } else {
            const [prov, offset] = r._0._0.prov_and_relative_offset();
            walk(tcx, CtfeProvenance.alloc_id(prov), seen, out);
            text = `${slot(tcx, CtfeProvenance.alloc_id(prov))} +${offset.bytes()}`;
          }
          body += `  ${off.bytes()}: ${text}\n`;
        }
        out.set(`VTABLE ${display_List_PolyExistentialPredicate(dyn_ty)} for ${display_Ty(ty)}`, body);
        break;
      }
    }
  }

  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
    },
    after_analysis(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      // rustc: partitioning.rs:1170: `if tcx.sess.link_dead_code() { Eager } else { Lazy }`
      const strategy = tcx.sess.link_dead_code() ? "Eager" : "Lazy";
      const [items, _usage_map] = collect_crate_mono_items(tcx, strategy);
      // rustc: partitioning.rs:1178: "Abort early if there are errors"
      tcx.dcx().abort_if_errors();
      const lines = tcx.with_stable_hashing_context((hcx) =>
        items.map((item) => {
          const fp = MonoItem.to_stable_hash_key(item, hcx);
          return `${fp.toString(16).padStart(32, "0")} ${with_no_trimmed_paths(() => display_MonoItem(item))}`;
        }),
      );
      write_stdout(lines.map((l) => `${l}\n`).join(""));
      const seen = new Set<AllocId>();
      const vtables = new Map<string, string>();
      with_no_trimmed_paths(() => {
        for (const item of (tcx.hir_crate_items(null) as ModuleItems).free_items()) {
          const def_id = item.owner_id.to_def_id();
          if (tcx.def_kind(def_id).$ === "Static") walk(tcx, tcx.reserve_and_set_static_alloc(def_id), seen, vtables);
        }
      });
      // As the probe's `BTreeMap<String, _>`: byte order.
      const headers = [...vtables.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
      write_stdout(headers.flatMap((h) => [h, ...vtables.get(h)!.trimEnd().split("\n")]).map((l) => `VT ${l}\n`).join(""));
      return "Stop";
    },
  };

  const early_dcx = EarlyDiagCtxt.new(ErrorOutputType.default());
  return catch_with_exit_code(() => compiler_entrypoint(raw_args(early_dcx), callbacks));
}

try {
  process.exitCode = await main();
} catch (e) {
  if (e instanceof Unported) {
    console.error(`rust-ts: reached unported code: ${e.what}`);
    process.exitCode = EXIT_UNPORTED;
  } else if (e instanceof Panic) {
    console.error(`rust-ts: internal compiler error: ${e.message}`);
    process.exitCode = 101;
  } else {
    throw e;
  }
}
