class PostgresUserRepository {
  /**
   * @param {import('pg').Pool} pool 
   */
  constructor(pool) {
    this.pool = pool;
  }

  async create(username, passwordHash) {
    try {
      const result = await this.pool.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING *',
        [username, passwordHash]
      );
      return result.rows[0];
    } catch (err) {
      if (err.code === '23505') { // Unique violation in Postgres
        throw new Error('Username already exists');
      }
      throw err;
    }
  }

  async findByUsername(username) {
    const result = await this.pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  async findById(id) {
    const result = await this.pool.query('SELECT * FROM users WHERE id = $1', [parseInt(id)]);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }
}

module.exports = PostgresUserRepository;
