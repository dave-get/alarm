import 'dotenv/config';
import { bootstrap } from '../bootstrap.js';

// Outbox dispatcher: committed alert events -> BullMQ. Safe to run several (SKIP LOCKED).
await bootstrap(['outbox']);
