// Test helper of src/rustc_hir_analysis/check/check_region_intrinsic.test.ts (lane check-region-intrinsic).
//
//   bun run.ts intrinsics <rustc arguments...>
//
// Runs the ported driver up to expansion, then calls `intrinsic::check_intrinsic_type` for every free fn item that is
// an intrinsic, in `hir_crate_items` order, as check/check.rs:839 `check_item_type` (`DefKind::Fn`) does: on a crate
// whose only errors are intrinsic declaration errors, stderr equals the oracle rustc's.
//
// `check_function_signature` (lane check-check) is not in this lane's base: `intrinsic.pending` is replaced by a
// recorder, and stdout gets one line per intrinsic that reached it: `<name>: same` if the signature
// `check_intrinsic_type` computed equals the declared `fn_sig` (same interned inputs and output, safety, ABI and
// C-variadic flag; this is what `check_function_signature` equates for a region-free signature), `<name>: differs`
// otherwise, and `<name>: regions` (not compared) if the declared signature has bound variables.
import type { Compiler } from "../../../rustc_interface/interface.ts";
import type { ModuleItems } from "../../../rustc_middle/hir/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { type DefId, LocalDefId } from "../../../rustc_span/def_id.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import type { PolyFnSig } from "../../../rustc_type_ir/decls.ts";
import { FnSig } from "../../../rustc_type_ir/ty_kind.ts";
import { ExternAbi } from "../../../rustc_abi/extern_abi.ts";
import { Ok } from "../../../std/result.ts";

async function main(args: string[]): Promise<number> {
  const mode = args[0];
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../rustc_driver_impl/lib.ts");
  const { std_print } = await import("../../../rustc_session/config.ts");
  const intrinsic = await import("../intrinsic.ts");
  if (mode === "intrinsics") {
    const callbacks = {
      config(): void {},
      after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
        const lines: string[] = [];
        intrinsic.pending.check_function_signature = (tcx_, _cause, fn_id: DefId, expected_sig: PolyFnSig) => {
          const declared = tcx_.fn_sig(fn_id) as EarlyBinder<PolyFnSig>;
          const d = EarlyBinder.skip_binder(declared);
          const name = Symbol.as_str(tcx_.item_name(fn_id));
          if (d.bound_vars.length !== 0) {
            lines.push(`${name}: regions`);
          } else {
            const a = Binder.skip_binder(expected_sig);
            const b = Binder.skip_binder(d);
            const same =
              a.inputs_and_output === b.inputs_and_output &&
              FnSig.safety(a) === FnSig.safety(b) &&
              ExternAbi.eq(FnSig.abi(a), FnSig.abi(b)) &&
              FnSig.c_variadic(a) === FnSig.c_variadic(b);
            lines.push(`${name}: ${same ? "same" : "differs"}`);
          }
          return Ok(null);
        };
        for (const id of (tcx.hir_crate_items(null) as ModuleItems).free_items()) {
          const def_id = id.owner_id.def_id;
          if (tcx.def_kind(def_id).$ !== "Fn") continue;
          // check/check.rs:839
          const i = tcx.intrinsic(LocalDefId.to_def_id(def_id)) as { name: Symbol } | undefined;
          if (i !== undefined) {
            intrinsic.check_intrinsic_type(tcx, def_id, tcx.def_ident_span(LocalDefId.to_def_id(def_id))!, i.name);
          }
        }
        std_print(lines.map((l) => l + "\n").join(""));
        return "Stop" as const;
      },
    };
    return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args.slice(1)], callbacks));
  }
  console.error(`ERROR: unknown mode ${mode}`);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
