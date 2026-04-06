import { HttpMethod } from "@/components/monitor/types";

export const STORAGE_KEY = "api-monitor-v1";

export const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "#3b82f6",
  POST: "#10b981",
  PUT: "#fbbf24",
  DELETE: "#ef4444",
  PATCH: "#a855f7",
};
