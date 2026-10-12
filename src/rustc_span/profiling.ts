// compiler/rustc_span/src/profiling.rs only defines `SpannedEventArgRecorder`, an extension trait
// for rustc's self-profiler (`-Zself-profile` event arguments). Self-profiling produces no
// compiler output and is out of scope.
// rustc-skip: compiler/rustc_span/src/profiling.rs:17 record_arg_with_span self-profiling only (no observable output)
// rustc-skip: compiler/rustc_span/src/profiling.rs:23 record_arg_with_span self-profiling only (no observable output)
export {};
