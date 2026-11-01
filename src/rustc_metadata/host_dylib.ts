// Port of compiler/rustc_metadata/src/host_dylib.rs.
//
// PORT: `libloading` and the `#[repr(C)]` bridge ABI live in the FFI edge src/rust_ts/proc_macro_host.ts
// (plan-m6 D7): `libloading::Library::new` / `get` / `into_raw` and `libloading::Error` are its `library_new` /
// `library_get` / `LibloadingError`, and reading the decls static's `&[Client]` is `read_proc_macro_clients`.
// `debug!` is compiled out of the release oracle and stays as comments.
import type { Client as ProcMacroClient_ } from "../proc_macro/bridge/client.ts";
import { try_canonicalize } from "../rustc_fs_util/lib.ts";
import { generate_proc_macro_decls_symbol } from "../rustc_session/session.ts";
import type { StableCrateId } from "../rustc_span/def_id.ts";
import { library_get, library_new, type LibloadingError, type Library, read_proc_macro_clients, sources_LibloadingError } from "../rust_ts/proc_macro_host.ts";
import { debug_IoError } from "../std/io.ts";
import { assert, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result, unwrap_result } from "../std/result.ts";
import type { CrateError } from "./locator.ts";

/** `use rustc_proc_macro::bridge::client::Client as ProcMacroClient;` */
export type ProcMacroClient = ProcMacroClient_;

// rustc: compiler/rustc_metadata/src/host_dylib.rs:12 format_dlopen_err
function format_dlopen_err(e: LibloadingError): string {
  return sources_LibloadingError(e)
    .map((e) => `: ${e}`)
    .join("");
}

// rustc: compiler/rustc_metadata/src/host_dylib.rs:16 attempt_load_dylib
function attempt_load_dylib(path: string): Result<Library, LibloadingError> {
  // #[cfg(target_os = "aix")] (the `.a` big-archive member path with RTLD_MEMBER): no rust-ts host is AIX.

  return library_new(path);
}

// On Windows the compiler would sometimes intermittently fail to open the
// proc-macro DLL with `Error::LoadLibraryExW`. It is suspected that something in the
// system still holds a lock on the file, so we retry a few times before calling it
// an error.
// rustc: compiler/rustc_metadata/src/host_dylib.rs:43 load_dylib
function load_dylib(path: string, max_attempts: number): Result<Library, string> {
  assert(max_attempts > 0, "assertion failed: max_attempts > 0");

  let last_error: LibloadingError | undefined;

  for (let attempt = 0; attempt < max_attempts; attempt++) {
    // debug!("Attempt to load proc-macro `{}`.", path.display());
    const r = attempt_load_dylib(path);
    if (r.$ === "Ok") {
      const lib = r._0;
      if (attempt > 0) {
        // debug!("Loaded proc-macro `{}` after {} attempts.", path.display(), attempt + 1);
      }
      return Ok(lib);
    } else {
      const err = r._0;
      // Only try to recover from this specific error.
      if (!(err.$ === "LoadLibraryExW")) {
        // debug!("Failed to load proc-macro `{}`. Not retrying", path.display());
        const err_ = format_dlopen_err(err);
        // We include the path of the dylib in the error ourselves, so
        // if it's in the error, we strip it.
        const prefix = `: ${path}`;
        if (err_.startsWith(prefix)) {
          return Err(err_.slice(prefix.length));
        }
        return Err(err_);
      }

      last_error = err;
      // std::thread::sleep(Duration::from_millis(100));
      Bun.sleepSync(100);
      // debug!("Failed to load proc-macro `{}`. Retrying.", path.display());
    }
  }

  // debug!("Failed to load proc-macro `{}` even after {} attempts.", path.display(), max_attempts);

  const last_error_ = unwrap(last_error);
  let message: string;
  // `last_error.source()`: the `WindowsError` of `LoadLibraryExW { source }`.
  const src = last_error_.$ === "LoadLibraryExW" ? last_error_.source : undefined;
  if (src !== undefined) {
    message = `${format_dlopen_err(last_error_)} (${src}) (retried ${max_attempts} times)`;
  } else {
    message = `${format_dlopen_err(last_error_)} (retried ${max_attempts} times)`;
  }
  return Err(message);
}

// #[derive(Debug)]
// rustc-type: compiler/rustc_metadata/src/host_dylib.rs:92 DylibError
export type DylibError = { readonly $: "DlOpen"; readonly _0: string; readonly _1: string } | { readonly $: "DlSym"; readonly _0: string; readonly _1: string };

/** `impl From<DylibError> for CrateError` */
// rustc: compiler/rustc_metadata/src/host_dylib.rs:98 from
export function CrateError_from_DylibError(err: DylibError): CrateError {
  switch (err.$) {
    case "DlOpen":
      return { $: "DlOpen", _0: err._0, _1: err._1 };
    case "DlSym":
      return { $: "DlSym", _0: err._0, _1: err._1 };
  }
}

/**
 * PORT: `load_symbol_from_dylib::<T>` returns the symbol's address; the caller reads its `T` from there (the
 * one caller here wants `T = *const &[ProcMacroClient]`, i.e. the address itself).
 */
// rustc: compiler/rustc_metadata/src/host_dylib.rs:106 load_symbol_from_dylib
export function load_symbol_from_dylib(path: string, sym_name: string): Result<number, DylibError> {
  // Make sure the path contains a / or the linker will search for it.
  const path_ = unwrap_result(try_canonicalize(path), debug_IoError);
  const lib_ = load_dylib(path_, 5);
  if (lib_.$ === "Err") return Err({ $: "DlOpen", _0: path_, _1: lib_._0 });
  const lib = lib_._0;

  const sym_ = library_get(lib, sym_name);
  if (sym_.$ === "Err") return Err({ $: "DlSym", _0: path_, _1: format_dlopen_err(sym_._0) });

  // Intentionally leak the dynamic library. We can't ever unload it
  // since the library can make things that will live arbitrarily long.
  // PORT: `sym.into_raw()` + `mem::forget(lib)`: the handle is never closed.
  const sym = sym_._0;

  return Ok(sym);
}

// rustc: compiler/rustc_metadata/src/host_dylib.rs:126 dlsym_proc_macros
export function dlsym_proc_macros(path: string, stable_crate_id: StableCrateId): Result<readonly ProcMacroClient[], DylibError> {
  const sym_name = generate_proc_macro_decls_symbol(stable_crate_id);
  // debug!("trying to dlsym proc_macros {} for symbol `{}`", path.display(), sym_name);

  // FIXME(bjorn3) this depends on the unstable slice memory layout
  const result = load_symbol_from_dylib(path, sym_name);
  switch (result.$) {
    case "Ok": {
      // debug!("loaded dlsym proc_macros {} for symbol `{}`", path.display(), sym_name);
      return Ok(read_proc_macro_clients(result._0));
    }
    case "Err": {
      // debug!("failed to dlsym proc_macros {} for symbol `{}`", path.display(), sym_name);
      return Err(result._0);
    }
  }
}
