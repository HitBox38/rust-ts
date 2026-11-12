// Fixture of abi_consts.test.ts (lane cg-abi-consts): one `#[no_mangle]` fn per ABI shape, plus callers (`call_all`) and fns
// whose argument is spilled to memory (`spill_*`). The oracle's `--emit=llvm-ir`
// shows each fn's LLVM signature (return and parameter types, their attributes, the calling convention) on its `define` /
// `declare` line; the port computes it with `FnAbiLlvmExt::{llvm_type, llvm_cconv, apply_attrs_llfn}` (abi.rs).
#![crate_type = "lib"]
#![no_std]
#![feature(rust_cold_cc)]
#![allow(dead_code, improper_ctypes_definitions)]

#[repr(C)]
pub struct Big3 { a: u64, b: u64, c: u64 }
#[repr(C)]
pub struct IntFloat { a: u32, b: f32 }
#[repr(C)]
pub struct DoubleInt { a: f64, b: u32 }
#[repr(C)]
pub struct Bytes3 { a: u8, b: u8, c: u8 }
pub struct RustPair { a: u32, b: u16 }

// Scalars, with the C ABI's integer extension.
#[no_mangle] pub extern "C" fn c_u8(x: u8) -> u8 { x }
#[no_mangle] pub extern "C" fn c_i16(x: i16) -> i16 { x }
#[no_mangle] pub extern "C" fn c_f64(x: f64, y: f32) -> f64 { x + y as f64 }
#[no_mangle] pub extern "C" fn c_bool(b: bool) -> bool { b }
#[no_mangle] pub fn r_bool(b: bool) -> bool { b }
#[no_mangle] pub fn r_u128(x: u128) -> u128 { x }
#[no_mangle] pub fn r_char(c: char) -> u32 { c as u32 }
// References and raw pointers.
#[no_mangle] pub fn r_ref(x: &u32) -> u32 { *x }
#[no_mangle] pub fn r_mut(x: &mut u64) { *x += 1 }
#[no_mangle] pub fn r_opt_ref(x: Option<&u16>) -> u16 { match x { Some(v) => *v, None => 0 } }
#[no_mangle] pub fn r_raw(x: *const u8) -> *const u8 { x }
// Pairs.
#[no_mangle] pub fn r_slice(x: &[u8]) -> &[u8] { x }
#[no_mangle] pub fn r_str(x: &str) -> usize { x.len() }
#[no_mangle] pub fn r_pair(p: RustPair) -> RustPair { p }
#[no_mangle] pub fn r_tuple(t: (u64, bool)) -> (u64, bool) { t }
// Indirect: sret and by-pointer.
#[no_mangle] pub fn r_big(x: [u64; 8]) -> [u64; 8] { x }
// extern "C" structs: byval, sret, cast targets.
#[no_mangle] pub extern "C" fn c_byval(s: Big3) -> u64 { s.a + s.b + s.c }
#[no_mangle] pub extern "C" fn c_sret(a: u64) -> Big3 { Big3 { a, b: a, c: a } }
#[no_mangle] pub extern "C" fn c_intfloat(s: IntFloat) -> IntFloat { s }
#[no_mangle] pub extern "C" fn c_doubleint(s: DoubleInt) -> DoubleInt { s }
#[no_mangle] pub extern "C" fn c_bytes3(s: Bytes3) -> Bytes3 { s }
// Ignored arguments.
#[no_mangle] pub fn r_zst(_u: (), x: u32) -> u32 { x }
// Calling conventions.
#[no_mangle] pub extern "win64" fn cc_win64(x: u32) -> u32 { x }
#[no_mangle] pub extern "sysv64" fn cc_sysv64(x: u32) -> u32 { x }
#[no_mangle] pub extern "rust-cold" fn cc_cold(x: u32) -> u32 { x }
// Never returns.
#[no_mangle] pub fn r_never() -> ! { loop {} }
// Call sites (the oracle's `call` lines).
#[no_mangle] pub fn call_all(b: Big3, x: [u64; 8], s: IntFloat) -> u64 {
    let r = c_sret(1);
    let _ = r_big(x);
    let _ = c_intfloat(s);
    r.a + c_byval(b) + c_u8(2) as u64 + c_i16(3) as u64 + cc_win64(4) as u64
}
// Arguments spilled to memory (`ArgAbiExt::store_fn_arg`, through rustc_codegen_ssa's `arg_local_refs`).
#[no_mangle] pub fn spill_pair(p: RustPair) -> u16 { let r = &p; r.b }
#[no_mangle] pub fn spill_direct(x: u64) -> u64 { let r = &x; *r }
#[no_mangle] pub fn spill_bool(b: bool) -> bool { let r = &b; *r }
