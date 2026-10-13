mod m {
    #[macro_export]
    macro_rules! makro {
        () => {};
    }
    pub struct Other;
    pub struct Third;
}
use crate::m::{makro, Other};
use crate::m::{Third, makro as renamed};
use crate::m::makro as plain;
mod inner {
    pub(crate) use super::m::{Other, makro};
}
