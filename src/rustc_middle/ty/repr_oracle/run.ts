// Test driver for src/rustc_middle/ty/repr.oracle.test.ts (not a port).
//   bun src/rustc_middle/ty/repr_oracle/run.ts <rustc arguments...>
//
// Subject side of ./probe.rs (its header documents the output): runs the ported driver and, in `after_expansion`,
// prints `TyCtxt::repr_options_of_def` and the `ReprOptions` predicates of every local struct / enum / union with lane
// repr-options' ports, then stops (`Compilation::Stop`).
//
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
import type { Compiler, Config } from "../../../rustc_interface/interface.ts";
import type { TyCtxt } from "../context.ts";
import { Panic, Unported } from "../../../std/panic.ts";
import { ensure_stack } from "../../../rust_ts/stack.ts";

const EXIT_UNPORTED = 70;

async function main(): Promise<number> {
  ensure_stack();
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../../../rustc_driver_impl/args.ts");
  const { EarlyDiagCtxt } = await import("../../../rustc_session/session.ts");
  const { ErrorOutputType, std_print } = await import("../../../rustc_session/config.ts");
  const { debug_IntegerType, debug_ReprOptions } = await import("../../../rustc_abi/lib.ts");
  type ReprOptions = import("../../../rustc_abi/lib.ts").ReprOptions;
  const { LocalDefId } = await import("../../../rustc_span/def_id.ts");
  const { Symbol } = await import("../../../rustc_span/symbol.ts");
  const { PLAIN, PRETTY } = await import("../../../std/fmt.ts");
  type ModuleItems = import("../../hir/mod.ts").ModuleItems;

  const callbacks = {
    config(_config: Config): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      let out = "";
      let first: ReprOptions | undefined;
      for (const def_id of (tcx.hir_crate_items(null) as ModuleItems).definitions()) {
        const kind = tcx.def_kind(def_id);
        if (!(kind.$ === "Struct" || kind.$ === "Enum" || kind.$ === "Union")) continue;
        const r = tcx.repr_options_of_def(def_id);
        out += `${Symbol.as_str(tcx.item_name(LocalDefId.to_def_id(def_id)))} ${debug_ReprOptions(r, PLAIN)}\n`;
        const preds = [
          r.c(),
          r.simd(),
          r.is_scalable(),
          r.rust(),
          r.packed(),
          r.transparent(),
          r.linear(),
          r.inhibit_enum_layout_opt(),
          r.inhibit_newtype_abi_optimization(),
          r.inhibit_struct_field_reordering(),
          r.can_randomize_type_layout(),
          r.inhibits_union_abi_opt(),
        ];
        out += `  ${preds.join(" ")}\n`;
        if (kind.$ === "Enum") out += `  discr_type ${debug_IntegerType(r.discr_type(), PLAIN)}\n`;
        first ??= r;
      }
      out += "== pretty\n";
      if (first !== undefined) out += `${debug_ReprOptions(first, PRETTY)}\n`;
      std_print(out);
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
    process.stderr.write(`rust-ts: unported: ${e.what}\n`);
    process.exitCode = EXIT_UNPORTED;
  } else {
    const msg = e instanceof Panic ? e.message : String(e);
    process.stderr.write(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
    process.exitCode = 101;
  }
}
