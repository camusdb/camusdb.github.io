---
sidebar_position: 7.25
---

# Agent skills

The [CamusDB agent skills](https://github.com/camusdb/camusdb-skills) give a
coding agent product-specific guidance for designing schemas, writing SQL,
handling transactions, tuning queries, and operating CamusDB. They work with
Claude Code, Codex, and Cursor.

The skills are a companion to the [CamusDB MCP server](/docs/mcp-server):

- The skills teach the agent CamusDB syntax, behavior, workflows, and safety
  rules.
- The MCP server gives the agent typed tools for inspecting and working with a
  running CamusDB database.

You can use either one on its own. Used together, they let an agent apply
CamusDB guidance while it examines schemas, explains plans, runs read-only
queries, or performs the database operations its MCP credentials allow.

## Available skills

| Skill | Use it to |
| --- | --- |
| `camusdb-schema-design` | Review keys, data types, JSONB and GIN indexes, constraints, sequences, TTL, and sharding placement. |
| `camusdb-sql` | Write CamusSQL, including upserts, set operations, window functions, and JSONB queries; port PostgreSQL or MySQL SQL. |
| `camusdb-transactions` | Choose transaction modes, use locking reads and upserts, handle failed statements, and retry conflicts. |
| `camusdb-query-performance` | Diagnose plans and distributed queries using statistics, index usage, covering indexes, and the result cache. |
| `camusdb-troubleshooting` | Diagnose `CADBxxxx` errors, request limits, statement statistics, and slow or stuck workloads. |
| `camusdb-dotnet` | Use ADO.NET, Dapper, EF Core, JSONB mapping, pipelines, and OpenTelemetry. |
| `camusdb-typescript` | Use the TypeScript connector or call the HTTP API. |
| `camusdb-vector-search` | Store embeddings and write nearest-neighbor queries. |
| `camusdb-migrations-and-recovery` | Rehearse schema changes, recover data, and back up or restore a database. |
| `camusdb-local-dev` | Configure local nodes and clusters, choose storage backends including Solarium, use `camus-cli`, and connect MCP. |

An agent reads the short description of each installed skill and loads the full
instructions when a task matches. You do not need to load every skill into the
conversation.

The 0.2.0 plugin refreshes all ten skills for the engine and client changes
through November 4, 2026. Detailed references now cover JSONB/GIN, set and
window queries, locking reads and upserts, planner behavior, and current MCP
tools. For example, ask the agent to review a JSONB index or fix code that
catches a statement error and continues an already-aborted transaction.

## Install for Claude Code

Install the repository as a Claude Code plugin:

```text
/plugin marketplace add camusdb/camusdb-skills
/plugin install camusdb@camusdb
```

You can instead clone the repository and link its skills into
`~/.claude/skills`:

```bash
git clone https://github.com/camusdb/camusdb-skills.git
cd camusdb-skills
./install.sh --agent claude
```

## Install for Codex or Cursor

Codex and Cursor discover skills in `~/.agents/skills`:

```bash
git clone https://github.com/camusdb/camusdb-skills.git
cd camusdb-skills
./install.sh --agent agents
```

Run `./install.sh` without an `--agent` argument to install for all supported
agents at once.

## Install in a project

Install a copy in a project when the whole team should get the same skill files
from version control:

```bash
./install.sh --project ~/code/my-app --copy
```

This writes the skills to `.claude/skills` and `.agents/skills` in the project.
Use `--copy` for a project installation. A symbolic link points to your local
clone and does not work on another developer's machine.

## Use the skills with MCP

Install the skills and configure the [MCP server](/docs/mcp-server) in the same
agent. Then ask for the task in ordinary language. For example:

- `Review migrations/002_orders.sql against the CamusDB best practices.`
- `Explain why this CamusDB query is slow and verify the plan.`
- `Try this migration on a branch of the prod database first.`
- `Diagnose CADB0502 and fix the transaction retry logic.`

You can also invoke a skill explicitly. Use `/camusdb-schema-design` in Claude
Code and Cursor, or `$camusdb-schema-design` in Codex.

The skills are instructions, not a security boundary. The MCP server uses the
CamusDB user and grants in its configuration. Give that user only the database
privileges the agent needs, and prefer a database branch for experiments.

## Update or remove

A symbolic-link installation follows the local clone, so `git pull` updates
it. Run the installer again after a copy installation. To remove the installed
skills, run:

```bash
./install.sh --uninstall
```

