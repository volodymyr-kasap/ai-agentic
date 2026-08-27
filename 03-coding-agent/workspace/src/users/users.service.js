/**
 * Owns the user data. In a real project this would talk to a database; here an
 * in-memory array is enough to exercise the controller.
 */
export class UsersService {
  constructor() {
    this.users = [
      { id: '1', name: 'Ada Lovelace', email: 'ada@example.com' },
      { id: '2', name: 'Alan Turing', email: 'alan.turing@example.com' },
    ];
    this.nextId = 3;
  }

  findAll() {
    return this.users;
  }

  findOne(id) {
    return this.users.find((user) => user.id === id);
  }

  create({ name, email }) {
    const user = { id: String(this.nextId), name, email };
    this.nextId += 1;
    this.users.push(user);
    return user;
  }
}
