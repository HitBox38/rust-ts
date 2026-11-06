// `#[rustc_abi(debug)]` by value at the sizes `callconv/mod.rs`'s and `x86_64.rs`'s comparisons turn on: one and two pointers,
// and either side of 2^53 up to `obj_size_bound`, where a `number` would stop or round (docs/reviews/abi-vtable.md F3). See regen.ts.
#![feature(no_core, lang_items, rustc_attrs, auto_traits, repr_simd)]
#![crate_type = "lib"]
#![no_core]
#![allow(improper_ctypes_definitions, dead_code, internal_features)]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "copy"]
pub trait Copy {}
#[lang = "freeze"]
pub unsafe auto trait Freeze {}
impl Copy for u8 {}

#[repr(simd)]
pub struct V64([f64; 8]);
pub struct B8([u8; 8]);
pub struct B9([u8; 9]);
pub struct B16([u8; 16]);
pub struct B17([u8; 17]);
pub struct B53Below([u8; 9007199254740991]);
pub struct B53([u8; 9007199254740992]);
pub struct B53Above([u8; 9007199254740993]);
pub struct B60([u8; 1152921504606846976]);
pub struct B61Below([u8; 2305843009213693951]);

macro_rules! each_size {
    ($($rust:ident $c:ident: $ty:ty;)*) => {
        $(
            #[rustc_abi(debug)]
            pub type $rust = fn($ty) -> $ty;
            #[rustc_abi(debug)]
            pub type $c = extern "C" fn($ty) -> $ty;
        )*
    };
}

each_size! {
    RustV64 CV64: V64;
    Rust8 C8: B8;
    Rust9 C9: B9;
    Rust16 C16: B16;
    Rust17 C17: B17;
    Rust53Below C53Below: B53Below;
    Rust53 C53: B53;
    Rust53Above C53Above: B53Above;
    Rust60 C60: B60;
    Rust61Below C61Below: B61Below;
}
