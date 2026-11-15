//! Oracle probe for the vendored object writer, `src/vendor/object/write/` (lane harness-w40s; adopted from the
//! vendor-object-write review's scratch probe, N2). Runs a script of `object::write::Object` operations on the oracle
//! toolchain's own `object` 0.39.1 (the copy inside librustc_driver that rustc_codegen_ssa writes objects with) and
//! prints what each step returns and every object it writes. Its twin, tools/probes/objwrite/twin.ts, runs the same
//! script on the port and prints the same text; tools/probes/objwrite/objwrite.test.ts compares the twin with the
//! committed output of this probe (tools/probes/objwrite/objwrite.oracle.txt), and tools/probes/fixtures.test.ts checks
//! that file against this probe.
//!
//!   objwrite <script>
//!
//! The script (tools/probes/objwrite/cases.txt) is one operation per line, `#` comments; `<sec>` and `<sym>` are
//! indexes into the sections and symbols the script has made since its last `new`:
//!   new <Elf|MachO> <Architecture> <Little|Big>          a fresh `Object`
//!   subsections                                          set_subsections_via_symbols
//!   sid <StandardSection> | subsec <StandardSection> <name> | addsec <segment|-> <name> <SectionKind>
//!   data <sec> <len> <align> | bss <sec> <size> <align>  append_section_data (pattern bytes) / append_section_bss
//!   sym <name> <SymbolKind> <SymbolScope> <weak 0|1> <U|A|C|N|sec>      add_symbol
//!   symdata <sym> <sec> <len> <align> | symbss <sym> <sec> <size> <align>
//!   common <name> <SymbolKind> <SymbolScope> <size> <align> | filesym <name> | secsym <sec>
//!   symid <name> | symsecoff <sym>
//!   reloc <sec> <offset> <sym> <addend> <RelocationKind> <RelocationEncoding> <size>     Generic flags
//!   relocsub ... as reloc ... <subtractor sym|->         add_relocation_with_subtractor
//!   relocmacho <sec> <offset> <sym> <addend> <r_type> <r_pcrel 0|1> <r_length>
//!   relocelf <sec> <offset> <sym> <addend> <r_type>
//!   comdat <sym> <sec,sec,...> [nodup]                   add_comdat (Any, or NoDuplicates)
//!   gnuprop <pr_type> <pr_data>                          add_elf_gnu_property_u32
//!   out <name>                                           write()
//!
//! Output, per `out`: `out <name>`, then one line per logged step since the last `new` (`data <offset>`,
//! `sym SymbolId(n)`, `reloc Ok(())` / `reloc Err(Error("..."))`, ...; on a write error `write Err(<Debug>) <Display>`),
//! then for a written object `object <length>` and its bytes, 32 per line as `<offset hex>: <hex>`.
#![feature(rustc_private)]

extern crate rustc_driver;
extern crate object;

use std::fmt::Write as _;

use object::write::*;
use object::*;

fn pat(n: usize) -> Vec<u8> {
    (0..n).map(|i| ((i * 13 + 5) & 0xff) as u8).collect()
}

fn std_sec(s: &str) -> StandardSection {
    match s {
        "Text" => StandardSection::Text,
        "Data" => StandardSection::Data,
        "ReadOnlyData" => StandardSection::ReadOnlyData,
        "ReadOnlyDataWithRel" => StandardSection::ReadOnlyDataWithRel,
        "ReadOnlyString" => StandardSection::ReadOnlyString,
        "UninitializedData" => StandardSection::UninitializedData,
        "Tls" => StandardSection::Tls,
        "UninitializedTls" => StandardSection::UninitializedTls,
        "TlsVariables" => StandardSection::TlsVariables,
        "Common" => StandardSection::Common,
        "GnuProperty" => StandardSection::GnuProperty,
        "EhFrame" => StandardSection::EhFrame,
        _ => panic!("{s}"),
    }
}

fn kind(s: &str) -> SymbolKind {
    match s {
        "Unknown" => SymbolKind::Unknown,
        "Text" => SymbolKind::Text,
        "Data" => SymbolKind::Data,
        "Section" => SymbolKind::Section,
        "File" => SymbolKind::File,
        "Label" => SymbolKind::Label,
        "Tls" => SymbolKind::Tls,
        _ => panic!("{s}"),
    }
}

fn scope(s: &str) -> SymbolScope {
    match s {
        "Unknown" => SymbolScope::Unknown,
        "Compilation" => SymbolScope::Compilation,
        "Linkage" => SymbolScope::Linkage,
        "Dynamic" => SymbolScope::Dynamic,
        _ => panic!("{s}"),
    }
}

fn rk(s: &str) -> RelocationKind {
    match s {
        "None" => RelocationKind::None,
        "Absolute" => RelocationKind::Absolute,
        "Relative" => RelocationKind::Relative,
        "Got" => RelocationKind::Got,
        "GotRelative" => RelocationKind::GotRelative,
        "GotBaseRelative" => RelocationKind::GotBaseRelative,
        "GotBaseOffset" => RelocationKind::GotBaseOffset,
        "PltRelative" => RelocationKind::PltRelative,
        "Unknown" => RelocationKind::Unknown,
        _ => panic!("{s}"),
    }
}

fn re(s: &str) -> RelocationEncoding {
    match s {
        "Generic" => RelocationEncoding::Generic,
        "X86Signed" => RelocationEncoding::X86Signed,
        "X86RipRelative" => RelocationEncoding::X86RipRelative,
        "X86RipRelativeMovq" => RelocationEncoding::X86RipRelativeMovq,
        "X86Branch" => RelocationEncoding::X86Branch,
        "AArch64Call" => RelocationEncoding::AArch64Call,
        "Unknown" => RelocationEncoding::Unknown,
        _ => panic!("{s}"),
    }
}

fn sk(s: &str) -> SectionKind {
    match s {
        "Text" => SectionKind::Text,
        "Data" => SectionKind::Data,
        "ReadOnlyData" => SectionKind::ReadOnlyData,
        "Tls" => SectionKind::Tls,
        "UninitializedData" => SectionKind::UninitializedData,
        "Other" => SectionKind::Other,
        _ => panic!("{s}"),
    }
}

fn arch(s: &str) -> Architecture {
    match s {
        "Aarch64" => Architecture::Aarch64,
        "X86_64" => Architecture::X86_64,
        "I386" => Architecture::I386,
        "Arm" => Architecture::Arm,
        "Mips64" => Architecture::Mips64,
        "Mips" => Architecture::Mips,
        "PowerPc64" => Architecture::PowerPc64,
        "PowerPc" => Architecture::PowerPc,
        "Riscv64" => Architecture::Riscv64,
        _ => panic!("{s}"),
    }
}

/// `object <length>`, then the bytes, 32 per line as `<offset hex>: <hex>`.
fn dump(out: &mut String, bytes: &[u8]) {
    writeln!(out, "object {}", bytes.len()).unwrap();
    for (i, chunk) in bytes.chunks(32).enumerate() {
        let hex: String = chunk.iter().map(|b| format!("{b:02x}")).collect();
        writeln!(out, "{:06x}: {hex}", i * 32).unwrap();
    }
}

fn main() {
    let script = std::fs::read_to_string(std::env::args().nth(1).expect("usage: objwrite <script>")).unwrap();
    let mut obj: Option<write::Object> = None;
    let mut secs: Vec<SectionId> = vec![];
    let mut syms: Vec<SymbolId> = vec![];
    let mut log = String::new();
    let mut out = String::new();
    for line in script.lines() {
        let t: Vec<&str> = line.split_whitespace().collect();
        if t.is_empty() || t[0].starts_with('#') {
            continue;
        }
        let n = |i: usize| -> u64 { t[i].parse().unwrap() };
        let o = obj.as_mut();
        match t[0] {
            "new" => {
                let f = if t[1] == "Elf" { BinaryFormat::Elf } else { BinaryFormat::MachO };
                let e = if t[3] == "Little" { Endianness::Little } else { Endianness::Big };
                obj = Some(write::Object::new(f, arch(t[2]), e));
                secs.clear();
                syms.clear();
                log.clear();
            }
            "subsections" => o.unwrap().set_subsections_via_symbols(),
            "sid" => secs.push(o.unwrap().section_id(std_sec(t[1]))),
            "subsec" => secs.push(o.unwrap().add_subsection(std_sec(t[1]), t[2].as_bytes())),
            "addsec" => {
                let seg = if t[1] == "-" { vec![] } else { t[1].as_bytes().to_vec() };
                secs.push(o.unwrap().add_section(seg, t[2].as_bytes().to_vec(), sk(t[3])))
            }
            "data" => {
                let r = o.unwrap().append_section_data(secs[n(1) as usize], &pat(n(2) as usize), n(3));
                writeln!(log, "data {r}").unwrap();
            }
            "bss" => {
                let r = o.unwrap().append_section_bss(secs[n(1) as usize], n(2), n(3));
                writeln!(log, "bss {r}").unwrap();
            }
            "sym" => {
                let section = match t[5] {
                    "U" => write::SymbolSection::Undefined,
                    "A" => write::SymbolSection::Absolute,
                    "C" => write::SymbolSection::Common,
                    "N" => write::SymbolSection::None,
                    x => write::SymbolSection::Section(secs[x.parse::<usize>().unwrap()]),
                };
                let id = o.unwrap().add_symbol(write::Symbol {
                    name: t[1].as_bytes().to_vec(),
                    value: 0,
                    size: 0,
                    kind: kind(t[2]),
                    scope: scope(t[3]),
                    weak: t[4] == "1",
                    section,
                    flags: SymbolFlags::None,
                });
                writeln!(log, "sym {:?}", id).unwrap();
                syms.push(id);
            }
            "symdata" => {
                let r = o.unwrap().add_symbol_data(syms[n(1) as usize], secs[n(2) as usize], &pat(n(3) as usize), n(4));
                writeln!(log, "symdata {r}").unwrap();
            }
            "symbss" => {
                let r = o.unwrap().add_symbol_bss(syms[n(1) as usize], secs[n(2) as usize], n(3), n(4));
                writeln!(log, "symbss {r}").unwrap();
            }
            "common" => {
                let id = o.unwrap().add_common_symbol(
                    write::Symbol {
                        name: t[1].as_bytes().to_vec(),
                        value: 0,
                        size: 0,
                        kind: kind(t[2]),
                        scope: scope(t[3]),
                        weak: false,
                        section: write::SymbolSection::Undefined,
                        flags: SymbolFlags::None,
                    },
                    n(4),
                    n(5),
                );
                writeln!(log, "common {:?}", id).unwrap();
                syms.push(id);
            }
            "filesym" => {
                let id = o.unwrap().add_file_symbol(t[1].as_bytes().to_vec());
                syms.push(id);
            }
            "secsym" => {
                let id = o.unwrap().section_symbol(secs[n(1) as usize]);
                writeln!(log, "secsym {:?}", id).unwrap();
                syms.push(id);
            }
            "symid" => {
                writeln!(log, "symid {:?}", o.unwrap().symbol_id(t[1].as_bytes())).unwrap();
            }
            "symsecoff" => {
                writeln!(log, "symsecoff {:?}", o.unwrap().symbol_section_and_offset(syms[n(1) as usize])).unwrap();
            }
            "reloc" | "relocsub" => {
                let flags = RelocationFlags::Generic { kind: rk(t[5]), encoding: re(t[6]), size: n(7) as u8 };
                let rel = write::Relocation { offset: n(2), symbol: syms[n(3) as usize], addend: t[4].parse::<i64>().unwrap(), flags };
                let sec = secs[n(1) as usize];
                let r = if t[0] == "reloc" {
                    o.unwrap().add_relocation(sec, rel)
                } else {
                    let sub = if t[8] == "-" { None } else { Some(syms[n(8) as usize]) };
                    o.unwrap().add_relocation_with_subtractor(sec, rel, sub)
                };
                writeln!(log, "{} {:?}", t[0], r).unwrap();
            }
            "relocmacho" => {
                let flags = RelocationFlags::MachO { r_type: n(5) as u8, r_pcrel: t[6] == "1", r_length: n(7) as u8 };
                let rel = write::Relocation { offset: n(2), symbol: syms[n(3) as usize], addend: t[4].parse::<i64>().unwrap(), flags };
                let r = o.unwrap().add_relocation(secs[n(1) as usize], rel);
                writeln!(log, "relocmacho {:?}", r).unwrap();
            }
            "relocelf" => {
                let flags = RelocationFlags::Elf { r_type: n(5) as u32 };
                let rel = write::Relocation { offset: n(2), symbol: syms[n(3) as usize], addend: t[4].parse::<i64>().unwrap(), flags };
                let r = o.unwrap().add_relocation(secs[n(1) as usize], rel);
                writeln!(log, "relocelf {:?}", r).unwrap();
            }
            "comdat" => {
                let sections = t[2].split(',').map(|x| secs[x.parse::<usize>().unwrap()]).collect();
                let kind = if t.len() > 3 { ComdatKind::NoDuplicates } else { ComdatKind::Any };
                let id = o.unwrap().add_comdat(write::Comdat { kind, symbol: syms[n(1) as usize], sections });
                writeln!(log, "comdat {:?}", id).unwrap();
            }
            "gnuprop" => o.unwrap().add_elf_gnu_property_u32(n(1) as u32, n(2) as u32),
            "out" => {
                let r = obj.as_ref().unwrap().write();
                if let Err(e) = &r {
                    writeln!(log, "write Err({:?}) {}", e, e).unwrap();
                }
                writeln!(out, "out {}", t[1]).unwrap();
                out.push_str(&log);
                if let Ok(b) = &r {
                    dump(&mut out, b);
                }
            }
            x => panic!("op {x}"),
        }
    }
    print!("{out}");
}
