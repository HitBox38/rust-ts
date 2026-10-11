//! Edit distances.
//!
//! The [edit distance] is a metric for measuring the difference between two strings.
//!
//! [edit distance]: https://en.wikipedia.org/wiki/Edit_distance

// The current implementation is the restricted Damerau-Levenshtein algorithm. It is restricted
// because it does not permit modifying characters that have already been transposed. The specific
// algorithm should not matter to the caller of the methods, which is why it is not noted in the
// documentation.

import { unwrap } from "../std/panic.ts";
import { utf8_len } from "../std/str.ts";
import { Symbol } from "./symbol.ts";

// PORT: `usize::MAX` → the largest exactly representable integer; only used as "no limit".
export const usize_MAX = Number.MAX_SAFE_INTEGER;

/** `s.chars().collect::<Vec<_>>()` */
function chars(s: string): Uint32Array {
  return Uint32Array.from(s, (c) => c.codePointAt(0)!);
}

/** `s.chars().count()` */
function chars_count(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (!(c >= 0xdc00 && c <= 0xdfff)) n++;
  }
  return n;
}

/// Finds the [edit distance] between two strings.
///
/// Returns `None` if the distance exceeds the limit.
///
/// [edit distance]: https://en.wikipedia.org/wiki/Edit_distance
// rustc: compiler/rustc_span/src/edit_distance.rs:24 edit_distance
export function edit_distance(a_: string, b_: string, limit: number): number | undefined {
  let a = chars(a_);
  let b = chars(b_);

  // Ensure that `b` is the shorter string, minimizing memory use.
  if (a.length < b.length) {
    [a, b] = [b, a];
  }

  const min_dist = a.length - b.length;
  // If we know the limit will be exceeded, we can return early.
  if (min_dist > limit) {
    return undefined;
  }

  // Strip common prefix.
  while (b.length > 0 && a.length > 0 && a[0] === b[0]) {
    a = a.subarray(1);
    b = b.subarray(1);
  }
  // Strip common suffix.
  while (b.length > 0 && a.length > 0 && a[a.length - 1] === b[b.length - 1]) {
    a = a.subarray(0, a.length - 1);
    b = b.subarray(0, b.length - 1);
  }

  // If either string is empty, the distance is the length of the other.
  // We know that `b` is the shorter string, so we don't need to check `a`.
  if (b.length === 0) {
    return min_dist;
  }

  let prev_prev: number[] = new Array(b.length + 1).fill(usize_MAX);
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current: number[] = new Array(b.length + 1).fill(0);

  // row by row
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    const a_idx = i - 1;

    // column by column
    for (let j = 1; j <= b.length; j++) {
      const b_idx = j - 1;

      // There is no cost to substitute a character with itself.
      const substitution_cost = a[a_idx] === b[b_idx] ? 0 : 1;

      current[j] = Math.min(
        // deletion
        prev[j]! + 1,
        Math.min(
          // insertion
          current[j - 1]! + 1,
          // substitution
          prev[j - 1]! + substitution_cost,
        ),
      );

      if (i > 1 && j > 1 && a[a_idx] === b[b_idx - 1] && a[a_idx - 1] === b[b_idx]) {
        // transposition
        current[j] = Math.min(current[j]!, prev_prev[j - 2]! + 1);
      }
    }

    // Rotate the buffers, reusing the memory.
    [prev_prev, prev, current] = [prev, current, prev_prev];
  }

  // `prev` because we already rotated the buffers.
  const distance = prev[b.length]!;
  return distance <= limit ? distance : undefined;
}

/// Provides a word similarity score between two words that accounts for substrings being more
/// meaningful than a typical edit distance. The lower the score, the closer the match. 0 is an
/// identical match.
///
/// Uses the edit distance between the two strings and removes the cost of the length difference.
/// If this is 0 then it is either a substring match or a full word match, in the substring match
/// case we detect this and return `1`. To prevent finding meaningless substrings, eg. "in" in
/// "shrink", we only perform this subtraction of length difference if one of the words is not
/// greater than twice the length of the other. For cases where the words are close in size but not
/// an exact substring then the cost of the length difference is discounted by half.
///
/// Returns `None` if the distance exceeds the limit.
// rustc: compiler/rustc_span/src/edit_distance.rs:114 edit_distance_with_substrings
export function edit_distance_with_substrings(a: string, b: string, limit: number): number | undefined {
  const n = chars_count(a);
  const m = chars_count(b);

  // Check one isn't less than half the length of the other. If this is true then there is a
  // big difference in length.
  const big_len_diff = n * 2 < m || m * 2 < n;
  const len_diff = Math.abs(m - n);
  const distance = edit_distance(a, b, limit + len_diff);
  if (distance === undefined) return undefined;

  // This is the crux, subtracting length difference means exact substring matches will now be 0
  let score = distance - len_diff;

  // If the score is 0 but the words have different lengths then it's a substring match not a full
  // word match
  if (score === 0 && len_diff > 0 && !big_len_diff) {
    score = 1; // Exact substring match, but not a total word match so return non-zero
  } else if (!big_len_diff) {
    // Not a big difference in length, discount cost of length difference
    score = score + Math.ceil(len_diff / 2);
  } else {
    // A big difference in length, add back the difference in length to the score
    score = score + len_diff;
  }

  return score <= limit ? score : undefined;
}

/// Finds the best match for given word in the given iterator where substrings are meaningful.
///
/// A version of [`find_best_match_for_name`] that uses [`edit_distance_with_substrings`] as the
/// score for word similarity. This takes an optional distance limit which defaults to one-third of
/// the given word.
///
/// We use case insensitive comparison to improve accuracy on an edge case with a lower(upper)case
/// letters mismatch.
// rustc: compiler/rustc_span/src/edit_distance.rs:150 find_best_match_for_name_with_substrings
export function find_best_match_for_name_with_substrings(
  candidates: readonly Symbol[],
  lookup: Symbol,
  dist: number | undefined,
): Symbol | undefined {
  return find_best_match_for_name_impl(true, candidates, lookup, dist);
}

/// Finds the best match for a given word in the given iterator.
///
/// As a loose rule to avoid the obviously incorrect suggestions, it takes
/// an optional limit for the maximum allowable edit distance, which defaults
/// to one-third of the given word.
///
/// We use case insensitive comparison to improve accuracy on an edge case with a lower(upper)case
/// letters mismatch.
// rustc: compiler/rustc_span/src/edit_distance.rs:166 find_best_match_for_name
export function find_best_match_for_name(
  candidates: readonly Symbol[],
  lookup: Symbol,
  dist: number | undefined,
): Symbol | undefined {
  return find_best_match_for_name_impl(false, candidates, lookup, dist);
}

/// Find the best match for multiple words
///
/// This function is intended for use when the desired match would never be
/// returned due to a substring in `lookup` which is superfluous.
///
/// For example, when looking for the closest lint name to `clippy:missing_docs`,
/// we would find `clippy::erasing_op`, despite `missing_docs` existing and being a better suggestion.
/// `missing_docs` would have a larger edit distance because it does not contain the `clippy` tool prefix.
/// In order to find `missing_docs`, this function takes multiple lookup strings, computes the best match
/// for each and returns the match which had the lowest edit distance. In our example, `clippy:missing_docs` and
/// `missing_docs` would be `lookups`, enabling `missing_docs` to be the best match, as desired.
// rustc: compiler/rustc_span/src/edit_distance.rs:185 find_best_match_for_names
export function find_best_match_for_names(
  candidates: readonly Symbol[],
  lookups: readonly Symbol[],
  dist: number | undefined,
): Symbol | undefined {
  // `.min_by(..)` returns the first of several equally minimal elements.
  let best: [Symbol, Symbol, number] | undefined;
  for (const s of lookups) {
    const r = find_best_match_for_name_impl(false, candidates, s, dist);
    if (r === undefined) continue;
    const d = unwrap(edit_distance(Symbol.as_str(s), Symbol.as_str(r), usize_MAX));
    if (best === undefined || d < best[2]) best = [s, r, d];
  }
  return best?.[1];
}

// PORT: `str::to_uppercase` → `String.prototype.toUpperCase` (both locale-independent full
// Unicode case mapping; the JS engine's Unicode version may differ from core's).
// rustc: compiler/rustc_span/src/edit_distance.rs:203 find_best_match_for_name_impl
function find_best_match_for_name_impl(
  use_substring_score: boolean,
  candidates: readonly Symbol[],
  lookup_symbol: Symbol,
  dist: number | undefined,
): Symbol | undefined {
  const lookup = Symbol.as_str(lookup_symbol);
  const lookup_uppercase = lookup.toUpperCase();

  // Priority of matches:
  // 1. Exact case insensitive match
  // 2. Edit distance match
  // 3. Sorted word match
  const c0 = candidates.find((c) => Symbol.as_str(c).toUpperCase() === lookup_uppercase);
  if (c0 !== undefined) {
    return c0;
  }

  // `fn edit_distance()` use `chars()` to calculate edit distance, so we must
  // also use `chars()` (and not `str::len()`) to calculate length here.
  const lookup_len = chars_count(lookup);

  let dist_ = dist !== undefined ? dist : Math.floor(Math.max(lookup_len, 3) / 3);
  let best: Symbol | undefined = undefined;
  // store the candidates with the same distance, only for `use_substring_score` current.
  let next_candidates: Symbol[] = [];
  for (const c of candidates) {
    const d = use_substring_score
      ? edit_distance_with_substrings(lookup, Symbol.as_str(c), dist_)
      : edit_distance(lookup, Symbol.as_str(c), dist_);
    if (d === 0) {
      return c;
    } else if (d !== undefined) {
      if (use_substring_score) {
        if (d < dist_) {
          dist_ = d;
          next_candidates = [];
        } else {
          // `d == dist` here, we need to store the candidates with the same distance
          // so we won't decrease the distance in the next loop.
        }
        next_candidates.push(c);
      } else {
        dist_ = d - 1;
      }
      best = c;
    }
  }

  // We have a tie among several candidates, try to select the best among them ignoring substrings.
  // For example, the candidates list `force_capture`, `capture`, and user inputted `forced_capture`,
  // we select `force_capture` with a extra round of edit distance calculation.
  if (next_candidates.length > 1) {
    // debug_assert!(use_substring_score);
    best = find_best_match_for_name_impl(false, next_candidates, lookup_symbol, utf8_len(lookup));
  }
  if (best !== undefined) {
    return best;
  }

  return find_match_by_sorted_words(candidates, lookup);
}

// rustc: compiler/rustc_span/src/edit_distance.rs:273 find_match_by_sorted_words
function find_match_by_sorted_words(iter_names: readonly Symbol[], lookup: string): Symbol | undefined {
  const lookup_sorted_by_words = sort_by_words(lookup);
  let result: Symbol | undefined = undefined;
  for (const candidate of iter_names) {
    const words = sort_by_words(Symbol.as_str(candidate));
    if (words.length === lookup_sorted_by_words.length && words.every((w, i) => w === lookup_sorted_by_words[i])) {
      result = candidate;
    }
  }
  return result;
}

// rustc: compiler/rustc_span/src/edit_distance.rs:284 sort_by_words
function sort_by_words(name: string): string[] {
  const split_words: string[] = name.split("_");
  // We are sorting primitive &strs and can use unstable sort here.
  // PORT: JS sorts by UTF-16 code units, not bytes; the result is only compared for equality
  // with another sorted list, for which any total order gives the same answer.
  split_words.sort();
  return split_words;
}
