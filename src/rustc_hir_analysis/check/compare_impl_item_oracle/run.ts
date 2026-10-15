// Test driver for src/rustc_hir_analysis/check/compare_impl_item.oracle.test.ts (lane check-compare; not a port).
//   bun run.ts <rustc arguments...>
//
// Runs the ported driver; in `after_expansion` it walks the crate's trait impls and, for each impl item, does what
// check/check.rs:1299 `check_impl_items_against_trait` (lane check-check) does with it: `compare_impl_item` (the query
// provider, called directly) and, when that is `Ok` for an associated fn,
// `refine::check_refining_return_position_impl_trait_in_trait`. Then it stops (`Compilation::Stop`). The diagnostics go
// through the session's emitter and the driver prints the error count at exit, so stderr and the exit code must equal
// plain `rustc` on the same file (whose type checking emits exactly these diagnostics).
//
// Scaffolding (not a port): the walk over `hir_free_items` stands for check.rs's caller chain (`check_item_type` ->
// `check_impl_items_against_trait`); it skips what that function does besides comparing items (negative impls, missing
// items, `impl_self_is_guaranteed_unsized`).
//
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
import "../../lib.ts";
import type { Compiler, Config } from "../../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { ensure_stack } from "../../../rust_ts/stack.ts";

async function main(args: string[]): Promise<number> {
  ensure_stack();
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../rustc_driver_impl/lib.ts");
  const { AssocItem } = await import("../../../rustc_middle/ty/assoc.ts");
  const { EarlyBinder } = await import("../../../rustc_type_ir/binder.ts");
  const { Unnormalized } = await import("../../../rustc_type_ir/unnormalized.ts");
  const { compare_impl_item, refine } = await import("../compare_impl_item.ts");

  function run(tcx: TyCtxt): void {
    for (const id of tcx.hir_free_items()) {
      const it = tcx.hir_item(id);
      if (it.kind.$ !== "Impl" || it.kind._0.of_trait === undefined) continue;
      const impl_id = it.owner_id.def_id;
      for (const impl_item of tcx.associated_item_def_ids(impl_id)) {
        const ty_impl_item = tcx.associated_item(impl_item) as import("../../../rustc_middle/ty/assoc.ts").AssocItem;
        const trait_item_id = AssocItem.expect_trait_impl(ty_impl_item);
        if (trait_item_id.$ === "Err") continue;
        const ty_trait_item = tcx.associated_item(trait_item_id._0) as import("../../../rustc_middle/ty/assoc.ts").AssocItem;

        const res = compare_impl_item(tcx, impl_item.expect_local());
        if (res.$ === "Ok" && ty_impl_item.kind.$ === "Fn") {
          refine.check_refining_return_position_impl_trait_in_trait(
            tcx,
            ty_impl_item,
            ty_trait_item,
            Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.impl_trait_ref(AssocItem.container_id(ty_impl_item, tcx)))),
          );
        }
      }
    }
  }

  const callbacks = {
    config(_config: Config): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      run(tcx);
      return "Stop";
    },
  };
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args], callbacks));
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  // As src/rust_ts/main.ts: reaching unported code is exit 70 with one `rust-ts: unported: ..` line.
  const { Unported } = await import("../../../std/panic.ts");
  if (e instanceof Unported) {
    process.stderr.write(`rust-ts: unported: ${e.what}\n`);
    process.exitCode = 70;
  } else {
    throw e;
  }
}
