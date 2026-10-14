struct Priv;
pub struct Pub;
pub trait PubTr {
    type Alias;
}
impl PubTr for Pub {
    type Alias = Priv;
}
mod m {
    pub(crate) struct CratePriv;
    pub struct Inner;
    impl crate::PubTr for Inner {
        type Alias = CratePriv;
    }
}
