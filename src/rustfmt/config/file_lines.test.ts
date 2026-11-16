// Port of the `#[cfg(test)] mod test` of src/tools/rustfmt/src/config/file_lines.rs:363 (lane rustfmt-contract-1).
import { expect, test } from "bun:test";
import { Unported } from "../../std/panic.ts";
import { install_serde_stubs } from "./serde_stubs.test_support.ts";

install_serde_stubs();
const { Range, FileLines, new_file_map, display_FileLines, FileLines_eq, clone_FileLines, debug_FileLines } = await import("./file_lines.ts");
await import("./mod.ts");

// rustc: src/tools/rustfmt/src/config/file_lines.rs:368 test_range_intersects
test("test_range_intersects", () => {
  expect(Range.new(1, 2).intersects(Range.new(1, 1))).toBe(true);
  expect(Range.new(1, 2).intersects(Range.new(2, 2))).toBe(true);
  expect(!Range.new(1, 2).intersects(Range.new(0, 0))).toBe(true);
  expect(!Range.new(1, 2).intersects(Range.new(3, 10))).toBe(true);
  expect(!Range.new(1, 3).intersects(Range.new(5, 5))).toBe(true);
});

// rustc: src/tools/rustfmt/src/config/file_lines.rs:377 test_range_adjacent_to
test("test_range_adjacent_to", () => {
  expect(!Range.new(1, 2).adjacent_to(Range.new(1, 1))).toBe(true);
  expect(!Range.new(1, 2).adjacent_to(Range.new(2, 2))).toBe(true);
  expect(Range.new(1, 2).adjacent_to(Range.new(0, 0))).toBe(true);
  expect(Range.new(1, 2).adjacent_to(Range.new(3, 10))).toBe(true);
  expect(!Range.new(1, 3).adjacent_to(Range.new(5, 5))).toBe(true);
});

// rustc: src/tools/rustfmt/src/config/file_lines.rs:386 test_range_contains
test("test_range_contains", () => {
  expect(Range.new(1, 2).contains(Range.new(1, 1))).toBe(true);
  expect(Range.new(1, 2).contains(Range.new(2, 2))).toBe(true);
  expect(!Range.new(1, 2).contains(Range.new(0, 0))).toBe(true);
  expect(!Range.new(1, 2).contains(Range.new(3, 10))).toBe(true);
});

// rustc: src/tools/rustfmt/src/config/file_lines.rs:394 test_range_merge
test("test_range_merge", () => {
  expect(Range.new(1, 3).merge(Range.new(5, 5))).toBeUndefined();
  expect(Range.new(4, 7).merge(Range.new(0, 1))).toBeUndefined();
  expect(Range.new(3, 5).merge(Range.new(4, 7))).toEqual(Range.new(3, 7));
  expect(Range.new(3, 5).merge(Range.new(5, 7))).toEqual(Range.new(3, 7));
  expect(Range.new(3, 5).merge(Range.new(6, 7))).toEqual(Range.new(3, 7));
  expect(Range.new(3, 7).merge(Range.new(4, 5))).toEqual(Range.new(3, 7));
});

// rustc: src/tools/rustfmt/src/config/file_lines.rs:420 file_lines_to_json
test("file_lines_to_json", () => {
  const ranges = new_file_map([
    [{ $: "Real", _0: "src/main.rs" }, [Range.new(1, 3), Range.new(5, 7)]],
    [{ $: "Real", _0: "src/lib.rs" }, [Range.new(1, 7)]],
  ]);

  const file_lines = FileLines.from_ranges(ranges);
  const spans = file_lines.to_json_spans();
  // PORT: `spans.sort()` (`JsonSpan: Ord`) and `json::to_value(&spans)` compared with `json! {[..]}` need serde_json, which
  // is not ported (plan-m8 D6); the spans are checked directly, the JSON step stops where serde_json would start.
  // `JsonSpan: Ord` on these spans: by file path, then range.
  const rows = spans.map((s) => [s.file, s.range] as const);
  rows.sort(([fa, ra], [fb, rb]) => (fa.$ === "Real" && fb.$ === "Real" && fa._0 !== fb._0 ? (fa._0 < fb._0 ? -1 : 1) : ra[0] - rb[0] || ra[1] - rb[1]));
  expect(rows).toEqual([
    [{ $: "Real", _0: "src/lib.rs" }, [1, 7]],
    [{ $: "Real", _0: "src/main.rs" }, [1, 3]],
    [{ $: "Real", _0: "src/main.rs" }, [5, 7]],
  ]);
  expect(() => FileLines.from_str("[]")).toThrow(Unported);
});

test("not upstream: FileLines normalize_ranges, Display, Debug, PartialEq, Clone (file_lines.rs:168, :184)", () => {
  const fl = FileLines.from_ranges(new_file_map([[{ $: "Real", _0: "a.rs" }, [Range.new(5, 7), Range.new(1, 3), Range.new(4, 4), Range.new(10, 9)]]]));
  // sorted (`Range: Ord`: lo, then hi), adjacent and overlapping ranges merged; the empty `10..9` neither merges nor is dropped
  expect(display_FileLines(fl)).toBe("a.rs: 1..7, 10..9\n");
  expect(display_FileLines(FileLines.all())).toBe("None");
  expect(debug_FileLines(FileLines.all(), { alternate: false })).toBe("FileLines(None)");
  expect(debug_FileLines(fl, { alternate: false })).toBe('FileLines(Some({Real("a.rs"): [Range { lo: 1, hi: 7 }, Range { lo: 10, hi: 9 }]}))');
  expect(FileLines_eq(fl, clone_FileLines(fl))).toBe(true);
  expect(FileLines_eq(fl, FileLines.all())).toBe(false);
  // `FileName` keys compare as paths (component-wise): `a.rs` and `./a.rs` differ, `x//a.rs` and `x/a.rs` are one key
  const m = new_file_map([[{ $: "Real", _0: "x//a.rs" }, [Range.new(1, 1)]]]);
  expect(m.get({ $: "Real", _0: "x/a.rs" })).toEqual([Range.new(1, 1)]);
  expect(m.get({ $: "Stdin" })).toBeUndefined();
  expect(fl.is_all()).toBe(false);
  expect(FileLines.all().contains_line({ $: "Stdin" }, 3)).toBe(true);
});
