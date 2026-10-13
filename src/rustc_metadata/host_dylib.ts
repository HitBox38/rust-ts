// Port of compiler/rustc_metadata/src/host_dylib.rs.
//
// PORT: contract-first stub (lane creader, wave 11). Loading a host dylib (proc-macro crates, `libloading`) is
// M6 (proc macros); `dlsym_proc_macros` calls `unported`. `DylibError` and its `From` impl into `CrateError`
// (which creader.rs's `?` uses) are ported.
import type { StableCrateId } from "../rustc_span/def_id.ts";
import { unported } from "../std/panic.ts";
import type { Result } from "../std/result.ts";
import type { CrateError } from "./locator.ts";

// #[derive(Debug)]
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

/** PORT: `&'static [ProcMacroClient]` (rustc_proc_macro bridge, M6) is opaque here. */
export type ProcMacroClient = unknown;

export function dlsym_proc_macros(_path: string, _stable_crate_id: StableCrateId): Result<readonly ProcMacroClient[], DylibError> {
  return unported("rustc_metadata::host_dylib::dlsym_proc_macros (proc-macro dylibs, M6)");
}
