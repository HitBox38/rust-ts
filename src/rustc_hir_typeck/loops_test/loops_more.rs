#![feature(no_core, lang_items, loop_match)]
#![no_core]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}

pub fn a() { while break {} }
pub fn b() { loop { while continue {} } }
pub fn c() { { if true { break; } } }
pub fn d() { let _x = const { break; }; }
pub fn e() { unsafe { break; } }
pub fn f() { 'a: { if true { break 'a; } } }
pub fn g(mut state: u8) {
    #[loop_match]
    loop {
        state = 'blk: {
            match state {
                _ => {
                    #[const_continue]
                    break 'blk 1;
                }
            }
        };
    }
}
pub fn h() {
    'outer: loop {
        #[const_continue]
        break 'outer;
    }
}
