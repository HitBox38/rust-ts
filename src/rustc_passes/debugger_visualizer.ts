// Port of compiler/rustc_passes/src/debugger_visualizer.rs
//! Detecting usage of the `#[debugger_visualizer]` attribute.
import { type ast, type Crate, type Item, visit } from "../rustc_ast/lib.ts";
import { AttributeParser } from "../rustc_attr_parsing/lib.ts";
import { DebuggerVisualizerFile } from "../rustc_middle/middle/debugger_visualizer.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Session } from "../rustc_session/session.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import { DebugVisualizerUnreadable_diagnostic } from "./diagnostics.ts";

// impl DebuggerVisualizerCollector<'_> (debugger_visualizer.rs:14) and its `Visitor` impl (:54) are the methods of
// the class below, in upstream order (PORTING §8: the class must exist before its methods).
// rustc-type: compiler/rustc_passes/src/debugger_visualizer.rs:49 DebuggerVisualizerCollector
class DebuggerVisualizerCollector extends visit.Visitor {
  constructor(
    public sess: Session,
    public visualizers: DebuggerVisualizerFile[],
  ) {
    super();
  }

  // rustc: compiler/rustc_passes/src/debugger_visualizer.rs:15 check_for_debugger_visualizer
  check_for_debugger_visualizer(attrs: readonly ast.Attribute[]): void {
    const a = AttributeParser.parse_limited_sym(this.sess, attrs, [sym.debugger_visualizer]);
    if (a !== undefined && a.$ === "Parsed" && a._0.$ === "DebuggerVisualizer") {
      const visualizers = a._0._0;
      for (const { span, visualizer_type, path } of visualizers) {
        const r = this.sess.resolve_path(Symbol.as_str(path), span);
        let file: string;
        if (r.$ === "Ok") {
          file = r._0;
        } else {
          r._0.emit();
          return;
        }

        const loaded = this.sess.source_map().load_binary_file(file);
        if (loaded.$ === "Ok") {
          const [source, _] = loaded._0;
          this.visualizers.push(DebuggerVisualizerFile.new(source, visualizer_type, file));
        } else {
          const error = loaded._0;
          this.sess.dcx().emit_err(DebugVisualizerUnreadable_diagnostic({ span, file, error }));
        }
      }
    }
  }

  // rustc: compiler/rustc_passes/src/debugger_visualizer.rs:55 visit_item
  override visit_item(item: Item): undefined {
    if (item.kind.$ === "Mod") {
      this.check_for_debugger_visualizer(item.attrs);
    }
    visit.walk_item(this, item, visit.WalkItemKind.ItemKind);
  }

  // rustc: compiler/rustc_passes/src/debugger_visualizer.rs:61 visit_crate
  override visit_crate(krate: Crate): undefined {
    this.check_for_debugger_visualizer(krate.attrs);
    visit.walk_crate(this, krate);
  }
}

/// Traverses and collects the debugger visualizers for a specific crate.
// rustc: compiler/rustc_passes/src/debugger_visualizer.rs:68 debugger_visualizers
function debugger_visualizers(tcx: TyCtxt, _: unknown): DebuggerVisualizerFile[] {
  const krate = tcx.resolver_for_lowering()[1];

  const visitor = new DebuggerVisualizerCollector(tcx.sess, []);
  visitor.visit_crate(krate.borrow());

  // We are collecting visualizers in AST-order, which is deterministic,
  // so we don't need to do any explicit sorting in order to get a
  // deterministic query result
  return visitor.visualizers;
}

// rustc: compiler/rustc_passes/src/debugger_visualizer.rs:80 provide
export function provide(providers: Providers): void {
  providers.debugger_visualizers = debugger_visualizers;
}
