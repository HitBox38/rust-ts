// STUB for compiler/rustc_expand/src/stats.rs (`-Zmacro-stats`; not assigned in wave 9; replace freely).
// Published by lane expand-base with only `MacroStat`, the type of `ExtCtxt.macro_stats`. No markers.

// #[derive(Default)]
export interface MacroStat {
  /// Number of uses of the macro.
  uses: number;

  /// Number of lines of code (when pretty-printed).
  lines: number;

  /// Number of bytes of code (when pretty-printed).
  bytes: number;
}
