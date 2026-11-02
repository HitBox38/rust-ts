// Oracle probe for src/miri/concurrency/{scheduler,thread}.ts (lane miri-threads-fix, review miri-threads finding 1).
//
// Miri's thread choice at the pin, transcribed verbatim with the rustc types replaced:
// - concurrency/scheduler.rs:52 `schedule` (the non-GenMC path). `DelayedReadinessUpdates::process` (no delayed
//   updates), `poll_and_unblock` (isolation on: `communicate()` is false) and `unblock_expired_deadlines` (the scripts
//   block without deadlines, so it returns `None`) draw nothing from the rng and are left out.
// - concurrency/thread.rs:1094 `yield_active_thread` and :1102 `maybe_preempt_active_thread` (called from
//   machine.rs:1952 `before_terminator`, before the terminator executes).
// - `ThreadManager::all_threads` is `IndexVec::iter_enumerated` (`raw.iter().enumerate().map(..)`), so the iterator
//   handed to `IteratorRandom::choose` is the same adapter chain as upstream's, with the same size hints.
// - The rng is the real rand 0.10.1 `StdRng`, seeded as MiriMachine::new does (machine.rs:721
//   `StdRng::seed_from_u64(config.seed.unwrap_or(0))`).
//
// A script (its own LCG, never the rng) picks what each step of the active thread does: spawn a thread, block itself,
// unblock a blocked thread, yield, terminate (never the main thread), or nothing. Each line printed is either a
// decision of the code under test (`sched -> <id>`, `preempt -> <bool>`) or a scripted event the replay must perform;
// `tail=` is the rng's next u32 after the run, so a missing or extra draw anywhere shows.
use rand::rngs::StdRng;
use rand::seq::IteratorRandom;
use rand::{Rng, RngExt, SeedableRng};

#[derive(Clone, Copy, PartialEq, Debug)]
enum ThreadState {
    Enabled,
    Blocked,
    Terminated,
}

impl ThreadState {
    fn is_enabled(&self) -> bool {
        matches!(self, ThreadState::Enabled)
    }
    fn is_terminated(&self) -> bool {
        matches!(self, ThreadState::Terminated)
    }
}

struct Thread {
    state: ThreadState,
}

impl Thread {
    pub fn is_enabled(&self) -> bool {
        self.state.is_enabled()
    }
    pub fn is_terminated(&self) -> bool {
        self.state.is_terminated()
    }
}

struct ThreadManager {
    active_thread: u32,
    threads: Vec<Thread>,
    yield_active_thread: bool,
    fixed_scheduling: bool,
}

impl ThreadManager {
    fn active_thread(&self) -> u32 {
        self.active_thread
    }
    fn active_thread_ref(&self) -> &Thread {
        &self.threads[self.active_thread as usize]
    }
    // `self.threads.iter_enumerated()` (IndexVec: `self.raw.iter().enumerate().map(|(n, t)| (I::new(n), t))`)
    fn all_threads(&self) -> impl Iterator<Item = (u32, &Thread)> {
        self.threads.iter().enumerate().map(|(n, t)| (u32::try_from(n).unwrap(), t))
    }
    fn set_active_thread(&mut self, id: u32) -> u32 {
        assert!((id as usize) < self.threads.len());
        std::mem::replace(&mut self.active_thread, id)
    }
    pub fn fixed_scheduling(&self) -> bool {
        self.fixed_scheduling
    }
}

struct Machine {
    threads: ThreadManager,
    rng: std::cell::RefCell<StdRng>,
    preemption_rate: f64,
}

enum SchedulingAction {
    ExecuteStep,
}

// concurrency/scheduler.rs:52 schedule (non-GenMC; see the header for the parts that draw nothing)
fn schedule(this: &mut Machine) -> Result<SchedulingAction, &'static str> {
    // We are not in GenMC mode, so we control the scheduling.
    let thread_manager = &this.threads;
    // Check if we can just keep running the current thread.
    if thread_manager.active_thread_ref().is_enabled() && !thread_manager.yield_active_thread {
        // The currently active thread is still enabled, just continue with it.
        return Ok(SchedulingAction::ExecuteStep);
    }

    let potential_sleep_time: Option<()> = None; // `this.unblock_expired_deadlines()?` (no deadlines)

    let thread_manager = &mut this.threads;
    let rng = this.rng.get_mut();

    let mut threads_iter = thread_manager
        .all_threads()
        .skip(thread_manager.active_thread() as usize + 1)
        .chain(thread_manager.all_threads().take(thread_manager.active_thread() as usize + 1))
        .filter(|(_id, thread)| thread.is_enabled());
    // Pick a new thread, and switch to it.
    let new_thread = if thread_manager.fixed_scheduling() {
        let next = threads_iter.next();
        drop(threads_iter);
        next
    } else {
        threads_iter.choose(rng)
    };

    if let Some((id, _thread)) = new_thread {
        if thread_manager.active_thread() != id {
            thread_manager.set_active_thread(id);
        }
    }
    // This completes the `yield`, if any was requested.
    thread_manager.yield_active_thread = false;

    if thread_manager.active_thread_ref().is_enabled() {
        return Ok(SchedulingAction::ExecuteStep);
    }

    // We have not found a thread to execute.
    if this.threads.all_threads().all(|(_id, thread)| thread.is_terminated()) {
        unreachable!("all threads terminated without the main thread terminating?!");
    } else if let Some(_sleep_time) = potential_sleep_time {
        unreachable!()
    } else {
        Err("GlobalDeadlock")
    }
}

// concurrency/thread.rs:1094 yield_active_thread
fn yield_active_thread(this: &mut Machine) {
    this.threads.yield_active_thread = true;
}

// concurrency/thread.rs:1102 maybe_preempt_active_thread
fn maybe_preempt_active_thread(this: &mut Machine) {
    if !this.threads.fixed_scheduling && this.rng.get_mut().random_bool(this.preemption_rate) {
        yield_active_thread(this);
    }
}

struct Lcg(u64);
impl Lcg {
    fn next(&mut self, n: u64) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (self.0 >> 33) % n
    }
}

#[allow(clippy::too_many_arguments)]
fn scenario(name: &str, seed: u64, rate: f64, fixed: bool, initial: usize, max_threads: usize, steps: usize, script_seed: u64, allow_deadlock: bool) {
    println!("scenario {name} seed={seed} rate={rate} fixed={} initial={initial}", fixed as u8);
    let mut m = Machine {
        threads: ThreadManager {
            active_thread: 0,
            threads: (0..initial).map(|_| Thread { state: ThreadState::Enabled }).collect(),
            yield_active_thread: false,
            fixed_scheduling: fixed,
        },
        rng: std::cell::RefCell::new(StdRng::seed_from_u64(seed)),
        preemption_rate: rate,
    };
    let mut script = Lcg(script_seed);
    for _ in 0..steps {
        match schedule(&mut m) {
            Ok(SchedulingAction::ExecuteStep) => println!("sched -> {}", m.threads.active_thread()),
            Err(stop) => {
                println!("sched -> {stop}");
                break;
            }
        }
        // One terminator of the active thread: the preemption point, then what the terminator does.
        maybe_preempt_active_thread(&mut m);
        println!("preempt -> {}", m.threads.yield_active_thread);
        let t = m.threads.active_thread();
        let enabled = m.threads.threads.iter().filter(|t| t.is_enabled()).count();
        let blocked: Vec<u32> = m.threads.all_threads().filter(|(_, t)| t.state == ThreadState::Blocked).map(|(id, _)| id).collect();
        let r = script.next(100);
        if r < 8 && m.threads.threads.len() < max_threads {
            m.threads.threads.push(Thread { state: ThreadState::Enabled });
            println!("spawn -> {}", m.threads.threads.len() - 1);
        } else if r < 18 && (enabled >= 2 || allow_deadlock) {
            m.threads.threads[t as usize].state = ThreadState::Blocked;
            println!("block {t}");
        } else if r < 30 && !blocked.is_empty() {
            let u = blocked[script.next(blocked.len() as u64) as usize];
            m.threads.threads[u as usize].state = ThreadState::Enabled;
            println!("unblock {u}");
        } else if r < 36 {
            yield_active_thread(&mut m);
            println!("yield");
        } else if r < 40 && t != 0 && (enabled >= 2 || allow_deadlock) {
            m.threads.threads[t as usize].state = ThreadState::Terminated;
            println!("terminate {t}");
        } else {
            println!("step");
        }
    }
    println!("tail={}", m.rng.get_mut().next_u32());
}

fn main() {
    // Miri's defaults: seed 0, preemption rate 0.01 (eval.rs:203), random scheduling.
    scenario("default", 0, 0.01, false, 1, 6, 1500, 1, false);
    // Frequent preemption: `choose` runs at almost every step, over up to 8 threads.
    scenario("preempt-half", 1, 0.5, false, 3, 8, 1500, 3, false);
    scenario("seed42", 42, 0.2, false, 2, 5, 1000, 7, false);
    // Rate 1.0 (`Bernoulli` with p = 1: `random_bool` draws nothing) and rate 0.0 (it still draws).
    scenario("always", 5, 1.0, false, 4, 6, 600, 11, false);
    scenario("never", 9, 0.0, false, 4, 6, 600, 13, false);
    // `-Zmiri-deterministic-concurrency` style fixed scheduling: round robin, no draws at all.
    scenario("fixed", 3, 0.5, true, 3, 6, 600, 17, false);
    // Blocking without the >= 2 enabled guard: ends with a GlobalDeadlock.
    scenario("deadlock", 21, 0.3, false, 3, 5, 3000, 23, true);
}
