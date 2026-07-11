class InMemoryTodoRepository {
  constructor() {
    this.todos = [];
    this.currentId = 1;
  }

  async getAll(userId) {
    return this.todos.filter(t => t.user_id === parseInt(userId));
  }

  async getById(id, userId) {
    const todo = this.todos.find(t => t.id === parseInt(id) && t.user_id === parseInt(userId));
    return todo || null;
  }

  async create(title, userId) {
    const newTodo = {
      id: this.currentId++,
      user_id: parseInt(userId),
      title,
      completed: false,
      created_at: new Date()
    };
    this.todos.push(newTodo);
    return newTodo;
  }

  async delete(id, userId) {
    const index = this.todos.findIndex(t => t.id === parseInt(id) && t.user_id === parseInt(userId));
    if (index === -1) return false;
    this.todos.splice(index, 1);
    return true;
  }
}

module.exports = InMemoryTodoRepository;
