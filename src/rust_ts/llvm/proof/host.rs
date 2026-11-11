#![crate_type = "lib"]
// Host target (aarch64-apple-darwin): its data layout, triple and module flags, a used static, an exported name,
// pointers into other statics and an external function.
use std::sync::atomic::AtomicUsize;
unsafe extern "C" {
    fn host_ext(x: u32) -> u32;
}
pub static COUNTER: AtomicUsize = AtomicUsize::new(5);
#[used]
static KEEP: [u8; 2] = [9, 8];
#[unsafe(export_name = "exported_name")]
pub static EXPORTED: u16 = 0xbeef;
pub static TABLE: [&u16; 2] = [&EXPORTED, &EXPORTED];
pub static HOOK: unsafe extern "C" fn(u32) -> u32 = host_ext;
pub static NESTED: (&str, [u64; 2], Option<&AtomicUsize>) = ("nested", [1, u64::MAX], Some(&COUNTER));
