---
sidebar_position: 3.55
---

# Authentication and authorization

CamusDB can enforce SQL authentication and per-object authorization for an HTTP
client and for a gRPC client. Authentication is off by default. An existing
development deployment therefore continues to work until an operator enables
authentication.

While authentication is enabled, CamusDB fails closed:

- The server refuses to start with an empty user catalog. It starts only when
  you supply bootstrap credentials for an administrator.
- A request must include a valid bearer token.
- CamusDB checks every statement against the privileges that its tables and its
  databases require.
- CamusDB refuses a request that carries a credential over a plaintext
  connection. There are two exceptions: a request from loopback, and a
  deployment where you disabled the TLS requirement.

CamusDB stores a password only as a salted PBKDF2-HMAC-SHA256 verifier. An
ordinary client request uses a short-lived opaque bearer token. It does not send
the password again.

## Enable authentication

Configure the authentication switch and the secrets through environment
variables, or through a secret provider. Do not configure them in `config.yml`.
Do not put a token key or a bootstrap password in YAML. The TLS topology setting
is not a secret. [TLS](#tls) covers it.

| Environment variable | Required | Meaning |
| --- | --- | --- |
| `CAMUSDB_AUTH_ENABLED` | yes | Set it to `true` to enable authentication and authorization. Any other value keeps them disabled. |
| `CAMUSDB_AUTH_TOKEN_KEY` | yes, while auth is enabled | The server-side key that applies an HMAC to the access-token secrets at rest. Use a long random value. Every node of the cluster must use the same value. |
| `CAMUSDB_BOOTSTRAP_USER` | at the first start with auth only | The name of the first superuser, used when the auth catalog is empty. |
| `CAMUSDB_BOOTSTRAP_PASSWORD` | at the first start with auth only | The initial password of the bootstrap superuser. |
| `CAMUSDB_NODE_SECRET` | in a cluster deployment with auth | The shared secret for the internal routes between nodes, used while auth is enabled. Every node of the cluster must use the same value. |

Here is an example:

```bash
export CAMUSDB_AUTH_ENABLED=true
export CAMUSDB_AUTH_TOKEN_KEY="$(openssl rand -hex 32)"
export CAMUSDB_BOOTSTRAP_USER=admin
export CAMUSDB_BOOTSTRAP_PASSWORD="$(openssl rand -base64 24)"
export CAMUSDB_NODE_SECRET="$(openssl rand -hex 32)"
```

At startup, three rules apply:

1. CamusDB creates one bootstrap superuser from the supplied values, if the auth
   catalog is empty.
2. Startup fails if the auth catalog is empty and the bootstrap values are
   absent.
3. CamusDB ignores the bootstrap values as soon as one user exists.

There is no default user, and there is no default password.

## Login and logout

Use `/login` to exchange a user name and a password for a bearer token:

```http
POST /login
Content-Type: application/json

{ "user": "admin", "password": "secret" }
```

A successful response looks like this:

```json
{
  "status": "ok",
  "token": "camus_<id>.<secret>",
  "expiresAtUnixMs": 1785270000000,
  "expiresInSeconds": 900
}
```

Send the token on each later HTTP request:

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

A token has an absolute lifetime of 15 minutes by default. There is no refresh
token. A client logs in again after a token expires.

The login response reports the deadline of the token in two forms:

- `expiresAtUnixMs` is the absolute UTC Unix epoch millisecond at which CamusDB
  stops acceptance of the token.
- `expiresInSeconds` is the same deadline, as a duration that the server
  measured.

Renew from those two fields. Do not assume a fixed lifetime. An operator can
change `AccessTokenTtl`. A client must renew before the reported deadline.

Three events invalidate an outstanding token: a change of the password, a `DROP
USER`, and a call to `/logout`.

## gRPC tokens

A gRPC client uses the same bearer token, in the request metadata:

```text
authorization: Bearer camus_<id>.<secret>
```

Use the `CamusAuth` gRPC service to obtain a token and to revoke one:

| RPC | Purpose |
| --- | --- |
| `Login(LoginRequest)` | Exchanges `user` and `password` for `token`, `expires_at_unix_ms`, and `expires_in_seconds`. |
| `Logout(LogoutRequest)` | Revokes the token in the `authorization` metadata. A second logout has no further effect. |

A gRPC-only deployment therefore does not need the HTTP API. Its clients do not
need a call to `/login`.

An authentication error and an authorization error map to an ordinary gRPC
status code:

| Condition | gRPC status |
| --- | --- |
| A token is absent, invalid, or expired | `UNAUTHENTICATED` |
| An authenticated caller lacks a privilege | `PERMISSION_DENIED` |
| The login rate limit or the KDF limit is reached | `RESOURCE_EXHAUSTED` |

See [gRPC API](/docs/grpc-api) for the service reference.

## TLS

While auth is enabled, CamusDB by default refuses a request that carries a
credential over a plaintext connection. A request from loopback is exempt.
Development on one host therefore works without a certificate.

Use HTTPS in production, or terminate TLS in front of the HTTP API. Deploy gRPC
over TLS as well.

TLS can terminate in front of the node, at an ingress, at a sidecar, or in a
service mesh. The CamusDB process then sees only the trusted plaintext hop. In
that topology, disable the transport check. Keep authentication and the grants
enabled:

```yaml
require_tls_when_auth_enabled: false
```

You can also use the command-line flag:

```bash
camusdb --require-tls-when-auth-enabled false
```

This setting is not a secret. It therefore belongs in the ordinary
configuration. Do not turn it off for a node that a client can reach directly.

## Manage users

The statements for user management are server-level statements. They need no
database context. They need the superuser attribute.

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

CamusDB supports `sha256_password` only. It uses that plugin by default when you
omit `IDENTIFIED WITH`.

`CREATE USER grant_target` creates a target for a grant, without a password.
That user cannot log in. Set a password with `ALTER USER` first.

Use a bound parameter for a password:

```camussql
CREATE USER myapp IDENTIFIED BY @password;
ALTER USER myapp IDENTIFIED BY @new_password;
```

A parameter keeps a cleartext secret out of the shell history, out of the
traces, and out of the query logs. A password has a maximum length of 1 KiB.

## Grant privileges

Use `GRANT` and `REVOKE` to manage the privileges on an object:

```camussql
GRANT SELECT, INSERT ON app.* TO myapp;
GRANT SELECT ON app.orders TO reader;
GRANT ALTER, INDEX ON app.orders TO migrator;
GRANT ALL PRIVILEGES ON app.* TO poweruser;

REVOKE INSERT ON app.* FROM myapp;

SHOW GRANTS FOR myapp;
SHOW GRANTS;
```

`SHOW GRANTS FOR <user>` returns the grants of the named user. `SHOW GRANTS`
without `FOR` returns the grants of the authenticated user.

CamusDB supports these privileges:

| Privilege | Allows |
| --- | --- |
| `SELECT` | Read the data of a table. Inspect the metadata of a table, with `SHOW COLUMNS` and `SHOW CREATE TABLE`. |
| `INSERT` | Insert a row. |
| `UPDATE` | Update a row. |
| `DELETE` | Delete a row. |
| `CREATE TABLE` | Create a table in the target database scope. |
| `DROP` | Drop a database or a table in the scope. |
| `ALTER` | Alter the metadata of a table or of a database in the scope. |
| `INDEX` | Create, alter, or drop an index in the scope. |
| `CREATE` | Create a database, or another object with a create scope where that applies. |
| `ALL PRIVILEGES` | The union of the concrete privileges that CamusDB knows today. |

A grant has one of three scopes. The list starts with the broadest scope:

| Scope | Example | Meaning |
| --- | --- | --- |
| Global | `*.*` | Every database and every table. |
| Database | `app.*` | Every table in one database. |
| Table | `app.orders` | One table. |

Grants add together, and a repeated grant is harmless. A grant of a privilege
that the user already holds does nothing. `REVOKE` subtracts a privilege from
the matching scope.

A grant binds to the immutable identity of a database or of a table. A rename
therefore keeps the grant. A table that you drop and create again does not
inherit the grants of the old table.

`GRANT` never creates a user. It also cannot make a user a superuser. Only the
bootstrap sets the superuser attribute.

## Enforcement rules

While auth is enabled, CamusDB checks every statement before it runs the
statement.

A read of a table needs `SELECT` on every table that the statement references.
That rule covers a join, a derived table, a subquery, a semi-join, `EXISTS`,
`IN`, and `EXPLAIN` for a query that reads a table.

A write needs the matching write privilege:

- `INSERT` for an insert.
- `UPDATE` for an update.
- `DELETE` for a delete.

[`TRUNCATE`](/docs/truncate-table) needs both `DELETE` and `DROP` on the target
table. It removes every row, which is an effect of a `DELETE`. It also retires a
whole key space, which is an effect of a `DROP`.

CamusDB checks the two privileges one at a time. They can therefore come from
two separate grants.

DDL needs the relevant DDL privilege, or superuser status. Two areas need a
superuser: the administration of users and grants, and the DDL for the lifetime
of a database.

Some statements open no table. Any authenticated user may run them. Examples are
`SHOW TABLES`, `SHOW DATABASE`, and a `SELECT` without a `FROM` clause.

Inspection of one table needs `SELECT` on that table. Examples are `SHOW
COLUMNS`, `SHOW CREATE TABLE`, and [`SHOW STATISTICS`](/docs/show-statistics).
`SHOW STATISTICS` reports bounds taken from real column values. CamusDB
therefore holds it to the same requirement as a read of those columns, and to
nothing higher.

`SHOW ENGINE STATS` inspects the operation of one node. It needs a superuser. It
is not scoped to a grant on a database or on a table.

The configuration surface has the same requirement. `SHOW VARIABLES`, `SHOW
CLUSTER SETTINGS`, and
[`SET` and `RESET CLUSTER SETTING`](/docs/runtime-cluster-settings) all need a
superuser. The last two also change the behavior of every node. Several of the
settings that they reach bound memory, concurrency, and background work.

One behavior is conservative today. An `UPDATE` or a `DELETE` with a subquery
that reads another table needs the write privilege on that second table. Only
`SELECT` would be sufficient. The rule is too restrictive. It is not too
permissive.

## Runtime defaults

These defaults are security settings at process level:

| Setting | Default | Meaning |
| --- | --- | --- |
| Access token lifetime | 15 minutes | The absolute lifetime of a bearer token. |
| Authorization cache TTL | 1 second | The maximum staleness of a cached snapshot of a token or a privilege, on one node. A revoke on another node takes effect inside this bound. |
| Password hash iterations | 600,000 | The PBKDF2-HMAC-SHA256 work factor, stored with each credential. |
| Login KDF concurrency | 8 | The maximum number of concurrent password verifications on one node. |
| Login attempts per minute | 20 | The login rate limit, per account. |
| Principal cache max entries | 10,000 | The bound of the cache of authenticated principals, on one node. |
| TLS requirement | enabled | Refuse a plaintext request that carries a credential, except from loopback. Configure it as `require_tls_when_auth_enabled`, or as `--require-tls-when-auth-enabled true\|false`. |

## Errors

An authentication error does not reveal which part was wrong. It does not tell
the caller whether the user, the password, or the token was wrong. That behavior
is intentional.

| Code | Meaning |
| --- | --- |
| `CADB0512 UserAlreadyExists` | `CREATE USER` targets an existing user, and the statement has no `IF NOT EXISTS`. |
| `CADB0513 UserDoesNotExist` | `ALTER USER`, `DROP USER`, `GRANT`, or `REVOKE` targets an unknown user. |
| `CADB0514 UnsupportedAuthPlugin` | `IDENTIFIED WITH` names an auth plugin that CamusDB does not support. |
| `CADB0515 InvalidPrivilege` | `GRANT` or `REVOKE` uses an unknown or invalid privilege. |
| `CADB0516 AuthenticationFailed` | The credentials are absent, invalid, expired, or revoked. The user name or the password is also wrong in some cases. |
| `CADB0517 InsufficientPrivilege` | The authenticated caller lacks the privilege that the statement needs. |
| `CADB0518 TooManyAuthAttempts` | The caller passed the login rate limit, or the limit on concurrent password verifications. |
| `CADB0519 InsecureTransport` | A request with a credential arrived over plaintext while TLS is required. |

See [Error Codes](/docs/error-codes) for the map to HTTP status codes.
