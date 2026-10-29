// Port of compiler/rustc_borrowck/src/polonius/legacy/facts.rs (lane borrowck-contract: declarations; fill lanes bck-nll
// (`PoloniusFactsExt::enabled`, main path) and bck-polonius-legacy (the rest; wave 26/29, plan-m4 D7)).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `PoloniusFacts` (`AllFacts<RustcFacts>`) and `PoloniusOutput` (`Output<RustcFacts>`) are vendor polonius-engine
// 0.13.0's `AllFacts<RustcFactTypes>` / `Output<RustcFactTypes>`: `impl FactTypes for RustcFacts` (only associated types)
// is the type-level record `RustcFactTypes` below, and the codegen typemap (tools/codegen/borrowck.typemap.json) maps
// `polonius_engine::AllFacts` / `Output` to the vendor types re-exported here. The generated `RustcFacts` stays the unit
// struct. polonius-engine's `Atom` is `number` (every atom is a `newtype_index!` handle); the `Atom` impls below are
// impl tables (`Atom_<Type>`) that only carry the upstream `index` fns (the engine uses the identity).
// PORT: `#[extension(pub(crate) trait PoloniusFactsExt)] impl PoloniusFacts` is the impl table `PoloniusFactsExt`
// (`PoloniusFacts` is not a class); `From<A> for B` is `B_from_A(a)`; the crate traits `FactRow` / `FactCell` are
// interfaces implemented by impl tables (`FactRow_<Type>`, `FactCell_<Type>`; the tuple impls are functions of the
// element impls). `&dyn FactCell` is a `DynFactCell` (the value bound to its impl). `Box<dyn Error>` is `IoError`
// (every error of these fns is an I/O error); `impl AsRef<Path>` / `&Path` are `string`; `&mut dyn Write` is vendor
// anstream's `Write`.
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { Local } from "../../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
// PORT: rustc_session is entered through its lib.ts (config.ts is not a fresh entry point; lib.ts of this crate).
import "../../../rustc_session/lib.ts";
import { Polonius } from "../../../rustc_session/config.ts";
import { MovePathIndex } from "../../../rustc_mir_dataflow/move_paths/mod.ts";
import { RegionVid } from "../../../rustc_type_ir/region_kind.ts";
import { debug_str, PLAIN } from "../../../std/fmt.ts";
import { type IoError, type IoResult, io_error_from_node } from "../../../std/io.ts";
import { path_join } from "../../../std/path.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { type FmtArguments, type Write, Write_default } from "../../../vendor/anstream/stream.ts";
import type { AllFacts, FactTypes, Output } from "../../../vendor/polonius_engine/lib.ts";
import { BorrowIndex } from "../../dataflow.gen.ts";
import { FactWriter, type PoloniusFacts, PoloniusRegionVid } from "./facts.gen.ts";
import { debug_RichLocation, LocationIndex, type PoloniusLocationTable } from "./location.gen.ts";

export * from "./facts.gen.ts";

// PORT: the vendor types the generated `PoloniusFacts` / `PoloniusOutput` name (codegen typemap; see the header).
export type { AllFacts, Output };

/** `polonius_engine::Atom` (vendor `Atom` is `number`): the impl tables carry the upstream `index` fns. */
export interface Atom<T> {
  index(self: T): number;
}

// impl polonius_engine::Atom for PoloniusRegionVid
export const Atom_PoloniusRegionVid: Atom<PoloniusRegionVid> = {
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:29 index
  index(self: PoloniusRegionVid): number {
    return PoloniusRegionVid.as_usize(self);
  },
};

// impl From<RegionVid> for PoloniusRegionVid
// rustc: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:34 from
export function PoloniusRegionVid_from_RegionVid(value: RegionVid): PoloniusRegionVid {
  return PoloniusRegionVid.from_usize(RegionVid.as_usize(value));
}

// impl From<PoloniusRegionVid> for RegionVid
// rustc: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:39 from
export function RegionVid_from_PoloniusRegionVid(value: PoloniusRegionVid): RegionVid {
  return RegionVid.from_usize(PoloniusRegionVid.as_usize(value));
}

// impl polonius_engine::FactTypes for RustcFacts
/** `impl polonius_engine::FactTypes for RustcFacts`: the associated atom types, as vendor polonius-engine's type-level
 * `FactTypes` record. */
export interface RustcFactTypes extends FactTypes {
  Origin: PoloniusRegionVid;
  Loan: BorrowIndex;
  Point: LocationIndex;
  Variable: Local;
  Path: MovePathIndex;
}

// #[extension(pub(crate) trait PoloniusFactsExt)] impl PoloniusFacts
export const PoloniusFactsExt = {
  /// Returns `true` if there is a need to gather `PoloniusFacts` given the
  /// current `-Z` flags.
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:58 enabled
  enabled(tcx: TyCtxt): boolean {
    return tcx.sess.opts.unstable_opts.nll_facts || Polonius.is_legacy_enabled(tcx.sess.opts.unstable_opts.polonius);
  },

  // rustc: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:63 write_to_dir
  write_to_dir(self: PoloniusFacts, dir: string, location_table: PoloniusLocationTable): Result<null, IoError> {
    const dir_: string = dir;
    try {
      // PORT: `fs::create_dir_all("")` is `Ok` (nothing to create); Node's `mkdirSync("")` fails.
      if (dir_ !== "") mkdirSync(dir_, { recursive: true });
    } catch (e) {
      return Err(io_error_from_node(e));
    }
    const wr = new FactWriter(location_table, dir_);
    // PORT: the local `write_facts_to_path!` macro expands to one `wr.write_facts_to_path(&self.<field>,
    // &format!("{}.facts", stringify!(<field>)))?;` per field, in this order; the `FactRow` impl of each field's row
    // type is passed explicitly.
    const Origin = FactCell_PoloniusRegionVid;
    const Loan = FactCell_BorrowIndex;
    const Point = FactCell_LocationIndex;
    const Variable = FactCell_Local;
    const Path = FactCell_MovePathIndex;
    let r: Result<null, IoError>;
    r = wr.write_facts_to_path(self.loan_issued_at, "loan_issued_at.facts", FactRow_tuple3(Origin, Loan, Point));
    if (r.$ === "Err") return r;
    r = wr.write_facts_to_path(self.universal_region, "universal_region.facts", FactRow_PoloniusRegionVid);
    if (r.$ === "Err") return r;
    r = wr.write_facts_to_path(self.cfg_edge, "cfg_edge.facts", FactRow_tuple2(Point, Point));
    if (r.$ === "Err") return r;
    r = wr.write_facts_to_path(self.loan_killed_at, "loan_killed_at.facts", FactRow_tuple2(Loan, Point));
    if (r.$ === "Err") return r;
    r = wr.write_facts_to_path(self.subset_base, "subset_base.facts", FactRow_tuple3(Origin, Origin, Point));
    if (r.$ === "Err") return r;
    r = wr.write_facts_to_path(self.loan_invalidated_at, "loan_invalidated_at.facts", FactRow_tuple2(Point, Loan));
    if (r.$ === "Err") return r;
    r = wr.write_facts_to_path(self.var_used_at, "var_used_at.facts", FactRow_tuple2(Variable, Point));
    if (r.$ === "Err") return r;
    r = wr.write_facts_to_path(self.var_defined_at, "var_defined_at.facts", FactRow_tuple2(Variable, Point));
    if (r.$ === "Err") return r;
    r = wr.write_facts_to_path(self.var_dropped_at, "var_dropped_at.facts", FactRow_tuple2(Variable, Point));
    if (r.$ === "Err") return r;
    r = wr.write_facts_to_path(self.use_of_var_derefs_origin, "use_of_var_derefs_origin.facts", FactRow_tuple2(Variable, Origin));
    if (r.$ === "Err") return r;
    r = wr.write_facts_to_path(self.drop_of_var_derefs_origin, "drop_of_var_derefs_origin.facts", FactRow_tuple2(Variable, Origin));
    if (r.$ === "Err") return r;
    r = wr.write_facts_to_path(self.child_path, "child_path.facts", FactRow_tuple2(Path, Path));
    if (r.$ === "Err") return r;
    r = wr.write_facts_to_path(self.path_is_var, "path_is_var.facts", FactRow_tuple2(Path, Variable));
    if (r.$ === "Err") return r;
    r = wr.write_facts_to_path(self.path_assigned_at_base, "path_assigned_at_base.facts", FactRow_tuple2(Path, Point));
    if (r.$ === "Err") return r;
    r = wr.write_facts_to_path(self.path_moved_at_base, "path_moved_at_base.facts", FactRow_tuple2(Path, Point));
    if (r.$ === "Err") return r;
    r = wr.write_facts_to_path(self.path_accessed_at_base, "path_accessed_at_base.facts", FactRow_tuple2(Path, Point));
    if (r.$ === "Err") return r;
    r = wr.write_facts_to_path(self.known_placeholder_subset, "known_placeholder_subset.facts", FactRow_tuple2(Origin, Origin));
    if (r.$ === "Err") return r;
    r = wr.write_facts_to_path(self.placeholder, "placeholder.facts", FactRow_tuple2(Origin, Loan));
    if (r.$ === "Err") return r;
    return Ok(null);
  },
};

// impl Atom for BorrowIndex
export const Atom_BorrowIndex: Atom<BorrowIndex> = {
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:110 index
  index(self: BorrowIndex): number {
    return BorrowIndex.as_usize(self);
  },
};

// impl Atom for LocationIndex
export const Atom_LocationIndex: Atom<LocationIndex> = {
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:116 index
  index(self: LocationIndex): number {
    return LocationIndex.as_usize(self);
  },
};

declare module "./facts.gen.ts" {
  interface FactWriter {
    // facts.rs:127
    write_facts_to_path<T>(rows: readonly T[], file_name: string, T_: FactRow<T>): Result<null, IoError>;
  }
}

/**
 * `File::create_buffered(path)`: a `BufWriter<File>`. The bytes are kept until `drop()`, which flushes them (errors
 * ignored, as `BufWriter`'s `Drop`) and closes the file.
 */
// PORT: std's `BufWriter<File>`; the buffer is unbounded (the fact files are small and written once).
class BufferedFile implements Write {
  private chunks: Uint8Array[] = [];

  constructor(private fd: number) {}

  static create(path: string): IoResult<BufferedFile> {
    try {
      return Ok(new BufferedFile(openSync(path, "w")));
    } catch (e) {
      return Err(io_error_from_node(e));
    }
  }

  write(buf: Uint8Array): IoResult<number> {
    this.chunks.push(buf.slice());
    return Ok(buf.length);
  }

  write_all(buf: Uint8Array): IoResult<void> {
    return Write_default.write_all(this, buf);
  }

  write_fmt(args: FmtArguments): IoResult<void> {
    return Write_default.write_fmt(this, args);
  }

  flush(): IoResult<void> {
    try {
      for (const c of this.chunks) {
        let off = 0;
        while (off < c.length) off += writeSync(this.fd, c, off, c.length - off);
      }
      this.chunks = [];
      return Ok(undefined);
    } catch (e) {
      return Err(io_error_from_node(e));
    }
  }

  drop(): void {
    this.flush();
    closeSync(this.fd);
  }
}

// rustc: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:127 write_facts_to_path
FactWriter.prototype.write_facts_to_path = function <T>(this: FactWriter, rows: readonly T[], file_name: string, T_: FactRow<T>): Result<null, IoError> {
  const file_ = path_join(this.dir, file_name);
  const created = BufferedFile.create(file_);
  if (created.$ === "Err") return created;
  const file = created._0;
  try {
    for (const row of rows) {
      const r = T_.write(row, file, this.location_table);
      if (r.$ === "Err") return r;
    }
    return Ok(null);
  } finally {
    file.drop();
  }
};

export interface FactRow<T> {
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:141 write
  write(self: T, out: Write, location_table: PoloniusLocationTable): Result<null, IoError>;
}

/** `&self as &dyn FactCell`: `self` bound to its `FactCell` impl. */
function dyn_cell<T>(self: T, T_: FactCell<T>): DynFactCell {
  return { to_string: (location_table) => T_.to_string(self, location_table) };
}

// impl FactRow for PoloniusRegionVid
export const FactRow_PoloniusRegionVid: FactRow<PoloniusRegionVid> = {
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:149 write
  write(self: PoloniusRegionVid, out: Write, location_table: PoloniusLocationTable): Result<null, IoError> {
    return write_row(out, location_table, [dyn_cell(self, FactCell_PoloniusRegionVid)]);
  },
};

// impl<A: FactCell, B: FactCell> FactRow for (A, B)
export function FactRow_tuple2<A, B>(A_: FactCell<A>, B_: FactCell<B>): FactRow<readonly [A, B]> {
  return {
    // rustc: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:163 write
    write(self: readonly [A, B], out: Write, location_table: PoloniusLocationTable): Result<null, IoError> {
      return write_row(out, location_table, [dyn_cell(self[0], A_), dyn_cell(self[1], B_)]);
    },
  };
}

// impl<A: FactCell, B: FactCell, C: FactCell> FactRow for (A, B, C)
export function FactRow_tuple3<A, B, C>(A_: FactCell<A>, B_: FactCell<B>, C_: FactCell<C>): FactRow<readonly [A, B, C]> {
  return {
    // rustc: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:178 write
    write(self: readonly [A, B, C], out: Write, location_table: PoloniusLocationTable): Result<null, IoError> {
      return write_row(out, location_table, [dyn_cell(self[0], A_), dyn_cell(self[1], B_), dyn_cell(self[2], C_)]);
    },
  };
}

// rustc: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:187 write_row
export function write_row(out: Write, location_table: PoloniusLocationTable, columns: readonly DynFactCell[]): Result<null, IoError> {
  for (let index = 0; index < columns.length; index++) {
    const c = columns[index]!;
    const tail = index === columns.length - 1 ? "\n" : "\t";
    const r = out.write_fmt([`${debug_str(c.to_string(location_table))}${tail}`]);
    if (r.$ === "Err") return r;
  }
  return Ok(null);
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
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:204 to_string
  to_string(self: BorrowIndex, _location_table: PoloniusLocationTable): string {
    return BorrowIndex.debug(self, PLAIN);
  },
};

// impl FactCell for Local
export const FactCell_Local: FactCell<Local> = {
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:210 to_string
  to_string(self: Local, _location_table: PoloniusLocationTable): string {
    return Local.debug(self, PLAIN);
  },
};

// impl FactCell for MovePathIndex
export const FactCell_MovePathIndex: FactCell<MovePathIndex> = {
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:216 to_string
  to_string(self: MovePathIndex, _location_table: PoloniusLocationTable): string {
    return MovePathIndex.debug(self, PLAIN);
  },
};

// impl FactCell for PoloniusRegionVid
export const FactCell_PoloniusRegionVid: FactCell<PoloniusRegionVid> = {
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:222 to_string
  to_string(self: PoloniusRegionVid, _location_table: PoloniusLocationTable): string {
    return PoloniusRegionVid.debug(self, PLAIN);
  },
};

// impl FactCell for RegionVid
export const FactCell_RegionVid: FactCell<RegionVid> = {
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:228 to_string
  to_string(self: RegionVid, _location_table: PoloniusLocationTable): string {
    return RegionVid.debug(self, PLAIN);
  },
};

// impl FactCell for LocationIndex
export const FactCell_LocationIndex: FactCell<LocationIndex> = {
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/facts.rs:234 to_string
  to_string(self: LocationIndex, location_table: PoloniusLocationTable): string {
    return debug_RichLocation(location_table.to_rich_location(self), PLAIN);
  },
};
