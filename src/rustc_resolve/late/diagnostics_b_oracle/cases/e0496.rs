struct S<'a>(&'a u8);
impl<'a> S<'a> {
    fn f<'a>(x: &'a u8) {}
}
