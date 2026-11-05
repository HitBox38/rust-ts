// An allocation dump with pointer fragments, concrete and wildcard (`mir/pretty.rs` `{prov:#?}`), and a whole pointer.
use std::alloc::{Layout, alloc};
use std::mem::{self, MaybeUninit};
use std::slice::from_raw_parts;

fn byte_with_provenance<T>(val: u8, prov: *const T, frag_idx: usize) -> MaybeUninit<u8> {
    let ptr = prov.with_addr(usize::from_ne_bytes([val; _]));
    let bytes: [MaybeUninit<u8>; mem::size_of::<*const ()>()] = unsafe { mem::transmute(ptr) };
    bytes[frag_idx]
}

fn main() {
    let layout = Layout::from_size_align(32, 8).unwrap();
    let local = 7u8;
    let exposed = std::ptr::with_exposed_provenance::<u8>((&raw const local).expose_provenance());
    unsafe {
        let ptr = alloc(layout);
        let ptr_raw = ptr.cast::<MaybeUninit<u8>>();
        *ptr_raw.add(0) = byte_with_provenance(0x42, &42u8, 0);
        *ptr.add(1) = 0x12;
        *ptr.add(2) = 0x13;
        *ptr_raw.add(3) = byte_with_provenance(0x43, &0u8, 1);
        *ptr_raw.add(4) = byte_with_provenance(0x4f, exposed, 2);
        ptr.add(16).cast::<*const u8>().write(&raw const local);
        let slice1 = from_raw_parts(ptr, 8);
        let slice2 = from_raw_parts(ptr.add(8), 8);
        drop(slice1.cmp(slice2));
    }
}
