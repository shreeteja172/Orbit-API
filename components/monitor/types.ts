export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
export type AuthType = "none" | "bearer" | "apikey" | "basic";
export type ActiveTab = "request" | "dashboard";

export interface KVPair {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface BasicAuth {
  username: string;
  password: string;
}

export interface AuthConfig {
  type: AuthType;
  bearerToken: string;
  apiKeyName: string;
  apiKeyValue: string;
  apiKeyLocation: "header" | "query";
  basic: BasicAuth;
}

export interface ApiResponseData {
  status: number;
  statusText: string;
  durationMs: number;
  sizeBytes: number;
  headers: Record<string, string>;
  bodyPretty: string;
  bodyRaw: string;
  contentType: string;
}

export interface ApiTestRecord {
  id: string;
  name: string;
  favorite: boolean;
  collectionId?: string;
  createdAt: string;
  method: HttpMethod;
  url: string;
  queryParams: KVPair[];
  headers: KVPair[];
  body: string;
  auth: AuthConfig;
  response?: ApiResponseData;
  thresholdBreached: boolean;
}

export interface Collection {
  id: string;
  name: string;
  testIds: string[];
}

export interface DashboardFilter {
  range: "24h" | "7d" | "30d" | "custom";
  from?: string;
  to?: string;
}

export interface ThresholdMap {
  [endpoint: string]: number;
}

export interface StorageShape {
  history: ApiTestRecord[];
  collections: Collection[];
  thresholds: ThresholdMap;
}

declare global {
  interface Window {
    storage?: Storage;
  }
}
