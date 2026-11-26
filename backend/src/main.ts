import 'dotenv/config';
import { bootstrap } from './bootstrap.js';
import { parseRoles } from './config/roles.js';

// APP_ROLE=all (default) runs API + every worker in one process (development).
await bootstrap(parseRoles(process.env.APP_ROLE));
