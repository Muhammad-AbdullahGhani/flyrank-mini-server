class InMemoryTodoRepository {
  constructor() {
    this.todos = [];
    this.currentId = 1;
  }

  async getAll() {
    return this.todos;
  }

  async getById(id) {
    const todo = this.todos.find(t => t.id === parseInt(id));
    return todo || null;
  }

  async create(title) {
    const newTodo = {
      id: this.currentId++,
      title,
      completed: false,
      created_at: new Date()
    };
    this.todos.push(newTodo);
    return newTodo;
  }

  async delete(id) {
    const index = this.todos.findIndex(t => t.id === parseInt(id));
    if (index === -1) return false;
    this.todos.splice(index, 1);
    return true;
  }
}

module.exports = InMemoryTodoRepository;
