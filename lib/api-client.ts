/** API responses may be replaced by a hosting/auth gateway before reaching a route. */
export class ApiError extends Error {
  status: number;
  needsSignIn: boolean;
  responseIsJson: boolean;
  constructor(
    message: string,
    status: number,
    needsSignIn = false,
    responseIsJson = false,
  ) {
    super(message);
    this.status = status;
    this.needsSignIn = needsSignIn;
    this.responseIsJson = responseIsJson;
  }
}
export async function readApiResponse<T>(response: Response): Promise<T> {
  const status = response.status;
  if (
    response.type === 'opaqueredirect' ||
    response.redirected ||
    (status >= 300 && status < 400)
  )
    throw new ApiError(
      'Сессия требует обновления. Войдите снова и повторите действие.',
      status,
      true,
    );
  if (
    !response.headers
      .get('content-type')
      ?.toLowerCase()
      .includes('application/json')
  ) {
    if (status === 401)
      throw new ApiError(
        'Войдите снова, чтобы сохранить изменения.',
        status,
        true,
      );
    throw new ApiError(
      `Сервис вернул страницу вместо ответа приложения (HTTP ${status}). Действие не подтверждено. Обновите страницу и проверьте задачу перед повтором.`,
      status,
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      `Не удалось прочитать ответ приложения (HTTP ${status}). Действие не подтверждено.`,
      status,
    );
  }
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new ApiError('Получен некорректный ответ приложения.', status);
  if (!response.ok) {
    const error = (data as { error?: unknown }).error;
    throw new ApiError(
      typeof error === 'string'
        ? error.slice(0, 1000)
        : `Ошибка приложения (HTTP ${status}).`,
      status,
      status === 401,
      true,
    );
  }
  return data as T;
}
export async function apiRequest<T>(
  path: string,
  payload?: Record<string, unknown>,
  timeoutMs = 60000,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const response = await fetch(path, {
    method: payload ? 'POST' : 'GET',
    credentials: 'same-origin',
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Accept: 'application/json',
      ...extraHeaders,
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  return readApiResponse<T>(response);
}
