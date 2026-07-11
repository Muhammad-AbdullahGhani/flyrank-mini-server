class InMemoryUserRepository {
  constructor() {
    this.users = [];
    this.currentId = 1;
  }

  async create(username, passwordHash) {
    const existing = await this.findByUsername(username);
    if (existing) {
      throw new Error('Username already exists');
    }
    const newUser = {
      id: this.currentId++,
      username,
      password_hash: passwordHash,
      created_at: new Date()
    };
    this.users.push(newUser);
    return newUser;
  }

  async findByUsername(username) {
    const user = this.users.find(u => u.username.toLowerCase() === username.toLowerCase());
    return user || null;
  }

  async findById(id) {
    const user = this.users.find(u => u.id === parseInt(id));
    return user || null;
  }
}

module.exports = InMemoryUserRepository;
