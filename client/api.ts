export interface ApiError extends Error {
  status?: number;
  requestId: string;
  url: string;
  method: string;
  responseBody?: string;
  cause?: unknown;
}

export function createApiError(
  message: string,
  details: {
    status?: number;
    requestId: string;
    url: string;
    method: string;
    responseBody?: string;
    cause?: unknown;
  }
): ApiError {
  const error = new Error(message) as ApiError;
  error.name = 'ApiError';
  error.status = details.status;
  error.requestId = details.requestId;
  error.url = details.url;
  error.method = details.method;
  error.responseBody = details.responseBody;
  error.cause = details.cause;
  return error;
}

export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const serialized: Record<string, unknown> = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
    if ('status' in err) serialized.status = (err as ApiError).status;
    if ('requestId' in err) serialized.requestId = (err as ApiError).requestId;
    if ('url' in err) serialized.url = (err as ApiError).url;
    if ('method' in err) serialized.method = (err as ApiError).method;
    if ('responseBody' in err) serialized.responseBody = (err as ApiError).responseBody;
    if ('cause' in err && err.cause) {
      serialized.cause = serializeError(err.cause);
    }
    return serialized;
  }
  return { value: String(err) };
}

export async function apiFetch<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<{ data: T; requestId: string }> {
  const requestId = crypto.randomUUID();
  
  const headers = new Headers(options.headers);
  headers.set('X-Request-Id', requestId);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const method = options.method || 'GET';
  
  console.debug(`[API] ${method} ${url}`, { requestId });

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    const responseRequestId = response.headers.get('X-Request-Id') || requestId;

    if (!response.ok) {
      let responseBody = '';
      try {
        responseBody = await response.text();
        if (responseBody.length > 2048) {
          responseBody = responseBody.substring(0, 2048) + '... [truncated]';
        }
      } catch {
        responseBody = '[Could not read response body]';
      }

      const error = createApiError(
        `API request failed: ${response.status} ${response.statusText}`,
        {
          status: response.status,
          requestId: responseRequestId,
          url,
          method,
          responseBody,
        }
      );

      console.error('[API] Request failed:', serializeError(error));
      throw error;
    }

    const data = await response.json() as T;
    console.debug(`[API] ${method} ${url} completed`, { requestId: responseRequestId, status: response.status });
    
    return { data, requestId: responseRequestId };
  } catch (err) {
    if ((err as ApiError).name === 'ApiError') {
      throw err;
    }

    const error = createApiError(
      `Network error: ${err instanceof Error ? err.message : String(err)}`,
      {
        requestId,
        url,
        method,
        cause: err,
      }
    );

    console.error('[API] Network error:', serializeError(error));
    throw error;
  }
}

export async function apiGet<T = unknown>(url: string): Promise<{ data: T; requestId: string }> {
  return apiFetch<T>(url, { method: 'GET' });
}

export async function apiPost<T = unknown>(
  url: string,
  body?: unknown
): Promise<{ data: T; requestId: string }> {
  return apiFetch<T>(url, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function apiPut<T = unknown>(
  url: string,
  body?: unknown
): Promise<{ data: T; requestId: string }> {
  return apiFetch<T>(url, {
    method: 'PUT',
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function apiDelete<T = unknown>(url: string): Promise<{ data: T; requestId: string }> {
  return apiFetch<T>(url, { method: 'DELETE' });
}
