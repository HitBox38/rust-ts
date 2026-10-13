//! The various pretty-printing routines.
// Partial port of compiler/rustc_driver_impl/src/pretty.rs: the modes that need no `TyCtxt`
// (`-Zunpretty=normal`, `-Zunpretty=ast-tree`). The HIR/MIR/THIR/expanded modes need
// rustc_middle and friends and call `unported`.
import "../rustc_session/options.ts"; // LOAD ORDER: see rustc_session/config.ts
import type { Crate } from "../rustc_ast/ast.gen.ts";
import { debug_Crate } from "../rustc_ast/ast.gen.ts";
import { PpAnn, print_crate } from "../rustc_ast_pretty/pprust/mod.ts";
import { Input, OutFileName, type PpMode, PpMode as PpModeC } from "../rustc_session/config.ts";
import type { Session } from "../rustc_session/session.ts";
import type { FileName } from "../rustc_span/lib.ts";
import { format_debug, PRETTY } from "../std/fmt.ts";
import { panic, unported } from "../std/panic.ts";
import type { Str } from "../std/str.ts";

// pub use self::PpMode::*; pub use self::PpSourceMode::*;

class AstNoAnn extends PpAnn {}

// `AstIdentifiedAnn`, `HirIdentifiedAnn`, `AstHygieneAnn`, `HirTypedAnn` (pretty.rs:24-197): not ported
// (they are only used by the expanded / HIR modes).

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
export type PrintExtra = { readonly $: "AfterParsing"; readonly krate: Crate } | { readonly $: "NeedsAstMap"; readonly tcx: never };
const PrintExtra = {
  // rustc: compiler/rustc_driver_impl/src/pretty.rs:214 with_krate
  with_krate<R>(self: PrintExtra, f: (krate: Crate) => R): R {
    switch (self.$) {
      case "AfterParsing":
        return f(self.krate);
      case "NeedsAstMap":
        return unported("rustc_middle::ty::TyCtxt::resolver_for_lowering (PrintExtra::with_krate)");
    }
  },

  // rustc: compiler/rustc_driver_impl/src/pretty.rs:224 tcx
  tcx(self: PrintExtra): never {
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
    // `ex.tcx().ensure_ok().analysis(())`
    unported("rustc_middle analysis (pretty::print)");
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
          return unported("rustc_driver_impl::pretty::AstIdentifiedAnn");
        case "ExpandedHygiene":
          return unported("rustc_driver_impl::pretty::AstHygieneAnn");
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
      return unported("rustc_middle::ty::TyCtxt::resolver_for_lowering (-Zunpretty=ast-tree,expanded)");
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
