#![feature(no_core, lang_items)]
#![no_core]
#![allow(internal_features)]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "copy"]
pub trait Copy {}
#[lang = "ResumeTy"]
pub struct ResumeTy;
#[lang = "future_trait"]
pub trait Future {
    #[lang = "future_output"]
    type Output;
}

#[lang = "async_drop"]
pub trait AsyncDrop {}

#[lang = "Poll"]
pub enum Poll<T> {
    #[lang = "Ready"]
    Ready(T),
    #[lang = "Pending"]
    Pending,
}

async fn main() {}
