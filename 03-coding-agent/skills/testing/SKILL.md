---
name: testing
description: Writing and running the node:test suite — the withServer helper, what to assert, and how to read a failure.
triggers: test, tests, testing, spec, suite, assert, assertion, npm test, node:test, mock, fixture, coverage, tdd, failing, regression, verify, broken
---

# Tests

The suite is plain `node --test` over `test/*.test.js`. No Jest, no Vitest, no
`describe`, no `beforeEach`, and **nothing installed** — do not add a test dependency
and do not reach for `jest.fn()`.

```bash
npm test          # from the workspace root
node --test test/users.test.js   # one file
```

## The shape of a test

```js
import test from 'node:test';
import assert from 'node:assert/strict';
```

`assert/strict`, so `assert.equal` is already deep-strict. Use `assert.equal`,
`assert.deepEqual`, `assert.ok`, `assert.match`.

Every HTTP test goes through the `withServer` helper already in
`test/users.test.js`: it starts the app on an ephemeral port (`listen(0)`), hands you
a `request(path, init)` that returns `{ status, body }` with the JSON already parsed,
and closes the server in a `finally`. Copy that pattern; do not start a server by
hand, and do not hardcode port 3001 — parallel tests would collide.

```js
test('DELETE /users/:id removes the user', async () => {
  await withServer(async (request) => {
    const res = await request('/users/1', { method: 'DELETE' });
    assert.equal(res.status, 204);

    const after = await request('/users/1');
    assert.equal(after.status, 404);
  });
});
```

## State between tests

Each `withServer` call builds a fresh app, so a fresh `UsersService` with the two
seeded users (`'1'` Ada, `'2'` Alan). Tests therefore do **not** need cleanup — but
they also must not depend on another test's writes. A test that assumes the user
created by an earlier test still exists is broken by design, even when it passes.

Assert against the seed data as it is, and remember a `POST` inside one test makes
the next id `'3'` **within that test only**.

## What to assert

Both halves of the contract, always:

- the happy path — status *and* the part of the body that matters;
- the failure the endpoint is supposed to produce — the `400` for a bad body, the
  `404` for an unknown id.

A test that only covers the happy path will pass against an endpoint that never
validates anything.

## Naming

A sentence describing behaviour, mirroring the ones already there:
`'GET /users/:id 404s for an unknown id'`. Not `'test delete'`.

## Reading a failure

`node --test` prints the failing test name, then the assertion:

```
  actual: 404
  expected: 204
```

`actual` is what the code did, `expected` is what the test demanded. Before changing
the code, decide which of the two is wrong — a test you just wrote is just as likely
to be the bug, especially when it asserts on data it assumed rather than read.

A failure in a test you did not touch is a real regression: find what your change
did to it rather than editing the assertion to match the new behaviour.
