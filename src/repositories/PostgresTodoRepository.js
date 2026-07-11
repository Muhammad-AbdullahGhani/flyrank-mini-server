class PostgresTodoRepository {
  /**
   * @param {import('pg').Pool} pool 
   */
  constructor(pool) {
    this.pool = pool;
  }

  async getAll() {
    const result = await this.pool.query('SELECT * FROM todos ORDER BY id ASC');
    return result.rows;
  }

  async getById(id) {
    const result = await this.pool.query('SELECT * FROM todos WHERE id = $1', [parseInt(id)]);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  async create(title) {
    const result = await this.pool.query(
      'INSERT INTO todos (title, completed) VALUES ($1, false) RETURNING *',
      [title]
    );
    return result.rows[0];
  }

  async delete(id) {
    const result = await this.pool.query('DELETE FROM todos WHERE id = $1', [parseInt(id)]);
    return result.rowCount > 0;
  }
}

module.exports = PostgresTodoRepository;
