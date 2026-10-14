// Test helper of src/rustc_hir_analysis/collect.test.ts (lane collect-a).
//
// Runs the ported driver up to expansion, lowers the crate (`hir_crate_items`), then prints, for every local DefId in
// DefIndex order, the `generics_of` and `type_of` facts the tydump probe prints (tools/probes/tydump/main.rs `dump`): the
// header `<LocalDefId:?> <DefKind:?>`, then `  generics_of <Generics:?>` if `should_encode_generics(def_kind)` and
// `  type_of <EarlyBinder<Ty>:?>` if `should_encode_type(..)`, formatted under `with_no_trimmed_paths!` as the probe does.
// A fact whose computation stops prints `  <fact> STOP <what>` instead (UNPORTED: the unported path; ERROR: anything else,
// e.g. a query poisoned by an earlier stop). Differences from the probe (documented, not ports):
// - the probe's prefix (`run_required_analyses` up to typeck) is not run; the facts are computed on demand;
// - `type_of` of an `AnonConst` is not asked: upstream feeds it while lowering the const argument (hir_ty_lowering), and
//   asking first takes the "before the const argument was lowered" error path (a delayed bug);
// - the `defs_with_hir` filter of erroneous crates is left out (the test crates have HIR for every DefId).
//
//   bun run.ts <rustc arguments...>
import type { Compiler } from "../../rustc_interface/interface.ts";
import { def } from "../../rustc_hir/lib.ts";
type DefKind = def.DefKind;
const debug_DefKind = (k: DefKind, f: typeof PLAIN): string => def.debug_DefKind(k, f);
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { debug_Generics, type Generics } from "../../rustc_middle/ty/generics.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import { with_no_trimmed_paths } from "../../rustc_middle/ty/print/pretty.ts";
import { debug_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { debug_LocalDefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { FatalErrorMarker } from "../../rustc_span/fatal_error.ts";
import { type AssocItem, AssocItem as AssocItemC } from "../../rustc_middle/ty/assoc.ts";
import { Defaultness } from "../../rustc_hir/lib.ts";
const local_id_to_def_id = LocalDefId.to_def_id;
import { debug_EarlyBinder } from "../../rustc_type_ir/binder.gen.ts";
import type { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Unported } from "../../std/panic.ts";

/** rustc_metadata encoder.rs:1251 `should_encode_generics`, as the probe copies it. */
function should_encode_generics(k: DefKind): boolean {
  switch (k.$) {
    case "Struct":
    case "Union":
    case "Enum":
    case "Variant":
    case "Trait":
    case "TyAlias":
    case "ForeignTy":
    case "TraitAlias":
    case "AssocTy":
    case "Fn":
    case "Const":
    case "Static":
    case "Ctor":
    case "AssocFn":
    case "AssocConst":
    case "AnonConst":
    case "OpaqueTy":
    case "Impl":
    case "Field":
    case "TyParam":
    case "Closure":
    case "SyntheticCoroutineBody":
      return true;
    default:
      return false;
  }
}

/** rustc_metadata encoder.rs:1288 `should_encode_type`, as the probe copies it (`AnonConst`: see the header). */
function should_encode_type(tcx: TyCtxt, def_id: LocalDefId, k: DefKind): boolean {
  switch (k.$) {
    case "Struct":
    case "Union":
    case "Enum":
    case "Variant":
    case "Ctor":
    case "Field":
    case "Fn":
    case "Const":
    case "TyAlias":
    case "ForeignTy":
    case "Impl":
    case "AssocFn":
    case "AssocConst":
    case "Closure":
    case "ConstParam":
    case "SyntheticCoroutineBody":
      return true;
    case "Static":
      return !k.nested;
    case "TyParam": {
      const node = tcx.hir_node_by_def_id(def_id);
      return node.$ === "GenericParam" && node._0.kind.$ === "Type" && node._0.kind.default !== undefined;
    }
    case "OpaqueTy": {
      const origin = tcx.local_opaque_ty_origin(def_id);
      if (origin.$ === "FnReturn" || origin.$ === "AsyncFn") {
        const node = tcx.hir_node_by_def_id(origin.parent);
        if (node.$ === "TraitItem" && node._0.expect_fn()[1].$ === "Required") return false;
      }
      return true;
    }
    case "AssocTy": {
      const assoc_item = tcx.associated_item(local_id_to_def_id(def_id)) as AssocItem;
      switch (assoc_item.container.$) {
        case "InherentImpl":
        case "TraitImpl":
          return true;
        case "Trait":
          return Defaultness.has_value(AssocItemC.defaultness(assoc_item, tcx));
      }
      return false;
    }
    default:
      return false;
  }
}

function fact(lines: string[], name: string, f: () => string): void {
  try {
    lines.push(`  ${name} ${with_no_trimmed_paths(f)}`);
  } catch (e) {
    const what = e instanceof Unported ? `UNPORTED: ${e.what}` : e instanceof FatalErrorMarker ? "FATAL" : `ERROR: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`;
    lines.push(`  ${name} STOP ${what}`);
  }
}

function report(tcx: TyCtxt): string {
  tcx.hir_crate_items(null);
  const n = tcx.definitions_untracked().num_definitions();
  const lines = [`== items (${n})`];
  for (let i = 0; i < n; i++) {
    const local_id = i as LocalDefId;
    const def_kind = tcx.def_kind(local_id);
    lines.push(with_no_trimmed_paths(() => `${debug_LocalDefId(local_id, PLAIN)} ${debug_DefKind(def_kind, PLAIN)}`));
    if (def_kind.$ === "AnonConst") {
      const node = tcx.hir_node_by_def_id(local_id);
      if (node.$ === "ConstArg" || (node.$ === "Infer" && node._0.kind === "Const")) continue;
    }
    if (should_encode_generics(def_kind)) {
      fact(lines, "generics_of", () => debug_Generics(tcx.generics_of(local_id) as Generics, PLAIN));
    }
    let encode_type: boolean;
    try {
      encode_type = should_encode_type(tcx, local_id, def_kind);
    } catch (e) {
      // The predicate itself stopped (e.g. `defaultness` of a trait's associated type): report it as the fact's stop.
      fact(lines, "type_of", () => {
        throw e;
      });
      continue;
    }
    if (encode_type) {
      fact(lines, "type_of", () => debug_EarlyBinder(tcx.type_of(local_id) as EarlyBinder<Ty>, PLAIN, debug_Ty));
    }
  }
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
