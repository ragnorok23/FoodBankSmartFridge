// Local-only bootstrap: keep credential output inside this process, never logs.
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {writeFile,access} from 'node:fs/promises';
import pg from 'pg';
try{await access(new URL('.env',import.meta.url));console.log('Private .env already exists; refusing to replace credentials.');process.exit(0);}catch{}
const service=process.env.TIGER_SERVICE_ID||'ym0p9v6xv2';
let pool;
try{
  const uri=execFileSync('/opt/homebrew/bin/tiger',['db','uri',service,'--with-password'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const admin=new URL(uri);admin.searchParams.set('sslmode','verify-full');admin.searchParams.set('sslrootcert',new URL('./tiger-ca.crt',import.meta.url).pathname);
  pool=new pg.Pool({connectionString:admin.toString(),connectionTimeoutMillis:15000});
  const existing=(await pool.query("SELECT 1 FROM pg_roles WHERE rolname='fridge_app'")).rowCount;
  if(existing)throw new Error('Role exists; retrieve existing credentials rather than replacing them.');
  const password=randomBytes(32).toString('hex');
  await pool.query(`CREATE ROLE fridge_app LOGIN PASSWORD '${password}'`);
  await pool.query('GRANT CONNECT ON DATABASE tsdb TO fridge_app; GRANT USAGE ON SCHEMA fridge TO fridge_app; GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA fridge TO fridge_app; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA fridge TO fridge_app; ALTER DEFAULT PRIVILEGES IN SCHEMA fridge GRANT SELECT,INSERT,UPDATE ON TABLES TO fridge_app;');
  admin.username='fridge_app';admin.password=password;
  const content=`TIGER_DATABASE_URL=${admin.toString()}\nFRIDGE_ID=orion-fridge-01\nDEVICE_ID=arduino-uno-r4\nSERIAL_PORT=\nSERIAL_BAUD=115200\nSENSOR_INTERVAL_MS=5000\nDATA_PORT=3200\nDATA_API_TOKEN=${randomBytes(32).toString('hex')}\n`;
  await writeFile(new URL('.env',import.meta.url),content,{mode:0o600,flag:'wx'});
  console.log('Restricted app role and private .env created. Credentials were not printed.');
}catch(error){console.error('Private setup failed; diagnostic code:',error.code||error.status||error.name);console.error('Category:',/certificate/i.test(error.message)?'TLS certificate validation':/Role exists/.test(error.message)?'existing role':/Invalid URL/.test(error.message)?'CLI did not return a connection URL':'database/CLI access');process.exitCode=1;}finally{if(pool)await pool.end();}
