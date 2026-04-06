"use client";

import axios, { AxiosError, AxiosRequestHeaders } from "axios";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  BarChart3,
  Clock3,
  Download,
  Folder,
  History,
  Plus,
  Search,
  Send,
  Settings,
  Star,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
type AuthType = "none" | "bearer" | "apikey" | "basic";
type ActiveTab = "request" | "dashboard";

interface KVPair {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

interface BasicAuth {
  username: string;
  password: string;
}

interface AuthConfig {
  type: AuthType;
  bearerToken: string;
  apiKeyName: string;
  apiKeyValue: string;
  apiKeyLocation: "header" | "query";
  basic: BasicAuth;
}

interface ApiResponseData {
  status: number;
  statusText: string;
  durationMs: number;
  sizeBytes: number;
  headers: Record<string, string>;
  bodyPretty: string;
  bodyRaw: string;
  contentType: string;
}

interface ApiTestRecord {
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

interface Collection {
  id: string;
  name: string;
  testIds: string[];
}

interface DashboardFilter {
  range: "24h" | "7d" | "30d" | "custom";
  from?: string;
  to?: string;
}

interface ThresholdMap {
  [endpoint: string]: number;
}

interface StorageShape {
  history: ApiTestRecord[];
  collections: Collection[];
  thresholds: ThresholdMap;
}

declare global {
  interface Window {
    storage?: Storage;
  }
}

const STORAGE_KEY = "api-monitor-v1";
const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "#3b82f6",
  POST: "#10b981",
  PUT: "#fbbf24",
  DELETE: "#ef4444",
  PATCH: "#a855f7",
};

const statusColor = (status?: number) => {
  if (!status) return "#707070";
  if (status >= 200 && status < 300) return "#00e676";
  if (status >= 300 && status < 400) return "#fbbf24";
  return "#ff4444";
};

const uid = () => crypto.randomUUID();
const makeKV = (): KVPair => ({ id: uid(), key: "", value: "", enabled: true });

const readStorage = (): StorageShape => {
  if (typeof window === "undefined") return { history: [], collections: [], thresholds: {} };
  const storage = window.storage ?? window.localStorage;
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return { history: [], collections: [], thresholds: {} };
  try {
    const parsed = JSON.parse(raw) as StorageShape;
    return {
      history: parsed.history ?? [],
      collections: parsed.collections ?? [],
      thresholds: parsed.thresholds ?? {},
    };
  } catch {
    return { history: [], collections: [], thresholds: {} };
  }
};

const writeStorage = (value: StorageShape) => {
  if (typeof window === "undefined") return;
  const storage = window.storage ?? window.localStorage;
  storage.setItem(STORAGE_KEY, JSON.stringify(value));
};

const safeParseBody = (body: unknown): { pretty: string; raw: string } => {
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return { pretty: JSON.stringify(parsed, null, 2), raw: body };
    } catch {
      return { pretty: body, raw: body };
    }
  }
  if (typeof body === "object" && body !== null) {
    const raw = JSON.stringify(body);
    return { pretty: JSON.stringify(body, null, 2), raw };
  }
  const text = String(body ?? "");
  return { pretty: text, raw: text };
};

const toBytes = (data: unknown, headers?: Record<string, string>) => {
  const lengthHeader = headers?.["content-length"];
  if (lengthHeader && !Number.isNaN(Number(lengthHeader))) return Number(lengthHeader);
  return new Blob([typeof data === "string" ? data : JSON.stringify(data ?? "")]).size;
};

const formatBytes = (size: number) => {
  if (size < 1024) return `${size} B`;
  return `${(size / 1024).toFixed(2)} KB`;
};

const mapToKVRecords = (items: KVPair[]) =>
  items.reduce<Record<string, string>>((acc, item) => {
    if (item.enabled && item.key.trim()) acc[item.key.trim()] = item.value;
    return acc;
  }, {});

export default function Home() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("request");
  const [method, setMethod] = useState<HttpMethod>("GET");
  const [url, setUrl] = useState("https://jsonplaceholder.typicode.com/posts/1");
  const [headers, setHeaders] = useState<KVPair[]>([makeKV()]);
  const [queryParams, setQueryParams] = useState<KVPair[]>([makeKV()]);
  const [urlParams, setUrlParams] = useState<KVPair[]>([makeKV()]);
  const [body, setBody] = useState('{\n  "title": "foo"\n}');
  const [auth, setAuth] = useState<AuthConfig>({
    type: "none",
    bearerToken: "",
    apiKeyName: "x-api-key",
    apiKeyValue: "",
    apiKeyLocation: "header",
    basic: { username: "", password: "" },
  });
  const [latestResponse, setLatestResponse] = useState<ApiResponseData>();
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<ApiTestRecord[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [thresholds, setThresholds] = useState<ThresholdMap>({});
  const [saveName, setSaveName] = useState("");
  const [responseView, setResponseView] = useState<"pretty" | "raw">("pretty");
  const [notification, setNotification] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historyMethodFilter, setHistoryMethodFilter] = useState<"all" | HttpMethod>("all");
  const [historyStatusFilter, setHistoryStatusFilter] = useState<"all" | "2xx" | "3xx" | "4xx5xx">("all");
  const [historyDateFrom, setHistoryDateFrom] = useState("");
  const [historyDateTo, setHistoryDateTo] = useState("");
  const [historyResponseMin, setHistoryResponseMin] = useState("");
  const [historyResponseMax, setHistoryResponseMax] = useState("");
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter>({ range: "7d" });
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>("");
  const [showSettings, setShowSettings] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");

  useEffect(() => {
    const stored = readStorage();
    setHistory(stored.history);
    setCollections(stored.collections);
    setThresholds(stored.thresholds);
  }, []);

  useEffect(() => {
    writeStorage({ history, collections, thresholds });
  }, [history, collections, thresholds]);

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 4000);
    return () => clearTimeout(timer);
  }, [notification]);

  const resolvedUrl = useMemo(() => {
    let built = url;
    for (const p of urlParams) {
      if (p.enabled && p.key.trim()) {
        built = built.replaceAll(`:${p.key.trim()}`, encodeURIComponent(p.value.trim()));
      }
    }
    const params = new URLSearchParams();
    for (const p of queryParams) {
      if (p.enabled && p.key.trim()) params.append(p.key.trim(), p.value);
    }
    return `${built}${params.toString() ? `?${params.toString()}` : ""}`;
  }, [url, urlParams, queryParams]);

  const filteredHistory = useMemo(() => {
    return history.filter((record) => {
      if (historySearch && !`${record.name} ${record.url}`.toLowerCase().includes(historySearch.toLowerCase())) return false;
      if (historyMethodFilter !== "all" && record.method !== historyMethodFilter) return false;
      const status = record.response?.status ?? 0;
      if (historyStatusFilter === "2xx" && !(status >= 200 && status < 300)) return false;
      if (historyStatusFilter === "3xx" && !(status >= 300 && status < 400)) return false;
      if (historyStatusFilter === "4xx5xx" && status < 400) return false;
      if (historyDateFrom && new Date(record.createdAt) < new Date(historyDateFrom)) return false;
      if (historyDateTo) {
        const to = new Date(historyDateTo);
        to.setHours(23, 59, 59, 999);
        if (new Date(record.createdAt) > to) return false;
      }
      if (historyResponseMin && (record.response?.durationMs ?? 0) < Number(historyResponseMin)) return false;
      if (historyResponseMax && (record.response?.durationMs ?? 0) > Number(historyResponseMax)) return false;
      return true;
    });
  }, [
    history,
    historySearch,
    historyMethodFilter,
    historyStatusFilter,
    historyDateFrom,
    historyDateTo,
    historyResponseMin,
    historyResponseMax,
  ]);

  const dashboardData = useMemo(() => {
    const now = Date.now();
    const cutoff = (() => {
      if (dashboardFilter.range === "24h") return now - 24 * 60 * 60 * 1000;
      if (dashboardFilter.range === "7d") return now - 7 * 24 * 60 * 60 * 1000;
      if (dashboardFilter.range === "30d") return now - 30 * 24 * 60 * 60 * 1000;
      if (dashboardFilter.from) return new Date(dashboardFilter.from).getTime();
      return 0;
    })();
    const to = dashboardFilter.range === "custom" && dashboardFilter.to ? new Date(dashboardFilter.to).getTime() : now;
    const inRange = history.filter((h) => {
      const t = new Date(h.createdAt).getTime();
      return t >= cutoff && t <= to && h.response;
    });
    const responseTimes = inRange.map((h) => h.response?.durationMs ?? 0);
    const total = inRange.length;
    const success = inRange.filter((h) => {
      const code = h.response?.status ?? 0;
      return code >= 200 && code < 400;
    }).length;
    const byEndpoint = inRange.reduce<Record<string, number[]>>((acc, h) => {
      const key = `${h.method} ${h.url}`;
      acc[key] = acc[key] ?? [];
      acc[key].push(h.response?.durationMs ?? 0);
      return acc;
    }, {});
    const endpointAverage = Object.entries(byEndpoint).map(([endpoint, times]) => ({
      endpoint: endpoint.length > 34 ? `${endpoint.slice(0, 34)}...` : endpoint,
      fullEndpoint: endpoint,
      average: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
    }));
    const trend = inRange
      .slice()
      .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
      .map((h) => ({
        label: new Date(h.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        responseTime: h.response?.durationMs ?? 0,
      }));
    return {
      total,
      average: total ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / total) : 0,
      fastest: total ? Math.min(...responseTimes) : 0,
      slowest: total ? Math.max(...responseTimes) : 0,
      successRate: total ? Math.round((success / total) * 100) : 0,
      trend,
      endpointAverage,
      pie: [
        { name: "Success", value: success, color: "#10b981" },
        { name: "Failed", value: total - success, color: "#ef4444" },
      ],
    };
  }, [history, dashboardFilter]);

  const alertCount = useMemo(() => history.filter((h) => h.thresholdBreached).length, [history]);
  const favorites = useMemo(() => history.filter((h) => h.favorite), [history]);

  const updateList = (setter: React.Dispatch<React.SetStateAction<KVPair[]>>, id: string, key: keyof KVPair, value: string | boolean) => {
    setter((prev) => prev.map((item) => (item.id === id ? { ...item, [key]: value } : item)));
  };

  const sendRequest = async (testName?: string) => {
    setLoading(true);
    try {
      const outgoingHeaders = mapToKVRecords(headers);
      const localAuth = { ...auth };
      if (localAuth.type === "bearer" && localAuth.bearerToken.trim()) {
        outgoingHeaders.Authorization = `Bearer ${localAuth.bearerToken.trim()}`;
      }
      if (localAuth.type === "basic" && localAuth.basic.username) {
        outgoingHeaders.Authorization = `Basic ${btoa(`${localAuth.basic.username}:${localAuth.basic.password}`)}`;
      }

      const params = mapToKVRecords(queryParams);
      if (localAuth.type === "apikey" && localAuth.apiKeyName && localAuth.apiKeyValue) {
        if (localAuth.apiKeyLocation === "header") {
          outgoingHeaders[localAuth.apiKeyName] = localAuth.apiKeyValue;
        } else {
          params[localAuth.apiKeyName] = localAuth.apiKeyValue;
        }
      }

      let parsedBody: unknown = undefined;
      if (method !== "GET" && body.trim()) {
        try {
          parsedBody = JSON.parse(body);
        } catch {
          parsedBody = body;
        }
      }

      const started = performance.now();
      const response = await axios.request({
        method,
        url: resolvedUrl,
        params,
        data: parsedBody,
        headers: outgoingHeaders as AxiosRequestHeaders,
        validateStatus: () => true,
      });
      const ended = performance.now();
      const durationMs = Math.round(ended - started);
      const parsedResponse = safeParseBody(response.data);
      const responseHeaders = Object.fromEntries(
        Object.entries(response.headers ?? {}).map(([k, v]) => [k, String(v)])
      );
      const responseData: ApiResponseData = {
        status: response.status,
        statusText: response.statusText,
        durationMs,
        sizeBytes: toBytes(response.data, responseHeaders),
        headers: responseHeaders,
        bodyPretty: parsedResponse.pretty,
        bodyRaw: parsedResponse.raw,
        contentType: responseHeaders["content-type"] ?? "unknown",
      };

      const threshold = thresholds[url] ?? thresholds[resolvedUrl];
      const thresholdBreached = !!threshold && durationMs > threshold;
      if (thresholdBreached) {
        setNotification(`Slow API detected: ${durationMs}ms exceeded ${threshold}ms threshold.`);
      }

      const item: ApiTestRecord = {
        id: uid(),
        name: testName || saveName || `${method} ${url}`,
        favorite: false,
        collectionId: selectedCollectionId || undefined,
        createdAt: new Date().toISOString(),
        method,
        url,
        queryParams,
        headers,
        body,
        auth: localAuth,
        response: responseData,
        thresholdBreached,
      };
      setLatestResponse(responseData);
      setHistory((prev) => [item, ...prev]);
    } catch (error) {
      const err = error as AxiosError;
      setLatestResponse({
        status: 0,
        statusText: "Request Failed",
        durationMs: 0,
        sizeBytes: 0,
        headers: {},
        bodyPretty: err.message || "Network or CORS error",
        bodyRaw: err.message || "Network or CORS error",
        contentType: "text/plain",
      });
      setNotification("Request failed. Check URL, network, or CORS configuration.");
    } finally {
      setLoading(false);
    }
  };

  const removeHistory = (id: string) => setHistory((prev) => prev.filter((h) => h.id !== id));
  const clearHistory = () => setHistory([]);
  const toggleFavorite = (id: string) =>
    setHistory((prev) => prev.map((item) => (item.id === id ? { ...item, favorite: !item.favorite } : item)));

  const createCollection = () => {
    if (!newCollectionName.trim()) return;
    const collection: Collection = { id: uid(), name: newCollectionName.trim(), testIds: [] };
    setCollections((prev) => [...prev, collection]);
    setNewCollectionName("");
  };

  const runCollection = async (collectionId: string) => {
    const targetCollection = collections.find((c) => c.id === collectionId);
    if (!targetCollection) return;
    const tests = history.filter((h) => targetCollection.testIds.includes(h.id));
    for (const t of tests) {
      setMethod(t.method);
      setUrl(t.url);
      setHeaders(t.headers);
      setQueryParams(t.queryParams);
      setBody(t.body);
      setAuth(t.auth);
      // Run each test with its original name.
      await sendRequest(`${t.name} (rerun)`);
    }
  };

  const duplicateTest = (record: ApiTestRecord) => {
    setMethod(record.method);
    setUrl(record.url);
    setHeaders(record.headers.map((item) => ({ ...item, id: uid() })));
    setQueryParams(record.queryParams.map((item) => ({ ...item, id: uid() })));
    setBody(record.body);
    setAuth(record.auth);
    setSaveName(`${record.name} Copy`);
  };

  const exportHistoryJson = () => {
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = "api-history.json";
    a.click();
    URL.revokeObjectURL(href);
  };

  const exportHistoryCsv = () => {
    const rows = [
      ["timestamp", "name", "method", "url", "status", "responseMs", "sizeBytes", "favorite", "thresholdBreached"],
      ...history.map((h) => [
        h.createdAt,
        h.name,
        h.method,
        h.url,
        String(h.response?.status ?? ""),
        String(h.response?.durationMs ?? ""),
        String(h.response?.sizeBytes ?? ""),
        String(h.favorite),
        String(h.thresholdBreached),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = "api-history.csv";
    a.click();
    URL.revokeObjectURL(href);
  };

  const importCollections = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Collection[];
        setCollections(parsed);
      } catch {
        setNotification("Could not import collections JSON.");
      }
    };
    reader.readAsText(file);
  };

  const exportCollections = () => {
    const blob = new Blob([JSON.stringify(collections, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = "api-collections.json";
    a.click();
    URL.revokeObjectURL(href);
  };

  const addTestToCollection = (testId: string, collectionId: string) => {
    setCollections((prev) =>
      prev.map((c) => (c.id === collectionId && !c.testIds.includes(testId) ? { ...c, testIds: [...c.testIds, testId] } : c))
    );
  };

  const metricCard = (title: string, value: string) => (
    <div className="rounded-lg border border-[#262626] bg-[#0a0a0a] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#707070]">{title}</p>
      <p className="mt-2 text-xl font-semibold text-[#fafafa]">{value}</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-[#ededed]">
      <header className="sticky top-0 z-30 h-14 border-b border-[#262626] bg-black/95 backdrop-blur">
        <div className="mx-auto flex h-full w-full max-w-[1400px] items-center justify-between gap-4 px-6">
          <h1 className="text-sm font-semibold tracking-[-0.02em] text-[#fafafa]">API Monitor</h1>
          <div className="flex max-w-xl flex-1 items-center gap-2 rounded-md border border-[#262626] bg-[#0a0a0a] px-3 py-2">
            <Search size={14} className="text-[#666]" />
            <input
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Search endpoints, tests..."
              className="w-full bg-transparent text-[13px] text-[#ededed] outline-none placeholder:text-[#666]"
            />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportHistoryJson} className="icon-btn" title="Export JSON">
              <Download size={16} />
            </button>
            <button onClick={() => setShowSettings(true)} className="icon-btn" title="Threshold settings">
              <Settings size={16} />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1400px]">
        <aside className="hidden h-[calc(100vh-56px)] w-[240px] shrink-0 border-r border-[#262626] bg-[#0a0a0a] md:block">
          <div className="h-full overflow-y-auto p-4">
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#888]">Collections</p>
              <div className="mb-3 flex gap-2">
                <input
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  placeholder="New collection"
                  className="w-full rounded-md border border-[#262626] bg-black px-2 py-1.5 text-[12px] outline-none focus:border-[#555]"
                />
                <button onClick={createCollection} className="icon-btn">
                  <Plus size={14} />
                </button>
              </div>
              <div className="space-y-1">
                {collections.map((collection) => (
                  <div key={collection.id} className="group flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-[#1a1a1a]">
                    <button
                      className="flex min-w-0 items-center gap-2 text-[13px]"
                      onClick={() => setSelectedCollectionId(collection.id)}
                    >
                      <Folder size={14} className="text-[#888]" />
                      <span className="truncate">{collection.name}</span>
                    </button>
                    <button
                      onClick={() => runCollection(collection.id)}
                      className="text-[11px] text-[#888] opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      Run
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button onClick={exportCollections} className="secondary-btn text-xs">
                  Export
                </button>
                <label className="secondary-btn cursor-pointer text-xs">
                  Import
                  <input type="file" accept="application/json" className="hidden" onChange={importCollections} />
                </label>
              </div>
            </div>

            <div className="mt-6">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#888]">Favorites</p>
              <div className="space-y-1">
                {favorites.slice(0, 5).map((f) => (
                  <button
                    key={f.id}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-[#1a1a1a]"
                    onClick={() => duplicateTest(f)}
                  >
                    <Star size={12} className="fill-[#fbbf24] text-[#fbbf24]" />
                    <span className="truncate">{f.name}</span>
                  </button>
                ))}
                {!favorites.length && <p className="text-xs text-[#666]">No starred tests yet.</p>}
              </div>
            </div>

            <div className="mt-6">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#888]">History</p>
              <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                {history.slice(0, 20).map((h) => (
                  <button
                    key={h.id}
                    onClick={() => duplicateTest(h)}
                    className="flex h-8 w-full items-center justify-between rounded-md px-2 text-left hover:bg-[#1a1a1a]"
                  >
                    <span className="truncate text-[12px]">{h.name}</span>
                    <span style={{ color: METHOD_COLORS[h.method] }} className="text-[10px] font-semibold">
                      {h.method}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>

        <main className="w-full bg-black p-6">
          <div className="mb-6 flex h-10 items-end gap-6 border-b border-[#1f1f1f]">
            <button
              onClick={() => setActiveTab("request")}
              className={`h-full border-b-2 text-[13px] transition ${
                activeTab === "request" ? "border-white text-[#fafafa]" : "border-transparent text-[#888] hover:text-[#aaa]"
              }`}
            >
              Request Builder
            </button>
            <button
              onClick={() => setActiveTab("dashboard")}
              className={`h-full border-b-2 text-[13px] transition ${
                activeTab === "dashboard" ? "border-white text-[#fafafa]" : "border-transparent text-[#888] hover:text-[#aaa]"
              }`}
            >
              Dashboard
            </button>
          </div>

          {activeTab === "request" ? (
            <div className="space-y-5">
              <section className="rounded-lg border border-[#262626] bg-[#0a0a0a] p-5">
                <div className="mb-4 flex flex-wrap gap-2">
                  {(["GET", "POST", "PUT", "DELETE", "PATCH"] as HttpMethod[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMethod(m)}
                      style={{ borderColor: method === m ? METHOD_COLORS[m] : "#333" }}
                      className="rounded-md border px-3 py-1.5 text-xs font-semibold"
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <div className="flex flex-col gap-3 lg:flex-row">
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://api.example.com/users/:id"
                    className="w-full rounded-md border border-[#262626] bg-black px-3 py-2.5 text-[13px] outline-none focus:border-[#555]"
                  />
                  <button onClick={() => sendRequest()} disabled={loading} className="primary-btn min-w-28">
                    {loading ? <Clock3 size={14} className="animate-spin" /> : <Send size={14} />}
                    <span>{loading ? "Sending" : "Send"}</span>
                  </button>
                </div>
                <p className="mt-2 text-xs text-[#666]">
                  Final URL: <span className="font-mono">{resolvedUrl}</span>
                </p>
              </section>

              <section className="grid gap-5 lg:grid-cols-2">
                <div className="rounded-lg border border-[#262626] bg-[#111] p-5">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#888]">URL Params</p>
                  {urlParams.map((item) => (
                    <div key={item.id} className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2">
                      <input
                        value={item.key}
                        onChange={(e) => updateList(setUrlParams, item.id, "key", e.target.value)}
                        placeholder="id"
                        className="input"
                      />
                      <input
                        value={item.value}
                        onChange={(e) => updateList(setUrlParams, item.id, "value", e.target.value)}
                        placeholder="123"
                        className="input"
                      />
                      <button onClick={() => setUrlParams((prev) => prev.filter((p) => p.id !== item.id))} className="icon-btn">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <button onClick={() => setUrlParams((prev) => [...prev, makeKV()])} className="secondary-btn text-xs">
                    Add Param
                  </button>
                </div>

                <div className="rounded-lg border border-[#262626] bg-[#111] p-5">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#888]">Query Params</p>
                  {queryParams.map((item) => (
                    <div key={item.id} className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2">
                      <input
                        value={item.key}
                        onChange={(e) => updateList(setQueryParams, item.id, "key", e.target.value)}
                        placeholder="limit"
                        className="input"
                      />
                      <input
                        value={item.value}
                        onChange={(e) => updateList(setQueryParams, item.id, "value", e.target.value)}
                        placeholder="10"
                        className="input"
                      />
                      <button onClick={() => setQueryParams((prev) => prev.filter((p) => p.id !== item.id))} className="icon-btn">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <button onClick={() => setQueryParams((prev) => [...prev, makeKV()])} className="secondary-btn text-xs">
                    Add Query
                  </button>
                </div>
              </section>

              <section className="grid gap-5 lg:grid-cols-2">
                <div className="rounded-lg border border-[#262626] bg-[#111] p-5">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#888]">Headers</p>
                  {headers.map((item) => (
                    <div key={item.id} className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2">
                      <input
                        value={item.key}
                        onChange={(e) => updateList(setHeaders, item.id, "key", e.target.value)}
                        placeholder="Content-Type"
                        className="input"
                      />
                      <input
                        value={item.value}
                        onChange={(e) => updateList(setHeaders, item.id, "value", e.target.value)}
                        placeholder="application/json"
                        className="input"
                      />
                      <button onClick={() => setHeaders((prev) => prev.filter((p) => p.id !== item.id))} className="icon-btn">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <button onClick={() => setHeaders((prev) => [...prev, makeKV()])} className="secondary-btn text-xs">
                    Add Header
                  </button>
                </div>

                <div className="rounded-lg border border-[#262626] bg-[#111] p-5">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#888]">Authentication</p>
                  <select
                    value={auth.type}
                    onChange={(e) => setAuth((prev) => ({ ...prev, type: e.target.value as AuthType }))}
                    className="input mb-3"
                  >
                    <option value="none">None</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="apikey">API Key</option>
                    <option value="basic">Basic Auth</option>
                  </select>

                  {auth.type === "bearer" && (
                    <input
                      className="input"
                      placeholder="Bearer token"
                      value={auth.bearerToken}
                      onChange={(e) => setAuth((prev) => ({ ...prev, bearerToken: e.target.value }))}
                    />
                  )}
                  {auth.type === "apikey" && (
                    <div className="space-y-2">
                      <input
                        className="input"
                        placeholder="API key name"
                        value={auth.apiKeyName}
                        onChange={(e) => setAuth((prev) => ({ ...prev, apiKeyName: e.target.value }))}
                      />
                      <input
                        className="input"
                        placeholder="API key value"
                        value={auth.apiKeyValue}
                        onChange={(e) => setAuth((prev) => ({ ...prev, apiKeyValue: e.target.value }))}
                      />
                      <select
                        className="input"
                        value={auth.apiKeyLocation}
                        onChange={(e) =>
                          setAuth((prev) => ({ ...prev, apiKeyLocation: e.target.value as "header" | "query" }))
                        }
                      >
                        <option value="header">Header</option>
                        <option value="query">Query</option>
                      </select>
                    </div>
                  )}
                  {auth.type === "basic" && (
                    <div className="space-y-2">
                      <input
                        className="input"
                        placeholder="Username"
                        value={auth.basic.username}
                        onChange={(e) => setAuth((prev) => ({ ...prev, basic: { ...prev.basic, username: e.target.value } }))}
                      />
                      <input
                        className="input"
                        type="password"
                        placeholder="Password"
                        value={auth.basic.password}
                        onChange={(e) => setAuth((prev) => ({ ...prev, basic: { ...prev.basic, password: e.target.value } }))}
                      />
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-[#262626] bg-[#111] p-5">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#888]">Request Body</p>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="h-44 w-full rounded-md border border-[#1f1f1f] bg-[#0a0a0a] p-3 font-mono text-[13px] outline-none focus:border-[#555]"
                />
              </section>

              <section className="rounded-lg border border-[#262626] bg-[#111] p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#888]">Response</p>
                    {latestResponse && (
                      <span className="inline-flex items-center gap-1 text-xs" style={{ color: statusColor(latestResponse.status) }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusColor(latestResponse.status) }} />
                        {latestResponse.status || "ERR"} {latestResponse.statusText}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[#888]">
                    {latestResponse && (
                      <>
                        <span>{latestResponse.durationMs}ms</span>
                        <span>{formatBytes(latestResponse.sizeBytes)}</span>
                        <span>{latestResponse.contentType}</span>
                      </>
                    )}
                    <button className="secondary-btn text-xs" onClick={() => setResponseView((v) => (v === "pretty" ? "raw" : "pretty"))}>
                      {responseView === "pretty" ? "Raw" : "Pretty"}
                    </button>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <pre className="max-h-96 overflow-auto rounded-md border border-[#1f1f1f] bg-[#0a0a0a] p-3 font-mono text-[13px]">
                    {latestResponse ? (responseView === "pretty" ? latestResponse.bodyPretty : latestResponse.bodyRaw) : "No response yet."}
                  </pre>
                  <pre className="max-h-96 overflow-auto rounded-md border border-[#1f1f1f] bg-[#0a0a0a] p-3 font-mono text-[12px]">
                    {latestResponse ? JSON.stringify(latestResponse.headers, null, 2) : "Response headers appear here."}
                  </pre>
                </div>
              </section>

              <section className="rounded-lg border border-[#262626] bg-[#111] p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <input
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    placeholder="Test label"
                    className="input max-w-xs"
                  />
                  <select value={selectedCollectionId} onChange={(e) => setSelectedCollectionId(e.target.value)} className="input max-w-xs">
                    <option value="">No Collection</option>
                    {collections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => sendRequest(saveName || undefined)} className="primary-btn text-xs">
                    Save + Run
                  </button>
                  {selectedCollectionId && history[0] && (
                    <button onClick={() => addTestToCollection(history[0].id, selectedCollectionId)} className="secondary-btn text-xs">
                      Add Last Test to Collection
                    </button>
                  )}
                </div>

                <div className="mb-3 grid gap-2 lg:grid-cols-6">
                  <select value={historyMethodFilter} onChange={(e) => setHistoryMethodFilter(e.target.value as "all" | HttpMethod)} className="input">
                    <option value="all">All methods</option>
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="DELETE">DELETE</option>
                    <option value="PATCH">PATCH</option>
                  </select>
                  <select
                    value={historyStatusFilter}
                    onChange={(e) => setHistoryStatusFilter(e.target.value as "all" | "2xx" | "3xx" | "4xx5xx")}
                    className="input"
                  >
                    <option value="all">All status</option>
                    <option value="2xx">2xx</option>
                    <option value="3xx">3xx</option>
                    <option value="4xx5xx">4xx/5xx</option>
                  </select>
                  <input type="date" value={historyDateFrom} onChange={(e) => setHistoryDateFrom(e.target.value)} className="input" />
                  <input type="date" value={historyDateTo} onChange={(e) => setHistoryDateTo(e.target.value)} className="input" />
                  <input
                    value={historyResponseMin}
                    onChange={(e) => setHistoryResponseMin(e.target.value)}
                    placeholder="Min ms"
                    className="input"
                  />
                  <input
                    value={historyResponseMax}
                    onChange={(e) => setHistoryResponseMax(e.target.value)}
                    placeholder="Max ms"
                    className="input"
                  />
                </div>

                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <button onClick={exportHistoryJson} className="secondary-btn text-xs">
                    Export JSON
                  </button>
                  <button onClick={exportHistoryCsv} className="secondary-btn text-xs">
                    Export CSV
                  </button>
                  <button onClick={clearHistory} className="danger-btn text-xs">
                    Clear All
                  </button>
                </div>

                <div className="overflow-hidden rounded-md">
                  <table className="w-full text-left text-[13px]">
                    <thead className="border-b border-[#1f1f1f] text-[11px] font-semibold uppercase tracking-[0.05em] text-[#888]">
                      <tr>
                        <th className="px-3 py-3">Name</th>
                        <th className="px-3 py-3">Method</th>
                        <th className="px-3 py-3">Status</th>
                        <th className="px-3 py-3">Time</th>
                        <th className="px-3 py-3">When</th>
                        <th className="px-3 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredHistory.map((item) => (
                        <tr key={item.id} className="border-b border-[#1f1f1f] hover:bg-[#0f0f0f]">
                          <td className="max-w-72 truncate px-3 py-3">{item.name}</td>
                          <td className="px-3 py-3" style={{ color: METHOD_COLORS[item.method] }}>
                            {item.method}
                          </td>
                          <td className="px-3 py-3">
                            <span className="inline-flex items-center gap-1" style={{ color: statusColor(item.response?.status) }}>
                              <span
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ backgroundColor: statusColor(item.response?.status) }}
                              />
                              {item.response?.status ?? "--"}
                            </span>
                          </td>
                          <td className="px-3 py-3">{item.response?.durationMs ?? "--"} ms</td>
                          <td title={new Date(item.createdAt).toLocaleString()} className="px-3 py-3 text-[#888]">
                            {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              {item.thresholdBreached && <AlertTriangle size={14} className="text-[#fbbf24]" />}
                              <button onClick={() => toggleFavorite(item.id)} className="icon-btn">
                                <Star size={14} className={item.favorite ? "fill-[#fbbf24] text-[#fbbf24]" : "text-[#888]"} />
                              </button>
                              <button onClick={() => duplicateTest(item)} className="icon-btn">
                                <History size={14} />
                              </button>
                              <button onClick={() => removeHistory(item.id)} className="icon-btn">
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filteredHistory.length && (
                    <div className="flex h-40 flex-col items-center justify-center gap-2 text-[#666]">
                      <BarChart3 size={36} />
                      <p className="text-sm text-[#fafafa]">No tests match current filters</p>
                      <p className="text-xs">Run a request or adjust filters.</p>
                    </div>
                  )}
                </div>
              </section>
            </div>
          ) : (
            <div className="space-y-5">
              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                {metricCard("Average Response", `${dashboardData.average} ms`)}
                {metricCard("Fastest", `${dashboardData.fastest} ms`)}
                {metricCard("Slowest", `${dashboardData.slowest} ms`)}
                {metricCard("Total Requests", String(dashboardData.total))}
                {metricCard("Success Rate", `${dashboardData.successRate}%`)}
              </section>

              <section className="rounded-lg border border-[#262626] bg-[#111] p-5">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#888]">Date Range</p>
                  <select
                    className="input max-w-40"
                    value={dashboardFilter.range}
                    onChange={(e) => setDashboardFilter((prev) => ({ ...prev, range: e.target.value as DashboardFilter["range"] }))}
                  >
                    <option value="24h">Last 24h</option>
                    <option value="7d">Last 7 days</option>
                    <option value="30d">Last 30 days</option>
                    <option value="custom">Custom</option>
                  </select>
                  {dashboardFilter.range === "custom" && (
                    <>
                      <input
                        type="date"
                        className="input max-w-40"
                        value={dashboardFilter.from ?? ""}
                        onChange={(e) => setDashboardFilter((prev) => ({ ...prev, from: e.target.value }))}
                      />
                      <input
                        type="date"
                        className="input max-w-40"
                        value={dashboardFilter.to ?? ""}
                        onChange={(e) => setDashboardFilter((prev) => ({ ...prev, to: e.target.value }))}
                      />
                    </>
                  )}
                  <div className="ml-auto text-xs text-[#888]">Threshold alerts: {alertCount}</div>
                </div>

                <div className="grid gap-5 xl:grid-cols-2">
                  <div className="rounded-md border border-[#1f1f1f] bg-[#0a0a0a] p-4">
                    <p className="mb-3 text-sm font-semibold">Response Time Trend</p>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={dashboardData.trend}>
                          <CartesianGrid stroke="#1f1f1f" />
                          <XAxis dataKey="label" stroke="#888" fontSize={11} />
                          <YAxis stroke="#888" fontSize={11} />
                          <Tooltip
                            contentStyle={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 8, color: "#ededed" }}
                          />
                          <Line type="monotone" dataKey="responseTime" stroke="#10b981" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="rounded-md border border-[#1f1f1f] bg-[#0a0a0a] p-4">
                    <p className="mb-3 text-sm font-semibold">Success vs Failure</p>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={dashboardData.pie} dataKey="value" nameKey="name" outerRadius={90}>
                            {dashboardData.pie.map((entry) => (
                              <Cell key={entry.name} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 8, color: "#ededed" }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                <div className="mt-5 rounded-md border border-[#1f1f1f] bg-[#0a0a0a] p-4">
                  <p className="mb-3 text-sm font-semibold">Endpoint Comparison (Average ms)</p>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dashboardData.endpointAverage}>
                        <CartesianGrid stroke="#1f1f1f" />
                        <XAxis dataKey="endpoint" stroke="#888" fontSize={10} interval={0} angle={-20} textAnchor="end" height={70} />
                        <YAxis stroke="#888" fontSize={11} />
                        <Tooltip
                          formatter={(value) => [`${value} ms`, "Average"]}
                          labelFormatter={(_, payload) => (payload?.[0]?.payload as { fullEndpoint?: string })?.fullEndpoint ?? ""}
                          contentStyle={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 8, color: "#ededed" }}
                        />
                        <Bar dataKey="average" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-lg border border-[#333] bg-[#111] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Threshold Settings</h2>
              <button className="icon-btn" onClick={() => setShowSettings(false)}>
                <Trash2 size={14} />
              </button>
            </div>
            <p className="mb-3 text-xs text-[#888]">Set per-endpoint threshold in ms. Keys should match request URL.</p>
            <div className="space-y-2">
              {Object.entries(thresholds).map(([endpoint, ms]) => (
                <div key={endpoint} className="grid grid-cols-[1fr_auto_auto] gap-2">
                  <input
                    className="input"
                    value={endpoint}
                    onChange={(e) => {
                      const next = { ...thresholds };
                      const value = next[endpoint];
                      delete next[endpoint];
                      next[e.target.value] = value;
                      setThresholds(next);
                    }}
                  />
                  <input
                    className="input w-24"
                    value={ms}
                    onChange={(e) => setThresholds((prev) => ({ ...prev, [endpoint]: Number(e.target.value || 0) }))}
                  />
                  <button
                    className="icon-btn"
                    onClick={() =>
                      setThresholds((prev) => {
                        const next = { ...prev };
                        delete next[endpoint];
                        return next;
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              className="secondary-btn mt-3 text-xs"
              onClick={() => setThresholds((prev) => ({ ...prev, [url]: prev[url] ?? 2000 }))}
            >
              Add Current URL
            </button>
          </div>
        </div>
      )}

      {notification && (
        <div className="fixed right-4 top-20 z-50 max-w-sm animate-[slide-in_200ms_cubic-bezier(0.4,0,0.2,1)] rounded-lg border border-[#333] bg-[#1a1a1a] p-4">
          <p className="text-sm text-[#ededed]">{notification}</p>
        </div>
      )}
    </div>
  );
}
