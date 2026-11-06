// Fixture of long_type.oracle.test.ts: a type too long for the diagnostic width, reported twice.
#![feature(no_core, lang_items)]
#![no_core]
#![crate_type = "lib"]
#[lang = "pointee_sized"]
trait PointeeSized {}
#[lang = "meta_sized"]
trait MetaSized: PointeeSized {}
#[lang = "sized"]
trait Sized: MetaSized {}
struct S<A, B>(*const A, *const B);
trait Trait {}
fn require_trait<T: Trait>() {}
type A = S<S<u8, u16>, S<u32, u64>>;
type B = S<S<A, A>, S<A, A>>;
type C = S<S<B, B>, S<B, B>>;
fn f() {
    require_trait::<C>();
    require_trait::<C>();
}
