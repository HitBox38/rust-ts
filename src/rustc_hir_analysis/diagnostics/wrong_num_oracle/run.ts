// Test helper of ../wrong_number_of_generic_args.oracle.test.ts (lane wrong-num-args; not a port).
//
// Runs the ported driver (real parsing, expansion, resolution, AST lowering, HIR, `def_path_str`, `def_descr`, spans,
// source map, `associated_items` and the emitter) on a `#![no_core]` test program and, in `after_expansion`, walks the
// HIR and checks the generic-argument count of the last segment of every resolved path the way HIR ty lowering does,
// emitting E0107 through the ported `WrongNumberOfGenericArgs` (diagnostics/wrong_number_of_generic_args.ts).
//
// Since merge-w16a the check is the real `check_generic_arg_count` (hir_ty_lowering/generics.rs:419) over an `ItemCtxt` of
// the segment's HIR owner, with the real `generics_of` / `trait_def` providers (the lane's stand-ins are gone). The callers:
// type position (`lower_generic_args_of_path`, `has_self` = trait ref) and value position
// (`check_generic_arg_count_for_value_path`, `GenericArgPosition::Value(IsMethodCall::No)`, `has_self` =
// `generics.has_own_self()`).
//
//   bun run.ts <rustc arguments...>
import "../../lib.ts";
import type { Compiler, Config } from "../../../rustc_interface/interface.ts";
import * as hir from "../../../rustc_hir/lib.ts";
import { Visitor } from "../../../rustc_hir/intravisit.ts";
import type { HirTyCtxt } from "../../../rustc_hir/intravisit.ts";
import { TyCtxt_as_HirTyCtxt } from "../../../rustc_middle/hir/map.ts";
import { All } from "../../../rustc_middle/hir/nested_filter.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Generics } from "../../../rustc_middle/ty/generics.ts";
import { ItemCtxt } from "../../decls.ts";
import { check_generic_arg_count } from "../../hir_ty_lowering/generics.ts";
import { GenericArgPosition } from "../../hir_ty_lowering/mod.ts";

const CHECKED_KINDS = new Set(["Struct", "Enum", "Union", "TyAlias", "Trait", "TraitAlias", "Fn", "AssocFn", "ForeignTy"]);

class Checker extends Visitor {
  override NestedFilter = All;
  constructor(public tcx: TyCtxt) {
    super();
  }
  override maybe_tcx(): HirTyCtxt {
    return TyCtxt_as_HirTyCtxt(this.tcx);
  }
  override visit_item(i: hir.Item): undefined {
    if (i.kind.$ === "Use") return undefined;
    return super.visit_item(i) as undefined;
  }
  override visit_path(path: hir.Path, id: hir.HirId): undefined {
    const res = path.res;
    const seg = path.segments[path.segments.length - 1];
    if (seg !== undefined && res.$ === "Def" && CHECKED_KINDS.has(res._0.$) && res._1.as_local() !== undefined) {
      const tcx = this.tcx;
      const node = tcx.hir_node(id);
      const generics = tcx.generics_of(res._1) as Generics;
      const cx = ItemCtxt.new(tcx, tcx.hir_get_parent_item(seg.hir_id).def_id).lowerer();
      if (node.$ === "Expr") check_generic_arg_count(cx, res._1, seg, generics, { $: "Value", _0: "No" }, generics.has_own_self());
      else check_generic_arg_count(cx, res._1, seg, generics, GenericArgPosition.Type, node.$ === "TraitRef");
    }
    return super.visit_path(path, id) as undefined;
  }
}

const config = (c: Config): void => {
  // As rustc_driver_impl `TimePassesCallbacks::config` (the callbacks of the real `rustc`).
  c.opts.trimmed_def_paths = true;
};

async function main(args: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../rustc_driver_impl/lib.ts");
  const callbacks = {
    config,
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      tcx.hir_walk_toplevel_module(new Checker(tcx));
      return "Stop" as const;
    },
  };
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args], callbacks));
}

process.exitCode = await main(process.argv.slice(2));
