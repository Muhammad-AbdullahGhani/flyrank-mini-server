class TodoService {
  constructor(todoRepository) {
    this.todoRepository = todoRepository;
  }

  async getAllTodos() {
    return this.todoRepository.getAll();
  }

  async getTodoById(id) {
    if (!id) throw new Error('ID is required');
    return this.todoRepository.getById(id);
  }

  async createTodo(title) {
    if (!title || typeof title !== 'string' || title.trim() === '') {
      throw new Error('Title is required and must be a non-empty string');
    }
    return this.todoRepository.create(title.trim());
  }

  async deleteTodo(id) {
    if (!id) throw new Error('ID is required');
    return this.todoRepository.delete(id);
  }
}

module.exports = TodoService;
