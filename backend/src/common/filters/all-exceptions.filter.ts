import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiError } from '../interfaces/api-response.interface.js';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  503: 'SERVICE_UNAVAILABLE',
};

/** One error body for every HTTP error; unexpected errors are logged and answered with a generic 500. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') throw exception;
    const res = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let code = 'INTERNAL_ERROR';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') message = body;
      else if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        message = (b.message as string | string[]) ?? exception.message;
        if (typeof b.errorCode === 'string') code = b.errorCode.toUpperCase();
        else if (typeof b.code === 'string') code = b.code;
      }
      if (code === 'INTERNAL_ERROR') code = CODE_BY_STATUS[status] ?? `HTTP_${status}`;
    } else {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error('Unhandled error', err.stack);
    }

    if (status >= 500 && exception instanceof HttpException) {
      this.logger.error(`HTTP ${status}: ${exception.message}`);
    }

    const payload: ApiError = { success: false, error: { statusCode: status, code, message } };
    res.status(status).json(payload);
  }
}
