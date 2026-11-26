import { ConfigService } from '@nestjs/config';
import type { AppConfig } from './configuration.js';

/** Typed config access: `config.get('PORT', { infer: true })` returns a number. */
export type AppConfigService = ConfigService<AppConfig, true>;
export { ConfigService };
