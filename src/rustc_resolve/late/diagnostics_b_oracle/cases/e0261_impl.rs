struct S<'b>(&'b u8);
impl<'b> S<'b> {
    fn f(&self, x: &'a u8) {}
}
