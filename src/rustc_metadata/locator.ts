// Port of compiler/rustc_metadata/src/locator.rs.
//
// PORT: contract-first stub (lane creader, wave 11). Only the declared shapes creader.rs needs are here:
// `CrateLocator` (fields + methods), `CratePaths`, `CrateFlavor` (ported: the generated diagnostics need its
// `IntoDiagArg`), `CrateRejections`, `CombinedLocatorError`, `CrateError` (+ `report`). Every body that
// searches the file system or reports a locator error calls `unported` and carries no marker; the locator
// lane fills them (and the rest of the file) in upstream order.
import type { CrateSource } from "../rustc_crate_store/lib.ts";
import type { DiagArgValue } from "../rustc_error_messages/lib.ts";
import type { Session } from "../rustc_session/lib.ts";
import type { PathKind } from "../rustc_session/search_paths.ts";
import type { PathBuf, Span } from "../rustc_span/lib.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import type { Target } from "../rustc_target/spec/mod.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { unported } from "../std/panic.ts";
import type { Result } from "../std/result.ts";
import type { Library, MetadataLoader } from "./creader.ts";
import type { Svh } from "./rmeta/decoder.ts";

// #[derive(Clone)]
export class CrateLocator {
  constructor(
    // Immutable per-session configuration.
    public only_needs_metadata: boolean,
    public metadata_loader: MetadataLoader,
    public cfg_version: string,

    // Immutable per-search configuration.
    public crate_name: Symbol,
    public exact_paths: unknown[],
    public hash: Svh | undefined,
    public extra_filename: string | undefined,
    public target: Target,
    public tuple: unknown,
    public filesearch: unknown,
    public is_proc_macro: boolean,
    public path_kind: PathKind,
  ) {}

  /** `#[derive(Clone)]` */
  clone(): CrateLocator {
    return new CrateLocator(
      this.only_needs_metadata,
      this.metadata_loader,
      this.cfg_version,
      this.crate_name,
      this.exact_paths.slice(),
      this.hash,
      this.extra_filename,
      this.target,
      this.tuple,
      this.filesearch,
      this.is_proc_macro,
      this.path_kind,
    );
  }

  static new(
    _sess: Session,
    _metadata_loader: MetadataLoader,
    _crate_name: Symbol,
    _is_rlib: boolean,
    _hash: Svh | undefined,
    _extra_filename: string | undefined,
    _path_kind: PathKind,
  ): CrateLocator {
    return unported("rustc_metadata::locator::CrateLocator::new (wave 11 locator)");
  }

  for_proc_macro(_sess: Session, _path_kind: PathKind): void {
    unported("rustc_metadata::locator::CrateLocator::for_proc_macro (wave 11 locator)");
  }

  for_target_proc_macro(_sess: Session, _path_kind: PathKind): void {
    unported("rustc_metadata::locator::CrateLocator::for_target_proc_macro (wave 11 locator)");
  }

  for_wasm_proc_macro(_sess: Session, _path_kind: PathKind): void {
    unported("rustc_metadata::locator::CrateLocator::for_wasm_proc_macro (wave 11 locator)");
  }

  maybe_load_library_crate(_crate_rejections: CrateRejections): Result<Library | undefined, CrateError> {
    return unported("rustc_metadata::locator::CrateLocator::maybe_load_library_crate (wave 11 locator)");
  }

  into_error(_crate_rejections: CrateRejections, _dep_root: CratePaths | undefined): CrateError {
    return unported("rustc_metadata::locator::CrateLocator::into_error (wave 11 locator)");
  }
}

// #[derive(Clone, Debug)]
export class CratePaths {
  constructor(
    public name: Symbol,
    public source: CrateSource,
  ) {}

  static new(_name: Symbol, _source: CrateSource): CratePaths {
    return unported("rustc_metadata::locator::CratePaths::new (wave 11 locator)");
  }
}

// #[derive(Copy, Clone, Debug, PartialEq)]
export type CrateFlavor = "Rlib" | "Rmeta" | "Dylib" | "SDylib";
export const CrateFlavor = { Rlib: "Rlib", Rmeta: "Rmeta", Dylib: "Dylib", SDylib: "SDylib" } as const;

/** `impl fmt::Display for CrateFlavor` */
// rustc: compiler/rustc_metadata/src/locator.rs:282 fmt
export function display_CrateFlavor(self: CrateFlavor): string {
  switch (self) {
    case "Rlib":
      return "rlib";
    case "Rmeta":
      return "rmeta";
    case "Dylib":
      return "dylib";
    case "SDylib":
      return "sdylib";
  }
}

/** `impl IntoDiagArg for CrateFlavor` */
// rustc: compiler/rustc_metadata/src/locator.rs:293 into_diag_arg
export function CrateFlavor_into_diag_arg(self: CrateFlavor, _: MutRef<PathBuf | undefined>): DiagArgValue {
  switch (self) {
    case "Rlib":
      return { $: "Str", _0: "rlib" };
    case "Rmeta":
      return { $: "Str", _0: "rmeta" };
    case "Dylib":
      return { $: "Str", _0: "dylib" };
    case "SDylib":
      return { $: "Str", _0: "sdylib" };
  }
}

// #[derive(Clone, Debug, Default)]
export class CrateRejections {
  constructor(
    public via_hash: unknown[],
    public via_triple: unknown[],
    public via_kind: unknown[],
    public via_version: unknown[],
    public via_filename: unknown[],
    public via_invalid: unknown[],
  ) {}

  /** `#[derive(Default)]` */
  static default(): CrateRejections {
    return new CrateRejections([], [], [], [], [], []);
  }
}

/// Candidate rejection reasons collected during crate search.
/// If no candidate is accepted, then these reasons are presented to the user,
/// otherwise they are ignored.
// #[derive(Debug)]
export interface CombinedLocatorError {
  crate_name: Symbol;
  dep_root: CratePaths | undefined;
  triple: unknown;
  dll_prefix: string;
  dll_suffix: string;
  crate_rejections: CrateRejections;
}

// #[derive(Debug)]
export type CrateError =
  | { readonly $: "NonAsciiName"; readonly _0: Symbol }
  | { readonly $: "ExternLocationNotExist"; readonly _0: Symbol; readonly _1: PathBuf }
  | { readonly $: "ExternLocationNotFile"; readonly _0: Symbol; readonly _1: PathBuf }
  | { readonly $: "MultipleCandidates"; readonly _0: Symbol; readonly _1: CrateFlavor; readonly _2: PathBuf[] }
  | { readonly $: "FullMetadataNotFound"; readonly _0: Symbol; readonly _1: CrateFlavor }
  | { readonly $: "SymbolConflictsCurrent"; readonly _0: Symbol }
  | { readonly $: "StableCrateIdCollision"; readonly _0: Symbol; readonly _1: Symbol }
  | { readonly $: "DlOpen"; readonly _0: string; readonly _1: string }
  | { readonly $: "DlSym"; readonly _0: string; readonly _1: string }
  | { readonly $: "LocatorCombined"; readonly _0: CombinedLocatorError }
  | { readonly $: "NotFound"; readonly _0: Symbol };

export const CrateError = {
  report(_self: CrateError, _sess: Session, _span: Span, _missing_core: boolean): void {
    unported("rustc_metadata::locator::CrateError::report (wave 11 locator)");
  },
} as const;
