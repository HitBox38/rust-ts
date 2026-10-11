// Port of compiler/rustc_span/src/edit_distance/tests.rs
import { expect, test } from "bun:test";
import { from_u32 } from "../../std/char.ts";
import { Unported } from "../../std/panic.ts";
import { create_default_session_globals_then } from "../lib.ts";
import { Symbol } from "../symbol.ts";
import { edit_distance, edit_distance_with_substrings, find_best_match_for_name, usize_MAX } from "../edit_distance.ts";

// PORT: tests that need session globals (lane span-core) are skipped while
// `create_default_session_globals_then` is still unported; they run automatically afterwards.
const globals_unported = (() => {
  try {
    create_default_session_globals_then(() => {});
    return false;
  } catch (e) {
    if (e instanceof Unported) return true;
    throw e;
  }
})();

// rustc: compiler/rustc_span/src/edit_distance/tests.rs:6 test_edit_distance
test("test_edit_distance", () => {
  // Test bytelength agnosticity
  for (let i = 0; i < 0x10ffff; i++) {
    const ch = from_u32(i);
    if (ch === undefined) continue;
    const c = String.fromCodePoint(ch);
    if (edit_distance(c, c, usize_MAX) !== 0) expect(edit_distance(c, c, usize_MAX)).toBe(0);
  }

  const a = "\nMäry häd ä little lämb\n\nLittle lämb\n";
  const b = "\nMary häd ä little lämb\n\nLittle lämb\n";
  const c = "Mary häd ä little lämb\n\nLittle lämb\n";
  expect(edit_distance(a, b, usize_MAX)).toBe(1);
  expect(edit_distance(b, a, usize_MAX)).toBe(1);
  expect(edit_distance(a, c, usize_MAX)).toBe(2);
  expect(edit_distance(c, a, usize_MAX)).toBe(2);
  expect(edit_distance(b, c, usize_MAX)).toBe(1);
  expect(edit_distance(c, b, usize_MAX)).toBe(1);
});

// rustc: compiler/rustc_span/src/edit_distance/tests.rs:24 test_edit_distance_limit
test("test_edit_distance_limit", () => {
  expect(edit_distance("abc", "abcd", 1)).toBe(1);
  expect(edit_distance("abc", "abcd", 0)).toBe(undefined);
  expect(edit_distance("abc", "xyz", 3)).toBe(3);
  expect(edit_distance("abc", "xyz", 2)).toBe(undefined);
});

// rustc: compiler/rustc_span/src/edit_distance/tests.rs:32 test_method_name_similarity_score
test("test_method_name_similarity_score", () => {
  expect(edit_distance_with_substrings("empty", "is_empty", 1)).toBe(1);
  expect(edit_distance_with_substrings("shrunk", "rchunks", 2)).toBe(undefined);
  expect(edit_distance_with_substrings("abc", "abcd", 1)).toBe(1);
  expect(edit_distance_with_substrings("a", "abcd", 1)).toBe(undefined);
  expect(edit_distance_with_substrings("edf", "eq", 1)).toBe(undefined);
  expect(edit_distance_with_substrings("abc", "xyz", 3)).toBe(3);
  expect(edit_distance_with_substrings("abcdef", "abcdef", 2)).toBe(0);
});

// rustc: compiler/rustc_span/src/edit_distance/tests.rs:43 test_find_best_match_for_name
test.skipIf(globals_unported)("test_find_best_match_for_name", () => {
  create_default_session_globals_then(() => {
    let input = [Symbol.intern("aaab"), Symbol.intern("aaabc")];
    expect(find_best_match_for_name(input, Symbol.intern("aaaa"), undefined)).toBe(Symbol.intern("aaab"));

    expect(find_best_match_for_name(input, Symbol.intern("1111111111"), undefined)).toBe(undefined);

    input = [Symbol.intern("AAAA")];
    expect(find_best_match_for_name(input, Symbol.intern("aaaa"), undefined)).toBe(Symbol.intern("AAAA"));

    input = [Symbol.intern("AAAA")];
    expect(find_best_match_for_name(input, Symbol.intern("aaaa"), 4)).toBe(Symbol.intern("AAAA"));

    input = [Symbol.intern("a_longer_variable_name")];
    expect(find_best_match_for_name(input, Symbol.intern("a_variable_longer_name"), undefined)).toBe(
      Symbol.intern("a_longer_variable_name"),
    );
  });
});

// rustc: compiler/rustc_span/src/edit_distance/tests.rs:75 test_precise_algorithm
test("test_precise_algorithm", () => {
  // Not Levenshtein distance.
  expect(edit_distance("ab", "ba", usize_MAX)).not.toBe(2);
  // Not unrestricted Damerau-Levenshtein distance.
  expect(edit_distance("abde", "bcaed", usize_MAX)).not.toBe(3);
  // The current implementation is a restricted Damerau-Levenshtein distance.
  expect(edit_distance("abde", "bcaed", usize_MAX)).toBe(4);
});
