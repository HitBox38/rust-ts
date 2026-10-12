//! Bindings to acquire a global named lock.
//!
//! This is intended to be used to synchronize multiple compiler processes to
//! ensure that we can output complete errors without interleaving on Windows.
//! Note that this is currently only needed for allowing only one 32-bit MSVC
//! linker to execute at once on MSVC hosts, so this is only implemented for
//! `cfg(windows)`. Also note that this may not always be used on Windows,
//! only when targeting 32-bit MSVC.
//!
//! For more information about why this is necessary, see where this is called.
// Port of compiler/rustc_errors/src/lock.rs.

// rustc-skip: compiler/rustc_errors/src/lock.rs:15 acquire_global_lock OS-level Windows named mutex (CreateMutexA/WaitForSingleObject); rust-ts is one process and only needs it for 32-bit MSVC linking, so the non-windows no-op below is used on every host
// rustc-skip: compiler/rustc_errors/src/lock.rs:28 drop CloseHandle of the Windows named mutex (see acquire_global_lock above)
// rustc-skip: compiler/rustc_errors/src/lock.rs:39 drop ReleaseMutex of the Windows named mutex (see acquire_global_lock above)

// rustc: compiler/rustc_errors/src/lock.rs:83 acquire_global_lock
export function acquire_global_lock(_name: string): unknown {
  return null;
}
