// Test helper of ../wrong_number_of_generic_args.oracle.test.ts (lane wrong-num-args; not a port).
//
// Runs the ported driver (real parsing, expansion, resolution, AST lowering, HIR, `def_path_str`, `def_descr`, spans,
// source map, `associated_items` and the emitter) on a `#![no_core]` test program and, in `after_expansion`, walks the
// HIR and checks the generic-argument count of the last segment of every resolved path the way HIR ty lowering does,
// emitting E0107 through the ported `WrongNumberOfGenericArgs` (diagnostics/wrong_number_of_generic_args.ts).
//
// Stand-ins (PORT(test); upstream callers / providers are other lanes' and not merged into this branch):
// - `check_generic_arg_count` (hir_ty_lowering/generics.rs:419, lane hir-ty-lowering-c): `stand_in_check_generic_arg_count`
//   below is its counting logic and E0107 tail, line for line, minus `prohibit_assoc_item_constraint` and
//   `prohibit_explicit_late_bound_lifetimes` (the test programs pass no constraint in value position and no explicit
//   late-bound lifetime) and minus the `has_assoc_ty_with_same_name` probe (it stops with ERROR if reached).
//   `cx.item_def_id()` is the HIR owner of the segment.
// - `generics_of` (collect/generics_of.rs, lane collect-a): built from the HIR generics as upstream orders them
//   (`Self` for traits, then early-bound lifetimes, then types / consts in source order). Lifetimes of fns are treated
//   as late-bound (the programs use no early-bound fn lifetimes).
// - `trait_def` (collect.rs, lane collect-a): only `paren_sugar` is read; no program uses `#[rustc_paren_sugar]`.
// The callers: type position (`lower_generic_args_of_path`, `has_self` = trait ref) and value position
// (`check_generic_arg_count_for_value_path`, `has_self` = `generics.has_own_self()`).
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
import { type GenericParamDef, Generics } from "../../../rustc_middle/ty/generics.ts";
import { type DefId, LocalDefId } from "../../../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../../../rustc_span/lib.ts";
import { kw, type Symbol } from "../../../rustc_span/symbol.ts";
import { type GenericArgsInfo, WrongNumberOfGenericArgs } from "../wrong_number_of_generic_args.ts";

const fail = (what: string): never => {
  throw new Error(`ERROR: wrong_num_oracle stand-in: ${what}`);
};

/** Stand-in `generics_of` (see the header). */
function generics_of(tcx: TyCtxt, def_id: LocalDefId): Generics {
  const kind = tcx.def_kind(def_id).$;
  let parent: DefId | undefined = undefined;
  let parent_count = 0;
  let has_self = false;
  if (kind === "AssocFn" || kind === "AssocTy" || kind === "AssocConst") {
    parent = LocalDefId.to_def_id(tcx.local_parent(def_id));
    const pg = tcx.generics_of(parent) as Generics;
    parent_count = pg.count();
    has_self = pg.has_self;
  }
  const own_params: GenericParamDef[] = [];
  const push = (name: Symbol, def_id: DefId, kind: GenericParamDef["kind"]): void => {
    own_params.push({ name, def_id, index: parent_count + own_params.length, pure_wrt_drop: false, kind });
  };
  if (kind === "Trait" || kind === "TraitAlias") {
    has_self = true;
    push(kw.SelfUpper, LocalDefId.to_def_id(def_id), { $: "Type", has_default: false, synthetic: false });
  }
  const g = hir.Node.generics(tcx.hir_node_by_def_id(def_id));
  const params = g?.params ?? [];
  const name_of = (p: hir.GenericParam): Symbol => (p.name.$ === "Plain" ? p.name._0.name : fail("param name"));
  const is_fn = kind === "Fn" || kind === "AssocFn";
  for (const p of params) {
    if (p.kind.$ === "Lifetime" && !is_fn) push(name_of(p), LocalDefId.to_def_id(p.def_id), { $: "Lifetime" });
  }
  for (const p of params) {
    if (p.kind.$ === "Type") push(name_of(p), LocalDefId.to_def_id(p.def_id), { $: "Type", has_default: p.kind.default !== undefined, synthetic: p.kind.synthetic });
    else if (p.kind.$ === "Const") push(name_of(p), LocalDefId.to_def_id(p.def_id), { $: "Const", has_default: p.kind.default !== undefined });
  }
  return Generics.from_decoded(parent, parent_count, own_params, new Map(own_params.map((p) => [p.def_id, p.index])), has_self, undefined);
}

type GenericArgPosition = "Type" | "Value";

/** Stand-in `check_generic_arg_count` (generics.rs:419; see the header). Returns whether the count was correct. */
function stand_in_check_generic_arg_count(tcx: TyCtxt, def_id: DefId, seg: hir.PathSegment, gen_params: Generics, gen_pos: GenericArgPosition, has_self: boolean): boolean {
  const gen_args = seg.args_();
  const default_counts = gen_params.own_defaults();
  const param_counts = gen_params.own_counts();
  const has_invalid_bound =
    seg.args !== undefined &&
    seg.args.constraints.some((c) => c.kind.$ === "Bound" && c.kind.bounds.length === 1 && c.kind.bounds[0]!.$ === "Trait" && c.kind.bounds[0]!._0.trait_ref.path.res.$ === "Err");
  const synth_type_param_count = gen_params.own_params.filter((param) => param.kind.$ === "Type" && param.kind.synthetic).length;
  const named_type_param_count = param_counts.types - (has_self ? 1 : 0) - synth_type_param_count;
  const named_const_param_count = param_counts.consts;
  const infer_lifetimes = (gen_pos !== "Type" || seg.infer_args) && !gen_args.has_lifetime_args();
  const item_def_id = tcx.hir_get_parent_item(seg.hir_id).def_id;

  const check_lifetime_args = (min_expected_args: number, max_expected_args: number, provided_args: number): ErrorGuaranteed | undefined => {
    if (min_expected_args <= provided_args && provided_args <= max_expected_args) return undefined;
    const gen_args_info: GenericArgsInfo =
      provided_args > min_expected_args
        ? { $: "ExcessLifetimes", num_redundant_args: provided_args - min_expected_args }
        : { $: "MissingLifetimes", num_missing_args: min_expected_args - provided_args };
    return tcx.dcx().emit_err(WrongNumberOfGenericArgs.new(tcx, gen_args_info, seg, gen_params, has_self ? 1 : 0, gen_args, def_id, item_def_id));
  };
  const lifetimes_err = check_lifetime_args(infer_lifetimes ? 0 : param_counts.lifetimes, param_counts.lifetimes, gen_args.num_lifetime_args());

  const check_types_and_consts = (
    expected_min: number,
    expected_max: number,
    expected_max_with_synth: number,
    provided: number,
    params_offset: number,
    args_offset: number,
  ): ErrorGuaranteed | undefined => {
    if (expected_min <= provided && provided <= expected_max) return undefined;
    const num_default_params = expected_max - expected_min;
    let gen_args_info: GenericArgsInfo;
    if (provided > expected_max) {
      gen_args_info = {
        $: "ExcessTypesOrConsts",
        num_redundant_args: provided - expected_max,
        num_default_params,
        args_offset,
        synth_provided: provided <= expected_max_with_synth,
      };
    } else {
      const first = tcx.hir_parent_owner_iter(seg.hir_id).next();
      const parent_is_impl_block = first !== undefined && hir.OwnerNode.is_impl_block(first[1]);
      if (parent_is_impl_block) {
        const names = gen_args.constraints.map((b) => b.ident.name);
        const params = gen_params.own_params.filter((p) => !has_self || p.index !== 0).map((p) => p.name);
        if (names.length === params.length && names.every((n, i) => n === params[i])) fail("all_params_are_binded path");
      }
      gen_args_info = { $: "MissingTypesOrConsts", num_missing_args: expected_max - provided, num_default_params, args_offset };
    }
    return (
      gen_args.has_err() ??
      tcx.dcx().create_err(WrongNumberOfGenericArgs.new(tcx, gen_args_info, seg, gen_params, params_offset, gen_args, def_id, item_def_id)).emit_err_unless_delay(has_invalid_bound)
    );
  };
  const expected_min = seg.infer_args ? 0 : param_counts.consts + named_type_param_count - default_counts.types - default_counts.consts;
  const args_err = check_types_and_consts(
    expected_min,
    named_const_param_count + named_type_param_count,
    named_const_param_count + named_type_param_count + synth_type_param_count,
    gen_args.num_generic_params(),
    param_counts.lifetimes + (has_self ? 1 : 0),
    gen_args.num_lifetime_args(),
  );
  return lifetimes_err === undefined && args_err === undefined;
}

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
      if (node.$ === "Expr") stand_in_check_generic_arg_count(tcx, res._1, seg, generics, "Value", generics.has_own_self());
      else stand_in_check_generic_arg_count(tcx, res._1, seg, generics, "Type", node.$ === "TraitRef");
    }
    return super.visit_path(path, id) as undefined;
  }
}

const config = (c: Config): void => {
  // As rustc_driver_impl `TimePassesCallbacks::config` (the callbacks of the real `rustc`).
  c.opts.trimmed_def_paths = true;
  c.override_queries = (_sess, providers) => {
    const p = providers.queries;
    p.generics_of = (tcx: TyCtxt, def_id: LocalDefId) => generics_of(tcx, def_id);
    p.trait_def = () => ({ paren_sugar: false });
  };
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
