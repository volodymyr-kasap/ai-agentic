import { UsersController } from './users/users.controller.js';
import { createRouter } from './core/router.js';

/** Registers the application's controllers, the way an AppModule does in Nest. */
export function createApp() {
  const controllers = [new UsersController()];
  return createRouter(controllers);
}
