// A std lib crate that names `libfoo.a` in a `#[link]` attribute (harness/suites.ts `rlib-native`).
#[link(name = "foo", kind = "static")]
unsafe extern "C" {
    pub fn bar_fn() -> i32;
}

pub fn call() -> i32 {
    unsafe { bar_fn() }
}
