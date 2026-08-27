/**
 * Minimal stand-in for what NestJS decorators do: turn a controller's route table
 * into an http request handler. Paths may contain :params, e.g. '/users/:id'.
 */

export function createRouter(controllers) {
  const routes = controllers.flatMap((controller) =>
    controller.routes.map((route) => ({
      method: route.method,
      pattern: compile(controller.prefix + route.path),
      handle: route.handle.bind(controller),
    }))
  );

  return async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

    for (const route of routes) {
      if (route.method !== req.method) continue;
      const match = route.pattern.regex.exec(url.pathname);
      if (!match) continue;

      const params = Object.fromEntries(
        route.pattern.keys.map((key, i) => [key, decodeURIComponent(match[i + 1])])
      );

      try {
        const body = await readBody(req);
        const result = await route.handle({ params, body, query: url.searchParams });
        return send(res, result?.status ?? 200, result?.body ?? result);
      } catch (err) {
        return send(res, err.status ?? 500, { message: err.message });
      }
    }

    return send(res, 404, { message: `Cannot ${req.method} ${url.pathname}` });
  };
}

/** '/users/:id' -> { regex: /^\/users\/([^/]+)$/, keys: ['id'] } */
function compile(path) {
  const keys = [];
  const source = path
    .replace(/[.+*?^${}()|[\]\\]/g, '\\$&')
    .replace(/:(\w+)/g, (_, key) => {
      keys.push(key);
      return '([^/]+)';
    });
  return { regex: new RegExp(`^${source}$`), keys };
}

function readBody(req) {
  if (req.method === 'GET' || req.method === 'DELETE') return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}
