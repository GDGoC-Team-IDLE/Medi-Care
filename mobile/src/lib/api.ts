/**
 * 공용 API 요청 함수. 서버 호출은 반드시 여기 헬퍼를 씁니다.
 *
 *   import { api, ApiError } from '@/lib/api';
 *
 *   const slots = await api.get<DoseSlot[]>('/dose_slots', { slot_date: '2026-11-20' });
 *   await api.post('/prescriptions', { start_date: '2026-11-20', days: 7 });
 *
 *   try { ... } catch (e) {
 *     if (e instanceof ApiError && e.code === 'ALREADY_TAKEN') { ... }
 *   }
 *
 * 경로는 /api/v1 뒤쪽만 적습니다 (끝 슬래시 없이).
 */
import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import { isWeb } from './platform';
import { getItem, removeItem, setItem } from './storage';

const API_PREFIX = '/api/v1';

/**
 * 서버 주소 (EXPO_PUBLIC_API_URL, 빌드할 때 코드에 들어감).
 * - Render 웹/앱: API 주소 (https://medi-care-api.onrender.com)
 * - 로컬 앱 개발: PC의 LAN IP 등
 * 웹에서 비어 있으면 같은 주소로 요청합니다 → 로컬 compose 미리보기에서 nginx 가 /api 를 백엔드로 넘깁니다.
 */
const BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');

/** 저장된 로그인 토큰 키. 값이 있으면 요청마다 자동으로 헤더에 붙습니다. */
export const TOKEN_KEYS = {
  guardian: 'medicare.guardian_token', // 보호자 → Authorization: Bearer <token>
  guardianRefresh: 'medicare.guardian_refresh_token', // 보호자 토큰 갱신용 (헤더에는 안 붙음)
  device: 'medicare.device_token', // 어르신 기기 → X-Device-Token: <token>
} as const;

export type TokenRole = keyof typeof TOKEN_KEYS;

export const saveToken = (role: TokenRole, token: string) => setItem(TOKEN_KEYS[role], token);
export const clearToken = (role: TokenRole) => removeItem(TOKEN_KEYS[role]);

/** 서버 에러 응답 {"code", "message"} 를 담는 에러 */
export class ApiError extends Error {
  constructor(
    public readonly status: number, // HTTP 상태 (네트워크 오류는 0)
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

interface RequestOptions {
  query?: Query;
  json?: unknown;
  form?: FormData;
}

function buildUrl(path: string, query?: Query): string {
  if (!BASE_URL && !isWeb) {
    throw new ApiError(0, 'CONFIG_ERROR', 'EXPO_PUBLIC_API_URL 이 설정되지 않았습니다 (mobile/.env)');
  }
  let url = `${BASE_URL}${API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`;
  if (query) {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    if (qs) url += `?${qs}`;
  }
  return url;
}

async function authHeaders(): Promise<Record<string, string>> {
  const [guardianToken, deviceToken] = await Promise.all([
    getItem(TOKEN_KEYS.guardian),
    getItem(TOKEN_KEYS.device),
  ]);
  const headers: Record<string, string> = {};
  if (guardianToken) headers.Authorization = `Bearer ${guardianToken}`;
  if (deviceToken) headers['X-Device-Token'] = deviceToken;
  return headers;
}

async function toApiError(res: Response): Promise<ApiError> {
  let code = `HTTP_${res.status}`;
  let message = `요청에 실패했습니다 (${res.status})`;
  try {
    const body = await res.json();
    if (typeof body?.code === 'string') code = body.code;
    if (typeof body?.message === 'string') message = body.message;
    else if (typeof body?.detail === 'string') message = body.detail; // FastAPI 기본 에러 형식
  } catch {
    // JSON 이 아닌 응답 (nginx 502 등)
  }
  return new ApiError(res.status, code, message);
}

let refreshing: Promise<boolean> | null = null;

/** 보호자 토큰이 만료(401)되면 refresh_token 으로 새로 받습니다. 여러 요청이 한꺼번에 401 이어도 갱신은 한 번만 */
function refreshGuardian(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const refreshToken = await getItem(TOKEN_KEYS.guardianRefresh);
      if (!refreshToken) return false;
      let res: Response;
      try {
        res = await fetch(buildUrl('/auth/refresh'), {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
      } catch {
        return false; // 네트워크 오류: 토큰은 그대로 둡니다
      }
      if (!res.ok) {
        // refresh_token 도 만료·폐기됨 → 다시 로그인해야 합니다
        if (res.status === 401) await Promise.all([clearToken('guardian'), clearToken('guardianRefresh')]);
        return false;
      }
      const data = (await res.json()) as { access_token: string; refresh_token: string };
      await Promise.all([saveToken('guardian', data.access_token), saveToken('guardianRefresh', data.refresh_token)]);
      return true;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

/** 모든 요청의 기본 함수. 보통은 아래 api.get / post / patch / postForm 을 씁니다. */
export async function request<T>(method: string, path: string, options: RequestOptions = {}, retried = false): Promise<T> {
  const url = buildUrl(path, options.query);
  const headers: Record<string, string> = { Accept: 'application/json', ...(await authHeaders()) };

  let body: string | FormData | undefined;
  if (options.form) {
    body = options.form; // Content-Type(boundary 포함)은 fetch 가 넣으므로 직접 지정하지 않습니다
  } else if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  }

  let res: Response;
  try {
    const send = options.form && !isWeb ? expoFetch : fetch;
    res = await send(url, { method, headers, body });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '서버에 연결할 수 없습니다');
  }

  // 보호자 토큰 만료 → 갱신 뒤 한 번만 다시 요청 (로그인·갱신 요청 자체는 제외)
  if (res.status === 401 && !retried && !/^\/?auth\//.test(path) && (await refreshGuardian())) {
    return request<T>(method, path, options, true);
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, { query }),
  post: <T>(path: string, json?: unknown) => request<T>('POST', path, { json }),
  patch: <T>(path: string, json?: unknown) => request<T>('PATCH', path, { json }),
  /** multipart/form-data 업로드. 파일은 appendFile 로 넣습니다. */
  postForm: <T>(path: string, form: FormData) => request<T>('POST', path, { form }),
};

export interface UploadFile {
  uri: string; // expo-image-picker 결과의 asset.uri
  name: string; // 웹에서 전송할 파일 이름
}

/**
 * FormData 에 파일을 넣습니다. 앱과 웹이 넣는 방식이 달라 여기서 분기합니다.
 *
 *   const form = new FormData();
 *   await appendFile(form, 'photo', { uri: asset.uri, name: 'dose.jpg' });
 *   await api.postForm('/dose_logs', form);
 */
export async function appendFile(form: FormData, field: string, file: UploadFile): Promise<void> {
  if (isWeb) {
    const blob = await (await fetch(file.uri)).blob(); // 웹의 uri 는 blob:/data: 주소
    form.append(field, blob, file.name);
  } else {
    // Expo fetch는 URI를 담은 객체 대신 읽을 수 있는 File을 받습니다.
    form.append(field, new File(file.uri));
  }
}
