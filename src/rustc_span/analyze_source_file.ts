import { assert } from "../std/panic.ts";
import { utf8_width, type Str } from "../std/str.ts";
import { RelativeBytePos, type MultiByteChar } from "./lib.ts";

/// Finds all newlines, multi-byte characters, and non-narrow characters in a
/// SourceFile.
///
/// This function will use an SSE2 enhanced implementation if hardware support
/// is detected at runtime.
// rustc: compiler/rustc_span/src/analyze_source_file.rs:11 analyze_source_file
export function analyze_source_file(src: Str): [RelativeBytePos[], MultiByteChar[]] {
  const lines: RelativeBytePos[] = [RelativeBytePos.from_u32(0)];
  const multi_byte_chars: MultiByteChar[] = [];

  // Calls the right implementation, depending on hardware support available.
  analyze_source_file_dispatch(src, lines, multi_byte_chars);

  // The code above optimistically registers a new line *after* each \n
  // it encounters. If that point is already outside the source_file, remove
  // it again.
  const last_line_start = lines[lines.length - 1];
  if (last_line_start !== undefined) {
    const source_file_end = RelativeBytePos.from_usize(src.len());
    assert(source_file_end >= last_line_start, "assertion failed: source_file_end >= last_line_start");
    if (last_line_start === source_file_end) {
      lines.pop();
    }
  }

  return [lines, multi_byte_chars];
}

// PORT: `cfg_select!` picks an SSE2 (x86) or LSX (loongarch64) implementation when available.
// Both scan 16-byte chunks, record newlines of all-ASCII chunks directly and hand every other
// chunk to `analyze_source_file_generic`; they produce exactly the generic scan's output, so
// rust-ts always takes the portable `_ =>` arm.
// rustc-skip: compiler/rustc_span/src/analyze_source_file.rs:34 analyze_source_file_dispatch SIMD dispatch (x86); equivalent to the generic arm, see PORT above
// rustc-skip: compiler/rustc_span/src/analyze_source_file.rs:59 analyze_source_file_sse2 SIMD fast path; output identical to analyze_source_file_generic, see PORT above
// rustc-skip: compiler/rustc_span/src/analyze_source_file.rs:136 analyze_source_file_dispatch SIMD dispatch (loongarch64); equivalent to the generic arm, see PORT above
// rustc-skip: compiler/rustc_span/src/analyze_source_file.rs:163 analyze_source_file_lsx SIMD fast path; output identical to analyze_source_file_generic, see PORT above

// The target (or compiler version) does not support vector instructions
// our specialized implementations need (x86 SSE2, loongarch64 LSX)...
// rustc: compiler/rustc_span/src/analyze_source_file.rs:240 analyze_source_file_dispatch
function analyze_source_file_dispatch(src: Str, lines: RelativeBytePos[], multi_byte_chars: MultiByteChar[]): void {
  analyze_source_file_generic(src, src.len(), RelativeBytePos.from_u32(0), lines, multi_byte_chars);
}

// `scan_len` determines the number of bytes in `src` to scan. Note that the
// function can read past `scan_len` if a multi-byte character start within the
// range but extends past it. The overflow is returned by the function.
// rustc: compiler/rustc_span/src/analyze_source_file.rs:259 analyze_source_file_generic
function analyze_source_file_generic(
  src: Str,
  scan_len: number,
  output_offset: RelativeBytePos,
  lines: RelativeBytePos[],
  multi_byte_chars: MultiByteChar[],
): number {
  assert(src.len() >= scan_len, "assertion failed: src.len() >= scan_len");
  let i = 0;
  const src_bytes = src.b;
  const base = src.lo;

  while (i < scan_len) {
    // We verified that i < scan_len <= src.len()
    const byte = src_bytes[base + i]!;

    // How much to advance in order to get to the next UTF-8 char in the
    // string.
    let char_len = 1;

    if (byte === 0x0a) {
      const pos = RelativeBytePos.add(RelativeBytePos.from_usize(i), output_offset);
      lines.push(RelativeBytePos.add(pos, RelativeBytePos(1)));
    } else if (byte >= 128) {
      // This is the beginning of a multibyte char. Just decode to `char`.
      // PORT: `src[i..].chars().next().unwrap().len_utf8()` == the UTF-8 sequence width of the
      // lead byte (`src` is valid UTF-8).
      char_len = utf8_width(byte);

      const pos = RelativeBytePos.add(RelativeBytePos.from_usize(i), output_offset);
      assert(char_len >= 2 && char_len <= 4, "assertion failed: (2..=4).contains(&char_len)");
      const mbc: MultiByteChar = { pos, bytes: char_len };
      multi_byte_chars.push(mbc);
    }

    i += char_len;
  }

  return i - scan_len;
}
