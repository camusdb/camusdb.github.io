---
sidebar_position: 3.55
---

# Authentication And Authorization

CamusDB can enforce SQL authentication and per-object authorization for HTTP
and gRPC clients. Authentication is off by default, so existing development
deployments keep working until an operator explicitly enables it.

When authentication is enabled, CamusDB fails closed:

- the server refuses to start with an empty user catalog unless bootstrap
  administrator credentials are supplied
- requests must include a valid bearer token
- every statement is checked against the privileges required by the tables and
  databases it touches
- credential-bearing requests over plaintext are refused unless they come from
  loopback or the TLS requirement is disabled

Passwords are stored only as salted PBKDF2-HMAC-SHA256 verifiers. Normal client
requests use short-lived opaque bearer tokens instead of resending passwords.

## Enable Authentication

The authentication switch and secrets are configured through environment
variables or a secret provider, not through `config.yml`. Do not put token keys
or bootstrap passwords in YAML. The non-secret TLS topology setting is covered
in [TLS](#tls).

| Environment variable | Required | Meaning |
| --- | --- | --- |
| `CAMUSDB_AUTH_ENABLED` | yes | Set to `true` to enable authentication and authorization. Any other value keeps auth disabled. |
| `CAMUSDB_AUTH_TOKEN_KEY` | yes when auth is enabled | Server-side key used to HMAC access-token secrets at rest. Use a long random value. Every cluster node must use the same value. |
| `CAMUSDB_BOOTSTRAP_USER` | first auth start only | First superuser name when the auth catalog is empty. |
| `CAMUSDB_BOOTSTRAP_PASSWORD` | first auth start only | Initial password for the bootstrap superuser. |
| `CAMUSDB_NODE_SECRET` | cluster auth deployments | Shared secret used for internal node-to-node routes when auth is enabled. Every cluster node must use the same value. |

Example:

```bash
export CAMUSDB_AUTH_ENABLED=true
export CAMUSDB_AUTH_TOKEN_KEY="$(openssl rand -hex 32)"
export CAMUSDB_BOOTSTRAP_USER=admin
export CAMUSDB_BOOTSTRAP_PASSWORD="$(openssl rand -base64 24)"
export CAMUSDB_NODE_SECRET="$(openssl rand -hex 32)"
```

On startup:

- if the auth catalog is empty, CamusDB creates one bootstrap superuser from
  the supplied bootstrap values
- if the auth catalog is empty and bootstrap values are missing, startup fails
- once any user exists, bootstrap values are ignored

There is no default user or password.

## Login And Logout

Use `/login` to exchange a username and password for a bearer token:

```http
POST /login
Content-Type: application/json

{ "user": "admin", "password": "secret" }
```

Successful response:

```json
{
  "status": "ok",
  "token": "camus_<id>.<secret>",
  "expiresAtUnixMs": 1785270000000,
  "expiresInSeconds": 900
}
```

Send the token on later HTTP requests:

```http
POST /execute-sql-query
Authorization: Bearer camus_<id>.<secret>
Content-Type: application/json

{
  "databaseName": "app",
  "sql": "SELECT * FROM orders"
}
```

Use `/logout` with the same `Authorization` header to revoke the current token:

```http
POST /logout
Authorization: Bearer camus_<id>.<secret>
```

Tokens have an absolute lifetime of 15 minutes by default. There is no refresh
token; clients log in again when a token expires. The login response reports
the token deadline in two forms:

- `expiresAtUnixMs`: the absolute UTC Unix epoch millisecond at which the token
  stops being accepted
- `expiresInSeconds`: the same deadline as a server-measured duration

Renew from those fields instead of assuming a fixed lifetime. Operators can
change `AccessTokenTtl`, and clients should renew before the reported deadline.

Password changes, `DROP USER`, and `/logout` invalidate outstanding tokens.

## gRPC Tokens

gRPC clients use the same bearer token in request metadata:

```text
authorization: Bearer camus_<id>.<secret>
```

Use the `CamusAuth` gRPC service to obtain and revoke tokens:

| RPC | Purpose |
| --- | --- |
| `Login(LoginRequest)` | Exchanges `user` and `password` for `token`, `expires_at_unix_ms`, and `expires_in_seconds`. |
| `Logout(LogoutRequest)` | Revokes the token supplied in `authorization` metadata. Logout is idempotent. |

This means a gRPC-only deployment does not need to expose the HTTP API just so
clients can call `/login`.

Authentication and authorization errors map to normal gRPC status codes:

| Condition | gRPC status |
| --- | --- |
| missing, invalid, or expired token | `UNAUTHENTICATED` |
| authenticated caller lacks a privilege | `PERMISSION_DENIED` |
| login rate limit or KDF saturation | `RESOURCE_EXHAUSTED` |

See [gRPC API](/docs/grpc-api) for the service reference.

## TLS

When auth is enabled, CamusDB refuses credential-bearing requests over plaintext
connections by default. Loopback requests are exempt so single-host development
can work without certificates.

Use HTTPS or terminate TLS in front of the HTTP API for production. Deploy gRPC
over TLS as well.

If TLS terminates in front of the node, such as at an ingress, sidecar, or
service mesh, the CamusDB process sees only the trusted plaintext hop. In that
topology, disable the transport check while keeping authentication and grants
enabled:

```yaml
require_tls_when_auth_enabled: false
```

or with the command-line flag:

```bash
camusdb --require-tls-when-auth-enabled false
```

This setting is not a secret, so it belongs in normal configuration. Do not
turn it off for a node directly reachable by clients.

## Manage Users

User management statements are server-level statements. They do not require a
database context, and they require the superuser attribute.

```camussql
CREATE USER myapp IDENTIFIED WITH sha256_password BY 'app-password';
CREATE USER myapp IDENTIFIED BY 'app-password';
CREATE USER IF NOT EXISTS myapp IDENTIFIED BY 'app-password';
CREATE USER grant_target;

ALTER USER myapp IDENTIFIED BY 'new-password';
ALTER USER myapp IDENTIFIED WITH sha256_password BY 'new-password';

DROP USER myapp;
DROP USER IF EXISTS myapp;
```

Only `sha256_password` is supported. Omitting `IDENTIFIED WITH` uses that plugin
by default.

`CREATE USER grant_target` creates a grant target without a password. That user
cannot log in until a password is set with `ALTER USER`.

Prefer bound parameters for passwords:

```camussql
CREATE USER myapp IDENTIFIED BY @password;
ALTER USER myapp IDENTIFIED BY @new_password;
```

That keeps cleartext secrets out of shell history, traces, and query logs.
Passwords are capped at 1 KiB.

## Grant Privileges

Use `GRANT` and `REVOKE` to manage object privileges:

```camussql
GRANT SELECT, INSERT ON app.* TO myapp;
GRANT SELECT ON app.orders TO reader;
GRANT ALTER, INDEX ON app.orders TO migrator;
GRANT ALL PRIVILEGES ON app.* TO poweruser;

REVOKE INSERT ON app.* FROM myapp;

SHOW GRANTS FOR myapp;
SHOW GRANTS;
```

`SHOW GRANTS FOR <user>` returns the grants for a named user. `SHOW GRANTS`
without `FOR` returns the current authenticated user's grants.

Supported privileges:

| Privilege | Allows |
| --- | --- |
| `SELECT` | Read table data and inspect table-specific metadata such as `SHOW COLUMNS` and `SHOW CREATE TABLE`. |
| `INSERT` | Insert rows. |
| `UPDATE` | Update rows. |
| `DELETE` | Delete rows. |
| `CREATE TABLE` | Create tables in the target database scope. |
| `DROP` | Drop databases or tables in scope. |
| `ALTER` | Alter table/database metadata in scope. |
| `INDEX` | Create, alter, or drop indexes in scope. |
| `CREATE` | Create databases or other create-scoped objects where applicable. |
| `ALL PRIVILEGES` | The union of the concrete privileges currently known to CamusDB. |

Grant scopes, from broadest to narrowest:

| Scope | Example | Meaning |
| --- | --- | --- |
| Global | `*.*` | Every database and table. |
| Database | `app.*` | Every table in one database. |
| Table | `app.orders` | One table. |

Grants are additive and idempotent. Granting a privilege the user already has
is a no-op; `REVOKE` subtracts privileges from the matching scope.

Grants are bound to immutable database/table identities. A rename keeps the
grant. A dropped-and-recreated table does not inherit the old table's grants.

`GRANT` never creates a user, and it cannot make a user a superuser. The
superuser attribute is set only by bootstrap.

## Enforcement Rules

With auth enabled, CamusDB checks every statement before it runs.

Table reads require `SELECT` on every table referenced by the statement. This
includes joins, derived tables, subqueries, semi-joins, `EXISTS`, `IN`, and
`EXPLAIN` for queries that read tables.

Writes require the matching write privilege:

- `INSERT` for inserts
- `UPDATE` for updates
- `DELETE` for deletes

DDL requires the relevant DDL privilege or superuser status. User and grant
administration, plus database lifecycle DDL, require superuser.

Some statements do not open a table and are allowed to any authenticated user,
including `SHOW TABLES`, `SHOW DATABASE`, and `SELECT` statements without a
`FROM` clause. Table-specific inspection such as `SHOW COLUMNS`,
`SHOW CREATE TABLE`, and [`SHOW STATISTICS`](/docs/show-statistics) requires
`SELECT` on the table. `SHOW STATISTICS` reports bounds drawn from real column
values, so it is held to the same bar as reading those columns, and to nothing
higher.

`SHOW ENGINE STATS` is node-level operational introspection and requires a
superuser. It is not scoped to a database or table grant. The configuration
surface is held to the same bar: `SHOW VARIABLES`, `SHOW CLUSTER SETTINGS`, and
[`SET` / `RESET CLUSTER SETTING`](/docs/runtime-cluster-settings) all require a
superuser. The last two also change how every node behaves, and several of the
settings they reach bound memory, concurrency, and background work.

Known conservative behavior: an `UPDATE` or `DELETE` whose subquery reads
another table currently requires the write privilege on that read table rather
than only `SELECT`. This is over-restrictive, not permissive.

## Runtime Defaults

These defaults are currently process-level security knobs:

| Setting | Default | Meaning |
| --- | --- | --- |
| Access token lifetime | 15 minutes | Absolute bearer-token lifetime. |
| Authorization cache TTL | 1 second | Maximum per-node staleness for cached token/privilege snapshots. Cross-node revokes take effect within this bound. |
| Password hash iterations | 600,000 | PBKDF2-HMAC-SHA256 work factor stored with each credential. |
| Login KDF concurrency | 8 | Maximum concurrent password verifications per node. |
| Login attempts per minute | 20 | Per-account login rate limit. |
| Principal cache max entries | 10,000 | Per-node authenticated-principal cache bound. |
| TLS requirement | enabled | Refuse plaintext credential-bearing requests, except loopback. Configurable as `require_tls_when_auth_enabled` or `--require-tls-when-auth-enabled true\|false`. |

## Errors

Authentication errors intentionally avoid revealing whether the user, password,
or token was wrong.

| Code | Meaning |
| --- | --- |
| `CADB0512 UserAlreadyExists` | `CREATE USER` targets an existing user without `IF NOT EXISTS`. |
| `CADB0513 UserDoesNotExist` | `ALTER USER`, `DROP USER`, `GRANT`, or `REVOKE` targets an unknown user. |
| `CADB0514 UnsupportedAuthPlugin` | `IDENTIFIED WITH` names an unsupported auth plugin. |
| `CADB0515 InvalidPrivilege` | `GRANT` or `REVOKE` uses an unknown or invalid privilege. |
| `CADB0516 AuthenticationFailed` | Missing, invalid, expired, or revoked credentials, or bad username/password. |
| `CADB0517 InsufficientPrivilege` | Authenticated caller lacks the privilege required by the statement. |
| `CADB0518 TooManyAuthAttempts` | Login rate limit or password-verification concurrency limit was exceeded. |
| `CADB0519 InsecureTransport` | A credential-bearing request arrived over plaintext while TLS is required. |

See [Error Codes](/docs/error-codes) for HTTP status mappings.
