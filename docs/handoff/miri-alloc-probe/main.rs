// Oracle probe for src/miri/alloc_addresses/{address_generator,reuse_pool,mod}.ts (lane miri-alloc).
// The address-assignment logic of Miri at the pin (alloc_addresses/address_generator.rs `generate`,
// reuse_pool.rs `add_addr` / `take_addr` / `address_space_shortage`, and the reuse-or-generate choice of
// alloc_addresses/mod.rs `addr_from_alloc_id_uncached` + `free_alloc_id`), copied with the rustc types replaced
// (Size/Align -> u64, ThreadId -> u32, VClock -> the donor thread id, MemoryKind -> Stack/Heap), driven by the real
// rand 0.10.1 `StdRng::seed_from_u64` that Miri uses. A scripted op sequence (its own LCG, not the rng) is printed
// with each result, so the TS test replays the script and compares the results line by line.
use rand::rngs::StdRng;
use rand::{Rng, RngExt, SeedableRng};

fn align_addr(addr: u64, align: u64) -> u64 {
    match addr % align {
        0 => addr,
        rem => addr.strict_add(align) - rem,
    }
}

struct AddressGenerator {
    next_base_addr: u64,
    end: u64,
}

impl AddressGenerator {
    fn get_remaining(&self) -> std::ops::Range<u64> {
        self.next_base_addr..self.end
    }
    fn generate<R: Rng>(&mut self, size: u64, align: u64, rng: &mut R) -> Option<u64> {
        let slack = rng.random_range(0..16);
        let base_addr = self.next_base_addr.checked_add(slack)?;
        let base_addr = align_addr(base_addr, align);
        self.next_base_addr = base_addr.checked_add(size.max(1))?;
        if self.next_base_addr > self.end {
            return None;
        }
        Some(base_addr)
    }
}

const MAX_POOL_SIZE: usize = 64;

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Stack,
    Heap,
}

struct ReusePool {
    address_reuse_rate: f64,
    address_reuse_cross_thread_rate: f64,
    pool: Vec<Vec<(u64, u64, u32, u32)>>,
}

impl ReusePool {
    fn address_space_shortage(&mut self) {
        if self.address_reuse_rate > 0.0 {
            self.address_reuse_rate = 1.0;
        }
    }
    fn subpool(&mut self, align: u64) -> &mut Vec<(u64, u64, u32, u32)> {
        let pool_idx = align.trailing_zeros() as usize;
        if self.pool.len() <= pool_idx {
            self.pool.resize(pool_idx + 1, Vec::new());
        }
        &mut self.pool[pool_idx]
    }
    fn add_addr(&mut self, rng: &mut impl Rng, addr: u64, size: u64, align: u64, kind: Kind, thread: u32, clock: impl FnOnce() -> u32) {
        if kind == Kind::Stack || !rng.random_bool(self.address_reuse_rate) {
            return;
        }
        let clock = clock();
        let subpool = self.subpool(align);
        let pos = subpool.partition_point(|(_addr, other_size, other_thread, _)| (*other_size, *other_thread) < (size, thread));
        if subpool.len() >= MAX_POOL_SIZE {
            let clamped_pos = pos.min(subpool.len() - 1);
            subpool[clamped_pos] = (addr, size, thread, clock);
            return;
        }
        subpool.insert(pos, (addr, size, thread, clock));
    }
    fn take_addr(&mut self, rng: &mut impl Rng, size: u64, align: u64, kind: Kind, thread: u32) -> Option<(u64, Option<u32>)> {
        if kind == Kind::Stack || !rng.random_bool(self.address_reuse_rate) {
            return None;
        }
        let cross_thread_reuse = rng.random_bool(self.address_reuse_cross_thread_rate);
        let subpool = self.subpool(align);
        let begin = subpool.partition_point(|(_addr, other_size, other_thread, _)| {
            *other_size < size || (*other_size == size && !cross_thread_reuse && *other_thread < thread)
        });
        let mut end = begin;
        while let Some((_addr, other_size, other_thread, _)) = subpool.get(end) {
            if *other_size != size {
                break;
            }
            if !cross_thread_reuse && *other_thread != thread {
                break;
            }
            end += 1;
        }
        if end == begin {
            return None;
        }
        let idx = rng.random_range(begin..end);
        let (chosen_addr, _chosen_size, chosen_thread, clock) = subpool.remove(idx);
        Some((chosen_addr, if chosen_thread == thread { None } else { Some(clock) }))
    }
}

struct Lcg(u64);
impl Lcg {
    fn next(&mut self, n: u64) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (self.0 >> 33) % n
    }
}

fn kind_str(k: Kind) -> &'static str {
    match k {
        Kind::Stack => "Stack",
        Kind::Heap => "Heap",
    }
}

#[allow(clippy::too_many_arguments)]
fn scenario(name: &str, seed: u64, start: u64, end: u64, reuse: f64, cross: f64, ops: usize, script_seed: u64, sizes: &[u64], aligns: &[u64], phased: bool) {
    println!("scenario {name} seed={seed} start={start} end={end} reuse={reuse} cross={cross}");
    let mut rng = StdRng::seed_from_u64(seed);
    let mut addr_gen = AddressGenerator { next_base_addr: start, end };
    let mut reuse_pool = ReusePool { address_reuse_rate: reuse, address_reuse_cross_thread_rate: cross, pool: vec![] };
    let mut script = Lcg(script_seed);
    // live: (id, addr, size, align, kind)
    let mut live: Vec<(usize, u64, u64, u64, Kind)> = Vec::new();
    let mut next_id = 0usize;
    for op in 0..ops {
        let thread = script.next(3) as u32;
        // Phased: allocate, then free everything (filling the pool past MAX_POOL_SIZE), then allocate again.
        let free = if phased { op >= ops / 3 && op < 2 * ops / 3 } else { script.next(5) < 2 };
        if !live.is_empty() && free {
            let i = script.next(live.len() as u64) as usize;
            let (id, addr, size, align, kind) = live.remove(i);
            reuse_pool.add_addr(&mut rng, addr, size, align, kind, thread, || thread);
            println!("free {id} thread={thread}");
        } else {
            let size = sizes[script.next(sizes.len() as u64) as usize];
            let align = aligns[script.next(aligns.len() as u64) as usize];
            let kind = if script.next(4) == 0 { Kind::Stack } else { Kind::Heap };
            let id = next_id;
            next_id += 1;
            let res = if let Some((reuse_addr, clock)) = reuse_pool.take_addr(&mut rng, size, align, kind, thread) {
                Some((reuse_addr, clock))
            } else {
                match addr_gen.generate(size, align, &mut rng) {
                    Some(new_addr) => {
                        let remaining_range = addr_gen.get_remaining();
                        if remaining_range.start > remaining_range.end / 2 {
                            reuse_pool.address_space_shortage();
                        }
                        Some((new_addr, None))
                    }
                    None => None,
                }
            };
            match res {
                Some((addr, clock)) => {
                    let sync = match clock {
                        Some(t) => format!(" sync={t}"),
                        None => String::new(),
                    };
                    println!("alloc {id} size={size} align={align} kind={} thread={thread} -> {addr}{sync}", kind_str(kind));
                    live.push((id, addr, size, align, kind));
                }
                None => {
                    println!("alloc {id} size={size} align={align} kind={} thread={thread} -> full", kind_str(kind));
                    break;
                }
            }
        }
    }
    println!("tail={}", rng.next_u32());
}

fn main() {
    // Miri's defaults: seed 0, stack_addr = page_size * 32 = 0x20000, end = target_usize_max (x86_64), reuse rates
    // 0.5 / 0.1 (eval.rs:211).
    let small = [0u64, 1, 2, 3, 4, 8, 16, 24, 100];
    let aligns = [1u64, 2, 4, 8, 16, 4096];
    scenario("default", 0, 0x20000, u64::MAX, 0.5, 0.1, 600, 1, &small, &aligns, false);
    scenario("seed42", 42, 0x20000, u64::MAX, 0.5, 0.1, 400, 7, &small, &aligns, false);
    // Reuse-heavy: every free is remembered and every alloc tries reuse; cross-thread reuse often.
    scenario("reuse", 3, 0x20000, u64::MAX, 1.0, 0.5, 1500, 11, &[8, 16], &aligns, false);
    // No reuse at all.
    scenario("noreuse", 5, 0x20000, u64::MAX, 0.0, 0.0, 200, 13, &small, &aligns, false);
    // A small address space (32-bit-like end): the shortage switch and AddressSpaceFull.
    scenario("tiny", 9, 0x1000, 0x8000, 0.5, 0.1, 4000, 17, &[64, 128, 256, 1000], &aligns, false);
    // One subpool past MAX_POOL_SIZE (the replace-or-clamp path), then reuse from the full pool.
    scenario("poolfull", 21, 0x20000, u64::MAX, 0.9, 0.3, 900, 23, &[8, 16], &[8], true);
}
