---
sidebar_position: 7.25
description: "Give Claude Code, Codex, or Cursor CamusDB-specific guidance for schemas, SQL, transactions, query tuning, and operations with the CamusDB agent skills."
---

# Agent skills

A coding agent knows PostgreSQL and MySQL well, but it doesn't know where
CamusDB is different. The [CamusDB agent skills](https://github.com/camusdb/camusdb-skills)
give the agent that guidance. For example, the agent can choose good primary
keys for a distributed table, or add the correct retry logic for a transaction
conflict. The skills work with Claude Code, Codex, and Cursor.

The skills and the [CamusDB MCP server](/docs/mcp-server) do different jobs:

- The skills teach the agent how CamusDB SQL and its features work.
- The MCP server gives the agent tools to inspect and use a running database.

You can use either one alone. Together, the agent can apply the guidance to
your real schemas and query plans through MCP.

## Available skills

| Skill | Use it to |
| --- | --- |
| `camusdb-schema-design` | Design or review a schema, including keys and indexes. |
| `camusdb-sql` | Write and review CamusSQL, or port SQL from PostgreSQL or MySQL. |
| `camusdb-transactions` | Write transactional code, including locking reads and retries. |
| `camusdb-query-performance` | Find why a query is slow, and fix it with indexes or statistics. |
| `camusdb-troubleshooting` | Explain a `CADBxxxx` error and fix it, or diagnose a slow or stuck workload. |
| `camusdb-dotnet` | Use the .NET driver and its Dapper and EF Core packages. |
| `camusdb-typescript` | Use the TypeScript connector, or call the HTTP API from any language. |
| `camusdb-vector-search` | Store embeddings and write nearest-neighbor queries. |
| `camusdb-migrations-and-recovery` | Rehearse schema changes on a branch, and recover or restore data. |
| `camusdb-csharp-extensions` | Write inline C# functions and triggers, or build and install C# extension DLLs. |
| `camusdb-local-dev` | Install and run CamusDB for development, and connect the MCP server. |

An agent reads the short description of each installed skill. It loads the full
instructions of a skill when a task matches. You don't need to load the skills
yourself.

The current plugin version is 0.4.0. It covers CamusDB changes through
November 16, 2026.

## Install for Claude Code

Install the repository as a Claude Code plugin:

```text
/plugin marketplace add camusdb/camusdb-skills
/plugin install camusdb@camusdb
```

You can also clone the repository and link the skills into `~/.claude/skills`:

```bash
git clone https://github.com/camusdb/camusdb-skills.git
cd camusdb-skills
./install.sh --agent claude
```

## Install for Codex or Cursor

Codex and Cursor read skills from `~/.agents/skills`:

```bash
git clone https://github.com/camusdb/camusdb-skills.git
cd camusdb-skills
./install.sh --agent agents
```

Run `./install.sh` with no `--agent` option to install for all supported agents.

## Install in a project

To give a team the same skill files through version control, copy the skills
into the project:

```bash
./install.sh --project ~/code/my-app --copy
```

This writes the skills to `.claude/skills` and `.agents/skills` in the project.
Use `--copy` for a project. A symbolic link points to your local clone, and it
doesn't work on another developer's machine.

## Use the skills with MCP

Install the skills, and configure the [MCP server](/docs/mcp-server) in the same
agent. Then describe the task in your own words. For example:

- `Review migrations/002_orders.sql against the CamusDB best practices.`
- `Explain why this CamusDB query is slow and verify the plan.`
- `Try this migration on a branch of the prod database first.`
- `Diagnose CADB0502 and fix the transaction retry logic.`

You can also call a skill by name:

| Agent | Command |
| --- | --- |
| Claude Code, plugin install | `/camusdb:camusdb-schema-design` |
| Claude Code and Cursor, `install.sh` install | `/camusdb-schema-design` |
| Codex | `$camusdb-schema-design` |

The skills don't limit what the agent can do. The MCP server connects as the
CamusDB user in its configuration, and that user's grants decide what the agent
can change. Give that user only the privileges that the agent needs. You should
use a [database branch](/docs/database-branching) for experiments.

## Update or remove

A linked installation follows the local clone, so `git pull` updates it. After
a copy installation, run the installer again. To remove the skills, run:

```bash
./install.sh --uninstall
```
