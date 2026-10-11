import pg from 'pg';
export function makePool() {
  if (!process.env.TIGER_DATABASE_URL) throw new Error('TIGER_DATABASE_URL is missing');
  const pool=new pg.Pool({connectionString: process.env.TIGER_DATABASE_URL, max: 4, connectionTimeoutMillis: 15000, idleTimeoutMillis: 30000});
  // pg removes a failed idle client; future requests can open a fresh one.
  // Never print the error object because it can contain connection details.
  pool.on('error',()=>console.error('Idle database connection lost; reconnecting on the next request.'));
  return pool;
}
