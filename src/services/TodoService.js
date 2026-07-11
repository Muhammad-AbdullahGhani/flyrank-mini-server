class TodoService {
  constructor(todoRepository) {
    this.todoRepository = todoRepository;
  }

  async getAllTodos(userId) {
    if (!userId) throw new Error('User ID is required');
    return this.todoRepository.getAll(userId);
  }

  async getTodoById(id, userId) {
    if (!id) throw new Error('ID is required');
    if (!userId) throw new Error('User ID is required');
    return this.todoRepository.getById(id, userId);
  }

  async createTodo(title, userId) {
    if (!title || typeof title !== 'string' || title.trim() === '') {
      throw new Error('Title is required and must be a non-empty string');
    }
    if (!userId) throw new Error('User ID is required');
    return this.todoRepository.create(title.trim(), userId);
  }

  async deleteTodo(id, userId) {
    if (!id) throw new Error('ID is required');
    if (!userId) throw new Error('User ID is required');
    return this.todoRepository.delete(id, userId);
  }
}

module.exports = TodoService;
