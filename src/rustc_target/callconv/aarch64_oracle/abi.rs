// `#[rustc_abi(debug)]` over what compiler/rustc_target/src/callconv/aarch64.rs decides (plan-m7 O7): every branch of
// `classify_arg` / `classify_ret` that aarch64-apple-darwin and aarch64-unknown-linux-gnu reach. See regen.ts.
#![feature(no_core, lang_items, rustc_attrs, repr_simd, unsized_fn_params, f16, f128, auto_traits, negative_impls, freeze_impls)]
#![crate_type = "lib"]
#![no_core]
#![allow(improper_ctypes_definitions, improper_ctypes, dead_code, internal_features, incomplete_features, unused_variables)]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "copy"]
pub trait Copy {}
#[lang = "legacy_receiver"]
pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
#[lang = "freeze"]
pub unsafe auto trait Freeze {}
#[lang = "unsafe_cell"]
#[repr(transparent)]
pub struct UnsafeCell<T: PointeeSized>(T);
impl<T: PointeeSized> !Freeze for UnsafeCell<T> {}
impl Copy for f32 {}
impl Copy for f64 {}
impl Copy for u64 {}

// Homogeneous float aggregates: four members is the limit.
pub struct Hfa1 { a: f32 }
pub struct Hfa2 { a: f32, b: f32 }
pub struct Hfa3 { a: f64, b: f64, c: f64 }
pub struct Hfa4 { a: f32, b: f32, c: f32, d: f32 }
pub struct Hfa4D { a: [f64; 4] }
pub struct Hfa5 { a: f32, b: f32, c: f32, d: f32, e: f32 }
pub struct HfaNested { a: Hfa2, b: [f32; 2] }
pub struct HfaF16 { a: f16, b: f16 }
pub struct HfaF128 { a: f128, b: f128 }
pub struct MixedFloats { a: f32, b: f64 }
pub struct FloatAndInt { a: f32, b: u32 }
#[repr(C)]
pub union UnionSame { a: f32, b: [f32; 2] }
#[repr(C)]
pub union UnionMixed { a: f32, b: u32 }
#[repr(C)]
pub struct HfaC { a: f32, b: f32, c: f32 }
#[repr(C)]
pub struct ZstPadded { a: f32, z: [u64; 0], b: f32 }

// Homogeneous vector aggregates: 64 and 128 bits only.
#[repr(simd)]
pub struct F32x2([f32; 2]);
#[repr(simd)]
pub struct F32x4([f32; 4]);
#[repr(simd)]
pub struct F64x2([f64; 2]);
#[repr(simd)]
pub struct F32x8([f32; 8]);
#[repr(simd)]
pub struct U64x2([u64; 2]);
#[repr(simd)]
pub struct U8x4([u8; 4]);
pub struct Hva2 { a: F32x4, b: F32x4 }
pub struct Hva4 { a: F32x2, b: F32x2, c: F32x2, d: F32x2 }
pub struct Hva5 { a: F32x4, b: F32x4, c: F32x4, d: F32x4, e: F32x4 }
pub struct HvaInt { a: U64x2, b: U64x2 }
pub struct HvaWide { a: F32x8 }
// `is_homogeneous_aggregate`'s vector-size limit: only 64 and 128 bits count (docs/reviews/abi-vtable.md F2). `HvaWide` alone
// never gets there, being a one-field wrapper with `BackendRepr::SimdVector`.
pub struct Hva256 { a: F32x8, b: F32x8 }
pub struct Hva32 { a: U8x4, b: U8x4 }
pub struct HvaMixed { a: F32x2, b: F32x4 }
pub struct VecAndFloat { a: F32x4, b: f32 }

// Integer aggregates: up to 128 bits as a cast, then indirect.
pub struct Int3 { a: u8, b: u8, c: u8 }
pub struct Int8 { a: u32, b: u32 }
pub struct Int9 { a: [u8; 9] }
pub struct Int16 { a: u64, b: u64 }
pub struct Int17 { a: [u8; 17] }
pub struct Int24 { a: u64, b: u64, c: u64 }
pub struct WrapU128 { a: u128 }
pub struct WrapBool { a: bool }
pub struct WrapU8 { a: u8 }
pub struct WrapI16 { a: i16 }
pub struct WrapF32Int { a: f32, z: () }
#[repr(transparent)]
pub struct TransparentU8(u8);
#[repr(transparent)]
pub struct TransparentHfa(Hfa2);

// Alignment: AAPCS uses the unadjusted alignment, Darwin the adjusted one.
#[repr(align(16))]
pub struct Align16U8 { a: u8 }
#[repr(align(16))]
pub struct Align16U64 { a: u64 }
#[repr(align(16))]
pub struct Align16Pair { a: u64, b: u64 }
#[repr(align(32))]
pub struct Align32U8 { a: u8 }
#[repr(align(16))]
pub struct Align16Big { a: [u8; 32] }
#[repr(C, packed)]
pub struct Packed { a: u8, b: u64 }
#[repr(C, packed(2))]
pub struct Packed2 { a: u16, b: u64 }

// Enums, tuples, wide pointers, ZSTs, unsized, huge.
pub enum CLike { A, B }
#[repr(i16)]
pub enum Repr16 { A = 1, B = 2 }
pub enum Two { A(u32), B(f32) }
pub enum Big { A([u64; 4]), B }
pub enum MaybeU8 { Some(u8), None }
pub enum MaybeRef<'a> { Some(&'a u8), None }
pub struct Zst;
pub type Huge = [u8; 1099511627776];
pub type Huger = [u8; 1152921504606846976];

macro_rules! each_abi {
    ($($name:ident: $($arg:ty),* $(=> $ret:ty)?;)*) => {
        $(
            #[rustc_abi(debug)]
            pub type $name = extern "C" fn($($arg),*) $(-> $ret)?;
        )*
    };
}

each_abi! {
    CScalars: u8, i8, u16, i16, bool, char, u32, i32, u64, i64, u128, i128, f16, f32, f64, f128, *const u8, &u8, &mut u8 => i8;
    CRetU8: => u8;
    CRetI8: => i8;
    CRetU16: => u16;
    CRetI16: => i16;
    CRetBool: => bool;
    CRetChar: => char;
    CRetF32: => f32;
    CRetU128: => u128;
    CHfa1: Hfa1 => Hfa1;
    CHfa2: Hfa2 => Hfa2;
    CHfa3: Hfa3 => Hfa3;
    CHfa4: Hfa4 => Hfa4;
    CHfa4D: Hfa4D => Hfa4D;
    CHfa5: Hfa5 => Hfa5;
    CHfaNested: HfaNested => HfaNested;
    CHfaF16: HfaF16 => HfaF16;
    CHfaF128: HfaF128 => HfaF128;
    CMixedFloats: MixedFloats => MixedFloats;
    CFloatAndInt: FloatAndInt => FloatAndInt;
    CUnionSame: UnionSame => UnionSame;
    CUnionMixed: UnionMixed => UnionMixed;
    CHfaC: HfaC => HfaC;
    CZstPadded: ZstPadded => ZstPadded;
    CF32x2: F32x2 => F32x2;
    CF32x4: F32x4 => F32x4;
    CF64x2: F64x2 => F64x2;
    CF32x8: F32x8 => F32x8;
    CHva2: Hva2 => Hva2;
    CHva4: Hva4 => Hva4;
    CHva5: Hva5 => Hva5;
    CHvaInt: HvaInt => HvaInt;
    CHvaWide: HvaWide => HvaWide;
    CHvaMixed: HvaMixed => HvaMixed;
    CVecAndFloat: VecAndFloat => VecAndFloat;
    CInt3: Int3 => Int3;
    CInt8: Int8 => Int8;
    CInt9: Int9 => Int9;
    CInt16: Int16 => Int16;
    CInt17: Int17 => Int17;
    CInt24: Int24 => Int24;
    CWrapU128: WrapU128 => WrapU128;
    CWrapBool: WrapBool => WrapBool;
    CWrapU8: WrapU8 => WrapU8;
    CWrapI16: WrapI16 => WrapI16;
    CWrapF32Int: WrapF32Int => WrapF32Int;
    CTransparentU8: TransparentU8 => TransparentU8;
    CTransparentHfa: TransparentHfa => TransparentHfa;
    CAlign16U8: Align16U8 => Align16U8;
    CAlign16U64: Align16U64 => Align16U64;
    CAlign16Pair: Align16Pair => Align16Pair;
    CAlign32U8: Align32U8 => Align32U8;
    CAlign16Big: Align16Big => Align16Big;
    CPacked: Packed => Packed;
    CPacked2: Packed2 => Packed2;
    CCLike: CLike => CLike;
    CRepr16: Repr16 => Repr16;
    CTwo: Two => Two;
    CBig: Big => Big;
    CMaybeU8: MaybeU8 => MaybeU8;
    CMaybeRef: MaybeRef<'static> => MaybeRef<'static>;
    CTuple: (u8, u32) => (u8, u32);
    CTupleFloats: (f32, f32) => (f32, f32);
    CTupleFloatInt: (f64, u8) => (f64, u8);
    CArray: [u32; 2] => [f32; 2];
    CArrayBig: [u64; 3] => [f64; 5];
    CUnit: () => ();
    CZst: Zst, [u8; 0], u8 => Zst;
    CWide: &'static [u8], *const [u8], &'static mut [f32] => &'static [u8];
    CHuge: Huge => Huge;
    CHuger: Huger => Huger;
}

#[rustc_abi(debug)]
pub type CVariadic = unsafe extern "C" fn(i32, u8, Hfa2, ...) -> u16;
#[rustc_abi(debug)]
pub type CUnwind = extern "C-unwind" fn(Hfa2, Int9, Int24) -> Hfa5;
#[rustc_abi(debug)]
pub type SystemAbi = extern "system" fn(u8, Hfa2, Int9, Int24) -> i16;

// `extern "C"` items (`fn_abi_of_instance`): unsized by-value arguments, and deduced attributes under -O.
#[rustc_abi(debug)]
pub extern "C" fn c_item_unsized(x: [u8]) {}
#[rustc_abi(debug)]
pub extern "C" fn c_item_hfa(x: Hfa4, y: &Hfa2, z: Int24) -> Hfa2 {
    loop {}
}
#[rustc_abi(debug)]
pub fn rust_item_unsized(x: [u8]) {}
#[rustc_abi(debug)]
pub fn rust_item(x: Hfa4, y: &Hfa2, z: Int24, a: Int9, b: F32x4, c: u8, d: &mut u8) -> Hfa2 {
    loop {}
}

// The Rust ABI goes through `compute_rust_abi_info`, and then through `adjust_for_rust_abi`'s common code.
#[rustc_abi(debug)]
pub type RustSmall = fn(u8, i16, f32, bool, char, Hfa2, Int3, Int16, Int24, (f32, f32), (f64, u8), MaybeU8) -> Hfa5;
#[rustc_abi(debug)]
pub type RustVectors = fn(F32x2, F32x4, F32x8, Hva2, &'static [u8], u128) -> F32x4;
#[rustc_abi(debug)]
pub type RustRet = fn() -> Int16;

// The early returns of `classify_ret` and `classify_arg`.
#[repr(C)]
#[rustc_pass_indirectly_in_non_rustic_abis]
pub struct PassIndirectly(u8);
#[rustc_abi(debug)]
pub type CPassIndirectly = extern "C" fn(PassIndirectly);
#[rustc_abi(debug)]
pub type RustPassIndirectly = fn(PassIndirectly);
#[rustc_abi(debug)]
pub type CHva256 = extern "C" fn(Hva256) -> Hva256;
#[rustc_abi(debug)]
pub type CHva32 = extern "C" fn(Hva32) -> Hva32;
#[rustc_scalable_vector(4)]
pub struct Svint32(i32);
#[rustc_abi(debug)]
pub type CScalable = extern "C" fn(Svint32) -> Svint32;
