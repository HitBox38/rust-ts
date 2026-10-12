import { BytePos, RelativeBytePos, type SourceFile, type SpanData } from "./lib.ts";
import type { SourceMap } from "./source_map.ts";
import { assert, unwrap } from "../std/panic.ts";

/** `std::ops::Range<BytePos>` (`start..end`, end exclusive). */
interface Range {
  readonly start: BytePos;
  readonly end: BytePos;
}

/** `Range::contains` */
function range_contains(r: Range, pos: BytePos): boolean {
  return r.start <= pos && pos < r.end;
}

/// A `SourceMap` wrapper that caches info about a single recent code position. This gives a good
/// speedup when hashing spans, because often multiple spans within a single line are hashed in
/// succession, and this avoids expensive `SourceMap` lookups each time the cache is hit. We used
/// to cache multiple code positions, but caching a single position ended up being simpler and
/// faster.
export class CachingSourceMapView {
  constructor(
    readonly source_map: SourceMap,
    public file: SourceFile,
    // The line's byte position range in the `SourceMap`. This range will fail to contain a valid
    // position in certain edge cases. Spans often start/end one past something, and when that
    // something is the last character of a file (this can happen when a file doesn't end in a
    // newline, for example), we'd still like for the position to be considered within the last
    // line. However, it isn't according to the exclusive upper bound of this range. We cannot
    // change the upper bound to be inclusive, because for most lines, the upper bound is the same
    // as the lower bound of the next line, so there would be an ambiguity.
    //
    // Since the containment aspect of this range is only used to see whether or not the cache
    // entry contains a position, the only ramification of the above is that we will get cache
    // misses for these rare positions. A line lookup for the position via `SourceMap::lookup_line`
    // after a cache miss will produce the last line number, as desired.
    public line_bounds: Range,
    public line_number: number,
  ) {}

  // rustc: compiler/rustc_span/src/caching_source_map_view.rs:32 new
  static new(source_map: SourceMap): CachingSourceMapView {
    const files = source_map.files();
    const first_file = unwrap(files.deref()[0], "index out of bounds: the len is 0 but the index is 0");
    return new CachingSourceMapView(source_map, first_file, { start: BytePos(0), end: BytePos(0) }, 0);
  }

  // rustc: compiler/rustc_span/src/caching_source_map_view.rs:44 pos_to_line
  pos_to_line(pos_: BytePos): [Range, number] {
    const pos = this.file.relative_position(pos_);
    const line_index = unwrap(this.file.lookup_line(pos));
    const [start, end] = this.file.line_bounds(line_index);
    const line_bounds: Range = { start, end };
    const line_number = line_index + 1;
    return [line_bounds, line_number];
  }

  // rustc: compiler/rustc_span/src/caching_source_map_view.rs:53 update
  update(new_file: SourceFile | undefined, pos: BytePos): void {
    if (new_file !== undefined) {
      this.file = new_file;
    }
    [this.line_bounds, this.line_number] = this.pos_to_line(pos);
  }

  // rustc: compiler/rustc_span/src/caching_source_map_view.rs:60 byte_pos_to_line_and_col
  byte_pos_to_line_and_col(pos: BytePos): [SourceFile, number, RelativeBytePos] | undefined {
    if (range_contains(this.line_bounds, pos)) {
      // Cache hit: do nothing.
    } else {
      // Cache miss. If the entry doesn't point to the correct file, get the new file and
      // index.
      let new_file: SourceFile | undefined;
      if (!file_contains(this.file, pos)) {
        const f = this.file_for_position(pos);
        if (f === undefined) return undefined;
        new_file = f;
      } else {
        new_file = undefined;
      }
      this.update(new_file, pos);
    }

    const col = RelativeBytePos(BytePos.to_u32(pos) - BytePos.to_u32(this.line_bounds.start));
    return [this.file, this.line_number, col];
  }

  // rustc: compiler/rustc_span/src/caching_source_map_view.rs:81 span_data_to_lines_and_cols
  span_data_to_lines_and_cols(span_data: SpanData): [SourceFile, number, BytePos, number, BytePos] | undefined {
    const lo_hit = range_contains(this.line_bounds, span_data.lo);
    const hi_hit = range_contains(this.line_bounds, span_data.hi);
    if (lo_hit && hi_hit) {
      // span_data.lo and span_data.hi are cached (i.e. both in the same line).
      return [
        this.file,
        this.line_number,
        BytePos.sub(span_data.lo, this.line_bounds.start),
        this.line_number,
        BytePos.sub(span_data.hi, this.line_bounds.start),
      ];
    }

    // If the cached file is wrong, update it. Return early if the span lo and hi are in
    // different files.
    let new_file: SourceFile | undefined;
    if (!file_contains(this.file, span_data.lo)) {
      const nf = this.file_for_position(span_data.lo);
      if (nf === undefined) return undefined;
      if (!file_contains(nf, span_data.hi)) {
        return undefined;
      }
      new_file = nf;
    } else {
      if (!file_contains(this.file, span_data.hi)) {
        return undefined;
      }
      new_file = undefined;
    }

    // If we reach here, lo and hi are in the same file.

    if (!lo_hit) {
      // We cache the lo information.
      this.update(new_file, span_data.lo);
    }
    const lo_line_bounds = this.line_bounds;
    const lo_line_number = this.line_number;

    const [hi_line_bounds, hi_line_number] = !range_contains(this.line_bounds, span_data.hi)
      ? // hi and lo are in different lines. We compute but don't cache the hi information.
        this.pos_to_line(span_data.hi)
      : // hi and lo are in the same line.
        [this.line_bounds, this.line_number];

    // Span lo and hi may equal line end when last line doesn't
    // end in newline, hence the inclusive upper bounds below.
    assert(span_data.lo >= lo_line_bounds.start, "assertion failed: span_data.lo >= lo_line_bounds.start");
    assert(span_data.lo <= lo_line_bounds.end, "assertion failed: span_data.lo <= lo_line_bounds.end");
    assert(span_data.hi >= hi_line_bounds.start, "assertion failed: span_data.hi >= hi_line_bounds.start");
    assert(span_data.hi <= hi_line_bounds.end, "assertion failed: span_data.hi <= hi_line_bounds.end");
    assert(this.file.contains(span_data.lo), "assertion failed: self.file.contains(span_data.lo)");
    assert(this.file.contains(span_data.hi), "assertion failed: self.file.contains(span_data.hi)");

    return [
      this.file,
      lo_line_number,
      BytePos.sub(span_data.lo, lo_line_bounds.start),
      hi_line_number,
      BytePos.sub(span_data.hi, hi_line_bounds.start),
    ];
  }

  // rustc: compiler/rustc_span/src/caching_source_map_view.rs:148 file_for_position
  file_for_position(pos: BytePos): SourceFile | undefined {
    if (this.source_map.files().deref().length !== 0) {
      const file_idx = this.source_map.lookup_source_file_idx(pos);
      const file = this.source_map.files().deref()[file_idx]!;

      if (file_contains(file, pos)) {
        return file;
      }
    }

    return undefined;
  }
}

// rustc: compiler/rustc_span/src/caching_source_map_view.rs:163 file_contains
function file_contains(file: SourceFile, pos: BytePos): boolean {
  // `SourceMap::lookup_source_file_idx` and `SourceFile::contains` both consider the position
  // one past the end of a file to belong to it. Normally, that's what we want. But for the
  // purposes of converting a byte position to a line and column number, we can't come up with a
  // line and column number if the file is empty, because an empty file doesn't contain any
  // lines. So for our purposes, we don't consider empty files to contain any byte position.
  return file.contains(pos) && !file.is_empty();
}
