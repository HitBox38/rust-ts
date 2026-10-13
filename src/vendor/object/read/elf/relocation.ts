// Port of object 0.39.1 `src/read/elf/relocation.rs` (`RelocationSections`, which
// `ElfFile::parse` builds).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: the relocation iterators and `Rel`/`Rela`/`Crel` readers are not ported (unused on
// rustc's path).

import { Err, Ok } from "../../../../std/result.ts";
import * as elf from "../../elf.ts";
import type { Endianness } from "../../endian.ts";
import { Error, type Result, SectionIndex } from "../mod.ts";
import { SectionHeader_provided, type SectionTable } from "./section.ts";

/// A mapping from section index to associated relocation sections.
export class RelocationSections {
  constructor(readonly relocations: number[]) {}

  static default(): RelocationSections {
    return new RelocationSections([]);
  }

  /// Create a new mapping using the section table.
  ///
  /// Skips relocation sections that do not use the given symbol table section.
  // crate: object-0.39.1/src/read/elf/relocation.rs:26 parse
  static parse(endian: Endianness, sections: SectionTable, symbol_section: SectionIndex): Result<RelocationSections> {
    const SH = sections.Elf.SectionHeader;
    const relocations: number[] = new Array<number>(sections.len()).fill(0);
    for (let index = sections.len() - 1; index >= 0; index--) {
      const section = sections.sections.at(index);
      const sh_type = SH.sh_type(section, endian);
      if (sh_type === elf.SHT_REL || sh_type === elf.SHT_RELA || sh_type === elf.SHT_CREL) {
        // The symbol indices used in relocations must be for the symbol table
        // we are expecting to use.
        const sh_link = SectionHeader_provided.link(SH, section, endian);
        if (sh_link !== symbol_section) {
          continue;
        }

        const sh_info = SectionHeader_provided.info_link(SH, section, endian);
        if (sh_info === SectionIndex(0)) {
          // Skip dynamic relocations.
          continue;
        }
        if (sh_info >= relocations.length) {
          return Err(new Error("Invalid ELF sh_info for relocation section"));
        }

        // We don't support relocations that apply to other relocation sections
        // because it interferes with the chaining of relocation sections below.
        const s = sections.section(sh_info);
        if (s.$ === "Err") return s;
        const sh_info_type = SH.sh_type(s._0, endian);
        if (sh_info_type === elf.SHT_REL || sh_info_type === elf.SHT_RELA || sh_info_type === elf.SHT_CREL) {
          return Err(new Error("Unsupported ELF sh_info for relocation section"));
        }

        // Handle multiple relocation sections by chaining them.
        const next = relocations[sh_info]!;
        relocations[sh_info] = index;
        relocations[index] = next;
      }
    }
    return Ok(new RelocationSections(relocations));
  }

  /// Given a section index, return the section index of the associated relocation section.
  ///
  /// This may also be called with a relocation section index, and it will return the
  /// next associated relocation section.
  // crate: object-0.39.1/src/read/elf/relocation.rs:74 get
  get(index: SectionIndex): SectionIndex | undefined {
    const x = this.relocations[index];
    if (x === undefined || x === 0) return undefined;
    return SectionIndex(x);
  }
}
