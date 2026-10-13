mod a {
    pub fn helper() {}
}
mod m {
    use crate::a;

    fn g() {
        helper();
    }
}
