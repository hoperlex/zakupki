export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

function getCookie(name: string): string | undefined {
  const match = document.cookie.split('; ').find((row) => row.startsWith(name + '='));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : undefined;
}

const BASE = '/api/v1';
const NO_REFRESH = new Set(['/auth/refresh', '/auth/login', '/auth/register', '/auth/me']);

let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  query?: Record<string, string | number | boolean | undefined>;
}

function buildUrl(path: string, query?: ApiOptions['query']): string {
  if (!query) return BASE + path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return BASE + path + (s ? `?${s}` : '');
}

async function doFetch(path: string, opts: ApiOptions): Promise<Response> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = getCookie('csrf');
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  return fetch(buildUrl(path, opts.query), {
    method,
    headers,
    body,
    credentials: 'include',
    signal: opts.signal,
  });
}

async function doUpload(path: string, form: FormData, query?: ApiOptions['query']): Promise<Response> {
  const csrf = getCookie('csrf');
  return fetch(buildUrl(path, query), {
    method: 'POST',
    body: form,
    credentials: 'include',
    headers: csrf ? { 'x-csrf-token': csrf } : {},
  });
}

export async function uploadFile<T>(
  path: string,
  file: File,
  query?: ApiOptions['query'],
): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  let res = await doUpload(path, form, query);
  if (res.status === 401) {
    const ok = await tryRefresh();
    if (ok) res = await doUpload(path, form, query);
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? res.statusText);
  }
  return (await res.json()) as T;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  let res = await doFetch(path, opts);
  if (res.status === 401 && !NO_REFRESH.has(path)) {
    const ok = await tryRefresh();
    if (ok) res = await doFetch(path, opts);
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      details?: unknown;
    };
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? res.statusText, data.details);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
