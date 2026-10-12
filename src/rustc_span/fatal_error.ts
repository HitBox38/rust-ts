import { Err, Ok, type Result } from "../std/result.ts";

// PORT: `rustc_data_structures::FatalErrorMarker` (a unit struct used as the unwind payload) is not
// ported yet; it is defined here so `raise`/`catch_fatal_errors` can be ported. Root: move it to
// `src/rustc_data_structures/lib.ts` when that crate lands and re-export it here (upstream does
// `pub use rustc_data_structures::FatalErrorMarker;`).
export class FatalErrorMarker {}

/// Used as a return value to signify a fatal error occurred.
export class FatalError {
  // rustc: compiler/rustc_span/src/fatal_error.rs:15 raise
  raise(): never {
    // PORT: `std::panic::resume_unwind(Box::new(FatalErrorMarker))` -> throw the marker.
    throw new FatalErrorMarker();
  }
}

export const debug_FatalError = (_v: FatalError): string => "FatalError";

// rustc: compiler/rustc_span/src/fatal_error.rs:21 fmt
/** `impl Display for FatalError` */
export function display_FatalError(_self: FatalError): string {
  return `fatal error`;
}

/// Runs a closure and catches unwinds triggered by fatal errors.
///
/// The compiler currently unwinds with a special sentinel value to abort
/// compilation on fatal errors. This function catches that sentinel and turns
/// the panic into a `Result` instead.
// rustc: compiler/rustc_span/src/fatal_error.rs:33 catch_fatal_errors
export function catch_fatal_errors<R>(f: () => R): Result<R, FatalError> {
  try {
    return Ok(f());
  } catch (value) {
    if (value instanceof FatalErrorMarker) {
      return Err(new FatalError());
    } else {
      throw value;
    }
  }
}
