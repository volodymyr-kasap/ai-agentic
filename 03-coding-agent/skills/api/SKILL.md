---
name: api
description: The HTTP contract — how handlers return status and body, which codes to use, and how params, query and body arrive.
triggers: api, http, endpoint, route, rest, request, response, status, get, post, put, patch, delete, param, query, querystring, body, json, pagination, paginate, validation, 404, 400, 201, header, cors
---

# The HTTP contract

## What a handler receives

```js
handle({ params, body, query })
```

- `params` — path parameters, already `decodeURIComponent`'d. `'/users/:id'` → `params.id`.
  **Always strings**, never numbers. Ids in the data are strings too; compare with `===`
  and do not `Number()` them.
- `body` — parsed JSON, or `undefined` for a `GET`/`DELETE`, or `undefined` for an empty
  body. Invalid JSON never reaches the handler: the router answers `400` itself.
- `query` — a `URLSearchParams`, not a plain object. Read it with `query.get('page')`,
  which returns a string or `null`. Destructuring it gives you nothing.

## What a handler returns

```js
return { status: 200, body: user };   // explicit — preferred
return user;                          // shorthand, becomes 200 with that body
```

`status` defaults to `200`, and the router serialises `body` as JSON. Anything you
return is the response — there is no `res` object in scope. Never call `res.json()`,
`res.send()` or `res.status()`; those are Express and they do not exist here.

Throwing works too, and is the right move for an error raised deep in a service:

```js
throw Object.assign(new Error('User 7 not found'), { status: 404 });
```

The router catches it and answers `{ message: err.message }` with that status; an
error without a `status` becomes a `500`.

## Status codes this API uses

| Code | When |
|---|---|
| `200` | successful read or update |
| `201` | resource created (`POST` that added something) |
| `204` | successful delete — return `{ status: 204 }` with **no** body |
| `400` | the request body is missing a required field, or a query param is nonsense |
| `404` | the id is well-formed but nothing has it |

## Error body shape

One shape, everywhere, no exceptions:

```js
{ message: 'User 999 not found' }
```

Not `{ error }`, not a bare string. Tests assert on `message`.

## Validate before you work

Check the input first and return `400` before touching the service — see
`UsersController.create`. Validation lives in the controller; the service assumes
it is given something valid.

## Pagination convention

If a collection endpoint takes paging, it reads `?page=` and `?limit=` from `query`,
defaults to page 1, clamps `limit` to something sane, and returns the plain array —
this API does not wrap collections in an envelope unless the task says to.

```js
const page = Math.max(1, Number(query.get('page') ?? 1) || 1);
const limit = Math.min(100, Math.max(1, Number(query.get('limit') ?? 20) || 20));
return { status: 200, body: items.slice((page - 1) * limit, page * limit) };
```

## Checklist for a new endpoint

1. Controller method returning `{ status, body }`.
2. Entry in the `routes` table — without it the route does not exist.
3. Service method if any data is read or changed (the controller must not touch data).
4. A test in `test/` for the success case *and* the failure case.
