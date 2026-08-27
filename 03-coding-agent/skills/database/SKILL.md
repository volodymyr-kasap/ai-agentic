---
name: database
description: The data layer — how the service stores records, id and seed rules, and how to add real persistence without touching the controllers.
triggers: database, db, persistence, store, storage, repository, entity, model, schema, migration, sql, sqlite, postgres, mysql, orm, typeorm, prisma, mongoose, mongo, seed, query builder, transaction, crud
---

# The data layer

There is no database. `UsersService` holds an in-memory array, and for most tasks
that is the whole data layer — treat it as one anyway, because the boundary is what
keeps the layering honest.

```js
this.users = [ { id: '1', name: 'Ada Lovelace', email: 'ada@example.com' }, ... ];
this.nextId = 3;
```

## Rules for records

- **Ids are strings**, produced by `String(this.nextId++)`. Path params arrive as
  strings, so this keeps `find(u => u.id === id)` working without coercion. Do not
  switch to numbers, and do not add uuids unless the task asks.
- **A missing record is `undefined`**, not `null` and not a thrown error. The service
  returns `undefined`; the controller turns that into a `404`. Keep it that way — a
  service that throws HTTP errors has HTTP knowledge it should not have.
- **Mutate in place.** `push`, `splice`, and direct field assignment on the found
  object. The array is the store; replacing `this.users` with a new array is fine
  too, but do not hand callers a copy and expect writes to it to stick.
- **Seed data is a fixture.** Tests assert on Ada and Alan by name, email and id.
  Changing the seed breaks tests that have nothing to do with your task; if a task
  needs different data, create it through the API inside the test.

## Method conventions

Service methods are named after the operation, not the SQL: `findAll`, `findOne(id)`,
`create(dto)`, `update(id, dto)`, `remove(id)` — the same names Nest's generated
resources use, so a controller reads the same whatever is underneath.

- `update` returns the updated record, or `undefined` if the id is unknown.
- `remove` returns `true` / `false` (or the removed record), never a status code.

## Adding real persistence

If a task actually calls for a database, the shape is fixed by the layering: the
controller must not change at all, and the service keeps its method names.

1. Put the driver behind a repository module — `src/users/users.repository.js` —
   exposing the same `findAll` / `findOne` / `create` names.
2. Inject it the way the service is injected today:
   `constructor(repo = new UsersRepository())`.
3. Make the methods `async` end to end. The router already `await`s handler results,
   so a promise-returning service works without touching `core/router.js`.
4. Keep the seed for tests — an in-memory repository implementing the same interface
   is what the suite should run against, so `npm test` stays dependency-free.

Do not add `sqlite3`, `pg`, `prisma` or `typeorm` to `package.json` on your own
initiative. `npm test` runs with nothing installed, and that is a property worth
keeping; if a task genuinely requires a real driver, say so before installing it.
