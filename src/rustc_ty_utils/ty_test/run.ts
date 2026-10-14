// Test helper of src/rustc_ty_utils/ty.test.ts (lane ty-utils).
//
// Runs the ported driver up to expansion, then prints, for every item, trait item and impl item of the crate (HIR
// owner order), the results of rustc_ty_utils providers that only read the HIR (`asyncness`, `defaultness`,
// `nested_bodies_within`), and where the providers that need rustc_hir_analysis queries stop (`param_env`,
// `opaque_types_defined_by`, `assumed_wf_types`): an `Unported` is printed as `UNPORTED: <what>`. Def ids print as `DefPath::to_string_no_crate_verbose` (`def_path_str` of an impl
// item needs `type_of`).
//
//   bun run.ts <rustc arguments...>
import type { Compiler } from "../../rustc_interface/interface.ts";
import type { ModuleItems } from "../../rustc_middle/hir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { List } from "../../rustc_middle/ty/list.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";

function attempt(f: () => string): string {
  try {
    return f();
  } catch (e) {
    const { Unported } = require("../../std/panic.ts") as typeof import("../../std/panic.ts");
    if (e instanceof Unported) return `UNPORTED: ${e.what}`;
    throw e;
  }
}

function report(tcx: TyCtxt): string {
  const path = (d: LocalDefId): string => tcx.def_path(LocalDefId.to_def_id(d)).to_string_no_crate_verbose();
  const { debug_Defaultness } = require("../../rustc_hir/hir.ts") as typeof import("../../rustc_hir/hir.ts");
  type Defaultness = import("../../rustc_hir/hir.ts").Defaultness;
  const { PLAIN } = require("../../std/fmt.ts") as typeof import("../../std/fmt.ts");
  const lines: string[] = [];
  const items = tcx.hir_crate_items(null) as ModuleItems;
  const owners: LocalDefId[] = [
    ...[...items.free_items()].map((i) => i.owner_id.def_id),
    ...[...items.trait_items()].map((i) => i.owner_id.def_id),
    ...[...items.impl_items()].map((i) => i.owner_id.def_id),
  ];
  for (const def_id of owners) {
    const kind = tcx.def_kind(def_id).$;
    lines.push(`${path(def_id)} (${kind})`);
    if (kind === "Fn" || kind === "AssocFn") {
      lines.push(`  asyncness = ${tcx.asyncness(def_id)}`);
    }
    // `defaultness` is defined for trait impls, trait items and trait impl items (inherent impl items are a `bug!`).
    const parent = kind === "AssocFn" || kind === "AssocConst" ? tcx.def_kind(tcx.local_parent(def_id)) : undefined;
    const k = tcx.def_kind(def_id);
    if ((k.$ === "Impl" && k.of_trait) || parent?.$ === "Trait" || (parent?.$ === "Impl" && parent.of_trait)) {
      lines.push(`  defaultness = ${debug_Defaultness(tcx.defaultness(def_id) as Defaultness, PLAIN)}`);
    }
    if (kind === "Fn" || kind === "AssocFn" || kind === "AssocConst" || kind === "Const") {
      if (tcx.hir_maybe_body_owned_by(def_id) !== undefined) {
        lines.push(`  nested_bodies_within = ${attempt(() => `[${(tcx.nested_bodies_within(def_id) as List<LocalDefId>).map(path).join(", ")}]`)}`);
      }
    }
  }
  // Each probe reaches a different unported rustc_hir_analysis query (a query whose provider stopped is poisoned: a
  // second call raises `FatalError`, as upstream after a panic).
  const fn_f = owners.find((d) => path(d) === "::f")!;
  const inherent_impl = owners.find((d) => path(d) === "::{impl#1}")!;
  lines.push(`param_env(::f): ${attempt(() => (tcx.param_env(fn_f), "ok"))}`);
  lines.push(`opaque_types_defined_by(::f): ${attempt(() => (tcx.opaque_types_defined_by(fn_f), "ok"))}`);
  lines.push(`assumed_wf_types(::{impl#1}): ${attempt(() => (tcx.assumed_wf_types(inherent_impl), "ok"))}`);
  return lines.join("\n") + "\n";
}

async function main(args: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { std_print } = await import("../../rustc_session/config.ts");
  const callbacks = {
    config(): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      std_print(report(tcx));
      return "Stop" as const;
    },
  };
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args], callbacks));
}

process.exitCode = await main(process.argv.slice(2));
