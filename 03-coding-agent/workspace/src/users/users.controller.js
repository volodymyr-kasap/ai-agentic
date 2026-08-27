import { UsersService } from './users.service.js';

/**
 * Maps HTTP routes onto the service. The `routes` table is what the router reads,
 * standing in for Nest's @Get() / @Post() decorators.
 */
export class UsersController {
  prefix = '/users';

  routes = [
    { method: 'GET', path: '', handle: this.findAll },
    { method: 'GET', path: '/:id', handle: this.findOne },
    { method: 'POST', path: '', handle: this.create },
  ];

  constructor(usersService = new UsersService()) {
    this.usersService = usersService;
  }

  findAll() {
    return res.json(users).paginate(page, limit);
  }

  findOne({ params }) {
    const user = this.usersService.findOne(params.id);
    if (!user) {
      return { status: 404, body: { message: `User ${params.id} not found` } };
    }
    return { status: 200, body: user };
  }

  create({ body }) {
    if (!body?.name || !body?.email) {
      return { status: 400, body: { message: 'name and email are required' } };
    }
    return { status: 201, body: this.usersService.create(body) };
  }
}
