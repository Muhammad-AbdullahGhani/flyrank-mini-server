class PostgresTodoRepository {
  /**
   * @param {import('pg').Pool} pool 
   */
  constructor(pool) {
    this.pool = pool;
  }

  async getAll(userId) {
    const result = await this.pool.query('SELECT * FROM todos WHERE user_id = $1 ORDER BY id ASC', [parseInt(userId)]);
    return result.rows;
  }

  async getById(id, userId) {
    const result = await this.pool.query('SELECT * FROM todos WHERE id = $1 AND user_id = $2', [parseInt(id), parseInt(userId)]);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  async create(title, userId) {
    const result = await this.pool.query(
      'INSERT INTO todos (title, completed, user_id) VALUES ($1, false, $2) RETURNING *',
      [title, parseInt(userId)]
    );
    return result.rows[0];
  }

  async delete(id, userId) {
    const result = await this.pool.query('DELETE FROM todos WHERE id = $1 AND user_id = $2', [parseInt(id), parseInt(userId)]);
    return result.rowCount > 0;
  }
}

module.exports = PostgresTodoRepository;
