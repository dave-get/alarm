import 'dotenv/config';
import { bootstrap } from '../bootstrap.js';

// BullMQ notification worker: Expo push, retries, receipts. Scale horizontally.
await bootstrap(['notifications']);
