mod a {
    mod hidden {
        pub fn run() {}
    }
    pub use self::hidden::run;
}
mod m {
    fn g() {
        run();
    }
}
