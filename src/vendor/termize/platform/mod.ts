// Port of termize =0.2.1 `src/platform/mod.rs`.
//
// PORT: rust-ts follows non-windows (unix) host semantics: `#[cfg(unix)] mod unix` is the
// platform. The `windows` and `unsupported` platforms are cfg-gated out:
// crate-skip: termize-0.2.1/src/platform/windows.rs:25 dimensions windows-only (cfg(windows))
// crate-skip: termize-0.2.1/src/platform/windows.rs:75 dimensions_stdout windows-only (cfg(windows))
// crate-skip: termize-0.2.1/src/platform/windows.rs:85 dimensions_stdin windows-only (cfg(windows))
// crate-skip: termize-0.2.1/src/platform/windows.rs:95 dimensions_stderr windows-only (cfg(windows))
// crate-skip: termize-0.2.1/src/platform/windows.rs:103 just_check_work windows-only test (cfg(windows))
// crate-skip: termize-0.2.1/src/platform/unsupported.rs:1 dimensions cfg(not(any(unix, windows))) only
// crate-skip: termize-0.2.1/src/platform/unsupported.rs:4 dimensions_stdout cfg(not(any(unix, windows))) only
// crate-skip: termize-0.2.1/src/platform/unsupported.rs:7 dimensions_stdin cfg(not(any(unix, windows))) only
// crate-skip: termize-0.2.1/src/platform/unsupported.rs:10 dimensions_stderr cfg(not(any(unix, windows))) only

export { dimensions, dimensions_stderr, dimensions_stdin, dimensions_stdout } from "./unix.ts";
