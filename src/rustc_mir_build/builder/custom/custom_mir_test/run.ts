// Test helper of src/rustc_mir_build/builder/custom/custom_mir.test.ts (lane mb-custom-tail).
//
// Runs the ported driver (parsing, expansion, resolution, AST lowering), then, for every body owner with
// `#[custom_mir]` in `hir_body_owners` order, `thir_body` and `construct_fn` (which branches into
// `custom::build_custom_mir` first thing), and prints the built body as rustc's `-Zdump-mir=built` file body
// (`MirWriter::write_mir_fn`, rustc_middle/src/mir/pretty.rs) on stdout.
// PORT (test): rustc reaches `construct_fn` through `mir_built` -> `build_mir_inner_impl` after `check_match` /
// `check_tail_calls`, which accept these bodies (the `check_match` provider is lane thir-pattern's, so this calls
// `construct_fn` directly, as builder/contract.test.ts does); the dump of `mir_built` is that body unchanged.
//
//   bun run.ts <rustc arguments...>
import type { Compiler, Config } from "../../../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../../../rustc_middle/ty/context.ts";

async function main(argv: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../../rustc_driver_impl/lib.ts");
  await import("../../../../rustc_hir_analysis/lib.ts");
  await import("../../../../rustc_middle/lib.ts");
  await import("../../../lib.ts");
  const { construct_fn } = await import("../../mod.ts");
  const { find_attr } = await import("../../../../rustc_attr_ir/lib.ts");
  const { HasAttrs_HirId } = await import("../../../../rustc_middle/ty/mod.ts");
  const { MirWriter } = await import("../../../../rustc_middle/mir/pretty.ts");
  const { VecU8 } = await import("../../../../vendor/anstream/stream.ts");
  const { debug_IoError } = await import("../../../../std/io.ts");
  const { PLAIN } = await import("../../../../std/fmt.ts");
  type Steal<T> = import("../../../../rustc_data_structures/steal.ts").Steal<T>;
  type Thir = import("../../../../rustc_middle/thir.ts").Thir;
  type ExprId = import("../../../../rustc_middle/thir.ts").ExprId;
  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(c: Config): void {
      c.opts.trimmed_def_paths = true;
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      for (const def_id of tcx.hir_body_owners()) {
        const hir_id = tcx.local_def_id_to_hir_id(def_id);
        if (find_attr(HasAttrs_HirId.get_attrs(hir_id, tcx), (k) => (k.$ === "CustomMir" ? null : undefined)) === undefined) continue;
        const r = tcx.thir_body(def_id) as { $: "Ok"; _0: [Steal<Thir>, ExprId] } | { $: "Err"; _0: unknown };
        if (r.$ !== "Ok") continue;
        const [thir, expr] = r._0;
        const thir_ = thir.borrow();
        if (thir_.body_type.$ !== "Fn") continue;
        const body = construct_fn(tcx, def_id, thir_, expr, thir_.body_type._0);
        const w = new VecU8();
        const wr = MirWriter.new(tcx).write_mir_fn(body, w);
        if (wr.$ === "Err") throw new Error(`ERROR: write_mir_fn: ${debug_IoError(wr._0, PLAIN)}`);
        process.stdout.write(new TextDecoder("utf-8", { fatal: true }).decode(w.bytes()));
      }
      return "Stop" as const;
    },
  };
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...argv], callbacks));
}

const { Unported } = await import("../../../../std/panic.ts");
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
