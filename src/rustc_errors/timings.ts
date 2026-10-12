// Port of compiler/rustc_errors/src/timings.rs.
//
// PORT: `std::time::Instant` is a `bigint` of nanoseconds from `process.hrtime.bigint()` (a
// monotonic clock, like `Instant`); `Duration::as_micros()` is the nanosecond difference divided
// by 1000 (truncating, as `as_micros` does). `Lock<FxHashSet<TimingSection>>` is a `Set`.
// `TimingSectionGuard`'s `Drop` is not automatic: holders call `guard.drop()` where upstream drops it.
import type { DiagCtxtHandle } from "./lib.ts";
import { type Debug, debug_int, debug_struct } from "../std/fmt.ts";

/** `std::time::Instant` (see the PORT note at the top of the file). */
export type Instant = bigint;

/** `Instant::now()` */
function Instant_now(): Instant {
  return process.hrtime.bigint();
}

/// A high-level section of the compilation process.
export type TimingSection =
  /// Time spent doing codegen.
  | "Codegen"
  /// Time spent linking.
  | "Linking";
export const TimingSection = { Codegen: "Codegen", Linking: "Linking" } as const;
/** `#[derive(Debug)]` */
export const debug_TimingSection: Debug<TimingSection> = (v) => v;

/// Section with attached timestamp
export class TimingRecord {
  constructor(
    public section: TimingSection,
    /// Microseconds elapsed since some predetermined point in time (~start of the rustc process).
    // PORT: `u128` -> bigint.
    public timestamp: bigint,
  ) {}

  // rustc: compiler/rustc_errors/src/timings.rs:26 from_origin
  static from_origin(origin: Instant, section: TimingSection): TimingRecord {
    return new TimingRecord(section, (Instant_now() - origin) / 1000n);
  }

  // rustc: compiler/rustc_errors/src/timings.rs:30 section
  section_(): TimingSection {
    // PORT: method `section` clashes with the field of the same name, hence `section_()`.
    return this.section;
  }

  // rustc: compiler/rustc_errors/src/timings.rs:34 timestamp
  timestamp_(): bigint {
    // PORT: method `timestamp` clashes with the field of the same name, hence `timestamp_()`.
    return this.timestamp;
  }
}
/** `#[derive(Debug)]` */
export const debug_TimingRecord: Debug<TimingRecord> = (v, f) =>
  debug_struct(f, "TimingRecord", [
    ["section", debug_TimingSection(v.section, f)],
    ["timestamp", debug_int(v.timestamp, f)],
  ]);

/// Manages emission of start/end section timings, enabled through `--json=timings`.
export class TimingSectionHandler {
  constructor(
    /// Time when the compilation session started.
    /// If `None`, timing is disabled.
    private origin: Instant | undefined,
    /// Sanity check to ensure that we open and close sections correctly.
    private opened_sections: Set<TimingSection>,
  ) {}

  // rustc: compiler/rustc_errors/src/timings.rs:49 new
  static new(enabled: boolean): TimingSectionHandler {
    const origin = enabled ? Instant_now() : undefined;
    return new TimingSectionHandler(origin, new Set());
  }

  /// Returns a RAII guard that will immediately emit a start the provided section, and then emit
  /// its end when it is dropped.
  // rustc: compiler/rustc_errors/src/timings.rs:56 section_guard
  section_guard(diag_ctxt: DiagCtxtHandle, section: TimingSection): TimingSectionGuard {
    if (this.is_enabled() && this.opened_sections.has(section)) {
      diag_ctxt.bug(`Section \`${debug_TimingSection(section, { alternate: false })}\` was started again before it was finished`);
    }

    return TimingSectionGuard.create(diag_ctxt, section, this.origin);
  }

  /// Start the provided section.
  // rustc: compiler/rustc_errors/src/timings.rs:70 start_section
  start_section(diag_ctxt: DiagCtxtHandle, section: TimingSection): void {
    const origin = this.origin;
    if (origin !== undefined) {
      const opened = this.opened_sections;
      // `!opened.insert(section)`
      const inserted = !opened.has(section);
      opened.add(section);
      if (!inserted) {
        diag_ctxt.bug(`Section \`${debug_TimingSection(section, { alternate: false })}\` was started again before it was finished`);
      }

      diag_ctxt.emit_timing_section_start(TimingRecord.from_origin(origin, section));
    }
  }

  /// End the provided section.
  // rustc: compiler/rustc_errors/src/timings.rs:83 end_section
  end_section(diag_ctxt: DiagCtxtHandle, section: TimingSection): void {
    const origin = this.origin;
    if (origin !== undefined) {
      const opened = this.opened_sections;
      if (!opened.delete(section)) {
        diag_ctxt.bug(`Section \`${debug_TimingSection(section, { alternate: false })}\` was ended before being started`);
      }

      diag_ctxt.emit_timing_section_end(TimingRecord.from_origin(origin, section));
    }
  }

  // rustc: compiler/rustc_errors/src/timings.rs:94 is_enabled
  private is_enabled(): boolean {
    return this.origin !== undefined;
  }
}

/// RAII wrapper for starting and ending section timings.
export class TimingSectionGuard {
  constructor(
    private dcx: DiagCtxtHandle,
    private section: TimingSection,
    private origin: Instant | undefined,
  ) {}

  // rustc: compiler/rustc_errors/src/timings.rs:107 create
  static create(dcx: DiagCtxtHandle, section: TimingSection, origin: Instant | undefined): TimingSectionGuard {
    if (origin !== undefined) {
      dcx.emit_timing_section_start(TimingRecord.from_origin(origin, section));
    }
    return new TimingSectionGuard(dcx, section, origin);
  }

  // impl Drop for TimingSectionGuard
  // rustc: compiler/rustc_errors/src/timings.rs:116 drop
  drop(): void {
    const origin = this.origin;
    if (origin !== undefined) {
      this.dcx.emit_timing_section_end(TimingRecord.from_origin(origin, this.section));
    }
  }
}
