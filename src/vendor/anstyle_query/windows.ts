// Port of anstyle-query =1.1.5 `src/windows.rs`.
//
//! Windows-specific style queries
//
// PORT: rust-ts follows non-windows host semantics: `mod windows_console` is the
// `#[cfg(not(windows))]` variant. The `#[cfg(windows)]` console code is not ported:
// crate-skip: anstyle-query-1.1.5/src/windows.rs:12 enable_vt windows-only console API (cfg(windows))
// crate-skip: anstyle-query-1.1.5/src/windows.rs:36 enable_virtual_terminal_processing windows-only console API (cfg(windows))
// crate-skip: anstyle-query-1.1.5/src/windows.rs:51 enable_ansi_colors windows-only console API (cfg(windows))
// crate-skip: anstyle-query-1.1.5/src/windows.rs:77 enable_virtual_terminal_processing windows-only (cfg(windows))

const windows_console = {
  // crate: anstyle-query-1.1.5/src/windows.rs:63 enable_ansi_colors
  enable_ansi_colors(): boolean | undefined {
    return undefined;
  },
} as const;

/// Enable ANSI escape codes ([`ENABLE_VIRTUAL_TERMINAL_PROCESSING`](https://learn.microsoft.com/en-us/windows/console/console-virtual-terminal-sequences#output-sequences))
///
/// For non-windows systems, returns `None`
// crate: anstyle-query-1.1.5/src/windows.rs:71 enable_ansi_colors
export function enable_ansi_colors(): boolean | undefined {
  return windows_console.enable_ansi_colors();
}
