// Port of compiler/rustc_middle/src/mir/graphviz.rs (lane driver-m4, wave 25).
//
// PORT (init order): mod.rs's `pub use self::graphviz::write_mir_graphviz` is not re-exported by mir/mod.ts (this
// module imports pretty.ts, which extends visit.ts's `Visitor` at load): import it as `rustc_middle/mir/graphviz.ts`,
// as pretty.ts.
import "./mod.ts";
import { type Body, debug_VarDebugInfoContents, Local } from "./mod.ts";
import { debug_Place } from "./syntax.ts";
import { Place_from_Local } from "./statement.ts";
import { mir_fn_to_generic_graph } from "./generic_graph.ts";
import { Mutability } from "../../rustc_ast_ir/lib.ts";
import { escape_html } from "../../rustc_graphviz/lib.ts";
import { display_Symbol } from "../../rustc_span/symbol.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import { type Debug, format_debug, PLAIN } from "../../std/fmt.ts";
import type { IoResult } from "../../std/io.ts";
import { Ok, type Result } from "../../std/result.ts";
import type { Write } from "../../vendor/anstream/stream.ts";
import { GraphvizSettings } from "../../vendor/gsgdt/lib.ts";
import type { TyCtxt } from "../ty/context.ts";
import { debug_Ty } from "../ty/mod.ts";

/// Write a graphviz DOT graph of a list of MIRs.
// rustc: compiler/rustc_middle/src/mir/graphviz.rs:10 write_mir_graphviz
export function write_mir_graphviz(tcx: TyCtxt, w: Write): IoResult<void> {
  let r: IoResult<void>;
  const mirs: Body[] = [...tcx.mir_keys(null)]
    .filter((def_id: LocalDefId) => !tcx.is_trivial_const(def_id))
    .flatMap((def_id: LocalDefId) => {
      if (tcx.is_const_fn(def_id)) {
        return [tcx.optimized_mir(def_id), tcx.mir_for_ctfe(def_id)];
      } else {
        return [tcx.instance_mir({ $: "Item", _0: LocalDefId.to_def_id(def_id) })];
      }
    });

  const use_subgraphs = mirs.length > 1;
  if (use_subgraphs) {
    if ((r = w.write_fmt(["digraph __crate__ {\n"])).$ === "Err") return r;
  }

  for (const mir of mirs) {
    if ((r = write_mir_fn_graphviz(tcx, mir, use_subgraphs, w)).$ === "Err") return r;
  }

  if (use_subgraphs) {
    if ((r = w.write_fmt(["}\n"])).$ === "Err") return r;
  }

  return Ok(undefined);
}

/// Write a graphviz DOT graph of the MIR.
// rustc: compiler/rustc_middle/src/mir/graphviz.rs:44 write_mir_fn_graphviz
export function write_mir_fn_graphviz(tcx: TyCtxt, body: Body, subgraph: boolean, w: Write): IoResult<void> {
  // Global graph properties
  const font = `fontname="${tcx.sess.opts.unstable_opts.graphviz_font}"`;
  const graph_attrs: string[] = [font];
  const content_attrs: string[] = [font];

  const dark_mode = tcx.sess.opts.unstable_opts.graphviz_dark_mode;
  if (dark_mode) {
    graph_attrs.push(`bgcolor="black"`);
    graph_attrs.push(`fontcolor="white"`);
    content_attrs.push(`color="white"`);
    content_attrs.push(`fontcolor="white"`);
  }

  // Graph label
  const label = { value: "" };
  // PORT: the `write_graph_label` writer is a `String` (`fmt::Write`); it never fails, so the
  // `io::Error::other("failed to write graph label")` mapping is unreachable.
  write_graph_label(tcx, body, label);
  const g = mir_fn_to_generic_graph(tcx, body);
  const settings = new GraphvizSettings(graph_attrs.join(" "), content_attrs.join(" "), content_attrs.join(" "), label.value);
  return g.to_dot(w, settings, subgraph);
}

/// Write the graphviz DOT label for the overall graph. This is essentially a block of text that
/// will appear below the graph, showing the type of the `fn` this MIR represents and the types of
/// all the variables and temporaries.
// rustc: compiler/rustc_middle/src/mir/graphviz.rs:83 write_graph_label
function write_graph_label(tcx: TyCtxt, body: Body, w: { value: string }): Result<void, never> {
  const def_id = body.source.def_id();

  w.value += `fn ${escape_html(tcx.def_path_str(def_id))}(`;

  // fn argument types.
  body.args_iter().forEach((arg, i) => {
    if (i > 0) {
      w.value += ", ";
    }
    w.value += `${debug_Place(Place_from_Local(arg), PLAIN)}: ${escape(body.local_decls[Local.index(arg)]!.ty, debug_Ty)}`;
  });

  w.value += `) -&gt; ${escape(body.return_ty(), debug_Ty)}`;
  w.value += `<br align="left"/>`;

  for (const local of body.vars_and_temps_iter()) {
    const decl = body.local_decls[Local.index(local)]!;

    w.value += "let ";
    if (Mutability.is_mut(decl.mutability)) {
      w.value += "mut ";
    }

    w.value += `${debug_Place(Place_from_Local(local), PLAIN)}: ${escape(decl.ty, debug_Ty)};<br align="left"/>`;
  }

  for (const var_debug_info of body.var_debug_info) {
    w.value += `debug ${display_Symbol(var_debug_info.name)} =&gt; ${escape(var_debug_info.value, debug_VarDebugInfoContents)};<br align="left"/>`;
  }

  return Ok(undefined);
}

// rustc: compiler/rustc_middle/src/mir/graphviz.rs:126 escape
function escape<T>(t: T, debug_T: Debug<T>): string {
  return escape_html(format_debug(t, debug_T, PLAIN));
}
