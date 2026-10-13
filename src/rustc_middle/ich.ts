// Port of compiler/rustc_middle/src/ich.rs (the `StableHashCtxt` rustc uses: `tcx.with_stable_hashing_context`).
// PORT: `Untracked` (rustc_crate_store) has its `FreezeLock`s / `RwLock`s erased (PORTING §5), so
// `definitions.read()` / `cstore.read()` are the fields themselves.
import type { Untracked } from "../rustc_crate_store/cstore.ts";
import type { Fingerprint } from "../rustc_data_structures/fingerprint.ts";
import {
  type RawDefId,
  type RawSpan,
  type StableHashControls,
  type StableHashCtxt,
  type StableHasher,
  debug_StableHashControls,
  stable_hash_Option,
  stable_hash_u32,
} from "../rustc_data_structures/stable_hash.ts";
import { Hash128 } from "../rustc_hashes/lib.ts";
import type { Session } from "../rustc_session/session.ts";
import { CachingSourceMapView } from "../rustc_span/caching_source_map_view.ts";
import { DefId, type DefPathHash, DefPathHash as DefPathHashC, type LocalDefId, stable_hash_LocalDefId } from "../rustc_span/def_id.ts";
import { stable_hash_SyntaxContext } from "../rustc_span/hygiene.ts";
import { BytePos, DUMMY_SP, Span, type SpanData } from "../rustc_span/lib.ts";
import type { SourceMap } from "../rustc_span/source_map.ts";
import { PLAIN } from "../std/fmt.ts";
import { panic } from "../std/panic.ts";

/** The parts of `rustc_crate_store::Untracked` that stable hashing reads; `Untracked` satisfies it (tests pass
 * smaller objects). */
export interface UntrackedForHashing {
  /** `untracked.definitions.read()` */
  definitions: Pick<Untracked["definitions"], "def_path_hash">;
  /** `untracked.cstore.read()` */
  cstore: Pick<Untracked["cstore"], "def_path_hash">;
  /** `untracked.source_span: AppendOnlyIndexVec<LocalDefId, Span>` */
  source_span: readonly (Span | undefined)[];
}

// Very often, we are hashing something that does not need the `CachingSourceMapView`, so we
// initialize it lazily.
type CachingSourceMap = { readonly $: "Unused"; readonly _0: SourceMap } | { readonly $: "InUse"; readonly _0: CachingSourceMapView };

/// This is the context state available during incr. comp. hashing. It contains
/// enough information to transform `DefId`s and `HirId`s into stable `DefPath`s (i.e.,
/// a reference to the `TyCtxt`) and it holds a few caches for speeding up various
/// things (e.g., each `DefId`/`DefPath` is only hashed once).
export class StableHashState implements StableHashCtxt {
  constructor(
    private readonly untracked: UntrackedForHashing,
    // The value of `-Z incremental-ignore-spans`.
    // This field should only be used by `unstable_opts_incremental_ignore_span`
    private readonly incremental_ignore_spans: boolean,
    private caching_source_map: CachingSourceMap,
    private stable_hash_controls_: StableHashControls,
    private readonly source_span_cache: SourceSpanCache,
  ) {}

  // rustc: compiler/rustc_middle/src/ich.rs:37 new
  static new(sess: Session, untracked: UntrackedForHashing): StableHashState {
    const hash_spans_initial = !sess.opts.unstable_opts.incremental_ignore_spans;

    return new StableHashState(
      untracked,
      sess.opts.unstable_opts.incremental_ignore_spans,
      { $: "Unused", _0: sess.source_map() },
      { hash_spans: hash_spans_initial },
      SourceSpanCache.default(),
    );
  }

  // rustc: compiler/rustc_middle/src/ich.rs:50 while_hashing_spans
  while_hashing_spans(hash_spans: boolean, f: (hcx: StableHashState) => void): void {
    const prev_hash_spans = this.stable_hash_controls_.hash_spans;
    this.stable_hash_controls_ = { hash_spans };
    f(this);
    this.stable_hash_controls_ = { hash_spans: prev_hash_spans };
  }

  // rustc: compiler/rustc_middle/src/ich.rs:58 source_map
  private source_map(): CachingSourceMapView {
    switch (this.caching_source_map.$) {
      case "InUse":
        return this.caching_source_map._0;
      case "Unused": {
        const sm = this.caching_source_map._0;
        this.caching_source_map = { $: "InUse", _0: CachingSourceMapView.new(sm) };
        return this.source_map(); // this recursive call will hit the `InUse` case
      }
    }
  }

  // rustc: compiler/rustc_middle/src/ich.rs:69 stable_hash_controls
  // rustc: compiler/rustc_middle/src/ich.rs:206 stable_hash_controls
  /** The inherent fn and the `StableHashCtxt` method (both return the controls) are this one method. */
  stable_hash_controls(): StableHashControls {
    return this.stable_hash_controls_;
  }

  // ---- impl StableHashCtxt for StableHashState ----

  /// Hashes a span in a stable way. We can't directly hash the span's `BytePos` fields (that
  /// would be similar to hashing pointers, since those are just offsets into the `SourceMap`).
  /// Instead, we hash the (file name, line, column) triple, which stays the same even if the
  /// containing `SourceFile` has moved within the `SourceMap`.
  ///
  /// Also note that we are hashing byte offsets for the column, not unicode codepoint offsets.
  /// For the purpose of the hash that's sufficient. Also, hashing filenames is expensive so we
  /// avoid doing it twice when the span starts and ends in the same file, which is almost always
  /// the case.
  ///
  /// IMPORTANT: changes to this method should be reflected in implementations of `SpanEncoder`.
  // rustc: compiler/rustc_middle/src/ich.rs:87 stable_hash_span
  stable_hash_span(raw_span: RawSpan, hasher: StableHasher): void {
    const TAG_VALID_SPAN = 0;
    const TAG_INVALID_SPAN = 1;
    const TAG_RELATIVE_SPAN = 2;

    // PORT: the result is a u64 (`bigint`); the inputs are below 2^32.
    // rustc: compiler/rustc_middle/src/ich.rs:93 pack_span_location
    function pack_span_location(line_lo: number, col_lo: BytePos, line_hi: number, col_hi: BytePos): bigint {
      const col_lo_trunc = BigInt(col_lo) & 0xffn;
      const line_lo_trunc = (BigInt(line_lo) & 0xff_ff_ffn) << 8n;
      const col_hi_trunc = (BigInt(col_hi) & 0xffn) << 32n;
      const line_hi_trunc = (BigInt(line_hi) & 0xff_ff_ffn) << 40n;
      return col_lo_trunc | line_lo_trunc | col_hi_trunc | line_hi_trunc;
    }

    if (!this.stable_hash_controls().hash_spans) {
      return;
    }

    // `Span::from_raw_span(raw_span)`: the handle number itself (see `RawSpan`).
    const span_ = raw_span as number as Span;
    const span = Span.data_untracked(span_);
    stable_hash_SyntaxContext(span.ctxt, this, hasher);
    stable_hash_Option(span.parent, this, hasher, stable_hash_LocalDefId);

    if (span.is_dummy()) {
      // `Hash::hash(&TAG_INVALID_SPAN, hasher)`: a `u8`
      hasher.write_u8(TAG_INVALID_SPAN);
      return;
    }

    const parent = span.parent === undefined ? undefined : this.source_span_cache.lookup(span.parent, this.untracked.source_span);
    if (parent !== undefined && parent.contains(span)) {
      // This span is enclosed in a definition: only hash the relative position. This catches
      // a subset of the cases from the `file.contains(parent.lo)`. But we can do this check
      // cheaply without the expensive `span_data_to_lines_and_cols` query.
      hasher.write_u8(TAG_RELATIVE_SPAN);
      stable_hash_u32(BytePos.to_u32(BytePos.sub(span.lo, parent.lo)), this, hasher);
      stable_hash_u32(BytePos.to_u32(BytePos.sub(span.hi, parent.lo)), this, hasher);
      return;
    }

    // If this is not an empty or invalid span, we want to hash the last position that belongs
    // to it, as opposed to hashing the first position past it.
    const lines = this.source_map().span_data_to_lines_and_cols(span);
    if (lines === undefined) {
      hasher.write_u8(TAG_INVALID_SPAN);
      return;
    }
    const [file, line_lo, col_lo, line_hi, col_hi] = lines;

    if (parent !== undefined && file.contains(parent.lo)) {
      // This span is relative to another span in the same file,
      // only hash the relative position.
      hasher.write_u8(TAG_RELATIVE_SPAN);
      // `Hash::hash(&(span.lo.0.wrapping_sub(parent.lo.0)), hasher)`: `u32`s
      hasher.write_u32((span.lo - parent.lo) >>> 0);
      hasher.write_u32((span.hi - parent.lo) >>> 0);
      return;
    }

    hasher.write_u8(TAG_VALID_SPAN);
    // `Hash::hash(&file.stable_id, hasher)`: `StableSourceFileId(Hash128)`'s derived Hash, i.e.
    // `impl Hash for Hash128` (the truncated `u64`)
    Hash128.hash(file.stable_id.hash(), hasher);

    // Hash both the length and the end location (line/column) of a span. If we hash only the
    // length, for example, then two otherwise equal spans with different end locations will
    // have the same hash. This can cause a problem during incremental compilation wherein a
    // previous result for a query that depends on the end location of a span will be
    // incorrectly reused when the end location of the span it depends on has changed (see
    // issue #74890). A similar analysis applies if some query depends specifically on the
    // length of the span, but we only hash the end location. So hash both.

    const col_line = pack_span_location(line_lo, col_lo, line_hi, col_hi);
    const len = BytePos.sub(span.hi, span.lo);
    hasher.write_u64(col_line);
    hasher.write_u32(len);
  }

  // rustc: compiler/rustc_middle/src/ich.rs:173 def_path_hash
  def_path_hash(raw_def_id: RawDefId): Fingerprint {
    const def_id = DefId.from_raw_def_id(raw_def_id);
    const local = def_id.as_local();
    const h = local !== undefined ? this.untracked.definitions.def_path_hash(local) : this.untracked.cstore.def_path_hash(def_id);
    return DefPathHashC._0(h);
  }

  /// Assert that the provided `StableHashCtxt` is configured with the default
  /// `StableHashControls`. We should always have bailed out before getting to here with a
  /// non-default mode. With this check in place, we can avoid the need to maintain separate
  /// versions of `ExpnData` hashes for each permutation of `StableHashControls` settings.
  // rustc: compiler/rustc_middle/src/ich.rs:188 assert_default_stable_hash_controls
  assert_default_stable_hash_controls(msg: string): void {
    const stable_hash_controls = this.stable_hash_controls_;
    const { hash_spans } = stable_hash_controls;

    // Note that we require that `hash_spans` be the inverse of the global `-Z
    // incremental-ignore-spans` option. Normally, this option is disabled, in which case
    // `hash_spans` must be true.
    //
    // Span hashing can also be disabled without `-Z incremental-ignore-spans`. This is the
    // case for instance when building a hash for name mangling. Such configuration must not be
    // used for metadata.
    if (hash_spans !== !this.incremental_ignore_spans) {
      panic(
        `assertion \`left == right\` failed: Attempted hashing of ${msg} with non-default StableHashControls: ${debug_StableHashControls(stable_hash_controls, PLAIN)}\n  left: ${hash_spans}\n right: ${!this.incremental_ignore_spans}`,
      );
    }
  }
}

/// A single-entry cache for a `SpanData`, to optimize a particular scenario: when iterating
/// through child spans (e.g. during encoding/decoding/hashing), many of those spans will have the
/// same parent span. In the case where that parent span is interned (e.g. the parent is a const
/// literal item exceeding MAX_LEN bytes of source code), this cache avoids having to fetch the
/// parent's `SpanData` from the interner (which involves TLS, locking, etc.) over and over. A
/// single entry is enough for an extremely high hit rate.
// `#[derive(Default)] pub(crate) struct SourceSpanCache(Option<(LocalDefId, SpanData)>);`
export class SourceSpanCache {
  constructor(public _0: [LocalDefId, SpanData] | undefined) {}

  static default(): SourceSpanCache {
    return new SourceSpanCache(undefined);
  }

  // rustc: compiler/rustc_middle/src/ich.rs:222 lookup
  lookup(def_id: LocalDefId, source_span: readonly (Span | undefined)[]): SpanData {
    const cache = this._0;
    if (cache !== undefined && cache[0] === def_id) {
      return cache[1];
    } else {
      const span_data = Span.data_untracked(source_span[def_id] ?? DUMMY_SP);
      this._0 = [def_id, span_data];
      return span_data;
    }
  }
}
