import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.module.js';

/** Start the app on an ephemeral port and return a fetch helper bound to it. */
async function withServer(run) {
  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;

  try {
    await run(async (path, init) => {
      const res = await fetch(base + path, init);
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : undefined };
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /users returns the seeded users', async () => {
  await withServer(async (request) => {
    const res = await request('/users');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 2);
    assert.equal(res.body[0].name, 'Ada Lovelace');
  });
});

test('GET /users/:id returns one user', async () => {
  await withServer(async (request) => {
    const res = await request('/users/2');
    assert.equal(res.status, 200);
    assert.equal(res.body.email, 'alan@example.com');
  });
});

test('GET /users/:id 404s for an unknown id', async () => {
  await withServer(async (request) => {
    const res = await request('/users/999');
    assert.equal(res.status, 404);
  });
});

test('POST /users creates a user', async () => {
  await withServer(async (request) => {
    const res = await request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Grace Hopper', email: 'grace@example.com' }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.id, '3');

    const all = await request('/users');
    assert.equal(all.body.length, 3);
  });
});

test('POST /users rejects a body without a name', async () => {
  await withServer(async (request) => {
    const res = await request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com' }),
    });
    assert.equal(res.status, 400);
  });
});
