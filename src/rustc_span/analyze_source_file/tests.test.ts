// Port of compiler/rustc_span/src/analyze_source_file/tests.rs
import { expect, test } from "bun:test";
import { Str } from "../../std/str.ts";
import { analyze_source_file } from "../analyze_source_file.ts";
import { RelativeBytePos, type MultiByteChar } from "../lib.ts";

// PORT: the `test!` macro_rules -> a helper registering one `bun:test` case per invocation.
function test_(test_name: string, text: string, lines_: number[], multi_byte_chars_: [number, number][]): void {
  test(test_name, () => {
    const [lines, multi_byte_chars] = analyze_source_file(Str.from(text));

    const expected_lines: RelativeBytePos[] = lines_.map((n) => RelativeBytePos(n));

    expect(lines).toEqual(expected_lines);

    const expected_mbcs: MultiByteChar[] = multi_byte_chars_.map(([pos, bytes]) => ({ pos: RelativeBytePos(pos), bytes }));

    expect(multi_byte_chars).toEqual(expected_mbcs);
  });
}

test_("empty_text", "", [], []);

test_("newlines_short", "a\nc", [0, 2], []);

test_("newlines_long", "012345678\nabcdef012345678\na", [0, 10, 26], []);

test_("newline_and_multi_byte_char_in_same_chunk", "01234β789\nbcdef0123456789abcdef", [0, 11], [[5, 2]]);

test_("newline_and_control_char_in_same_chunk", "01234\u{07}6789\nbcdef0123456789abcdef", [0, 11], []);

test_("multi_byte_char_short", "aβc", [0], [[1, 2]]);

test_("multi_byte_char_long", "0123456789abcΔf012345β", [0], [
  [13, 2],
  [22, 2],
]);

test_("multi_byte_char_across_chunk_boundary", "0123456789abcdeΔ123456789abcdef01234", [0], [[15, 2]]);

test_("multi_byte_char_across_chunk_boundary_tail", "0123456789abcdeΔ....", [0], [[15, 2]]);

test_("non_narrow_short", "0\t2", [0], []);

test_("non_narrow_long", "01\t3456789abcdef01234567\u{07}9", [0], []);

test_("output_offset_all", "01\t345\n789abcΔf01234567\u{07}9\nbcΔf", [0, 7, 27], [
  [13, 2],
  [29, 2],
]);
