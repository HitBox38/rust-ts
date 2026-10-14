// Test helper of src/rustc_hir_analysis/variance_outlives.test.ts (lane variance-outlives).
//
// Runs the ported driver up to expansion (`after_expansion` -> `Stop`, as collect_test/run.ts), then
// - `dump <rustc arguments...>`: calls `outlives::dump::inferred_outlives` and `variance::dump::variances` in
//   `check_crate`'s order (lib.rs:220-221). Their diagnostics go to stderr as rustc's do, so on a crate that is otherwise
//   clean, stderr equals the oracle rustc's;
// - `facts <rustc arguments...>`: for every local DefId in DefIndex order prints the tydump probe's header
//   `<LocalDefId:?> <DefKind:?>`, then `  variances_of <[Variance]:?>` if `should_encode_variances` and
//   `  clauses_of <GenericClauses:?>` if `should_encode_generics` (tools/probes/tydump/main.rs `dump`), formatted under
//   `with_no_trimmed_paths!`. A fact whose computation stops prints `  <fact> STOP <what>`. Structs, enums, unions and
//   type aliases also get `  inferred_outlives_of <[(Clause, Span)]:?>`, which the probe has no line for: its
//   `clauses_of` list ends with these clauses (collect/clauses_of.rs appends them), and the test checks that.
//   Differences from the probe (documented, not ports): the prefix is not run (facts are computed on demand), and
//   the `generics_of` / `type_of` / `fn_sig` / ... facts are not printed.
//
//   bun run.ts dump|facts <rustc arguments...>
import { def } from "../../rustc_hir/lib.ts";
import type { Compiler } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { debug_GenericClauses, type GenericClauses } from "../../rustc_middle/ty/generics.ts";
import { with_no_trimmed_paths } from "../../rustc_middle/ty/print/pretty.ts";
import { debug_LocalDefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { FatalErrorMarker } from "../../rustc_span/fatal_error.ts";
import { debug_Variance, type Variance } from "../../rustc_type_ir/lib.ts";
import { debug_tuple, debug_vec, PLAIN } from "../../std/fmt.ts";
import type { Clause } from "../../rustc_middle/ty/predicate.ts";
import { debug_Clause } from "../../rustc_middle/ty/structural_impls.ts";
import { debug_Span, type Span } from "../../rustc_span/lib.ts";
import { Unported } from "../../std/panic.ts";

type DefKind = def.DefKind;

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

/** rustc_metadata encoder.rs:1213 `should_encode_variances`, as the probe copies it. */
function should_encode_variances(tcx: TyCtxt, def_id: LocalDefId, k: DefKind): boolean {
  switch (k.$) {
    case "Struct":
    case "Union":
    case "Enum":
    case "OpaqueTy":
    case "Fn":
    case "Ctor":
    case "AssocFn":
      return true;
    case "AssocTy": {
      // Only encode variances for RPITITs (for traits)
      const info = tcx.opt_rpitit_info(LocalDefId.to_def_id(def_id));
      return info !== undefined && info.$ === "Trait";
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

function facts(tcx: TyCtxt): string {
  tcx.hir_crate_items(null);
  const n = tcx.definitions_untracked().num_definitions();
  const lines = [`== items (${n})`];
  for (let i = 0; i < n; i++) {
    const local_id = i as LocalDefId;
    const def_kind = tcx.def_kind(local_id);
    lines.push(with_no_trimmed_paths(() => `${debug_LocalDefId(local_id, PLAIN)} ${def.debug_DefKind(def_kind, PLAIN)}`));
    if (def_kind.$ === "AnonConst") {
      const node = tcx.hir_node_by_def_id(local_id);
      if (node.$ === "ConstArg" || (node.$ === "Infer" && node._0.kind === "Const")) continue;
    }
    if (should_encode_generics(def_kind)) {
      fact(lines, "clauses_of", () => debug_GenericClauses(tcx.clauses_of(LocalDefId.to_def_id(local_id)) as GenericClauses, PLAIN));
    }
    if (def_kind.$ === "Struct" || def_kind.$ === "Enum" || def_kind.$ === "Union" || def_kind.$ === "TyAlias") {
      // Not a probe fact: the probe's `clauses_of` ends with these (clauses_of.rs appends `inferred_outlives_of`).
      fact(lines, "inferred_outlives_of", () =>
        debug_vec(tcx.inferred_outlives_of(local_id) as readonly [Clause, Span][], PLAIN, (x, f) => debug_tuple(f, "", [debug_Clause(x[0], f), debug_Span(x[1], f)])),
      );
    }
    if (should_encode_variances(tcx, local_id, def_kind)) {
      fact(lines, "variances_of", () => debug_vec(tcx.variances_of(local_id) as readonly Variance[], PLAIN, debug_Variance));
    }
  }
  return lines.join("\n") + "\n";
}

async function main(args: string[]): Promise<number> {
  const mode = args[0];
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { std_print } = await import("../../rustc_session/config.ts");
  const outlives_dump = await import("../outlives/dump.ts");
  const variance_dump = await import("../variance/dump.ts");
  if (mode === "dump") {
    const callbacks = {
      config(): void {},
      after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
        // lib.rs:220-221, in this order.
        outlives_dump.inferred_outlives(tcx);
        variance_dump.variances(tcx);
        return "Stop" as const;
      },
    };
    return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args.slice(1)], callbacks));
  }
  if (mode === "facts") {
    const callbacks = {
      config(): void {},
      after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
        std_print(facts(tcx));
        return "Stop" as const;
      },
    };
    return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args.slice(1)], callbacks));
  }
  console.error(`ERROR: unknown mode ${mode}`);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
