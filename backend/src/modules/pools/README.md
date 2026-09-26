# Pools prototype

Separate from ranked competitions, social games and legacy `/challenges`.
Entry point: centre + → Pools. No new bottom tab.

**Test credits only.** PoolTestWallet grants 100,000 nonwithdrawable credits.
Neither payment providers nor User.walletBalanceCents / ledger are touched.
Host creates and joins. Friends join waiting public pools, or host fills seats
with named test players. Activity reports are host-controlled simulations,
not Health-verified. Automatic Health ingestion, delayed-sync policy and
real-money launch remain separate follow-up work.

Rules: 7–365 days, 2–50 players including host, 1–10,000 credits each.
Walking steps; running/cycling/swimming km; sleep hours. Combine all five;
every selected goal must pass every day. Full pools start next midnight in
the host's fixed IANA timezone. Leaving before start refunds and reopens.
Current-day snapshots replace prior totals. Only at midnight do missing or
insufficient results eliminate players. Sleep belongs to its wake date,
including the preceding night for day 1. Main sleep duration and optional
bedtime/wake deadlines must pass. Durations use elapsed time and deadlines
local time, with daylight-saving transitions respected.

After each daily cutoff, if exactly one player remains, the pool completes
immediately and that player receives all credits, regardless of days remaining.
All players are evaluated together before choosing the winner. Otherwise,
after the last day, all credits split equally among finishers, with remainder
credits one each to earliest joiners. No commission or redemption. No finishers
means every entry refunded. All pool state/debit/refund/payout writes are in
one transaction under a pool row lock. Creation has a UUID retry key (always
supplied by the app); duplicate joins/leaves do not debit/refund twice. Test
clock advancement requires the current version. Settlement is atomic.

Host test flow: Fill test players → Jump to test day 1 (23:59:59 local) → save
each player's totals → close day and advance. The simulated clock stays frozen while totals are entered. The next test day is also shown
at 23:59:59, so complete sleep reports can be entered. Day 7 closes/settles;
missed days stay failed. Real users can also wait for actual daily cutoffs.

Tables initialize lazily. A separate minute tick only moves test credits;
real-wallet race job flags remain unchanged. Detail reads reconcile elapsed
days after a restart. Account deletion anonymizes members and removes their
reports; host-owned test pools and test wallets cascade.

Validation: `npm test -- tests/pools-engine.test.ts tests/pools-store.test.ts`.
The store suite uses actual PGlite SQL/transactions and tests auth, isolation,
rollback, repeat requests, credit conservation and no changes to real wallets.
