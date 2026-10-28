//! The various pretty-printing routines.
// Partial port of compiler/rustc_driver_impl/src/pretty.rs: the AST modes (`normal`, `ast-tree`, and the
// `NeedsAstMap` ones: `expanded`, `expanded,identified`, `expanded,hygiene`, `ast-tree,expanded`), `hir` and
// `hir,identified`, `hir,typed`, `hir-tree`, `mir`, `mir-cfg`, `thir-tree`, `thir-flat`, and `emit_mir`.
// `stable-mir` (rustc_public is excluded) calls `unported`.
import "../rustc_session/options.ts"; // LOAD ORDER: see rustc_session/config.ts
import type { Crate } from "../rustc_ast/ast.gen.ts";
import { debug_Crate } from "../rustc_ast/ast.gen.ts";
import { PpAnn, print_crate } from "../rustc_ast_pretty/pprust/mod.ts";
import type { AnnNode, State } from "../rustc_ast_pretty/pprust/state.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { hir } from "../rustc_middle/lib.ts";
import { debug_OwnerNodes } from "../rustc_hir/hir.ts";
import { display_HirId, type HirId } from "../rustc_hir_id/lib.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import type { BodyId as MiddleBodyId } from "../rustc_middle/ty/decls.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import * as pprust_hir from "../rustc_hir_pretty/lib.ts";
import { debug_OwnerId } from "../rustc_hir_id/lib.ts";
import { debug_hygiene_data, debug_SyntaxContext } from "../rustc_span/hygiene.ts";
import { Span } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { Input, OutFileName, type OutputFilenames, type PpMode, PpMode as PpModeC } from "../rustc_session/config.ts";
import type { Session } from "../rustc_session/session.ts";
import type { FileName } from "../rustc_span/lib.ts";
import { debug_list, debug_struct, format_debug, PLAIN, PRETTY } from "../std/fmt.ts";
import { panic, unported } from "../std/panic.ts";
import { from_utf8, type Str, type Utf8Error } from "../std/str.ts";
import { debug_IoError, io_error_from_node, type IoResult } from "../std/io.ts";
import { closeSync, openSync, writeSync } from "node:fs";
import { Err, Ok, unwrap_result } from "../std/result.ts";
import { stdout, VecU8 } from "../vendor/anstream/stream.ts";
import { write_mir_pretty } from "../rustc_middle/mir/pretty.ts";
import { write_mir_graphviz } from "../rustc_middle/mir/graphviz.ts";
import { thir_flat, thir_tree } from "../rustc_mir_build/thir/print.ts";
import * as rustc_hir_analysis from "../rustc_hir_analysis/lib.ts";
import { debug_LocalDefId } from "../rustc_span/def_id.ts";

// pub use self::PpMode::*; pub use self::PpSourceMode::*;

class AstNoAnn extends PpAnn {}

class AstIdentifiedAnn extends PpAnn {
  // rustc: compiler/rustc_driver_impl/src/pretty.rs:32 pre
  override pre(s: State, node: AnnNode): void {
    if (node.$ === "Expr") {
      s.s.popen();
    }
  }

  // rustc: compiler/rustc_driver_impl/src/pretty.rs:38 post
  override post(s: State, node: AnnNode): void {
    switch (node.$) {
      case "Crate":
      case "Ident":
      case "Name":
        break;

      case "Item": {
        const item = node._0;
        s.s.space();
        s.s.synth_comment(String(item.id));
        break;
      }
      case "SubItem": {
        const id = node._0;
        s.s.space();
        s.s.synth_comment(String(id));
        break;
      }
      case "Block": {
        const blk = node._0;
        s.s.space();
        s.s.synth_comment(`block ${blk.id}`);
        break;
      }
      case "Expr": {
        const expr = node._0;
        s.s.space();
        s.s.synth_comment(String(expr.id));
        s.s.pclose();
        break;
      }
      case "Pat": {
        const pat = node._0;
        s.s.space();
        s.s.synth_comment(`pat ${pat.id}`);
        break;
      }
    }
  }
}

class HirIdentifiedAnn extends pprust_hir.PpAnn {
  constructor(public tcx: TyCtxt) {
    super();
  }

  // rustc: compiler/rustc_driver_impl/src/pretty.rs:74 nested
  override nested(state: pprust_hir.State, nested: pprust_hir.Nested): void {
    const this_ = pprust_hir.HirTyCtxt_as_PpAnn(hir.map.TyCtxt_as_HirTyCtxt(this.tcx));
    this_.nested(state, nested);
  }

  // rustc: compiler/rustc_driver_impl/src/pretty.rs:79 pre
  override pre(s: pprust_hir.State, node: pprust_hir.AnnNode): void {
    if (node.$ === "Expr") {
      s.s.popen();
    }
  }

  // rustc: compiler/rustc_driver_impl/src/pretty.rs:85 post
  override post(s: pprust_hir.State, node: pprust_hir.AnnNode): void {
    switch (node.$) {
      case "Name":
        break;
      case "Item": {
        const item = node._0;
        s.s.space();
        s.s.synth_comment(`hir_id: ${display_HirId(item.hir_id())}`);
        break;
      }
      case "SubItem": {
        const id = node._0;
        s.s.space();
        s.s.synth_comment(display_HirId(id));
        break;
      }
      case "Block": {
        const blk = node._0;
        s.s.space();
        s.s.synth_comment(`block hir_id: ${display_HirId(blk.hir_id)}`);
        break;
      }
      case "Expr": {
        const expr = node._0;
        s.s.space();
        s.s.synth_comment(`expr hir_id: ${display_HirId(expr.hir_id)}`);
        s.s.pclose();
        break;
      }
      case "Pat": {
        const pat = node._0;
        s.s.space();
        s.s.synth_comment(`pat hir_id: ${display_HirId(pat.hir_id)}`);
        break;
      }
      case "TyPat": {
        const pat = node._0;
        s.s.space();
        s.s.synth_comment(`ty pat hir_id: ${display_HirId(pat.hir_id)}`);
        break;
      }
      case "Arm": {
        const arm = node._0;
        s.s.space();
        s.s.synth_comment(`arm hir_id: ${display_HirId(arm.hir_id)}`);
        break;
      }
    }
  }
}

class AstHygieneAnn extends PpAnn {
  constructor(public sess: Session) {
    super();
  }

  // rustc: compiler/rustc_driver_impl/src/pretty.rs:126 post
  override post(s: State, node: AnnNode): void {
    switch (node.$) {
      case "Ident": {
        const { name, span } = node._0;
        s.s.space();
        s.s.synth_comment(`${Symbol.as_u32(name)}${format_debug(Span.ctxt(span), debug_SyntaxContext, PLAIN)}`);
        break;
      }
      case "Name": {
        const name = node._0;
        s.s.space();
        s.s.synth_comment(String(Symbol.as_u32(name)));
        break;
      }
      case "Crate": {
        s.s.hardbreak();
        const verbose = this.sess.verbose_internals();
        s.s.synth_comment(debug_hygiene_data(verbose));
        s.s.hardbreak_if_not_bol();
        break;
      }
      default:
        break;
    }
  }
}

class HirTypedAnn extends pprust_hir.PpAnn {
  constructor(
    public tcx: TyCtxt,
    // PORT: `Cell<Option<&TypeckResults>>` is the field itself (PORTING §5).
    public maybe_typeck_results: TypeckResults | undefined,
  ) {
    super();
  }

  // rustc: compiler/rustc_driver_impl/src/pretty.rs:153 nested
  override nested(state: pprust_hir.State, nested: pprust_hir.Nested): void {
    const this_ = pprust_hir.HirTyCtxt_as_PpAnn(hir.map.TyCtxt_as_HirTyCtxt(this.tcx));
    const old_maybe_typeck_results = this.maybe_typeck_results;
    if (nested.$ === "Body") {
      const id = nested._0;
      // PORT: `ty::decls`'s `BodyId` is still a `Pending` placeholder for `hir::BodyId` (as rustc_privacy / rustc_lint).
      this.maybe_typeck_results = this.tcx.typeck_body(id as unknown as MiddleBodyId);
    }
    this_.nested(state, nested);
    this.maybe_typeck_results = old_maybe_typeck_results;
  }

  // rustc: compiler/rustc_driver_impl/src/pretty.rs:163 pre
  override pre(s: pprust_hir.State, node: pprust_hir.AnnNode): void {
    if (node.$ === "Expr") {
      s.s.popen();
    }
  }

  // rustc: compiler/rustc_driver_impl/src/pretty.rs:169 post
  override post(s: pprust_hir.State, node: pprust_hir.AnnNode): void {
    if (node.$ === "Expr") {
      const expr = node._0;
      let typeck_results = this.maybe_typeck_results;
      if (typeck_results === undefined) {
        const body_id = this.tcx.hir_maybe_body_owned_by(expr.hir_id.owner.def_id);
        typeck_results = body_id === undefined ? undefined : this.tcx.typeck_body(body_id.id() as unknown as MiddleBodyId);
      }

      if (typeck_results !== undefined) {
        s.s.space();
        s.s.word("as");
        s.s.space();
        s.s.word(display_Ty(typeck_results.expr_ty(expr)));
      }

      s.s.pclose();
    }
  }
}

/** `String::from_utf8(out).unwrap()` (the `Debug` of `FromUtf8Error` as rustc_errors/json.ts). */
function string_from_utf8_unwrap(bytes: Uint8Array): string {
  return unwrap_result(from_utf8(bytes), (e: Utf8Error, f) =>
    // `#[derive(Debug)] struct FromUtf8Error { bytes: Vec<u8>, error: Utf8Error }`
    debug_struct(f, "FromUtf8Error", [
      ["bytes", debug_list(f, [...bytes].map(String))],
      ["error", e.debug()],
    ]),
  );
}

// rustc: compiler/rustc_driver_impl/src/pretty.rs:189 get_source
function get_source(sess: Session): [Str, FileName] {
  const src_name = Input.file_name(sess.io.input, sess);
  const sf = sess.source_map().get_source_file(src_name);
  if (sf === undefined) panic("get_source_file");
  const src = sf.src;
  if (src === undefined) panic("src");
  return [src, src_name];
}

// rustc: compiler/rustc_driver_impl/src/pretty.rs:202 write_or_print
function write_or_print(out: string, sess: Session): void {
  OutFileName.overwrite(sess.io.output_file ?? OutFileName.Stdout, out, sess);
}

// Extra data for pretty-printing, the form of which depends on what kind of
// pretty-printing we are doing.
export type PrintExtra = { readonly $: "AfterParsing"; readonly krate: Crate } | { readonly $: "NeedsAstMap"; readonly tcx: TyCtxt };
const PrintExtra = {
  // rustc: compiler/rustc_driver_impl/src/pretty.rs:214 with_krate
  with_krate<R>(self: PrintExtra, f: (krate: Crate) => R): R {
    switch (self.$) {
      case "AfterParsing":
        return f(self.krate);
      case "NeedsAstMap":
        return f(self.tcx.resolver_for_lowering()[1].borrow());
    }
  },

  // rustc: compiler/rustc_driver_impl/src/pretty.rs:224 tcx
  tcx(self: PrintExtra): TyCtxt {
    switch (self.$) {
      case "AfterParsing":
        return panic("PrintExtra::tcx");
      case "NeedsAstMap":
        return self.tcx;
    }
  },
} as const;

// rustc: compiler/rustc_driver_impl/src/pretty.rs:232 print
export function print(sess: Session, ppm: PpMode, ex: PrintExtra): void {
  if (PpModeC.needs_analysis(ppm)) {
    PrintExtra.tcx(ex).ensure_ok().analysis(null);
  }

  const [src, src_name] = get_source(sess);

  let out: string;
  switch (ppm.$) {
    case "Source": {
      const s = ppm._0;
      // debug!("pretty printing source code {:?}", s);
      let annotation: PpAnn;
      switch (s) {
        case "Normal":
          annotation = new AstNoAnn();
          break;
        case "Expanded":
          annotation = new AstNoAnn();
          break;
        case "ExpandedIdentified":
          annotation = new AstIdentifiedAnn();
          break;
        case "ExpandedHygiene":
          annotation = new AstHygieneAnn(sess);
          break;
      }
      const psess = sess.psess;
      const is_expanded = PpModeC.needs_ast_map(ppm);
      out = PrintExtra.with_krate(ex, (krate) =>
        print_crate(sess.source_map(), krate, src_name, src, annotation, is_expanded, psess.edition, sess.psess.attr_id_generator),
      );
      break;
    }
    case "AstTree":
      // debug!("pretty printing AST tree");
      out = PrintExtra.with_krate(ex, (krate) => format_debug(krate, debug_Crate, PRETTY)); // format!("{krate:#?}")
      break;
    case "AstTreeExpanded":
      // debug!("pretty-printing expanded AST");
      out = format_debug(PrintExtra.tcx(ex).resolver_for_lowering()[1].borrow(), debug_Crate, PRETTY);
      break;
    case "Hir": {
      const s = ppm._0;
      // debug!("pretty printing HIR {:?}", s);
      const tcx = PrintExtra.tcx(ex);
      const f = (annotation: pprust_hir.PpAnn): string => {
        const sm = sess.source_map();
        const attrs = (id: HirId) => tcx.hir_attrs(id);
        return pprust_hir.print_crate(sm, tcx.hir_root_module(), src_name, src, attrs, annotation);
      };
      switch (s) {
        case "Normal":
          // `f(&(&tcx as &dyn intravisit::HirTyCtxt<'_>) as &dyn PpAnn)`
          out = f(pprust_hir.HirTyCtxt_as_PpAnn(hir.map.TyCtxt_as_HirTyCtxt(tcx)));
          break;
        case "Identified": {
          const annotation = new HirIdentifiedAnn(tcx);
          out = f(annotation);
          break;
        }
        case "Typed": {
          const annotation = new HirTypedAnn(tcx, undefined);
          out = tcx.dep_graph.with_ignore(() => f(annotation));
          break;
        }
      }
      break;
    }
    case "HirTree": {
      // debug!("pretty printing HIR tree");
      // PORT: the `hir_crate_items` query value is `unknown` in queries.gen.ts.
      const owners = (PrintExtra.tcx(ex).hir_crate_items(null) as hir.ModuleItems).owners();
      // `.map(|owner| format!("{:#?} => {:#?}\n", owner, ex.tcx().hir_owner_nodes(owner))).collect()`
      let s = "";
      for (const owner of owners) {
        s += `${format_debug(owner, debug_OwnerId, PRETTY)} => ${format_debug(PrintExtra.tcx(ex).hir_owner_nodes(owner), debug_OwnerNodes, PRETTY)}\n`;
      }
      out = s;
      break;
    }
    case "Mir": {
      const out_ = new VecU8();
      unwrap_result(write_mir_pretty(PrintExtra.tcx(ex), out_), debug_IoError);
      out = string_from_utf8_unwrap(out_.bytes());
      break;
    }
    case "MirCFG": {
      const out_ = new VecU8();
      unwrap_result(write_mir_graphviz(PrintExtra.tcx(ex), out_), debug_IoError);
      out = string_from_utf8_unwrap(out_.bytes());
      break;
    }
    case "StableMir":
      // PORT: `rustc_public::rustc_internal::pretty::write_smir_pretty`: rustc_public is excluded
      // (harness/scope.json).
      return unported("rustc_public::rustc_internal::pretty::write_smir_pretty (-Zunpretty=stable-mir)");
    case "ThirTree": {
      const tcx = PrintExtra.tcx(ex);
      let out_ = "";
      rustc_hir_analysis.check_crate(tcx);
      tcx.dcx().abort_if_errors();
      // debug!("pretty printing THIR tree");
      for (const did of tcx.hir_body_owners()) {
        out_ += `${format_debug(did, debug_LocalDefId, PLAIN)}:\n${thir_tree(tcx, did)}\n\n`;
      }
      out = out_;
      break;
    }
    case "ThirFlat": {
      const tcx = PrintExtra.tcx(ex);
      let out_ = "";
      rustc_hir_analysis.check_crate(tcx);
      tcx.dcx().abort_if_errors();
      // debug!("pretty printing THIR flat");
      for (const did of tcx.hir_body_owners()) {
        out_ += `${format_debug(did, debug_LocalDefId, PLAIN)}:\n${thir_flat(tcx, did)}\n\n`;
      }
      out = out_;
      break;
    }
  }

  write_or_print(out, sess);
}

/// Implementation of `--emit=mir`.
// rustc: compiler/rustc_driver_impl/src/pretty.rs:349 emit_mir
export function emit_mir(tcx: TyCtxt): IoResult<void> {
  let r: IoResult<void>;
  const path = (tcx.output_filenames(null) as OutputFilenames).path("Mir");
  switch (path.$) {
    case "Stdout": {
      // PORT: `io::stdout()` is vendor/anstream's unbuffered `Stdout` (fd 1); `print!` output of the driver
      // (`std_print`) is buffered until exit, so it would follow this text instead of preceding it.
      const f = stdout();
      if ((r = write_mir_pretty(tcx, f)).$ === "Err") return r;
      break;
    }
    case "Real": {
      const p = path._0;
      // PORT: `File::create_buffered(&path)?`: the text is collected and written when the `BufWriter` is
      // dropped (its `Drop` flushes and ignores errors), after `write_mir_pretty` returned.
      let fd: number;
      try {
        fd = openSync(p, "w");
      } catch (e) {
        return Err(io_error_from_node(e));
      }
      const f = new VecU8();
      r = write_mir_pretty(tcx, f);
      try {
        writeSync(fd, f.bytes());
      } catch {
        // ignored, as `BufWriter`'s `Drop`
      }
      closeSync(fd);
      if (r.$ === "Err") return r;
      if (tcx.sess.opts.json_artifact_notifications) {
        tcx.dcx().emit_artifact_notification(p, "mir");
      }
      break;
    }
  }
  return Ok(undefined);
}
