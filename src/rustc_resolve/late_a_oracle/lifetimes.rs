// Lifetime resolution and elision (late.rs: resolve_lifetime, resolve_anonymous_lifetime,
// resolve_elided_lifetime, create_fresh_lifetime, resolve_fn_signature / resolve_fn_params,
// find_lifetime_for_self, resolve_elided_lifetimes_in_path).
#![allow(unused)]
struct S<'a> {
    x: &'a u8,
}
struct T<'a, 'b>(&'a u8, &'b u8);
fn elided(x: &u8) -> &u8 {
    x
}
fn named<'a>(s: S<'a>, y: &'static u8) -> S<'a> {
    s
}
fn underscore(s: S<'_>) {}
fn in_path(s: S) -> S {
    s
}
fn two(a: &u8, b: &u8) {}
fn fn_ptr(f: for<'a> fn(&'a u8) -> &'a u8, g: fn(&u8) -> &u8) {}
fn with_closure() {
    let c = |x: &u8| -> &u8 { x };
}
struct W;
impl W {
    fn by_ref(&self, x: &u8) -> &u8 {
        x
    }
    fn by_self<'a>(self: &'a Self) -> &'a W {
        self
    }
}
