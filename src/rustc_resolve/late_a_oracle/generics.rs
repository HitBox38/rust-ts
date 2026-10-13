// Generic parameters (late.rs: visit_generic_params forward-ban ribs, visit_generics, visit_where_predicate,
// visit_poly_trait_ref) and lifetime errors in bounds.
#![allow(unused)]
struct Fwd<T = U, U = u8>(T, U);
struct SelfDefault<T = Self>(T);
struct Ok<T, U = T>(T, U);
trait Tr<'a> {}
fn hrtb<F>(f: F)
where
    F: for<'a> Tr<'a>,
{
}
fn anon_in_bound<T: Tr<'_>>(t: T) {}
fn undeclared_lt(x: &'b u8) {}
fn missing() -> &u8 {
    loop {}
}
