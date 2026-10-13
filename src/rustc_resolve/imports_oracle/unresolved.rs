// imports.test.ts: unresolved imports and their suggestions (similar names, missing modules,
// grouped per `use` item, glob of a non-module, self-import).
pub mod a {
    pub struct Thing;
    pub struct Other;
    pub mod inner { pub struct Deep; }
}
use crate::a::Thinng;
use crate::a::{Thing, Missing, Another};
use crate::nope::X;
use crate::a::innr::Deep;
use nonexistent_crate;
use crate::a::Thing::*;
mod m { use self::*; }
use crate::a::inner::{self as inn, Deeep};
