// Port of icu_provider 2.3.0 `src/error.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
//
// PORT: logging. icu_provider's `log` module is a no-op unless the `logging` feature is on or the
// crate is built with debug assertions (then it is `eprintln!`). rustc builds it with neither, so
// every `log::warn!` below is a no-op (kept as a comment).
import { debug_option, debug_str, debug_struct, type Fmt, PLAIN } from "../../std/fmt.ts";
import { Ok, type Result } from "../../std/result.ts";
import { type DataMarkerId, type DataMarkerInfo, debug_DataMarkerId, debug_DataMarkerInfo } from "./marker.ts";
import type { DataRequest } from "./request.ts";

/// A list specifying general categories of data provider error.
///
/// Errors may be caused either by a malformed request or by the data provider
/// not being able to fulfill a well-formed request.
// #[derive(Clone, Copy, Eq, PartialEq, Display, Debug)] #[non_exhaustive]
export type DataErrorKind =
  /// No data for the requested data marker. This is only returned by [`DynamicDataProvider`].
  | { readonly $: "MarkerNotFound" }
  /// There is data for the data marker, but not for this particular data identifier.
  | { readonly $: "IdentifierNotFound" }
  /// The request is invalid, such as a request for a singleton marker containing a data identifier.
  | { readonly $: "InvalidRequest" }
  /// The data for two [`DataMarker`]s is not consistent.
  | { readonly $: "InconsistentData"; readonly _0: DataMarkerInfo }
  /// An error occured during [`Any`](core::any::Any) downcasting.
  | { readonly $: "Downcast"; readonly _0: string }
  /// An error occured during [`serde`] deserialization.
  ///
  /// Check debug logs for potentially more information.
  | { readonly $: "Deserialize" }
  /// An unspecified error occurred.
  ///
  /// Check debug logs for potentially more information.
  | { readonly $: "Custom" }
  /// An error occurred while accessing a system resource.
  | { readonly $: "Io"; readonly _0: string };

/** `#[derive(Debug)]` */
export function debug_DataErrorKind(v: DataErrorKind, f: Fmt = PLAIN): string {
  switch (v.$) {
    case "InconsistentData":
      return `InconsistentData(${debug_DataMarkerInfo(v._0, f)})`;
    case "Downcast":
      return `Downcast(${debug_str(v._0)})`;
    case "Io":
      return `Io(${v._0})`;
    default:
      return v.$;
  }
}

/** `#[derive(displaydoc::Display)]` */
export function display_DataErrorKind(v: DataErrorKind): string {
  switch (v.$) {
    case "MarkerNotFound":
      return "Missing data for marker";
    case "IdentifierNotFound":
      return "Missing data for identifier";
    case "InvalidRequest":
      return "Invalid request";
    case "InconsistentData":
      return `The data for two markers is not consistent: ${debug_DataMarkerInfo(v._0)} (were they generated in different datagen invocations?)`;
    case "Downcast":
      return `Downcast: expected ${v._0}, found`;
    case "Deserialize":
      return "Deserialize";
    case "Custom":
      return "Custom";
    case "Io":
      return `I/O: ${v._0}`;
  }
}

/// The error type for ICU4X data provider operations.
///
/// To create one of these, either start with a [`DataErrorKind`] or use [`DataError::custom()`].
// #[derive(Clone, Copy, Eq, PartialEq, Debug)] #[non_exhaustive]
export class DataError {
  constructor(
    /// Broad category of the error.
    public kind: DataErrorKind,
    /// The data marker of the request, if available.
    public marker: DataMarkerId | undefined,
    /// Additional context, if available.
    public str_context: string | undefined,
    /// Whether this error was created in silent mode to not log.
    public silent: boolean,
  ) {}

  // impl DataErrorKind { .. }  (methods on the kind, as statics taking it first)

  /// Converts this DataErrorKind into a DataError.
  ///
  /// If possible, you should attach context using a `with_` function.
  // crate: icu_provider-2.3.0/src/error.rs:115 into_error
  static into_error(kind: DataErrorKind): DataError {
    return new DataError(kind, undefined, undefined, false);
  }

  /// Creates a DataError with a data marker context.
  // crate: icu_provider-2.3.0/src/error.rs:126 with_marker
  static with_marker_kind(kind: DataErrorKind, marker: DataMarkerInfo): DataError {
    return DataError.into_error(kind).with_marker(marker);
  }

  /// Creates a DataError with a string context.
  // crate: icu_provider-2.3.0/src/error.rs:132 with_str_context
  static with_str_context_kind(kind: DataErrorKind, context: string): DataError {
    return DataError.into_error(kind).with_str_context(context);
  }

  // crate-skip: icu_provider-2.3.0/src/error.rs:138 with_type_context `core::any::type_name::<T>()` has no TS equivalent; unused on rustc's path

  /// Creates a DataError with a request context.
  // crate: icu_provider-2.3.0/src/error.rs:144 with_req
  static with_req_kind(kind: DataErrorKind, marker: DataMarkerInfo, req: DataRequest): DataError {
    return DataError.into_error(kind).with_req(marker, req);
  }

  /// Returns a new, empty [`DataError`] with kind Custom and a string error message.
  // crate: icu_provider-2.3.0/src/error.rs:152 custom
  static custom(str_context: string): DataError {
    return new DataError({ $: "Custom" }, undefined, str_context, false);
  }

  /// Sets the data marker of a DataError, returning a modified error.
  // crate: icu_provider-2.3.0/src/error.rs:163 with_marker
  with_marker(marker: DataMarkerInfo): DataError {
    return new DataError(this.kind, marker.id, this.str_context, this.silent);
  }

  /// Sets the string context of a DataError, returning a modified error.
  // crate: icu_provider-2.3.0/src/error.rs:174 with_str_context
  with_str_context(context: string): DataError {
    return new DataError(this.kind, this.marker, context, this.silent);
  }

  // crate-skip: icu_provider-2.3.0/src/error.rs:185 with_type_context `core::any::type_name::<T>()` has no TS equivalent; unused on rustc's path

  /// Logs the data error with the given request, returning an error containing the data marker.
  ///
  /// If the "logging" Cargo feature is enabled, this logs the whole request. Either way,
  /// it returns an error with the data marker portion of the request as context.
  // crate: icu_provider-2.3.0/src/error.rs:196 with_req
  with_req(marker: DataMarkerInfo, req: DataRequest): DataError {
    // `mut self`
    let self_: DataError = new DataError(this.kind, this.marker, this.str_context, this.silent);
    if (req.metadata.silent) {
      self_ = new DataError(self_.kind, self_.marker, self_.str_context, true);
    }
    // Don't write out a log for MissingDataMarker since there is no context to add
    if (!self_.silent && self_.kind.$ !== "MarkerNotFound") {
      // log::warn!("{self} (marker: {marker:?}, request: {})", req.id);  (no-op, see header)
    }
    return self_.with_marker(marker);
  }

  // crate-skip: icu_provider-2.3.0/src/error.rs:212 with_path_context `std::path::Path` contexts are unused on rustc's path

  /// Logs the data error with the given context, then return self.
  ///
  /// This does not modify the error, but if the "logging" Cargo feature is enabled,
  /// it will print out the context.
  // crate: icu_provider-2.3.0/src/error.rs:225 with_display_context
  with_display_context(_context: unknown): DataError {
    if (!this.silent) {
      // log::warn!("{self}: {context}");  (no-op, see header)
    }
    return this;
  }

  /// Logs the data error with the given context, then return self.
  ///
  /// This does not modify the error, but if the "logging" Cargo feature is enabled,
  /// it will print out the context.
  // crate: icu_provider-2.3.0/src/error.rs:238 with_debug_context
  with_debug_context(_context: unknown): DataError {
    if (!this.silent) {
      // log::warn!("{self}: {context:?}");  (no-op, see header)
    }
    return this;
  }

  // crate-skip: icu_provider-2.3.0/src/error.rs:246 for_type `core::any::type_name::<T>()` has no TS equivalent; unused on rustc's path

  /** `#[derive(PartialEq)]` */
  eq(other: DataError): boolean {
    const m = this.marker === undefined || other.marker === undefined ? this.marker === other.marker : this.marker.eq(other.marker);
    return (
      debug_DataErrorKind(this.kind) === debug_DataErrorKind(other.kind) &&
      m &&
      this.str_context === other.str_context &&
      this.silent === other.silent
    );
  }
}

// impl fmt::Display for DataError
// crate: icu_provider-2.3.0/src/error.rs:95 fmt
export function display_DataError(v: DataError): string {
  let s = "ICU4X data error";
  if (v.kind.$ !== "Custom") {
    s += `: ${display_DataErrorKind(v.kind)}`;
  }
  if (v.marker !== undefined) {
    s += ` (marker: ${debug_DataMarkerId(v.marker)})`;
  }
  if (v.str_context !== undefined) {
    s += `: ${v.str_context}`;
  }
  return s;
}

/** `#[derive(Debug)]` */
export function debug_DataError(v: DataError, f: Fmt = PLAIN): string {
  return debug_struct(f, "DataError", [
    ["kind", debug_DataErrorKind(v.kind, f)],
    ["marker", debug_option(v.marker, f, debug_DataMarkerId)],
    ["str_context", debug_option(v.str_context, f, (s) => debug_str(s))],
    ["silent", v.silent ? "true" : "false"],
  ]);
}

// crate-skip: icu_provider-2.3.0/src/error.rs:260 from `From<std::io::Error>`: unused on rustc's path

/// Extension trait for `Result<T, DataError>`.
// crate-skip: icu_provider-2.3.0/src/error.rs:269 allow_identifier_not_found trait method declaration (the impl below)
// crate: icu_provider-2.3.0/src/error.rs:273 allow_identifier_not_found
export function allow_identifier_not_found<T>(self: Result<T, DataError>): Result<T | undefined, DataError> {
  if (self.$ === "Ok") return Ok(self._0);
  if (self._0.kind.$ === "IdentifierNotFound") return Ok(undefined);
  return self;
}


