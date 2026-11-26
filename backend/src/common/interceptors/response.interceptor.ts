import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';

const RAW_RESPONSE = 'raw-response';
/** Opt a route out of the `{ success, data }` envelope (health checks). */
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);

/** Plan §10: responses are `{ "success": true, "data": ... }`. */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE, [context.getHandler(), context.getClass()]);
    if (raw) return next.handle();
    return next.handle().pipe(map((data: unknown) => (data === undefined ? undefined : { success: true, data })));
  }
}
