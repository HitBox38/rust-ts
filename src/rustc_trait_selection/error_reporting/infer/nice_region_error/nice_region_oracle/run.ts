// Test driver for src/rustc_trait_selection/error_reporting/infer/nice_region_error/nice_region.oracle.test.ts
// (lane errrep-nice-region; not a port).
//   bun run.ts <rustc arguments...>
//
// Every case is a no_core library with one `pub fn f(x: &.., ..) -> <impl or dyn type>` whose body returns data borrowed
// from `x` where the return type requires `'static`. Plain rustc reports that in borrowck
// (rustc_borrowck/src/diagnostics/region_errors.rs:1001 `add_static_impl_trait_suggestion`), whose `help:` children are
// all written by static_impl_trait.rs's `suggest_new_region_bound` (and `make_elided_region_spans_suggs`).
//
// Borrowck is not ported, so this driver stands in for `add_static_impl_trait_suggestion` up to that call, in
// `after_expansion`: `fr` = the region of `x`'s reference type (liberated), `outlived_fr` = `'static`, `suitable_region.scope`
// = `f`; `find_param_with_region` (util.rs, lane errrep-region) is reproduced for `x`: its type with that region replaced
// by `'static`, and the span of its HIR type. The suggestions go onto a scaffold error at `f`'s span, emitted through
// the session's emitter; the test compares the `help:` children with the oracle's (the parent diagnostic differs).
//
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
import "../../../../lib.ts";
import type { Compiler, Config } from "../../../../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../../../../rustc_middle/ty/context.ts";
import type { Region } from "../../../../../rustc_type_ir/sty/mod.ts";
import type { EarlyBinder } from "../../../../../rustc_type_ir/binder.ts";
import type { PolyFnSig } from "../../../../../rustc_type_ir/decls.ts";
import { ensure_stack } from "../../../../../rust_ts/stack.ts";

async function main(args: string[]): Promise<number> {
  ensure_stack();
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../../../rustc_driver_impl/lib.ts");
  const { EarlyBinder } = await import("../../../../../rustc_type_ir/binder.ts");
  const { Unnormalized } = await import("../../../../../rustc_type_ir/unnormalized.ts");
  const { FnSig, fold_FnSig } = await import("../../../../../rustc_type_ir/ty_kind.ts");
  const { fold_regions } = await import("../../../../../rustc_type_ir/fold.ts");
  const { fold_Ty } = await import("../../../../../rustc_middle/ty/structural_impls.ts");
  const { display_Ty } = await import("../../../../../rustc_middle/ty/print/pretty.ts");
  const { display_Region } = await import("../../../../../rustc_type_ir/ir_print.ts");
  const { display_Ident } = await import("../../../../../rustc_span/symbol.ts");
  const { LocalDefId } = await import("../../../../../rustc_span/def_id.ts");
  const { suggest_new_region_bound } = await import("../static_impl_trait.ts");

  function run(tcx: TyCtxt): void {
    for (const id of tcx.hir_free_items()) {
      const it = tcx.hir_item(id);
      if (it.kind.$ !== "Fn" || display_Ident(it.kind.ident) !== "f") continue;
      const scope = it.owner_id.def_id;
      const did = LocalDefId.to_def_id(scope);
      const fn_sig = tcx.liberate_late_bound_regions(did, Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(did) as EarlyBinder<PolyFnSig>)), fold_FnSig);
      const ty = FnSig.inputs(fn_sig)[0]!;
      const k = ty.kind();
      if (k.$ !== "Ref") throw new Error("scaffold: `x` is not a reference");
      const f: Region = k._0;
      const re_static = tcx.lifetimes.re_static;

      const fn_returns = tcx.return_type_impl_or_dyn_traits(scope);
      // find_param_with_region(tcx, scope, f, 'static) for the first parameter
      const body = tcx.hir_body_owned_by(scope);
      const param = body.params[0]!;
      const fn_decl = tcx.hir_fn_decl_by_hir_id(tcx.local_def_id_to_hir_id(scope))!;
      const param_ty_span = tcx.hir_span(fn_decl.inputs[0]!.hir_id);
      const param_ty = fold_regions(tcx, ty, (r) => (r === f ? re_static : r), fold_Ty);

      const lifetime = f.is_named(tcx) ? display_Region(f) : "'_";
      const simple_ident = param.pat.simple_ident();
      const arg = simple_ident !== undefined ? `argument \`${display_Ident(simple_ident)}\`` : "the argument";
      const captures = `captures data from ${arg}`;

      const diag = tcx.dcx().struct_span_err(tcx.def_span(did), "scaffold (borrowck's `lifetime may not live long enough`)");
      if (fn_returns.length !== 0) {
        suggest_new_region_bound(tcx, diag, fn_returns, lifetime, arg, captures, [param_ty_span, display_Ty(param_ty)], scope);
      }
      diag.emit();
    }
  }

  const callbacks = {
    config(_config: Config): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      run(tcx);
      return "Stop";
    },
  };
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args], callbacks));
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  // As src/rust_ts/main.ts: reaching unported code is exit 70 with one `rust-ts: unported: ..` line.
  const { Unported } = await import("../../../../../std/panic.ts");
  if (e instanceof Unported) {
    process.stderr.write(`rust-ts: unported: ${e.what}\n`);
    process.exitCode = 70;
  } else {
    throw e;
  }
}
