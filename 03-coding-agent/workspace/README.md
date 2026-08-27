# users-api

A tiny HTTP API laid out the way a NestJS project is: a module wires controllers
together, a controller maps routes to handlers, and a service owns the data.

Deliberately dependency-free — the router in `src/core/router.js` stands in for
what Nest's decorators do, so `npm test` runs with nothing installed.

```
src/
  main.js                 bootstrap
  app.module.js           registers controllers
  core/router.js          route table -> http handler
  users/users.controller.js
  users/users.service.js
test/
  users.test.js
```

```bash
npm start      # http://localhost:3001
npm test
```
