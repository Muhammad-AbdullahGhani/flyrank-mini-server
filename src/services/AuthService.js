const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-in-production';
const TOKEN_EXPIRY = '24h';

class AuthService {
  constructor(userRepository) {
    this.userRepository = userRepository;
  }

  /**
   * Hashes a password using scrypt
   */
  hashPassword(password) {
    return new Promise((resolve, reject) => {
      const salt = crypto.randomBytes(16).toString('hex');
      crypto.scrypt(password, salt, 64, (err, derivedKey) => {
        if (err) return reject(err);
        resolve(`${salt}:${derivedKey.toString('hex')}`);
      });
    });
  }

  /**
   * Verifies a password against a hash
   */
  verifyPassword(password, hash) {
    return new Promise((resolve, reject) => {
      const [salt, key] = hash.split(':');
      if (!salt || !key) return resolve(false);
      crypto.scrypt(password, salt, 64, (err, derivedKey) => {
        if (err) return reject(err);
        resolve(key === derivedKey.toString('hex'));
      });
    });
  }

  /**
   * Registers a new user
   */
  async register(username, password) {
    if (!username || typeof username !== 'string' || username.trim() === '') {
      throw new Error('Username is required');
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      throw new Error('Password is required and must be at least 6 characters long');
    }

    const passwordHash = await this.hashPassword(password);
    const user = await this.userRepository.create(username.trim(), passwordHash);
    
    // Return user without password hash
    return {
      id: user.id,
      username: user.username,
      created_at: user.created_at
    };
  }

  /**
   * Authenticates a user and generates a JWT
   */
  async login(username, password) {
    if (!username || !password) {
      throw new Error('Username and password are required');
    }

    const user = await this.userRepository.findByUsername(username);
    if (!user) {
      throw new Error('Invalid username or password');
    }

    const isValid = await this.verifyPassword(password, user.password_hash);
    if (!isValid) {
      throw new Error('Invalid username or password');
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    );

    return {
      token,
      user: {
        id: user.id,
        username: user.username
      }
    };
  }

  /**
   * Verifies a token and returns decoded payload
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (err) {
      throw new Error('Invalid or expired authentication token');
    }
  }
}

module.exports = AuthService;
