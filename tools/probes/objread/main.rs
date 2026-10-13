//! Oracle probe for src/rustc_codegen_ssa/back/metadata.oracle.test.ts (lane object-read): runs the
//! oracle compiler's own `rustc_codegen_ssa::back::metadata::DefaultMetadataLoader` on files.
//!
//!   objread <target-tuple> <sysroot> <file>...
//!
//! Output, per file:
//!   file <path>
//!     rlib ok len=<n> head=<hex of the first 64 bytes> fnv=<FNV-1a 64 of all bytes, hex>
//!     rlib err <message>
//!     dylib ok ... | dylib err ...
//! (`rlib` is `get_rlib_metadata`, `dylib` is `get_dylib_metadata`; the target only matters
//! through `is_like_aix`.)
#![feature(rustc_private)]

extern crate rustc_codegen_ssa;
extern crate rustc_driver;
extern crate rustc_metadata;
extern crate rustc_target;

use std::path::Path;

use rustc_codegen_ssa::back::metadata::DefaultMetadataLoader;
use rustc_metadata::creader::MetadataLoader;
use rustc_target::spec::{Target, TargetTuple};

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for &b in bytes {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let tuple = TargetTuple::from_tuple(&args[1]);
    let (target, _) = Target::search(&tuple, Path::new(&args[2]), false).expect("target");
    let loader = DefaultMetadataLoader;
    for p in &args[3..] {
        println!("file {p}");
        let path = Path::new(p);
        for (kind, r) in [
            ("rlib", loader.get_rlib_metadata(&target, path)),
            ("dylib", loader.get_dylib_metadata(&target, path)),
        ] {
            match r {
                Ok(s) => println!(
                    "  {kind} ok len={} head={} fnv={:016x}",
                    s.len(),
                    hex(&s[..s.len().min(64)]),
                    fnv1a64(&s)
                ),
                Err(e) => println!("  {kind} err {e}"),
            }
        }
    }
}
