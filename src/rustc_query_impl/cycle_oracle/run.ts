// Test helper of src/rustc_query_impl/cycle.oracle.test.ts (lane query-growth).
//
// Runs the ported driver (real parsing, expansion, resolution and AST lowering) with `override_queries` installing
// providers that play the parts of rustc_hir_analysis and rustc_ty_utils for the queries a cycle goes through, then
// asks for `check_well_formed` of every free item, as `check_type_wf` does (`par_items` order). The cycle detection,
// the cycle diagnostics (`create_cycle_error`, the `Cycle` diagnostic, the `check_representability` handler and
// `recursive_type_error`), the query descriptions, `def_path_str`, the HIR accessors and the emitter are the real ones.
//
// The stand-in providers make the same nested query calls, with the same spans, as the upstream providers do on the
// test programs:
// - `check_well_formed(def_id)` (wfcheck.rs): a type alias asks for `type_of`, a trait alias for
//   `explicit_implied_clauses_of`, an ADT for `check_representability` (`check_type_defn`).
// - `type_of(alias)` (collect/type_of.rs): HIR ty lowering of the aliased path asks `tcx.at(path span).type_of(def)`.
// - `explicit_implied_clauses_of(trait alias)` (collect/predicates_of.rs): lowering each bound asks
//   `tcx.at(bound path span).explicit_implied_clauses_of(def)`.
// - `check_representability` (rustc_ty_utils representability.rs): an ADT checks each field; a field walks its type
//   as `check_representability_ty` (arrays, tuples) and, for a local ADT, goes on to that ADT's
//   `check_representability`. PORT (test): upstream goes through `check_representability_adt_ty(Ty)`, whose key type
//   has no `QueryKey` impl yet; that frame does not change the report for ADTs without generic parameters
//   (`representable_ids` only matters for `params_in_repr`).
//
//   bun run.ts <rustc arguments...>
import type { Config } from "../../rustc_interface/interface.ts";
import type { Compiler } from "../../rustc_interface/interface.ts";
import type { FieldDef, Ty as HirTy, VariantData } from "../../rustc_hir/lib.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";

const fail = (what: string): never => {
  throw new Error(`ERROR: cycle_oracle stand-in: ${what}`);
};

const fields_of = (data: VariantData): readonly FieldDef[] => {
  switch (data.$) {
    case "Struct":
      return data.fields;
    case "Tuple":
      return data._0;
    default:
      return [];
  }
};

/** `check_representability_ty` over the HIR type of a field. */
function check_representability_hir_ty(tcx: TyCtxt, ty: HirTy): void {
  const kind = ty.kind;
  switch (kind.$) {
    case "Path":
      if (kind._0.$ === "Resolved") {
        const res = kind._0._1.res;
        if (res.$ === "Def" && (res._0.$ === "Struct" || res._0.$ === "Enum" || res._0.$ === "Union")) {
          const local = res._1.as_local();
          if (local !== undefined) tcx.ensure_ok().check_representability(local);
        } else if (res.$ === "Def" && res._0.$ === "TyAlias") {
          // `type_of(field)` normalizes the (local) alias to its aliased type.
          const alias = tcx.hir_expect_item(res._1.expect_local()).kind;
          if (alias.$ !== "TyAlias") return fail("alias item");
          check_representability_hir_ty(tcx, alias._2);
        }
      }
      break;
    case "Array":
      check_representability_hir_ty(tcx, kind._0);
      break;
    case "Tup":
      for (const t of kind._0) check_representability_hir_ty(tcx, t);
      break;
  }
}

const config = (c: Config): void => {
  c.override_queries = (_sess, providers) => {
    const p = providers.queries;
    p.check_well_formed = (tcx, def_id: LocalDefId) => {
      switch (tcx.def_kind(def_id).$) {
        case "TyAlias":
          tcx.type_of(def_id);
          break;
        case "TraitAlias":
          tcx.explicit_implied_clauses_of(def_id);
          break;
        case "Struct":
        case "Enum":
        case "Union":
          tcx.ensure_ok().check_representability(def_id);
          break;
      }
      return { $: "Ok", _0: null };
    };
    p.type_of = (tcx, def_id: LocalDefId) => {
      const kind = tcx.hir_expect_item(def_id).kind;
      if (kind.$ === "TyAlias" && kind._2.kind.$ === "Path" && kind._2.kind._0.$ === "Resolved") {
        const res = kind._2.kind._0._1.res;
        if (res.$ === "Def") return tcx.at(kind._2.span).type_of(res._1);
      }
      return fail(`type_of(${def_id})`);
    };
    p.explicit_implied_clauses_of = (tcx, def_id: LocalDefId) => {
      const kind = tcx.hir_expect_item(def_id).kind;
      if (kind.$ === "TraitAlias") {
        for (const bound of kind._3) {
          if (bound.$ !== "Trait") continue;
          const path = bound._0.trait_ref.path;
          if (path.res.$ === "Def") tcx.at(path.span).explicit_implied_clauses_of(path.res._1);
        }
      }
      return fail(`explicit_implied_clauses_of(${def_id})`);
    };
    p.check_representability = (tcx, def_id: LocalDefId) => {
      const def_kind = tcx.def_kind(def_id);
      switch (def_kind.$) {
        case "Struct":
        case "Union": {
          const kind = tcx.hir_expect_item(def_id).kind;
          if (kind.$ !== "Struct" && kind.$ !== "Union") return fail("adt item");
          for (const field of fields_of(kind._2)) tcx.ensure_ok().check_representability(field.def_id);
          break;
        }
        case "Enum": {
          const kind = tcx.hir_expect_item(def_id).kind;
          if (kind.$ !== "Enum") return fail("enum item");
          for (const variant of kind._2.variants) for (const field of fields_of(variant.data)) tcx.ensure_ok().check_representability(field.def_id);
          break;
        }
        case "Field": {
          const node = tcx.hir_node_by_def_id(def_id);
          if (node.$ !== "Field") return fail("field node");
          check_representability_hir_ty(tcx, node._0.ty);
          break;
        }
        default:
          return fail(`check_representability of a ${def_kind.$}`);
      }
      return null;
    };
  };
};

async function main(args: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const callbacks = {
    config,
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      // `check_type_wf`: `tcx.hir_crate_items(()).par_items(|item| tcx.ensure_ok().check_well_formed(item.owner_id.def_id))`
      for (const item of tcx.hir_free_items()) tcx.ensure_ok().check_well_formed(item.owner_id.def_id);
      return "Stop" as const;
    },
  };
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args], callbacks));
}

process.exitCode = await main(process.argv.slice(2));
