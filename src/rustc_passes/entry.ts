// Port of compiler/rustc_passes/src/entry.rs
import { entry_point_type } from "../rustc_ast/entry.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { E0601 } from "../rustc_errors/lib.ts";
import type { ItemId } from "../rustc_hir/hir.gen.ts";
import { MainDefinition } from "../rustc_middle/middle/resolve.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import * as sigpipe_ from "../rustc_session/config/sigpipe.ts";
import { CRATE_DEF_ID, debug_DefId, type DefId, LOCAL_CRATE, LocalDefId } from "../rustc_span/def_id.ts";
import { RemapPathScopeComponents, Span } from "../rustc_span/lib.ts";
import { type Debug, debug_int, debug_struct, debug_tuple } from "../std/fmt.ts";
import { ExternMain_diagnostic, MultipleRustcMain_diagnostic, NoMainErr_diagnostic } from "./diagnostics.ts";

// PORT: stand-in for `rustc_session::config::EntryFnType` (config.rs:1617, `#[derive(Clone, Copy, PartialEq, Eq,
// Hash, Debug, Encodable, BlobDecodable)]`), which rustc_session/config.ts does not define yet (the `entry_fn`
// query value is typed `[DefId, unknown]` by the codegen typemap). Move it there when config.rs:1617 is ported.
export type EntryFnType = {
  readonly $: "Main";
  /// Specifies what to do with `SIGPIPE` before calling `fn main()`.
  ///
  /// What values that are valid and what they mean must be in sync
  /// across rustc and libstd, but we don't want it public in libstd,
  /// so we take a bit of an unusual approach with simple constants
  /// and an `include!()`.
  sigpipe: number;
};
/** `#[derive(Debug)]` of `EntryFnType`. */
export const debug_EntryFnType: Debug<EntryFnType> = (v, f) => debug_struct(f, "Main", [["sigpipe", debug_int(v.sigpipe, f)]]);
/** `#[derive(Debug)]` of the `entry_fn` value `Option<(DefId, EntryFnType)>` (the tuple part). */
export const debug_entry_fn_value: Debug<[DefId, EntryFnType]> = (v, f) => debug_tuple(f, "", [debug_DefId(v[0], f), debug_EntryFnType(v[1], f)]);

// rustc-type: compiler/rustc_passes/src/entry.rs:14 EntryContext
interface EntryContext {
  tcx: TyCtxt;

  /// The function has the `#[rustc_main]` attribute.
  rustc_main_fn: [LocalDefId, Span] | undefined;

  /// The functions that one might think are `main` but aren't, e.g.
  /// main functions not defined at the top level. For diagnostics.
  non_main_fns: Span[];
}

// rustc: compiler/rustc_passes/src/entry.rs:25 entry_fn
function entry_fn(tcx: TyCtxt, _: null): [DefId, EntryFnType] | undefined {
  const any_exe = tcx.crate_types().includes("Executable");
  if (!any_exe) {
    // No need to find a main function.
    return undefined;
  }

  // If the user wants no main function at all, then stop here.
  if (find_attr(tcx.hir_krate_attrs(), (k) => (k.$ === "NoMain" ? null : undefined)) !== undefined) {
    return undefined;
  }

  const ctxt: EntryContext = { tcx, rustc_main_fn: undefined, non_main_fns: [] };

  for (const id of tcx.hir_free_items()) {
    check_and_search_item(id, ctxt);
  }

  return configure_main(tcx, ctxt);
}

// rustc: compiler/rustc_passes/src/entry.rs:46 check_and_search_item
function check_and_search_item(id: ItemId, ctxt: EntryContext): void {
  const at_root = ctxt.tcx.opt_local_parent(id.owner_id.def_id) === CRATE_DEF_ID;

  const attrs = ctxt.tcx.hir_attrs(id.hir_id());
  const entry_point_type_ = entry_point_type(
    find_attr(attrs, (k) => (k.$ === "RustcMain" ? null : undefined)) !== undefined,
    at_root,
    ctxt.tcx.opt_item_name(id.owner_id.to_def_id()),
  );

  switch (entry_point_type_) {
    case "None":
      break;
    case "MainNamed":
      break;
    case "OtherMain":
      ctxt.non_main_fns.push(ctxt.tcx.def_span(id.owner_id));
      break;
    case "RustcMainAttr":
      if (ctxt.rustc_main_fn === undefined) {
        ctxt.rustc_main_fn = [id.owner_id.def_id, ctxt.tcx.def_span(id.owner_id)];
      } else {
        ctxt.tcx.dcx().emit_err(
          MultipleRustcMain_diagnostic({
            span: ctxt.tcx.def_span(id.owner_id.to_def_id()),
            first: ctxt.rustc_main_fn[1],
            additional: ctxt.tcx.def_span(id.owner_id.to_def_id()),
          }),
        );
      }
      break;
  }
}

// rustc: compiler/rustc_passes/src/entry.rs:76 configure_main
function configure_main(tcx: TyCtxt, visitor: EntryContext): [DefId, EntryFnType] | undefined {
  if (visitor.rustc_main_fn !== undefined) {
    const [local_def_id, _] = visitor.rustc_main_fn;
    const def_id = LocalDefId.to_def_id(local_def_id);
    return [def_id, { $: "Main", sigpipe: sigpipe(tcx) }];
  } else {
    // The actual resolution of main happens in the resolver, this here
    const main_def = tcx.resolutions(null).main_def;
    let def_id: DefId | undefined;
    if (main_def !== undefined && (def_id = MainDefinition.opt_fn_def_id(main_def)) !== undefined) {
      // non-local main imports are handled below
      const local = def_id.as_local();
      if (local !== undefined && tcx.hir_node_by_def_id(local).$ === "ForeignItem") {
        tcx.dcx().emit_err(ExternMain_diagnostic({ span: tcx.def_span(local) }));
        return undefined;
      }

      return [def_id, { $: "Main", sigpipe: sigpipe(tcx) }];
    }
    no_main_err(tcx, visitor);
    return undefined;
  }
}

// rustc: compiler/rustc_passes/src/entry.rs:100 sigpipe
function sigpipe(tcx: TyCtxt): number {
  switch (tcx.sess.opts.unstable_opts.on_broken_pipe) {
    case "Default":
      return sigpipe_.DEFAULT;
    case "Kill":
      return sigpipe_.SIG_DFL;
    case "Error":
      return sigpipe_.SIG_IGN;
    case "Inherit":
      return sigpipe_.INHERIT;
  }
}

// rustc: compiler/rustc_passes/src/entry.rs:109 no_main_err
function no_main_err(tcx: TyCtxt, visitor: EntryContext): void {
  const sp = tcx.def_span(CRATE_DEF_ID);

  // There is no main function.
  let has_filename = true;
  const src = tcx.sess.local_crate_source_file();
  let filename: string;
  if (src !== undefined) {
    filename = src.path(RemapPathScopeComponents.DIAGNOSTICS);
  } else {
    has_filename = false;
    filename = "";
  }
  const main_def_opt = tcx.resolutions(null).main_def;
  const code = E0601;
  const add_teach_note = tcx.sess.teach(code);
  // The file may be empty, which leads to the diagnostic machinery not emitting this
  // note. This is a relatively simple way to detect that case and emit a span-less
  // note instead.
  const file_empty = tcx.sess.source_map().lookup_line(Span.hi(sp)).$ === "Err";

  tcx.dcx().emit_err(
    NoMainErr_diagnostic({
      sp,
      crate_name: tcx.crate_name(LOCAL_CRATE),
      has_filename,
      filename,
      file_empty,
      non_main_fns: [...visitor.non_main_fns],
      main_def_opt,
      add_teach_note,
    }),
  );
}

// rustc: compiler/rustc_passes/src/entry.rs:142 provide
export function provide(providers: Providers): void {
  providers.entry_fn = entry_fn;
}
