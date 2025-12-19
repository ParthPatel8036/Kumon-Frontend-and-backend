import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000 // fail fast if DB can’t be reached
});

pool.on('connect', () => console.log('Connected to PostgreSQL'));
pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL error', err);
  process.exit(1);
});

const db = {
  query: (text, params) => pool.query(text, params),
  pool
};

export default db;
