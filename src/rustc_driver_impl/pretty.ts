//! The various pretty-printing routines.
// Partial port of compiler/rustc_driver_impl/src/pretty.rs: the AST modes (`normal`, `ast-tree`, and the
// `NeedsAstMap` ones: `expanded`, `expanded,identified`, `expanded,hygiene`, `ast-tree,expanded`). The
// HIR/MIR/THIR modes need HIR and later crates and call `unported`.
import "../rustc_session/options.ts"; // LOAD ORDER: see rustc_session/config.ts
import type { Crate } from "../rustc_ast/ast.gen.ts";
import { debug_Crate } from "../rustc_ast/ast.gen.ts";
import { PpAnn, print_crate } from "../rustc_ast_pretty/pprust/mod.ts";
import type { AnnNode, State } from "../rustc_ast_pretty/pprust/state.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { debug_hygiene_data, debug_SyntaxContext } from "../rustc_span/hygiene.ts";
import { Span } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { Input, OutFileName, type PpMode, PpMode as PpModeC } from "../rustc_session/config.ts";
import type { Session } from "../rustc_session/session.ts";
import type { FileName } from "../rustc_span/lib.ts";
import { format_debug, PLAIN, PRETTY } from "../std/fmt.ts";
import { panic, unported } from "../std/panic.ts";
import type { Str } from "../std/str.ts";

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

// `HirIdentifiedAnn` (pretty.rs:68): not ported (HIR, M3).

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

// `HirTypedAnn` (pretty.rs:149): not ported (HIR, M3).

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
    case "Hir":
    case "HirTree":
    case "Mir":
    case "MirCFG":
    case "StableMir":
    case "ThirTree":
    case "ThirFlat":
      return unported(`rustc_driver_impl::pretty::print (${ppm.$}: needs a TyCtxt)`);
  }

  write_or_print(out, sess);
}

// `emit_mir` (pretty.rs:343): not ported (rustc_middle).
