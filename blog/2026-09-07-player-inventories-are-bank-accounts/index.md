---
slug: player-inventories-are-bank-accounts
title: Game wallets and inventories need distributed transactions
date: 2026-09-07
authors: [andresgutierrez]
tags: [camusdb, video-games, distributed-transactions, game-backends]
description: "Why we treat every player inventory and wallet as a small bank account, and why that leads a game backend to distributed transactions."
image: /img/cyberpunk.png
---

# Game wallets and inventories need distributed transactions

![Cyberpunk game economy scene](/img/cyberpunk.png)

This post explains why a game backend needs distributed transactions for
player wallets and inventories. You will see the argument against them, three
reasons it fails for a game economy, and what a safe trade looks like in SQL.
If you design a game backend, the post ends with five requirements for the
database that stores player value.

A player spends forty hours to earn a sword. Another player pays real money
for a bundle of skins. A guild saves gold for three weeks to buy a fortress.
To the player, that is time, money, and trust. When a backend loses an item
or duplicates a currency, the player reads it as disrespect.

We run game backends on CamusDB today, and we treat each inventory and each
wallet as a small bank account.

<!-- truncate -->

## A game economy is a ledger

- A wallet is an account with a balance that can't go below zero.
- An inventory is a set of assets, and each asset has exactly one owner.
- A shop purchase is a transfer: currency leaves one account, an item enters
  another.
- A trade between two players is a transfer in both directions, at the same
  instant.
- A guild bank is a shared account with many writers.
- A season reward is a credit that must be granted exactly once.

These are the rules a bank enforces. The amounts are smaller, and the number
of accounts is often larger.

```text
balance >= 0
one item -> one owner
one reward -> granted once
a trade completes for both sides, or for neither
```
A game backend must enforce these rules on each operation, as a bank does.
One broken rule costs the trust of the player.

## The single-threaded shard argument

A popular argument in the game backend world says that each region of a game
should live in one single-threaded shard, with local transactions only. We
state it in full before we answer it.

A shard is one slice of the game data, for example one region of the world,
that lives on one machine. The argument has four steps.

- A transaction that touches data on several machines needs network round
  trips.
- A transaction that waits on a network round trip locks its rows for a
  millisecond. A local transaction locks them for a few microseconds.
- If two transactions touch the same busy row (a hot row), the second one
  waits for the first.
- A single thread on a single machine can process a hot row hundreds of
  thousands of times per second. A distributed commit on that same row
  processes it about a thousand times per second.

Therefore, the argument says, keep each region of the game world in one
single-threaded shard. Keep the transactions local. Pass messages between
shards asynchronously. Reserve distributed transactions for rare cases, or
avoid them completely.

The physics in that argument is correct. A network round trip is slower than
a memory access, and ten machines cannot update one row faster than one
machine can.

The conclusion fails for games, for three reasons.

## Reason one: the valuable transactions cross the shard boundary

The argument assumes that transactions across shards are rare and
unimportant. In a game economy, they carry the value.

- A trade between two players who met in different regions.
- A deposit into a guild bank from a member who plays on another continent.
- A marketplace sale, where the seller and the buyer are in different
  places.
- A gift from one account to another.
- A player who walks from one region to another with a full inventory.
- A cross-server event that pays a reward to all the participants.

These are less frequent than movement updates. They also have the most real
money, the most player hours, and the most exploit attempts behind them.

A shard model that makes local work fast and cross-shard work unsafe leaves
the most valuable transactions to hand-written code.

## Reason two: asynchronous messages between shards cause duplicates

If two shards cannot commit together, a trade between them becomes a
conversation. Shard A removes the sword and sends a message. Shard B receives
the message and adds the sword.

- If B is down, A must remember to retry.
- If A crashes after the removal and before the send, the sword is gone.
- If the message is delivered twice, the sword exists twice.
- If a player logs out during the hand-off between regions, the inventory can
  exist on both regions, or on neither.

Item duplication exploits have this shape. The usual fix has three parts.

- Idempotency keys: a unique key per operation, which makes a repeat harmless.
- Outbox tables: a table of messages that are saved with the change and sent
  later.
- Compensation steps: code that undoes the first half when the second half
  fails.

A reconciliation job at night then files the differences into a
spreadsheet. Together, that is a distributed transaction protocol, often
called a saga. The game team writes it under a release deadline, and writes
it again for each new feature that crosses a boundary.

A database with distributed transactions does that work once and tests it
against node failures, at a cost of a millisecond at commit.

## Reason three: the hot key belongs to the simulation

The strongest part of the argument is the hot row. A world boss with one
health value takes hits from two hundred players at once. A single-threaded
engine can process that rate, and a distributed commit is too slow for it.

The ledger does not need that rate. Games already separate two kinds of
state.

- **Simulation state** lives in the memory of the game server and changes on
  each tick (one step of the game loop). Position, health, cooldowns,
  projectiles. It is rebuilt from scratch when a match starts, and it is
  allowed to lose a few ticks when a server dies.
- **Ledger state** lives in the database. Wallets, inventories, ownership,
  purchase history, progression. It can't be rebuilt from scratch, and it
  can't lose one entry.

The boss fight is simulation. The loot at the end of the fight is ledger, and
the ledger sees one transaction per player at the end.

What remains for the database is a ledger workload: many accounts, low
contention per account, and a strict need for atomicity when two accounts
change together. A distributed SQL database is built for that workload.

## Coordination cost applies only to transactions that cross partitions

A fair objection is that the ledger becomes slow for the common case too, if
all commits pay for a distributed protocol.

CamusDB splits the key space into partitions. Each partition has one leader
node and a log that is replicated to the other nodes with Raft, a consensus
protocol. A table and its secondary indexes live under one key prefix, and
that prefix maps to one partition by default.

A transaction that touches one partition commits through that one leader.
Two-phase commit, the protocol that makes several partitions commit together,
is needed only for a transaction that writes to more than one partition.

- A shop purchase that changes one wallet and one inventory usually commits
  on one leader, with one replicated log round.
- A trade between two players whose rows live on different partitions pays
  for two-phase commit.
- A read-only report over the full economy reads one consistent snapshot. It
  takes no lock and does not block writers.

When a table becomes hot, key-range sharding can split it into ranges and
place those ranges on different leaders. The split moves data placement. A
transaction that spans two ranges is still one transaction. See
[Key-range sharding](/docs/key-range-sharding) and
[Distributed transactions and HLC](/docs/distributed-transactions) for the
details.

## Example: a trade between two players

Player 10 gives a sword and receives 500 gold. Player 20 gives 500 gold and
receives the sword.

The wallet table carries the bank rule as a constraint, and the database
enforces it on each update.

```camussql
CREATE TABLE wallets (
  player_id INT64 NOT NULL PRIMARY KEY,
  balance INT64 NOT NULL CHECK (balance >= 0)
);
```
The trade is one transaction. It has an idempotency key, so a client retry
cannot execute it twice.

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
Four things protect the players here.

- If player 20 cannot pay, the first update violates the check constraint.
  The statement fails, and the transaction does not commit.
- If player 10 no longer owns the sword, the third update changes zero rows.
  The application sees that count and rolls back.
- A second attempt with the same key violates the unique index on `trade_key`.
- Serializable isolation is the default: the result is the same as if the
  transactions ran one at a time. A concurrent trade of the same sword to a
  third player conflicts, and one of the two transactions retries. The
  application replays the loser from `BEGIN`.

The two wallets and the item can live on three different partitions. The
transaction still commits on all of them or on none of them.

## A confirmed commit survives a node failure

If CamusDB confirms a commit, that commit survives, even if the node that
confirmed it dies one second later.

- A committed write goes through the replicated partition log before the
  client hears "ok".
- A leader change continues from a log state that Raft made safe.
- A transaction that did not reach a durable decision is reported as a retry,
  and the application replays it.

We test that rule with real failures. Our chaos tool,
[Caraxes](/docs/caraxes), moves money between random accounts while it
injects faults such as node kills and network cuts. At the end, the total of
all balances must be exactly the same as before. We wrote about that tool in
[Caraxes: how we test CamusDB against real failures](/blog/a-dragon-to-attack-our-own-database).

An in-memory engine that acknowledges a commit before the write is safe on a
second machine benchmarks faster. It also leaves a window in which a player's
purchase exists only in the memory of one process, and an item lost in that
window was already paid for.

## The cost: milliseconds at commit

A distributed commit in CamusDB costs milliseconds. A local commit costs
less. A single-threaded in-memory engine costs microseconds.

A player clicks "accept trade". The round trip from the client to the server
is tens of milliseconds, and the animation is half a second. The player
cannot perceive the difference between three microseconds and three
milliseconds at commit.

The engineering trade is a millisecond at commit against a saga per feature
and a reconciliation job at night. Keep the simulation in the tick loop, and
keep the ledger in database transactions.

## Five requirements for a game database

We hold CamusDB to this list, and we suggest it for any database that stores
player value.

1. Serializable isolation by default. A race then causes a retry and can't
   duplicate an item.
2. Atomic commits across machines. A trade or a region hand-off is then one
   unit of work.
3. Coordination cost that follows the data. A local purchase does not pay
   for a distributed protocol it does not need.
4. Durability before acknowledgement. A confirmed purchase survives the
   death of the node that confirmed it.
5. Failure tests with an invariant check. The guarantee is measured on
   every build.
