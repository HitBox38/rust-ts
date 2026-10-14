// Test helper of src/rustc_hir_analysis/collect/collect_b.test.ts (lane collect-b): runs the ported driver on a case of
// this directory up to expansion + name resolution (`after_expansion` -> `Stop`, as rustc_middle hir_tree_oracle/run.ts),
// then
// - `dump <fn>,<fn>..`: calls the listed collect/dump.rs fns in `check_crate`'s order (lib.rs:217-222). Their diagnostics
//   go to stderr as rustc's do, so on a crate that is otherwise clean, stderr equals the oracle rustc's;
// - `queries`: for every `hir_crate_items(()).definitions()` DefId prints `<def_id:?> <DefKind:?>` and, per query of
//   this lane, a line `  <query> <value:?>` or `  <query> UNPORTED <what>` (the stop of an unported path): `clauses_of`
//   for every DefId the tydump probe dumps it for (not the crate root, not lifetime params), `explicit_item_bounds` / `item_bounds` for `AssocTy`, `OpaqueTy` and `TyAlias`.
//
//   bun src/rustc_hir_analysis/collect/collect_b_oracle/run.ts dump def_parents <rustc arguments...>
//   bun src/rustc_hir_analysis/collect/collect_b_oracle/run.ts queries <rustc arguments...>
import { debug_DefKind } from "../../../rustc_hir/def.ts";
import type { Compiler, Config } from "../../../rustc_interface/interface.ts";
import type { ModuleItems } from "../../../rustc_middle/hir/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { debug_GenericClauses, type GenericClauses } from "../../../rustc_middle/ty/generics.ts";
import { type Clauses, debug_RawList } from "../../../rustc_middle/ty/list.ts";
import type { Clause } from "../../../rustc_middle/ty/predicate.ts";
import { debug_Clause } from "../../../rustc_middle/ty/structural_impls.ts";
import { debug_LocalDefId, LocalDefId } from "../../../rustc_span/def_id.ts";
import { debug_Span, type Span } from "../../../rustc_span/lib.ts";
import type { EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { debug_EarlyBinder } from "../../../rustc_type_ir/binder.gen.ts";
import { debug_tuple, debug_vec, PLAIN } from "../../../std/fmt.ts";
import { Unported } from "../../../std/panic.ts";

const config = (config: Config): void => {
  config.opts.trimmed_def_paths = true;
};

/** `f()`'s Debug text, or `UNPORTED <what>` when it reaches an unported path. */
function attempt(f: () => string): string {
  try {
    return f();
  } catch (e) {
    if (e instanceof Unported) return `UNPORTED ${e.what}`;
    throw e;
  }
}

function queries(tcx: TyCtxt): string {
  let out = "";
  for (const def_id of (tcx.hir_crate_items(null) as ModuleItems).definitions()) {
    const kind = tcx.def_kind(def_id);
    out += `${debug_LocalDefId(def_id, PLAIN)} ${debug_DefKind(kind, PLAIN)}\n`;
    const did = LocalDefId.to_def_id(def_id);
    // As the tydump probe: no `clauses_of` for the crate root and lifetime params (it ICEs on a node without generics).
    if (kind.$ !== "Mod" && kind.$ !== "LifetimeParam") {
      out += `  clauses_of ${attempt(() => debug_GenericClauses(tcx.clauses_of(did) as GenericClauses, PLAIN))}\n`;
    }
    if (kind.$ === "AssocTy" || kind.$ === "OpaqueTy" || kind.$ === "TyAlias") {
      const ib = attempt(() =>
        debug_EarlyBinder(tcx.explicit_item_bounds(did) as EarlyBinder<readonly [Clause, Span][]>, PLAIN, (v, f) =>
          debug_vec(v, f, (x, f) => debug_tuple(f, "", [debug_Clause(x[0], f), debug_Span(x[1], f)])),
        ),
      );
      out += `  explicit_item_bounds ${ib}\n`;
      // A query that stopped is poisoned (a later read raises `FatalError`, as upstream's): skip its dependant.
      if (ib.startsWith("UNPORTED ")) continue;
      out += `  item_bounds ${attempt(() => debug_EarlyBinder(tcx.item_bounds(did) as EarlyBinder<Clauses>, PLAIN, (v, f) => debug_RawList(v, f, debug_Clause)))}\n`;
    }
  }
  return out;
}

async function main(args: string[]): Promise<number> {
  const mode = args[0];
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../rustc_driver_impl/lib.ts");
  const { std_print } = await import("../../../rustc_session/config.ts");
  const dump = await import("../dump.ts");
  if (mode === "dump") {
    const fns = new Set(args[1]!.split(","));
    const callbacks = {
      config,
      after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
        // lib.rs:217-222, in this order.
        if (fns.has("clauses_and_item_bounds")) dump.clauses_and_item_bounds(tcx);
        if (fns.has("def_parents")) dump.def_parents(tcx);
        if (fns.has("generics")) dump.generics(tcx);
        if (fns.has("object_lifetime_defaults")) dump.object_lifetime_defaults(tcx);
        if (fns.has("opaque_hidden_types")) dump.opaque_hidden_types(tcx);
        if (fns.has("vtables")) dump.vtables(tcx);
        return "Stop" as const;
      },
    };
    return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args.slice(2)], callbacks));
  }
  if (mode === "queries") {
    const callbacks = {
      config,
      after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
        std_print(queries(tcx));
        return "Stop" as const;
      },
    };
    return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args.slice(1)], callbacks));
  }
  console.error(`ERROR: unknown mode ${mode}`);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
