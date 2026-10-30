// Test helper of src/rustc_ty_utils/representability.test.ts (lane ty-utils).
//
// Runs the ported driver (real parsing, expansion, resolution and AST lowering) with the real rustc_ty_utils
// `check_representability` / `check_representability_adt_ty` / `params_in_repr` providers and `override_queries`
// stand-ins for the rustc_hir_analysis queries they read, then asks for `check_well_formed` of every free item as
// `check_type_wf` does (`par_items` order). The cycle detection, the cycle diagnostics (`create_cycle_error`, the
// `check_representability` handler, `recursive_type_error`), the query descriptions and the emitter are the real ones.
//
// PORT (test): the stand-ins only cover the shapes of the test programs (no generics):
// - `check_well_formed(def_id)` (wfcheck.rs `check_type_defn`): an ADT asks `ensure_ok().check_representability`.
// - `adt_def(def_id)` (collect.rs `adt_def`): one `VariantDef` per HIR variant (struct/union: one), fields in order.
// - `type_of(def_id)` of a field or a type alias: the HIR type lowered for paths to local ADTs (`Ty::new_adt`, identity
//   args), type aliases (`tcx.at(span).type_of(alias)`, as `lower_path` does), `u8`, tuples and arrays (length from
//   the literal, a `usize` value const).
// - `generics_of(def_id)`: no parameters.
//
//   bun run.ts <rustc arguments...>
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { Ty as HirTy, VariantData } from "../../rustc_hir/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { ReprOptions, AdtDef } from "../../rustc_middle/ty/decls.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";

const fail = (what: string): never => {
  throw new Error(`ERROR: representability_test stand-in: ${what}`);
};

const fields_of = (data: VariantData): readonly import("../../rustc_hir/lib.ts").FieldDef[] => {
  switch (data.$) {
    case "Struct":
      return data.fields;
    case "Tuple":
      return data._0;
    default:
      return [];
  }
};

async function main(args: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const mod = await import("../../rustc_middle/ty/mod.ts");
  const { FxHashMap_DefId_u32, Generics } = await import("../../rustc_middle/ty/generics.ts");
  const { RawList } = await import("../../rustc_middle/ty/list.ts");
  const { LocalDefId: LocalDefIdC } = await import("../../rustc_span/def_id.ts");
  const { Ty: TyC, FieldDef, VariantDef, Visibility, RestrictionKind } = mod;

  /** HIR ty lowering of the field types the test programs use. */
  const lower = (tcx: TyCtxt, ty: HirTy): Ty => {
    const kind = ty.kind;
    switch (kind.$) {
      case "Path": {
        if (kind._0.$ !== "Resolved") return fail("unresolved path");
        const res = kind._0._1.res;
        if (res.$ === "PrimTy" && res._0.$ === "Uint" && res._0._0 === "U8") return tcx.types.u8;
        if (res.$ === "Def" && (res._0.$ === "Struct" || res._0.$ === "Enum" || res._0.$ === "Union")) {
          return TyC.new_adt(tcx, tcx.adt_def(res._1) as AdtDef, RawList.empty());
        }
        if (res.$ === "Def" && res._0.$ === "TyAlias") {
          const { EarlyBinder } = require("../../rustc_type_ir/binder.ts") as typeof import("../../rustc_type_ir/binder.ts");
          return EarlyBinder.skip_binder(tcx.at(kind._0._1.span).type_of(res._1) as import("../../rustc_type_ir/binder.ts").EarlyBinder<Ty>);
        }
        return fail(`path ${res.$}`);
      }
      case "Tup":
        return TyC.new_tup(
          tcx,
          kind._0.map((t) => lower(tcx, t)),
        );
      case "Array": {
        const len = kind._1;
        // `[T; N]` with a literal `N`: the HIR `ConstArg` of an anon const whose body is the literal.
        let n: number | undefined;
        if (len.kind.$ === "Anon") {
          const body = tcx.hir_body(len.kind._0.body);
          if (body.value.kind.$ === "Lit" && body.value.kind._0.node.$ === "Int") n = Number(body.value.kind._0.node._0);
        }
        if (n === undefined) return fail("array length");
        // `Ty::new_array` goes through `Const::from_target_usize` (layouts, M4); lowering the anon const builds the
        // same `usize` value directly.
        const { Const } = require("../../rustc_type_ir/sty/consts.ts") as typeof import("../../rustc_type_ir/sty/consts.ts");
        const { ValTree } = require("../../rustc_middle/ty/consts/valtree.ts") as typeof import("../../rustc_middle/ty/consts/valtree.ts");
        const { ScalarInt } = require("../../rustc_middle/ty/consts/int.ts") as typeof import("../../rustc_middle/ty/consts/int.ts");
        const { Size } = require("../../rustc_abi/lib.ts") as typeof import("../../rustc_abi/lib.ts");
        // PORT (test): `GlobalCtxt::data_layout` is not ported; the tests run with `--target x86_64-unknown-linux-gnu`
        // (pointer size 8).
        const ct = Const.new_value(tcx, ValTree.from_scalar_int(tcx, ScalarInt.try_from_uint(BigInt(n), Size.from_bytes(8))!), tcx.types.usize);
        return TyC.new_array_with_const_len(tcx, lower(tcx, kind._0), ct);
      }
      default:
        return fail(`hir ty ${kind.$}`);
    }
  };

  const config = (c: Config): void => {
    c.override_queries = (_sess, providers) => {
      const p = providers.queries;
      p.check_well_formed = (tcx, def_id: LocalDefId) => {
        switch (tcx.def_kind(def_id).$) {
          case "Struct":
          case "Enum":
          case "Union":
            tcx.ensure_ok().check_representability(def_id);
            break;
        }
        return { $: "Ok", _0: null };
      };
      p.adt_def = (tcx, def_id: LocalDefId) => {
        const kind = tcx.hir_expect_item(def_id).kind;
        const parent_did = LocalDefIdC.to_def_id(def_id);
        const variant = (name: import("../../rustc_span/symbol.ts").Symbol, variant_did: LocalDefId | undefined, data: VariantData, i: number) => {
          const fields = fields_of(data).map(
            (f) => new FieldDef(LocalDefIdC.to_def_id(f.def_id), f.ident.name, Visibility.Public, RestrictionKind.Unrestricted, "Safe", undefined),
          );
          return VariantDef.new(
            name,
            variant_did === undefined ? undefined : LocalDefIdC.to_def_id(variant_did),
            data.$ === "Tuple" ? ["Fn", LocalDefIdC.to_def_id(data._2)] : data.$ === "Unit" ? ["Const", LocalDefIdC.to_def_id(data._1)] : undefined,
            { $: "Relative", _0: i },
            fields,
            parent_did,
            undefined,
            false,
          );
        };
        switch (kind.$) {
          case "Struct":
            return tcx.mk_adt_def(parent_did, "Struct", [variant(kind._0.name, undefined, kind._2, 0)], {} as ReprOptions);
          case "Union":
            return tcx.mk_adt_def(parent_did, "Union", [variant(kind._0.name, undefined, kind._2, 0)], {} as ReprOptions);
          case "Enum":
            return tcx.mk_adt_def(
              parent_did,
              "Enum",
              kind._2.variants.map((v, i) => variant(v.ident.name, v.def_id, v.data, i)),
              {} as ReprOptions,
            );
          default:
            return fail(`adt_def of ${kind.$}`);
        }
      };
      p.type_of = (tcx, def_id: LocalDefId) => {
        const { EarlyBinder } = require("../../rustc_type_ir/binder.ts") as typeof import("../../rustc_type_ir/binder.ts");
        const { fold_Ty } = require("../../rustc_middle/ty/structural_impls.ts") as typeof import("../../rustc_middle/ty/structural_impls.ts");
        const node = tcx.hir_node_by_def_id(def_id);
        if (node.$ === "Field") return EarlyBinder.bind(tcx, lower(tcx, node._0.ty), fold_Ty);
        if (node.$ === "Item" && node._0.kind.$ === "TyAlias") return EarlyBinder.bind(tcx, lower(tcx, node._0.kind._2), fold_Ty);
        return fail(`type_of(${node.$})`);
      };
      p.generics_of = (_tcx, _def_id: LocalDefId) => new Generics(undefined, 0, [], FxHashMap_DefId_u32.with_capacity(0), false, undefined);
    };
  };

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
