export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new AppError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'Требуется авторизация') =>
  new AppError(401, 'unauthorized', msg);
export const forbidden = (msg = 'Доступ запрещён') => new AppError(403, 'forbidden', msg);
export const notFound = (msg = 'Не найдено') => new AppError(404, 'not_found', msg);
export const conflict = (msg: string, details?: unknown) =>
  new AppError(409, 'conflict', msg, details);
export const unprocessable = (msg: string, details?: unknown) =>
  new AppError(422, 'unprocessable', msg, details);

// ─── коды внешнего машинного API (/api/v1/external) ───

/** Тот же external_ref уже создан, но с другим телом запроса — данные разошлись. */
export const idempotencyConflict = (msg: string, details?: unknown) =>
  new AppError(409, 'idempotency_conflict', msg, details);

/** Итоги ещё не подведены. Для клиента это не ошибка — он опрашивает дальше. */
export const resultsNotReady = (msg = 'Итоги ещё не подведены — повторите опрос позже') =>
  new AppError(409, 'results_not_ready', msg);

export const cannotCancelAfterDeadline = (
  msg = 'Отменить тендер можно только до окончания приёма предложений',
) => new AppError(409, 'cannot_cancel_after_deadline', msg);

/** Превышен лимит запросов. AppError, чтобы @fastify/rate-limit бросил его в наш конверт. */
export const rateLimited = (msg: string) => new AppError(429, 'rate_limited', msg);
