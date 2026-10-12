// `std::io::Error` (library/core/src/io/error.rs at the pin) as far as rustc_span needs it.
//
// PORT: the repr is a tagged union of the `ErrorData` variants rust-ts produces. OS errors keep
// Node's error code; their message text (`format_os_error`) and `decode_error_kind` are
// unported, so their Display/Debug call `unported`. `ErrorData::Simple` is not produced yet.
import { debug_str, debug_struct, type Debug } from "./fmt.ts";
import { unported } from "./panic.ts";
import type { Result } from "./result.ts";

/** `std::io::ErrorKind` (the variants rust-ts produces). */
export type ErrorKind = "Other" | "InvalidData";

/** `std::io::Error` */
export type IoError =
  | { readonly $: "Os"; readonly code: string; readonly message: string }
  /** `io::Error::new(kind, String)` / `io::Error::other(String)`: a boxed `StringError`. */
  | { readonly $: "Custom"; readonly kind: ErrorKind; readonly error: string }
  /** `const_error!(kind, "message")` (e.g. `io::Error::INVALID_UTF8`). */
  | { readonly $: "SimpleMessage"; readonly kind: ErrorKind; readonly message: string };

/** `std::io::Result<T>` */
export type IoResult<T> = Result<T, IoError>;

/** `io::Error::other(error)` */
export function io_error_other(error: string): IoError {
  return { $: "Custom", kind: "Other", error };
}

/** `io::Error::INVALID_UTF8` (core/src/io/error.rs:103) */
export const INVALID_UTF8: IoError = { $: "SimpleMessage", kind: "InvalidData", message: "stream did not contain valid UTF-8" };

/** An OS error from a failed Node fs call (`io::Error::from_raw_os_error`). */
export function io_error_from_node(e: unknown): IoError {
  const err = e as { code?: string; message?: string };
  return { $: "Os", code: err.code ?? "UNKNOWN", message: err.message ?? String(e) };
}

/** `impl fmt::Display for io::Error` (core/src/io/error.rs:520) */
export function display_IoError(e: IoError): string {
  switch (e.$) {
    case "Os":
      return unported(`std::io::Error Display (os error ${e.code})`);
    case "Custom":
      return e.error;
    case "SimpleMessage":
      return e.message;
  }
}

/** `impl fmt::Debug for Repr` (core/src/io/error.rs:494); `Custom` is `#[derive(Debug)]` with a
 *  `StringError` whose Debug is the string's. */
export const debug_IoError: Debug<IoError> = (e, f) => {
  switch (e.$) {
    case "Os":
      return unported(`std::io::Error Debug (os error ${e.code})`);
    case "Custom":
      return debug_struct(f, "Custom", [
        ["kind", e.kind],
        ["error", debug_str(e.error)],
      ]);
    case "SimpleMessage":
      return debug_struct(f, "Error", [
        ["kind", e.kind],
        ["message", debug_str(e.message)],
      ]);
  }
};
