// Port of the `#[cfg(test)] mod test` in annotate-snippets =0.12.16 `src/renderer/render.rs`.
// PORT: `snapbox::assert_data_eq!(actual, expected.into_data().raw())` → `expect(actual).toBe(expected)`.
import { expect, test } from "bun:test";
import { debug_char, debug_str, debug_tuple, PLAIN } from "../../../std/fmt.ts";
import { Str } from "../../../std/str.ts";
import { newline_count, OUTPUT_REPLACEMENTS_for_test as OUTPUT_REPLACEMENTS } from "./render.ts";

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:2728 format_replacements
function format_replacements(replacements: (readonly [number, string])[]): string {
  return replacements.map((r) => `    ${debug_tuple(PLAIN, "", [debug_char(r[0]), debug_str(r[1])])}`).join("\n");
}

/// The [`OUTPUT_REPLACEMENTS`] array must be sorted (for binary search to
/// work) and must contain no duplicate entries
// crate: annotate-snippets-0.12.16/src/renderer/render.rs:2739 ensure_output_replacements_is_sorted
test("ensure_output_replacements_is_sorted", () => {
  const expected_ = OUTPUT_REPLACEMENTS.slice();
  expected_.sort((a, b) => a[0] - b[0]); // sort_by_key(|r| r.0)
  const deduped = expected_.filter((r, i) => i === 0 || expected_[i - 1]![0] !== r[0]); // dedup_by_key(|r| r.0)
  const expected = format_replacements(deduped);
  const actual = format_replacements(OUTPUT_REPLACEMENTS.slice());
  expect(actual).toBe(expected);
  expect(actual.split("\n")[0]).toBe(`    ('\\0', "␀")`);
});

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:2749 ensure_newline_count_correct
test("ensure_newline_count_correct", () => {
  const source = Str.from(`
                cargo-features = ["path-bases"]

                [package]
                name = "foo"
                version = "0.5.0"
                authors = ["wycats@example.com"]

                [dependencies]
                bar = { base = '^^not-valid^^', path = 'bar' }
            `);
  const actual_count = newline_count(source);
  const expected_count = 10;

  expect(actual_count).toBe(expected_count);
});
