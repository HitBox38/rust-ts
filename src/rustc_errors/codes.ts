//! This module defines the following.
//! - The `ErrCode` type.
//! - A constant for every error code, with a name like `E0123`.
//! - A static table `DIAGNOSTICS` pairing every error code constant with its
//!   long description text.
// Port of compiler/rustc_errors/src/codes.rs. `ErrCode` (newtype_index!) and `InvalidErrorCode` are
// generated into codes.gen.ts; the `E<nnnn>` constants into error_codes.gen.ts
// (tools/codegen/error_codes.ts, from `rustc_error_codes::error_codes!`).
import { into_diag_arg_using_display } from "../rustc_error_messages/lib.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { ErrCode, type InvalidErrorCode as InvalidErrorCode_ } from "./codes.gen.ts";
import { ERROR_CODES } from "./error_codes.gen.ts";

export * from "./codes.gen.ts";
export * from "./error_codes.gen.ts";

/** `impl fmt::Display for ErrCode` */
// rustc: compiler/rustc_errors/src/codes.rs:21 fmt
export function display_ErrCode(self: ErrCode): string {
  // write!(f, "E{:04}", self.as_u32())
  return "E" + String(ErrCode.as_u32(self)).padStart(4, "0");
}

/** `rustc_error_messages::into_diag_arg_using_display!(ErrCode);` */
export const ErrCode_into_diag_arg = into_diag_arg_using_display<ErrCode>(display_ErrCode);

/**
 * PORT: the long description of an error code (`include_str!("../../rustc_error_codes/src/error_codes/E<n>.md")`). The 418,411
 * bytes of Markdown are in error_codes_text.gen.ts (tools/codegen/error_codes.ts), loaded with a synchronous `require` the first
 * time a text is read, so a compile that reads none neither parses nor evaluates them. `import()` is not an option here: `text()`
 * is synchronous, as upstream's `&'static str` is.
 */
export class ErrCodeDescription {
  constructor(readonly code: ErrCode) {}

  text(): string {
    const { ERROR_CODE_TEXT } = require("./error_codes_text.gen.ts") as typeof import("./error_codes_text.gen.ts");
    return ERROR_CODE_TEXT[ErrCode.as_u32(this.code)]!;
  }
}

// static DIAGNOSTICS: LazyLock<FxHashMap<ErrCode, &'static str>>
let DIAGNOSTICS: Map<ErrCode, ErrCodeDescription> | undefined;

function diagnostics(): Map<ErrCode, ErrCodeDescription> {
  if (DIAGNOSTICS === undefined) {
    DIAGNOSTICS = new Map(ERROR_CODES.map((code) => [code, new ErrCodeDescription(code)]));
  }
  return DIAGNOSTICS;
}

/** `#[derive(Debug)] pub struct InvalidErrorCode;` */
export type InvalidErrorCode = InvalidErrorCode_;
export const InvalidErrorCode: InvalidErrorCode = {};

/// Returns `InvalidErrorCode` if the code requested does not exist.
// rustc: compiler/rustc_errors/src/codes.rs:55 try_find_description
export function try_find_description(code: ErrCode): Result<ErrCodeDescription, InvalidErrorCode> {
  const d = diagnostics().get(code);
  return d !== undefined ? Ok(d) : Err(InvalidErrorCode);
}
