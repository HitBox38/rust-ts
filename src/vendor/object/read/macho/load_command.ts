// Port of object 0.39.1 `src/read/macho/load_command.rs` (the load command iterator and the
// segment / symtab commands `MachOFile::parse` reads).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: the `E: Endian` parameter is `Endianness` (see ../elf/file.ts); `T: Pod` arguments are
// passed as `Pod` values. `LoadCommandVariant` and the other command accessors are not ported
// (unused on rustc's path).

import { Err, Ok } from "../../../../std/result.ts";
import { type Endianness, U32 } from "../../endian.ts";
import * as macho from "../../macho.ts";
import type { Pod } from "../../pod.ts";
import { Error, read_error_unit, type Result } from "../mod.ts";
import { ReadRef } from "../read_ref.ts";
import { Bytes, StringTable } from "../util.ts";
import type { MachHeader } from "./file.ts";
import { SymbolTable } from "./symbol.ts";

/// An iterator for the load commands from a [`MachHeader`].
export class LoadCommandIterator {
  constructor(
    readonly endian: Endianness,
    public data: Bytes,
    public ncmds: number,
  ) {}

  // crate: object-0.39.1/src/read/macho/load_command.rs:19 new
  static new(endian: Endianness, data: Uint8Array, ncmds: number): LoadCommandIterator {
    return new LoadCommandIterator(endian, new Bytes(data), ncmds);
  }

  /// Return the next load command.
  // crate: object-0.39.1/src/read/macho/load_command.rs:28 next
  next(): Result<LoadCommandData | undefined> {
    if (this.ncmds === 0) {
      return Ok(undefined);
    }

    const result = this.parse();
    if (result.$ === "Err") {
      this.ncmds = 0;
    } else {
      this.ncmds -= 1;
    }
    return result;
  }

  // crate: object-0.39.1/src/read/macho/load_command.rs:42 parse
  parse(): Result<LoadCommandData> {
    const h = read_error_unit(this.data.read_at(macho.LoadCommand.POD, 0), "Invalid Mach-O load command header");
    if (h.$ === "Err") return h;
    const header = h._0;
    const cmd = U32.get(header.cmd, this.endian);
    const cmdsize = U32.get(header.cmdsize, this.endian);
    if (cmdsize < macho.LoadCommand.POD.size) {
      return Err(new Error("Invalid Mach-O load command size"));
    }
    const data = read_error_unit(this.data.read_bytes(cmdsize), "Invalid Mach-O load command size");
    if (data.$ === "Err") return data;
    return Ok(new LoadCommandData(cmd, data._0));
  }
}

/// The data for a [`macho::LoadCommand`].
export class LoadCommandData {
  constructor(
    readonly cmd_: number,
    // Includes the header.
    readonly data_: Bytes,
  ) {}

  /// Return the `cmd` field of the [`macho::LoadCommand`].
  ///
  /// This is one of the `LC_` constants.
  // crate: object-0.39.1/src/read/macho/load_command.rs:85 cmd
  cmd(): number {
    return this.cmd_;
  }

  /// Return the `cmdsize` field of the [`macho::LoadCommand`].
  // crate: object-0.39.1/src/read/macho/load_command.rs:90 cmdsize
  cmdsize(): number {
    return this.data_.len();
  }

  /// Parse the data as the given type.
  // crate: object-0.39.1/src/read/macho/load_command.rs:96 data
  data<T>(T: Pod<T>): Result<T> {
    return read_error_unit(this.data_.read_at(T, 0), "Invalid Mach-O command size");
  }

  /// Raw bytes of this [`macho::LoadCommand`] structure.
  // crate: object-0.39.1/src/read/macho/load_command.rs:103 raw_data
  raw_data(): Uint8Array {
    return this.data_._0;
  }

  /// Try to parse this command as a [`macho::SegmentCommand32`].
  ///
  /// Returns the segment command and the data containing the sections.
  // crate: object-0.39.1/src/read/macho/load_command.rs:188 segment_32
  segment_32(): Result<[macho.SegmentCommand32, Uint8Array] | undefined> {
    if (this.cmd_ === macho.LC_SEGMENT) {
      const data = new Bytes(this.data_._0);
      const segment = read_error_unit(data.read(macho.SegmentCommand32.POD), "Invalid Mach-O command size");
      if (segment.$ === "Err") return segment;
      return Ok([segment._0, data._0]);
    } else {
      return Ok(undefined);
    }
  }

  /// Try to parse this command as a [`macho::SymtabCommand`].
  // crate: object-0.39.1/src/read/macho/load_command.rs:199 symtab
  symtab(): Result<macho.SymtabCommand | undefined> {
    if (this.cmd_ === macho.LC_SYMTAB) {
      return this.data(macho.SymtabCommand.POD);
    } else {
      return Ok(undefined);
    }
  }

  /// Try to parse this command as a [`macho::SegmentCommand64`].
  // crate: object-0.39.1/src/read/macho/load_command.rs:265 segment_64
  segment_64(): Result<[macho.SegmentCommand64, Uint8Array] | undefined> {
    if (this.cmd_ === macho.LC_SEGMENT_64) {
      const data = new Bytes(this.data_._0);
      const command = read_error_unit(data.read(macho.SegmentCommand64.POD), "Invalid Mach-O command size");
      if (command.$ === "Err") return command;
      return Ok([command._0, data._0]);
    } else {
      return Ok(undefined);
    }
  }
}

// impl<E: Endian> macho::SymtabCommand<E>

/// Return the symbol table that this command references.
// crate: object-0.39.1/src/read/macho/load_command.rs:407 symbols
export function SymtabCommand_symbols(self: macho.SymtabCommand, Mach: MachHeader, endian: Endianness, data: Uint8Array): Result<SymbolTable> {
  const symbols = read_error_unit(
    ReadRef.read_slice_at(data, Mach.Nlist, U32.get(self.symoff, endian), U32.get(self.nsyms, endian)),
    "Invalid Mach-O symbol table offset or size",
  );
  if (symbols.$ === "Err") return symbols;
  const str_start = U32.get(self.stroff, endian);
  // `str_start.checked_add(strsize)` cannot overflow: both are u32 values.
  // ("Invalid Mach-O string table length")
  const str_end = str_start + U32.get(self.strsize, endian);
  const strings = StringTable.new(data, str_start, str_end);
  return Ok(SymbolTable.new(Mach, symbols._0, strings));
}
