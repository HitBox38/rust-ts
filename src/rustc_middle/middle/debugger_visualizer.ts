// Port of compiler/rustc_middle/src/middle/debugger_visualizer.rs.
//
// PORT: hand-written type (rustc_middle types are hand-written, see codegen set `rustc_middle`'s note). The derived
// `Debug`/`Hash`/`Ord`/`StableHash`/`Encodable`/`Decodable` are not ported: nothing prints or hashes it yet
// (`crate_hash` has its own shim), and metadata is M5.
import type { DebuggerVisualizerType } from "../../rustc_attr_ir/lib.ts";
import type { PathBuf } from "../../rustc_span/lib.ts";

/// A single debugger visualizer file.
// rustc-type: compiler/rustc_middle/src/middle/debugger_visualizer.rs:10 DebuggerVisualizerFile
export class DebuggerVisualizerFile {
  constructor(
    /// The complete debugger visualizer source.
    public src: Uint8Array,
    /// Indicates which visualizer type this targets.
    public visualizer_type: DebuggerVisualizerType,
    /// The file path to the visualizer file. This is used for reporting
    /// visualizer files in dep-info. Before it is written to crate metadata,
    /// the path is erased to `None`, so as not to emit potentially privacy
    /// sensitive data.
    public path: PathBuf | undefined,
  ) {}

  // rustc: compiler/rustc_middle/src/middle/debugger_visualizer.rs:23 new
  static new(src: Uint8Array, visualizer_type: DebuggerVisualizerType, path: PathBuf): DebuggerVisualizerFile {
    return new DebuggerVisualizerFile(src, visualizer_type, path);
  }

  // rustc: compiler/rustc_middle/src/middle/debugger_visualizer.rs:27 path_erased
  path_erased(): DebuggerVisualizerFile {
    // `Arc::clone(&self.src)`: the same bytes.
    return new DebuggerVisualizerFile(this.src, this.visualizer_type, undefined);
  }
}
