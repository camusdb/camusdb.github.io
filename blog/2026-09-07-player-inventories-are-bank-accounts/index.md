---
slug: player-inventories-are-bank-accounts
title: Player inventories are bank accounts
date: 2026-09-07
authors: [andresgutierrez]
tags: [camusdb, video-games, distributed-transactions, game-backends]
---

# Player inventories are bank accounts

![Cyberpunk game economy scene](/img/cyberpunk.png)

A player spends forty hours to earn a sword. Another player pays real money for
a bundle of skins. A guild saves gold for three weeks to buy a fortress.

None of that is "game data" to the person who did it. It is time, money, and
trust. When a backend loses an item, duplicates a currency, or shows two owners
for one mount, the player does not read it as a bug. The player reads it as
disrespect.

We run game backends on CamusDB today. This post explains why we treat every
inventory and every wallet as a small bank account. It also explains why that
decision leads to distributed transactions, not away from them.

<!-- truncate -->

## What a game economy really is

Strip the art away and a game economy is a ledger.

- A wallet is an account with a balance that must never go below zero.
- An inventory is a set of assets, and each asset has exactly one owner.
- A shop purchase is a transfer: currency leaves one account, an item enters
  another.
- A trade between two players is a transfer in both directions, at the same
  instant.
- A guild bank is a shared account with many writers.
- A season reward is a credit that must be granted exactly once.

These are the same rules a bank enforces. The amounts are smaller. The number
of accounts is often larger. The rules are identical:

```text
balance >= 0
one item -> one owner
one reward -> granted once
a trade completes for both sides, or for neither
```

A bank does not ask whether a rule deserves enforcement on a slow day. It
enforces the rule on every day, because a single broken rule ends the trust of the
customer. Games are not different. A player who loses one legendary item once
tells everyone, and that player is often right to do so.

## The argument for one thread

There is a popular argument in the game backend world, and it deserves a fair
statement before we answer it.

The argument goes like this. Coordination is expensive. A transaction that
touches data on several machines needs network round trips. A transaction that
waits on a network round trip holds its locks for a millisecond instead of a few
microseconds. If two transactions touch the same hot row, the second one waits
for the first. A single thread on a single machine can process a hot row
hundreds of thousands of times per second. A distributed commit on that same row
processes it about a thousand times per second. Therefore, the argument says,
keep each region of the game world in one single-threaded shard. Keep the
transactions local. Pass messages between shards asynchronously. Reserve
distributed transactions for rare cases, or avoid them completely.

The physics in that argument is correct. A network round trip is slower than a
cache line. A hot row is serial by nature. Nobody can make ten machines update
one row faster than one machine can.

The conclusion is where the argument fails for games. It fails for three
reasons.

## Reason one: the valuable transactions cross the shard boundary

The argument assumes that most transactions stay inside one shard, and that the
transactions that cross shards are rare and unimportant. In a game economy, the
opposite is true. Look at where the money is:

- A trade between two players who met in different regions.
- A deposit into a guild bank from a member who plays on another continent.
- A marketplace sale, where the seller and the buyer are never in the same
  place.
- A gift from one account to another.
- A player who walks from one region to another with a full inventory.
- A cross-server event that pays a reward to every participant.

Every one of these moves value across a boundary. They are less frequent than
movement updates, yes. They are also the transactions with the most real money,
the most player hours, and the most exploit attempts behind them. Rare is not
the same as unimportant. In an economy, the rare transaction is often the one
that matters most.

A shard model that makes local work fast and cross-shard work unsafe optimizes
the transactions that nobody would miss. It leaves the transactions that
everybody would miss to hand-written code.

## Reason two: asynchronous messages between shards are where duplicates come from

If two shards cannot commit together, a trade between them becomes a
conversation. Shard A removes the sword and sends a message. Shard B receives
the message and adds the sword. If B is down, A must remember to retry. If A
crashes after the removal and before the send, the sword is gone. If the message
is delivered twice, the sword exists twice. If a player logs out during the
hand-off between regions, the inventory can exist on both regions, or on
neither.

Every game developer with a few years of live operations knows this pattern,
because every item duplication exploit in history has this shape. The fix is
always the same: idempotency keys, outbox tables, and compensation steps. A
reconciliation job then runs at night and files the differences into a
spreadsheet. That is a distributed transaction protocol. The game team writes
it under a release deadline, without a model checker. The team then writes it
again for each new feature that crosses a boundary.

A database with distributed transactions does that work once, in one place, and
tests it against node failures. The cost is a millisecond at commit. The
alternative is a saga for every feature. We prefer to pay the millisecond.

## Reason three: the hot key is a simulation problem, not a ledger problem

The strongest part of the argument is the hot row. A world boss with one health
value takes hits from two hundred players at once. A single-threaded engine can
process that. A distributed commit cannot, at that rate.

That is true, and it is also not a requirement for the ledger. Games already
separate two kinds of state:

- Simulation state lives in the game server, in memory, at the tick rate.
  Position, health, cooldowns, projectiles. It is rebuilt from scratch when a
  match starts, and it is allowed to lose a few ticks when a server dies.
- Ledger state lives in the database. Wallets, inventories, ownership, purchase
  history, progression. It is never rebuilt from scratch, and it is never
  allowed to lose one entry.

The boss fight is simulation. The loot at the end of the fight is ledger. The
ledger sees one transaction per player at the end, not two hundred writes per
second on one row. Nobody needs a database to update one row hundreds of
thousands of times per second. Nobody sane commits the boss health to a durable
log on every hit.

When you keep the two layers apart, the hot key argument no longer applies to
the part of the system that holds player value. What remains is a ledger workload:
many accounts, low contention per account, and a strict need for atomicity when
two accounts change together. That is the workload a distributed SQL database
exists for.

## You pay for coordination only where the data crosses a partition

A fair objection remains. If every commit pays for a distributed protocol, the
ledger becomes slow for the common case too. That would be a bad trade.

CamusDB does not work that way. It splits the key space into Raft partitions.
Each partition has one leader and a replicated log. A table and its secondary
indexes live under one key prefix, and that prefix maps to one partition by
default. A transaction that touches one partition commits through that one
leader. Two-phase commit runs only when a transaction actually writes to more
than one partition.

In practice this means:

- A shop purchase that changes one wallet and one inventory usually commits on
  one leader, with one replicated log round.
- A trade between two players whose rows live on different partitions pays for
  two-phase commit, because that is the case where atomicity across machines is
  the whole point.
- A read-only report over the whole economy runs from one consistent snapshot,
  without a lock, and without a block on writers.

When a table becomes hot, key-range sharding can split it into ranges and place
those ranges on different leaders. The split moves data placement. It does not
move the atomicity boundary. A transaction that spans two ranges is still one
transaction. See [Key-range sharding](/docs/key-range-sharding) and
[Distributed transactions and HLC](/docs/distributed-transactions) for the
details.

The coordination cost follows the data, not the schema. That is the property a
game team needs. You design your tables around your economy, and the database
decides where the network round trip is necessary.

## What a trade looks like

Here is a trade between two players. Player 10 gives a sword and receives 500
gold. Player 20 gives 500 gold and receives the sword.

The wallet table carries the bank rule as a constraint, so the database enforces
it on every update:

```camussql
CREATE TABLE wallets (
  player_id INT64 NOT NULL PRIMARY KEY,
  balance INT64 NOT NULL CHECK (balance >= 0)
);
```

The trade itself is one transaction. It has an idempotency key, so a client
retry cannot execute it twice.

```camussql
BEGIN;

UPDATE wallets
SET balance = balance - 500
WHERE player_id = 20;

UPDATE wallets
SET balance = balance + 500
WHERE player_id = 10;

UPDATE items
SET owner_id = 20
WHERE item_id = 88123 AND owner_id = 10;

INSERT INTO trades (trade_key, seller_id, buyer_id, item_id, price)
VALUES ('7f3a9c1e-trade-2026-09-07', 10, 20, 88123, 500);

COMMIT;
```

Four things protect the players here:

- If player 20 cannot pay, the first update violates the check constraint. The
  statement fails, and the transaction commits nothing.
- If player 10 no longer owns the sword, the third update changes zero rows. The
  application sees that count and rolls back.
- The unique index on `trade_key` rejects a second attempt with the same key.
- Serializable isolation is the default. A concurrent trade of the same sword to
  a third player conflicts, and one of the two transactions retries. The
  application replays the loser from `BEGIN`.

The two wallets and the item can live on three different partitions. The
transaction still commits on all of them or on none of them. Nobody ends up with
two swords, and nobody ends up with a sword that was never paid for.

A retry is not a failure of the database. It is the database that tells you the
truth about a race. The alternative is not "no conflict". The alternative is a
conflict that the application discovers in a support ticket.

## Durability is the part players actually feel

Speed is the argument developers have with each other. Durability is the
argument players have with you.

Our rule is simple. If CamusDB confirms a commit, that commit survives, even if
the node that confirmed it dies one second later. A committed write goes through
the replicated partition log before the client hears "ok". A leader change
continues from a log state that Raft made safe. A transaction that did not reach
a durable decision is never reported as committed. It is reported as a retry,
and the application replays it.

We test that rule with real failures, not with assumptions. Our chaos tool,
[Caraxes](/docs/caraxes), runs money transfers between random accounts while it
kills nodes, cuts the network, and fills disks. The check at the end is the same
check a bank auditor would run. The total of all balances must be exactly the
same as before. We wrote about that tool in
[We built a dragon to attack our own database](/blog/a-dragon-to-attack-our-own-database).
Every argument in this post rests on that check.

An in-memory engine that acknowledges a commit before the write is safe on a
second machine gives you an impressive benchmark. It also gives you a window in
which a player's purchase exists only in the RAM of one process. Whether that
window is a millisecond or a second, the item that disappears in it was paid for.

## The cost, stated plainly

A distributed commit in CamusDB costs milliseconds. A local commit costs less.
A single-threaded in-memory engine costs microseconds.

A player clicks "accept trade". The round trip from the client to the server is
tens of milliseconds. The animation is half a second. The player will never
perceive the difference between three microseconds and three milliseconds at
commit. The player will remember, for years, the sword that vanished.

The engineering trade is therefore not "fast versus slow". It is "a millisecond
at commit versus a saga per feature and a reconciliation job at night". For the
simulation, choose the tick loop. For the ledger, choose the transaction.

## What we ask of a game database

This is the list we hold CamusDB to, and the list we suggest for any database
that holds player value:

1. Serializable isolation by default, so a race is a retry and never a
   duplicate.
2. Atomic commits across machines, so a trade, a guild deposit, or a region
   hand-off is one unit of work.
3. Coordination cost that follows the data, so a local purchase does not pay
   for a distributed protocol it does not need.
4. Durability before acknowledgement, so a confirmed purchase survives the death
   of the node that confirmed it.
5. Failure tests with an invariant check, so the guarantee is measured on every
   build and not remembered from a design document.

Players give a game their evenings and their money. The least a backend can do
is keep the books straight.
