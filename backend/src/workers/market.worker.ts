import 'dotenv/config';
import { bootstrap } from '../bootstrap.js';

// Binance ingestion + alert engine. Run one or more; a Redis lease elects a single active leader.
await bootstrap(['market']);
