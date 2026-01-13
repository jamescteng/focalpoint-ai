interface FetchWithTraceOptions extends RequestInit {
  timeout?: number;
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const serialized: Record<string, unknown> = {
      name: err.name,
      message: err.message,
      stack: err.stack?.split('\n').slice(0, 5).join('\n'),
    };
    if ('cause' in err && err.cause) {
      serialized.cause = serializeError(err.cause);
    }
    if ('code' in err) {
      serialized.code = (err as NodeJS.ErrnoException).code;
    }
    return serialized;
  }
  return { value: String(err) };
}

export async function fetchWithTrace(
  requestId: string,
  url: string,
  options: FetchWithTraceOptions = {}
): Promise<Response> {
  const method = options.method || 'GET';
  const parsedUrl = new URL(url);
  const host = parsedUrl.host;
  const path = parsedUrl.pathname + parsedUrl.search;
  
  const startTime = Date.now();
  console.log(`[${requestId}] --> External ${method} ${host}${path}`);

  try {
    const { timeout, ...fetchOptions } = options;
    
    let response: Response;
    if (timeout) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      try {
        response = await fetch(url, {
          ...fetchOptions,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    } else {
      response = await fetch(url, fetchOptions);
    }

    const duration = Date.now() - startTime;
    console.log(`[${requestId}] <-- External ${method} ${host}${path} ${response.status} (${duration}ms)`);
    
    return response;
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`[${requestId}] <-- External ${method} ${host}${path} FAILED (${duration}ms):`, serializeError(err));
    throw err;
  }
}

export async function fetchJsonWithTrace<T = unknown>(
  requestId: string,
  url: string,
  options: FetchWithTraceOptions = {}
): Promise<T> {
  const response = await fetchWithTrace(requestId, url, options);
  
  if (!response.ok) {
    let body = '';
    try {
      body = await response.text();
      if (body.length > 1024) {
        body = body.substring(0, 1024) + '... [truncated]';
      }
    } catch {
      body = '[Could not read response body]';
    }
    
    const error = new Error(`External API error: ${response.status} ${response.statusText}`);
    (error as any).status = response.status;
    (error as any).responseBody = body;
    throw error;
  }
  
  return response.json() as Promise<T>;
}
