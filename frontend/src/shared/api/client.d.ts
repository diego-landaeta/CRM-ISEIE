/**
 * Tipos para el client.js (axios-like wrapper sobre fetch).
 * Todas las respuestas siguen el shape `{ success, data?, pagination?, error?, ... }`.
 */

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  pagination?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  error?: string;
  message?: string;
  stats?: Record<string, any>;
  [key: string]: any;
}

export interface RequestOptions {
  signal?: AbortSignal;
  responseType?: 'blob' | 'json' | 'text';
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ApiClient {
  get<T = any>(url: string, options?: RequestOptions): Promise<ApiResponse<T>>;
  post<T = any>(url: string, body?: any, options?: RequestOptions): Promise<ApiResponse<T>>;
  patch<T = any>(url: string, body?: any, options?: RequestOptions): Promise<ApiResponse<T>>;
  put<T = any>(url: string, body?: any, options?: RequestOptions): Promise<ApiResponse<T>>;
  delete<T = any>(url: string, options?: RequestOptions): Promise<ApiResponse<T>>;
  upload<T = any>(url: string, file: File | Blob): Promise<ApiResponse<T>>;
}

export function setAccessToken(token: string | null): void;
export function getAccessToken(): string | null;
export function setOnAuthFailure(cb: (() => void) | null): void;

declare const client: ApiClient;
export default client;
