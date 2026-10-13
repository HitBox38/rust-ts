//! Oracle probe for src/rustc_codegen_ssa/back/metadata.oracle.test.ts (lane object-read): lists
//! what the `object` crate (0.39.1, rustc_codegen_ssa's features) sees in archives and object files.
//!
//!   objlist <file>...
//!
//! Output, per file:
//!   file <path>
//!     archive <ArchiveKind:?> thin=<bool>          | archive err <message>
//!     member <name, lossy UTF-8 :?> <offset> <size> | member err <message>   (each member, in order)
//!     object <member name or "-"> <BinaryFormat:?> | object err <message>   (lib.rmeta members; non-archives)
//!     section <name> <offset> <size>  | section <name> none | section <name> nodata  (name: .rmeta for
//!     members, .rustc for files; offsets relative to the member / file; `nodata`: no file range)
//!     data ok len=<n> | data err <message>
use object::read::archive::ArchiveFile;
use object::{Object, ObjectSection};

fn object(label: &str, bytes: &[u8], section: &str) {
    match object::File::parse(bytes) {
        Err(e) => println!("  object {label} err {e}"),
        Ok(file) => {
            println!("  object {label} {:?}", file.format());
            match file.section_by_name(section) {
                None => println!("  section {section} none"),
                Some(s) => {
                    match s.file_range() {
                        Some((o, n)) => println!("  section {section} {o} {n}"),
                        None => println!("  section {section} nodata"),
                    }
                    match s.data() {
                        Ok(d) => println!("  data ok len={}", d.len()),
                        Err(e) => println!("  data err {e}"),
                    }
                }
            }
        }
    }
}

fn main() {
    for p in std::env::args().skip(1) {
        println!("file {p}");
        let data = std::fs::read(&p).expect("read");
        match ArchiveFile::parse(&*data) {
            Err(e) => {
                println!("  archive err {e}");
                object("-", &data, ".rustc");
            }
            Ok(archive) => {
                println!("  archive {:?} thin={}", archive.kind(), archive.is_thin());
                for m in archive.members() {
                    match m {
                        Err(e) => {
                            println!("  member err {e}");
                            break;
                        }
                        Ok(m) => {
                            let name = String::from_utf8_lossy(m.name()).into_owned();
                            let (o, n) = m.file_range();
                            println!("  member {name:?} {o} {n}");
                            if m.name() == b"lib.rmeta" {
                                match m.data(&*data) {
                                    Err(e) => println!("  member-data err {e}"),
                                    Ok(d) => object(&format!("{name:?}"), d, ".rmeta"),
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
