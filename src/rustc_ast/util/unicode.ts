// Port of compiler/rustc_ast/src/util/unicode.rs
import { utf8 } from "../../std/str.ts";

export const TEXT_FLOW_CONTROL_CHARS: readonly number[] = [
  0x202a, 0x202b, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x202c, 0x2069,
];

// rustc: compiler/rustc_ast/src/util/unicode.rs:7 contains_text_flow_control_chars
export function contains_text_flow_control_chars(s: string): boolean {
  // Char   - UTF-8
  // U+202A - E2 80 AA
  // U+202B - E2 80 AB
  // U+202C - E2 80 AC
  // U+202D - E2 80 AD
  // U+202E - E2 80 AE
  // U+2066 - E2 81 A6
  // U+2067 - E2 81 A7
  // U+2068 - E2 81 A8
  // U+2069 - E2 81 A9
  const bytes = utf8(s);
  let start = 0;
  for (;;) {
    // memchr::memchr(0xE2, bytes)
    const idx = bytes.indexOf(0xe2, start);
    if (idx !== -1) {
      // bytes are valid UTF-8 -> E2 must be followed by two bytes
      const b1 = bytes[idx + 1]!;
      const b2 = bytes[idx + 2]!;
      if ((b1 === 0x80 && b2 >= 0xaa && b2 <= 0xae) || (b1 === 0x81 && b2 >= 0xa6 && b2 <= 0xa9)) {
        return true;
      }
      start = idx + 3;
    } else {
      return false;
    }
  }
}
