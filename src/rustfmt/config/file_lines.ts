// Port of src/tools/rustfmt/src/config/file_lines.rs (lane rustfmt-contract-1).
//! This module contains types and functions to support formatting specific line ranges.
// `FileName`, `Range` and `JsonSpan` with their derives are generated into file_lines.gen.ts (tools/codegen/rustfmt.ts);
// `FileLines` is hand-written here (its map is keyed by `FileName` values: codegen-fmt-serde PORT #7), with the manual
// impls of all four types.
import { FileName, JsonSpan, Range, clone_FileName, clone_Range, debug_FileName, debug_Range } from "./file_lines.gen.ts";
import type { FileName as rustc_span_FileName, SourceFile } from "../../rustc_span/lib.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { clone_HashMap, debug_HashMap } from "../../rust_ts/hash_map.ts";
import { type Debug, debug_option, debug_tuple, debug_vec } from "../../std/fmt.ts";
import { canonicalize } from "../../std/fs.ts";
import { path_components } from "../../std/path.ts";
import { panic, unported, unreachable } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { deserialize_String } from "../../vendor/serde_core/de/impls.ts";
import type { Deserializer } from "../../vendor/serde_core/de/mod.ts";
import type { Serializer } from "../../vendor/serde_core/ser/mod.ts";

export * from "./file_lines.gen.ts";

/// A range of lines in a file, inclusive of both ends.
export class LineRange {
  constructor(
    public file: SourceFile,
    public lo: number,
    public hi: number,
  ) {}

  // rustc: src/tools/rustfmt/src/config/file_lines.rs:86 file_name
  file_name(): FileName {
    return FileName_from(this.file.name);
  }
}

// `impl From<rustc_span::FileName> for FileName`
// rustc: src/tools/rustfmt/src/config/file_lines.rs:29 from
export function FileName_from(name: rustc_span_FileName): FileName {
  switch (name.$) {
    case "Real": {
      const p = name._0.into_local_path();
      if (p !== undefined) {
        return { $: "Real", _0: p };
      } else {
        // rustfmt does not remap filenames; the local path should always
        // remain accessible.
        return unreachable();
      }
    }
    case "Custom":
      if (name._0 === "stdin") return FileName.Stdin;
      return unreachable();
    default:
      return unreachable();
  }
}

// rustc: src/tools/rustfmt/src/config/file_lines.rs:47 fmt
export function display_FileName(self: FileName): string {
  switch (self.$) {
    // PORT: `p.display()` of a path held as a JS string is the string.
    case "Real":
      return self._0;
    case "Stdin":
      return "<stdin>";
  }
}

// rustc: src/tools/rustfmt/src/config/file_lines.rs:56 deserialize
export function deserialize_FileName<E>(deserializer: Deserializer<E>): Result<FileName, E> {
  const s = deserialize_String(deserializer);
  if (s.$ === "Err") return s;
  if (s._0 === "stdin") {
    return Ok(FileName.Stdin);
  } else {
    return Ok({ $: "Real", _0: s._0 });
  }
}

// rustc: src/tools/rustfmt/src/config/file_lines.rs:70 serialize
export function serialize_FileName<O, E>(self: FileName, serializer: Serializer<O, E>): Result<O, E> {
  // PORT: `path.to_str()` is `None` only for a non-UTF-8 path, which a JS string path cannot hold, so the
  // `ser::Error::custom("path can't be serialized as UTF-8 string")` arm is never taken (the `Result` is kept).
  const s = (self.$ === "Stdin" ? Ok("stdin") : Ok(self._0)) as Result<string, E>;

  if (s.$ === "Err") return s;
  return serializer.serialize_str(s._0);
}

/** `#[derive(PartialEq, Eq, Hash)]` of `FileName` as a map key: `PathBuf`'s `Eq`/`Hash` compare components.
 *  PORT: a canonical string for `KeyedMap` (equal exactly when the `FileName`s are `==`). */
export function key_FileName(f: FileName): string {
  if (f.$ === "Stdin") return "S";
  const c = path_components(f._0);
  let k = "R";
  for (let x = c.next(); x !== undefined; x = c.next()) {
    k += "\0" + x.$ + (x.$ === "Normal" ? ":" + x._0 : x.$ === "Prefix" ? ":" + x.raw : "");
  }
  return k;
}

/** `#[derive(PartialEq)]` of `FileName`. */
export function FileName_eq(a: FileName, b: FileName): boolean {
  return key_FileName(a) === key_FileName(b);
}

declare module "./file_lines.gen.ts" {
  interface Range {
    is_empty(): boolean;
    contains(other: Range): boolean;
    intersects(other: Range): boolean;
    adjacent_to(other: Range): boolean;
    merge(other: Range): Range | undefined;
  }
  namespace Range {
    function new_(lo: number, hi: number): Range;
    export { new_ as new };
  }
  interface JsonSpan {
    into_tuple(): Result<[FileName, Range], FileLinesError>;
  }
}

// `impl<'a> From<&'a LineRange> for Range`
// rustc: src/tools/rustfmt/src/config/file_lines.rs:99 from
export function Range_from(range: LineRange): Range {
  return Range.new(range.lo, range.hi);
}

// rustc: src/tools/rustfmt/src/config/file_lines.rs:105 fmt
export function display_Range(self: Range): string {
  return `${self.lo}..${self.hi}`;
}

Object.assign(Range, {
  // rustc: src/tools/rustfmt/src/config/file_lines.rs:111 new
  new(lo: number, hi: number): Range {
    return new Range(lo, hi);
  },
});

// rustc: src/tools/rustfmt/src/config/file_lines.rs:115 is_empty
Range.prototype.is_empty = function (this: Range): boolean {
  return this.lo > this.hi;
};

// rustc: src/tools/rustfmt/src/config/file_lines.rs:120 contains
Range.prototype.contains = function (this: Range, other: Range): boolean {
  if (other.is_empty()) {
    return true;
  } else {
    return !this.is_empty() && this.lo <= other.lo && this.hi >= other.hi;
  }
};

// rustc: src/tools/rustfmt/src/config/file_lines.rs:128 intersects
Range.prototype.intersects = function (this: Range, other: Range): boolean {
  if (this.is_empty() || other.is_empty()) {
    return false;
  } else {
    return (this.lo <= other.hi && other.hi <= this.hi) || (other.lo <= this.hi && this.hi <= other.hi);
  }
};

// rustc: src/tools/rustfmt/src/config/file_lines.rs:137 adjacent_to
Range.prototype.adjacent_to = function (this: Range, other: Range): boolean {
  if (this.is_empty() || other.is_empty()) {
    return false;
  } else {
    return this.hi + 1 === other.lo || other.hi + 1 === this.lo;
  }
};

/// Returns a new `Range` with lines from `self` and `other` if they were adjacent or
/// intersect; returns `None` otherwise.
// rustc: src/tools/rustfmt/src/config/file_lines.rs:147 merge
Range.prototype.merge = function (this: Range, other: Range): Range | undefined {
  if (this.adjacent_to(other) || this.intersects(other)) {
    return Range.new(Math.min(this.lo, other.lo), Math.max(this.hi, other.hi));
  } else {
    return undefined;
  }
};

/** `#[derive(PartialEq)]` of `Range`. */
export function Range_eq(a: Range, b: Range): boolean {
  return a.lo === b.lo && a.hi === b.hi;
}

/** `#[derive(Ord)]` of `Range`: `lo`, then `hi`. */
export function Range_cmp(a: Range, b: Range): number {
  if (a.lo !== b.lo) return a.lo < b.lo ? -1 : 1;
  if (a.hi !== b.hi) return a.hi < b.hi ? -1 : 1;
  return 0;
}

// PORT: upstream has the `FileLines` struct (file_lines.rs:165), then these two (:168, :184), then its impl (:205); the struct
// and the impl are one class here, after them.
// rustc: src/tools/rustfmt/src/config/file_lines.rs:168 fmt
export function display_FileLines(self: FileLines): string {
  let f = "";
  const m = self._0;
  if (m === undefined) {
    f += "None";
  } else {
    for (const [file_name, ranges] of m) {
      f += `${display_FileName(file_name)}: `;
      // `ranges.iter().format(", ")` (itertools)
      f += `${ranges.map(display_Range).join(", ")}\n`;
    }
  }
  return f;
}

/// Normalizes the ranges so that the invariants for `FileLines` hold: ranges are non-overlapping,
/// and ordered by their start point.
// rustc: src/tools/rustfmt/src/config/file_lines.rs:184 normalize_ranges
function normalize_ranges(ranges: KeyedMap<FileName, Range[]>): void {
  for (const [key, ranges_] of ranges) {
    ranges_.sort(Range_cmp);
    const result: Range[] = [];
    let i = 0;
    while (i < ranges_.length) {
      let next = ranges_[i++]!;
      while (i < ranges_.length) {
        const peek = ranges_[i]!;
        const merged = next.merge(peek);
        if (merged !== undefined) {
          i++;
          next = merged;
        } else {
          break;
        }
      }
      result.push(next);
    }
    ranges.set(key, result);
  }
}

/// A set of lines in files.
///
/// It is represented as a multimap keyed on file names, with values a collection of
/// non-overlapping ranges sorted by their start point. An inner `None` is interpreted to mean all
/// lines in all files.
// PORT: the `HashMap<FileName, Vec<Range>>` is a `KeyedMap` (FileName compared by value). std's `HashMap` iterates in a
// per-process random order (`RandomState`), so no rustfmt output depends on one order; the port iterates in insertion
// order, which is one of the orders upstream can produce.
export class FileLines {
  constructor(public _0: KeyedMap<FileName, Range[]> | undefined) {}

  /// Creates a `FileLines` that contains all lines in all files.
  // rustc: src/tools/rustfmt/src/config/file_lines.rs:207 all
  static all(): FileLines {
    return new FileLines(undefined);
  }

  /// Returns `true` if this `FileLines` contains all lines in all files.
  // rustc: src/tools/rustfmt/src/config/file_lines.rs:212 is_all
  is_all(): boolean {
    return this._0 === undefined;
  }

  // rustc: src/tools/rustfmt/src/config/file_lines.rs:216 from_ranges
  static from_ranges(ranges: KeyedMap<FileName, Range[]>): FileLines {
    normalize_ranges(ranges);
    return new FileLines(ranges);
  }

  /// Returns an iterator over the files contained in `self`.
  // rustc: src/tools/rustfmt/src/config/file_lines.rs:222 files
  files(): Files {
    return new Files(this._0 === undefined ? undefined : this._0.keys());
  }

  /// Returns JSON representation as accepted by the `--file-lines JSON` arg.
  // rustc: src/tools/rustfmt/src/config/file_lines.rs:227 to_json_spans
  to_json_spans(): JsonSpan[] {
    const m = this._0;
    if (m === undefined) return [];
    return [...m].flatMap(([file, ranges]) => ranges.map((range) => new JsonSpan(clone_FileName(file), [range.lo, range.hi])));
  }

  /// Returns `true` if `self` includes all lines in all files. Otherwise runs `f` on all ranges
  /// in the designated file (if any) and returns true if `f` ever does.
  // rustc: src/tools/rustfmt/src/config/file_lines.rs:243 file_range_matches
  file_range_matches(file_name: FileName, f: (r: Range) => boolean): boolean {
    // `None` means "all lines in all files".
    if (this._0 === undefined) return true;
    const map = this._0;

    const file = canonicalize_path_string(file_name);
    const ranges = file === undefined ? undefined : map.get(file);
    if (ranges !== undefined) {
      return ranges.some(f);
    } else {
      return false;
    }
  }

  /// Returns `true` if `range` is fully contained in `self`.
  // rustc: src/tools/rustfmt/src/config/file_lines.rs:261 contains
  contains(range: LineRange): boolean {
    return this.file_range_matches(range.file_name(), (r) => r.contains(Range_from(range)));
  }

  /// Returns `true` if any lines in `range` are in `self`.
  // rustc: src/tools/rustfmt/src/config/file_lines.rs:266 intersects
  intersects(range: LineRange): boolean {
    return this.file_range_matches(range.file_name(), (r) => r.intersects(Range_from(range)));
  }

  /// Returns `true` if `line` from `file_name` is in `self`.
  // rustc: src/tools/rustfmt/src/config/file_lines.rs:271 contains_line
  contains_line(file_name: FileName, line: number): boolean {
    return this.file_range_matches(file_name, (r) => r.lo <= line && r.hi >= line);
  }

  /// Returns `true` if all the lines between `lo` and `hi` from `file_name` are in `self`.
  // rustc: src/tools/rustfmt/src/config/file_lines.rs:276 contains_range
  contains_range(file_name: FileName, lo: number, hi: number): boolean {
    return this.file_range_matches(file_name, (r) => r.contains(Range.new(lo, hi)));
  }

  // `impl str::FromStr for FileLines`
  // This impl is needed for `Config::override_value` to work for use in tests.
  // rustc: src/tools/rustfmt/src/config/file_lines.rs:311 from_str
  static from_str(s: string): Result<FileLines, FileLinesError> {
    const v_r = json_from_str_Vec_JsonSpan(s);
    if (v_r.$ === "Err") return Err({ $: "Json", _0: v_r._0 });
    const v = v_r._0;
    const m = new_file_map();
    for (const js of v) {
      const t = js.into_tuple();
      if (t.$ === "Err") return t;
      const [s, r] = t._0;
      let e = m.get(s);
      if (e === undefined) {
        e = [];
        m.set(s, e);
      }
      e.push(r);
    }
    return Ok(FileLines.from_ranges(m));
  }
}

/** A new `HashMap<FileName, Vec<Range>>`. */
export function new_file_map(entries?: Iterable<readonly [FileName, Range[]]>): KeyedMap<FileName, Range[]> {
  return new KeyedMap<FileName, Range[]>(key_FileName, entries);
}

/** `#[derive(Debug)]` of `FileLines` (hand-written with the type: codegen-fmt-serde PORT #7). */
export const debug_FileLines: Debug<FileLines> = (v, f) =>
  debug_tuple(f, "FileLines", [debug_option(v._0, f, (m, f) => debug_HashMap(m, f, debug_FileName, (r, f) => debug_vec(r, f, debug_Range)))]);

/** `#[derive(Clone)]` of `FileLines`. */
export function clone_FileLines(v: FileLines): FileLines {
  return new FileLines(v._0 === undefined ? undefined : (clone_HashMap(v._0, clone_FileName, (r) => r.map(clone_Range)) as KeyedMap<FileName, Range[]>));
}

/** `#[derive(Default)]` of `FileLines`. */
export function default_FileLines(): FileLines {
  return new FileLines(undefined);
}

/** `#[derive(PartialEq)]` of `FileLines`: `Option<HashMap<..>>` equality. */
export function FileLines_eq(self: FileLines, other: FileLines): boolean {
  const a = self._0;
  const b = other._0;
  if (a === undefined || b === undefined) return a === b;
  if (a.size !== b.size) return false;
  for (const [k, ra] of a) {
    const rb = b.get(k);
    if (rb === undefined || ra.length !== rb.length) return false;
    for (let i = 0; i < ra.length; i++) if (!Range_eq(ra[i]!, rb[i]!)) return false;
  }
  return true;
}

/// `FileLines` files iterator.
export class Files {
  constructor(public _0: Iterator<FileName> | undefined) {}

  // rustc: src/tools/rustfmt/src/config/file_lines.rs:287 next
  next(): FileName | undefined {
    if (this._0 === undefined) return undefined;
    const r = this._0.next();
    return r.done ? undefined : r.value;
  }
}

// rustc: src/tools/rustfmt/src/config/file_lines.rs:292 canonicalize_path_string
function canonicalize_path_string(file: FileName): FileName | undefined {
  switch (file.$) {
    case "Real": {
      const r = canonicalize(file._0);
      return r.$ === "Ok" ? { $: "Real", _0: r._0 } : undefined;
    }
    default:
      return clone_FileName(file);
  }
}

/** `serde_json::Error`: not ported until the serde_json lane (plan-m8 D6: "only what `--emit json` and `file_lines` reach"). */
export type JsonError = { readonly __serde_json_Error: never };

/** `#[derive(Error, Debug)] pub enum FileLinesError` */
export type FileLinesError =
  /** `#[error("{0}")]` */
  | { readonly $: "Json"; _0: JsonError }
  /** `#[error("Can't canonicalize {0}")]` */
  | { readonly $: "CannotCanonicalize"; _0: FileName };
export const debug_FileLinesError: Debug<FileLinesError> = (v, f) => {
  switch (v.$) {
    case "Json":
      return debug_tuple(f, "Json", [unported("vendor-serde_json: Debug for serde_json::Error")]);
    case "CannotCanonicalize":
      return debug_tuple(f, "CannotCanonicalize", [debug_FileName(v._0, f)]);
  }
};
export function display_FileLinesError(v: FileLinesError): string {
  switch (v.$) {
    case "Json":
      return unported("vendor-serde_json: Display for serde_json::Error");
    case "CannotCanonicalize":
      return `Can't canonicalize ${display_FileName(v._0)}`;
  }
}

/** `serde_json::from_str::<Vec<JsonSpan>>` (serde_json is not ported yet). */
function json_from_str_Vec_JsonSpan(_s: string): Result<JsonSpan[], JsonError> {
  return unported("vendor-serde_json: serde_json::from_str (FileLines::from_str)");
}

// For JSON decoding.
// rustc: src/tools/rustfmt/src/config/file_lines.rs:330 into_tuple
JsonSpan.prototype.into_tuple = function (this: JsonSpan): Result<[FileName, Range], FileLinesError> {
  const [lo, hi] = this.range;
  const canonical = canonicalize_path_string(this.file);
  if (canonical === undefined) return Err({ $: "CannotCanonicalize", _0: this.file });
  return Ok([canonical, Range.new(lo, hi)]);
};

// This impl is needed for inclusion in the `Config` struct. We don't have a toml representation
// for `FileLines`, so it will just panic instead.
// rustc: src/tools/rustfmt/src/config/file_lines.rs:341 deserialize
export function deserialize_FileLines<E>(_: Deserializer<E>): Result<FileLines, E> {
  return panic(
    "FileLines cannot be deserialized from a project rustfmt.toml file: please specify it via the `--file-lines` option instead",
  );
}

// We also want to avoid attempting to serialize a FileLines to toml. The
// `Config` struct should ensure this impl is never reached.
// rustc: src/tools/rustfmt/src/config/file_lines.rs:355 serialize
export function serialize_FileLines<O, E>(_self: FileLines, _: Serializer<O, E>): Result<O, E> {
  return unreachable("internal error: entered unreachable code: FileLines cannot be serialized. This is a rustfmt bug.");
}

