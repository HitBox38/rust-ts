// Port of compiler/rustc_borrowck/src/polonius/legacy/facts.rs (lane borrowck-contract: declarations; fill lanes bck-nll
// (`PoloniusFactsExt::enabled`, main path) and bck-polonius-legacy (the rest; wave 26, plan-m4 D7)).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: vendor polonius-engine 0.13.0 is not ported (plan-m4 D7): `PoloniusFacts` (`AllFacts<RustcFacts>`) and
// `PoloniusOutput` are `unknown` (generated), and its traits `Atom` / `FactTypes` are local impl-table shapes.
// `impl FactTypes for RustcFacts` has only associated types (nothing to declare).
// PORT: `#[extension(pub(crate) trait PoloniusFactsExt)] impl PoloniusFacts` is the impl table `PoloniusFactsExt`
// (`PoloniusFacts` is not a class); `From<A> for B` is `B_from_A(a)`; the crate traits `FactRow` / `FactCell` are
// interfaces implemented by impl tables (`FactRow_<Type>`, `FactCell_<Type>`; the tuple impls are functions of the
// element impls). `&dyn FactCell` is a `DynFactCell` (the value bound to its impl). `Box<dyn Error>` is `IoError`
// (every error of these fns is an I/O error); `impl AsRef<Path>` / `&Path` are `string`; `&mut dyn Write` is vendor
// anstream's `Write`.
import type { Local } from "../../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
// PORT: rustc_session is entered through its lib.ts (config.ts is not a fresh entry point; lib.ts of this crate).
import "../../../rustc_session/lib.ts";
import { Polonius } from "../../../rustc_session/config.ts";
import type { MovePathIndex } from "../../../rustc_mir_dataflow/move_paths/mod.ts";
import type { RegionVid } from "../../../rustc_type_ir/region_kind.ts";
import type { IoError } from "../../../std/io.ts";
import { unported } from "../../../std/panic.ts";
import type { Result } from "../../../std/result.ts";
import type { Write } from "../../../vendor/anstream/stream.ts";
import type { BorrowIndex } from "../../dataflow.gen.ts";
import { FactWriter, type PoloniusFacts, type PoloniusRegionVid } from "./facts.gen.ts";
import type { LocationIndex, PoloniusLocationTable } from "./location.gen.ts";

export * from "./facts.gen.ts";

/** `polonius_engine::Atom` (vendor, not ported). */
export interface Atom<T> {
  index(self: T): number;
}

// impl polonius_engine::Atom for PoloniusRegionVid
export const Atom_PoloniusRegionVid: Atom<PoloniusRegionVid> = {
  // stub: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:29 index (lane bck-polonius-legacy)
  index(self: PoloniusRegionVid): number {
    return unported("rustc_borrowck::polonius::legacy::facts::PoloniusRegionVid::index");
  },
};

// impl From<RegionVid> for PoloniusRegionVid
// stub: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:34 from (lane bck-polonius-legacy)
export function PoloniusRegionVid_from_RegionVid(value: RegionVid): PoloniusRegionVid {
  return unported("rustc_borrowck::polonius::legacy::facts::PoloniusRegionVid::from");
}

// impl From<PoloniusRegionVid> for RegionVid
// stub: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:39 from (lane bck-polonius-legacy)
export function RegionVid_from_PoloniusRegionVid(value: PoloniusRegionVid): RegionVid {
  return unported("rustc_borrowck::polonius::legacy::facts::RegionVid::from");
}

// #[extension(pub(crate) trait PoloniusFactsExt)] impl PoloniusFacts
export const PoloniusFactsExt = {
  /// Returns `true` if there is a need to gather `PoloniusFacts` given the
  /// current `-Z` flags.
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:58 enabled
  enabled(tcx: TyCtxt): boolean {
    return tcx.sess.opts.unstable_opts.nll_facts || Polonius.is_legacy_enabled(tcx.sess.opts.unstable_opts.polonius);
  },

  // stub: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:63 write_to_dir (lane bck-polonius-legacy)
  write_to_dir(self: PoloniusFacts, dir: string, location_table: PoloniusLocationTable): Result<null, IoError> {
    return unported("rustc_borrowck::polonius::legacy::facts::PoloniusFactsExt::write_to_dir");
  },
};

// impl Atom for BorrowIndex
export const Atom_BorrowIndex: Atom<BorrowIndex> = {
  // stub: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:110 index (lane bck-polonius-legacy)
  index(self: BorrowIndex): number {
    return unported("rustc_borrowck::polonius::legacy::facts::BorrowIndex::index");
  },
};

// impl Atom for LocationIndex
export const Atom_LocationIndex: Atom<LocationIndex> = {
  // stub: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:116 index (lane bck-polonius-legacy)
  index(self: LocationIndex): number {
    return unported("rustc_borrowck::polonius::legacy::facts::LocationIndex::index");
  },
};

declare module "./facts.gen.ts" {
  interface FactWriter {
    // facts.rs:127 (lane bck-polonius-legacy)
    write_facts_to_path<T>(rows: readonly T[], file_name: string, T_: FactRow<T>): Result<null, IoError>;
  }
}

// stub: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:127 write_facts_to_path (lane bck-polonius-legacy)
FactWriter.prototype.write_facts_to_path = function <T>(this: FactWriter, rows: readonly T[], file_name: string, T_: FactRow<T>): Result<null, IoError> {
  return unported("rustc_borrowck::polonius::legacy::facts::FactWriter::write_facts_to_path");
};

export interface FactRow<T> {
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:141 write
  write(self: T, out: Write, location_table: PoloniusLocationTable): Result<null, IoError>;
}

// impl FactRow for PoloniusRegionVid
export const FactRow_PoloniusRegionVid: FactRow<PoloniusRegionVid> = {
  // stub: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:149 write (lane bck-polonius-legacy)
  write(self: PoloniusRegionVid, out: Write, location_table: PoloniusLocationTable): Result<null, IoError> {
    return unported("rustc_borrowck::polonius::legacy::facts::PoloniusRegionVid::write");
  },
};

// impl<A: FactCell, B: FactCell> FactRow for (A, B)
export function FactRow_tuple2<A, B>(A_: FactCell<A>, B_: FactCell<B>): FactRow<[A, B]> {
  return {
    // stub: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:163 write (lane bck-polonius-legacy)
    write(self: [A, B], out: Write, location_table: PoloniusLocationTable): Result<null, IoError> {
      return unported("rustc_borrowck::polonius::legacy::facts::FactRow_tuple2::write");
    },
  };
}

// impl<A: FactCell, B: FactCell, C: FactCell> FactRow for (A, B, C)
export function FactRow_tuple3<A, B, C>(A_: FactCell<A>, B_: FactCell<B>, C_: FactCell<C>): FactRow<[A, B, C]> {
  return {
    // stub: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:178 write (lane bck-polonius-legacy)
    write(self: [A, B, C], out: Write, location_table: PoloniusLocationTable): Result<null, IoError> {
      return unported("rustc_borrowck::polonius::legacy::facts::FactRow_tuple3::write");
    },
  };
}

// stub: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:187 write_row (lane bck-polonius-legacy)
export function write_row(out: Write, location_table: PoloniusLocationTable, columns: readonly DynFactCell[]): Result<null, IoError> {
  return unported("rustc_borrowck::polonius::legacy::facts::write_row");
}

export interface FactCell<T> {
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:200 to_string
  to_string(self: T, location_table: PoloniusLocationTable): string;
}
/** `&dyn FactCell`: a value bound to its `FactCell` impl. */
export interface DynFactCell {
  to_string(location_table: PoloniusLocationTable): string;
}

// impl FactCell for BorrowIndex
export const FactCell_BorrowIndex: FactCell<BorrowIndex> = {
  // stub: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:204 to_string (lane bck-polonius-legacy)
  to_string(self: BorrowIndex, _location_table: PoloniusLocationTable): string {
    return unported("rustc_borrowck::polonius::legacy::facts::BorrowIndex::to_string");
  },
};

// impl FactCell for Local
export const FactCell_Local: FactCell<Local> = {
  // stub: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:210 to_string (lane bck-polonius-legacy)
  to_string(self: Local, _location_table: PoloniusLocationTable): string {
    return unported("rustc_borrowck::polonius::legacy::facts::Local::to_string");
  },
};

// impl FactCell for MovePathIndex
export const FactCell_MovePathIndex: FactCell<MovePathIndex> = {
  // stub: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:216 to_string (lane bck-polonius-legacy)
  to_string(self: MovePathIndex, _location_table: PoloniusLocationTable): string {
    return unported("rustc_borrowck::polonius::legacy::facts::MovePathIndex::to_string");
  },
};

// impl FactCell for PoloniusRegionVid
export const FactCell_PoloniusRegionVid: FactCell<PoloniusRegionVid> = {
  // stub: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:222 to_string (lane bck-polonius-legacy)
  to_string(self: PoloniusRegionVid, _location_table: PoloniusLocationTable): string {
    return unported("rustc_borrowck::polonius::legacy::facts::PoloniusRegionVid::to_string");
  },
};

// impl FactCell for RegionVid
export const FactCell_RegionVid: FactCell<RegionVid> = {
  // stub: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:228 to_string (lane bck-polonius-legacy)
  to_string(self: RegionVid, _location_table: PoloniusLocationTable): string {
    return unported("rustc_borrowck::polonius::legacy::facts::RegionVid::to_string");
  },
};

// impl FactCell for LocationIndex
export const FactCell_LocationIndex: FactCell<LocationIndex> = {
  // stub: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:234 to_string (lane bck-polonius-legacy)
  to_string(self: LocationIndex, location_table: PoloniusLocationTable): string {
    return unported("rustc_borrowck::polonius::legacy::facts::LocationIndex::to_string");
  },
};
