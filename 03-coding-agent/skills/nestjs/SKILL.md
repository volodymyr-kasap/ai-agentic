---
name: nestjs
description: How this codebase is layered — module, controller, service — and where a new piece of behaviour belongs.
triggers: nestjs, nest, module, controller, service, provider, injectable, decorator, dependency injection, architecture, layer, resource, refactor, structure
---

# NestJS-shaped architecture

This project has no NestJS dependency, but it is laid out exactly like one, and the
layering is not decoration — it is the convention every change has to follow.

| Nest concept | Here |
|---|---|
| `@Module()` | `src/app.module.js` — `createApp()` instantiates the controllers |
| `@Controller('users')` | a class with `prefix = '/users'` and a `routes` table |
| `@Get()` / `@Post()` | an entry in that `routes` array |
| decorator metadata → HTTP | `src/core/router.js`, hand-rolled |
| provider / service | `src/users/users.service.js` — owns the data |
| constructor injection | `constructor(usersService = new UsersService())` |

## The layering rule

    router  →  controller  →  service  →  data

- The **controller** translates HTTP into a call and a result into a status code.
  It must not own state, and it must not reach into `service.users` directly.
- The **service** owns the data and the business rules. It knows nothing about HTTP:
  no status codes, no `req`, no `res`. It returns values or `undefined`.
- The **router** is generic. Adding a route never means editing `core/router.js`.

A change that puts logic on the wrong side of that line is wrong even if the tests
pass. If you find yourself filtering an array inside a controller, move it down.

## Adding a route to an existing controller

Two edits, in this order:

1. Add a method to the controller class.
2. Add its entry to the `routes` table: `{ method, path, handle: this.methodName }`.

Both are required — a method that is not in the table is unreachable, and that is
the most common mistake here. `path` is relative to `prefix`, so `'/:id'` under
`prefix = '/users'` serves `/users/:id`. An empty `path` (`''`) serves `/users`.

Handlers are called as `handle({ params, body, query })` and are bound to the
controller instance, so `this.usersService` works.

## Adding a whole new resource

Mirror `src/users/` exactly:

    src/things/things.controller.js   class ThingsController { prefix = '/things'; routes = [...] }
    src/things/things.service.js      class ThingsService { ... }

then register the controller in `src/app.module.js`:

```js
const controllers = [new UsersController(), new ThingsController()];
```

Forgetting that last step is the second most common mistake: everything looks
written, and every request 404s.

## Conventions to match

- ES modules, `.js` extension **required** in every relative import.
- Named exports for classes; no default exports anywhere in `src/`.
- Constructor-injected collaborators with a default (`= new UsersService()`), which
  is what makes a service swappable in a test.
