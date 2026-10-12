// rust-ts: io::Error Debug/Display against the oracle (rustc 1.101.0-nightly 6f5da406b, scratch
// program: `io::Error::other(..)` and the `read_to_string` invalid-UTF-8 error).
import { expect, test } from "bun:test";
import { PLAIN, PRETTY } from "./fmt.ts";
import { debug_IoError, display_IoError, INVALID_UTF8, io_error_other } from "./io.ts";

test("Custom and SimpleMessage io::Error Debug/Display", () => {
  const other = io_error_other("text files larger than 5 bytes are unsupported");
  expect(debug_IoError(other, PLAIN)).toBe('Custom { kind: Other, error: "text files larger than 5 bytes are unsupported" }');
  expect(display_IoError(other)).toBe("text files larger than 5 bytes are unsupported");
  expect(debug_IoError(INVALID_UTF8, PLAIN)).toBe('Error { kind: InvalidData, message: "stream did not contain valid UTF-8" }');
  expect(display_IoError(INVALID_UTF8)).toBe("stream did not contain valid UTF-8");
  expect(debug_IoError(INVALID_UTF8, PRETTY)).toBe('Error {\n    kind: InvalidData,\n    message: "stream did not contain valid UTF-8",\n}');
});
