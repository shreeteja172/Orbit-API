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
import { METHOD_COLORS } from "@/components/monitor/constants";
import { readStorage, writeStorage } from "@/components/monitor/storage";
import {
  ActiveTab,
  ApiResponseData,
  ApiTestRecord,
  AuthConfig,
  AuthType,
  Collection,
  DashboardFilter,
  HttpMethod,
  KVPair,
  ThresholdMap,
} from "@/components/monitor/types";
import {
  formatBytes,
  makeKV,
  mapToKVRecords,
  safeParseBody,
  statusColor,
  toBytes,
  uid,
} from "@/components/monitor/utils";

type RequestTab = "params" | "headers" | "auth" | "body" | "snippets";
type ResponseTab = "body" | "headers" | "raw";

export default function ApiMonitorApp() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("request");
  const [requestTab, setRequestTab] = useState<RequestTab>("params");
  const [responseTab, setResponseTab] = useState<ResponseTab>("body");
  const [method, setMethod] = useState<HttpMethod>("GET");
  const [url, setUrl] = useState(
    "https://jsonplaceholder.typicode.com/posts/1",
  );
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
  const [notification, setNotification] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historyMethodFilter, setHistoryMethodFilter] = useState<
    "all" | HttpMethod
  >("all");
  const [historyStatusFilter, setHistoryStatusFilter] = useState<
    "all" | "2xx" | "3xx" | "4xx5xx"
  >("all");
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter>({
    range: "7d",
  });
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
        built = built.replaceAll(
          `:${p.key.trim()}`,
          encodeURIComponent(p.value.trim()),
        );
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
      if (
        historySearch &&
        !`${record.name} ${record.url}`
          .toLowerCase()
          .includes(historySearch.toLowerCase())
      )
        return false;
      if (
        historyMethodFilter !== "all" &&
        record.method !== historyMethodFilter
      )
        return false;
      const status = record.response?.status ?? 0;
      if (historyStatusFilter === "2xx" && !(status >= 200 && status < 300))
        return false;
      if (historyStatusFilter === "3xx" && !(status >= 300 && status < 400))
        return false;
      if (historyStatusFilter === "4xx5xx" && status < 400) return false;
      return true;
    });
  }, [history, historySearch, historyMethodFilter, historyStatusFilter]);

  const dashboardData = useMemo(() => {
    const now = Date.now();
    const cutoff = (() => {
      if (dashboardFilter.range === "24h") return now - 24 * 60 * 60 * 1000;
      if (dashboardFilter.range === "7d") return now - 7 * 24 * 60 * 60 * 1000;
      if (dashboardFilter.range === "30d")
        return now - 30 * 24 * 60 * 60 * 1000;
      if (dashboardFilter.from) return new Date(dashboardFilter.from).getTime();
      return 0;
    })();
    const to =
      dashboardFilter.range === "custom" && dashboardFilter.to
        ? new Date(dashboardFilter.to).getTime()
        : now;
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

    const endpointAverage = Object.entries(byEndpoint).map(
      ([endpoint, times]) => ({
        endpoint:
          endpoint.length > 30 ? `${endpoint.slice(0, 30)}...` : endpoint,
        fullEndpoint: endpoint,
        average: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
      }),
    );

    const trend = inRange
      .slice()
      .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
      .map((h) => ({
        label: new Date(h.createdAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        responseTime: h.response?.durationMs ?? 0,
      }));

    return {
      total,
      average: total
        ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / total)
        : 0,
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

  const favorites = useMemo(() => history.filter((h) => h.favorite), [history]);
  const alertCount = useMemo(
    () => history.filter((h) => h.thresholdBreached).length,
    [history],
  );

  const updateList = (
    setter: React.Dispatch<React.SetStateAction<KVPair[]>>,
    id: string,
    key: keyof KVPair,
    value: string | boolean,
  ) => {
    setter((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [key]: value } : item)),
    );
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
      if (
        localAuth.type === "apikey" &&
        localAuth.apiKeyName &&
        localAuth.apiKeyValue
      ) {
        if (localAuth.apiKeyLocation === "header")
          outgoingHeaders[localAuth.apiKeyName] = localAuth.apiKeyValue;
        else params[localAuth.apiKeyName] = localAuth.apiKeyValue;
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
      const durationMs = Math.round(performance.now() - started);
      const parsedResponse = safeParseBody(response.data);
      const responseHeaders = Object.fromEntries(
        Object.entries(response.headers ?? {}).map(([k, v]) => [k, String(v)]),
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
      if (thresholdBreached)
        setNotification(`Slow API: ${durationMs}ms exceeds ${threshold}ms`);

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

      let errorDetail = err.message || "Unknown Error";
      let errorName = err.name || "Request Failed";
      let statusCode = 0;

      if (err.response) {
        // The request was made and the server responded with a status code
        errorDetail = `Server Error: ${err.response.status} ${err.response.statusText}`;
        statusCode = err.response.status;
      } else if (err.request) {
        // The request was made but no response was received (e.g., CORS, DNS, Timeout)
        if (err.code === "ECONNABORTED") {
          errorDetail = "Request Timeout. The server took too long to respond.";
          errorName = "TimeoutError";
        } else if (err.message === "Network Error") {
          errorDetail =
            "Network Error: This is likely a CORS issue, an invalid URL, or the server is completely down. Check the browser console for exact details.";
          errorName = "NetworkError / CORS";
        } else {
          errorDetail = `No response received: ${err.message}`;
        }
      } else {
        // Something happened in setting up the request
        errorDetail = `Request Setup Error: ${err.message}`;
      }

      setLatestResponse({
        status: statusCode,
        statusText: errorName,
        durationMs: 0,
        sizeBytes: 0,
        headers: {},
        bodyPretty: JSON.stringify(
          {
            error: errorName,
            message: errorDetail,
            code: err.code || "UNKNOWN",
          },
          null,
          2,
        ),
        bodyRaw: errorDetail,
        contentType: "application/json",
      });
      setNotification(`Error: ${errorName} - ${err.message}`);
    } finally {
      setLoading(false);
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
    setActiveTab("request");
  };

  const removeHistory = (id: string) =>
    setHistory((prev) => prev.filter((h) => h.id !== id));
  const clearHistory = () => setHistory([]);
  const toggleFavorite = (id: string) =>
    setHistory((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, favorite: !item.favorite } : item,
      ),
    );

  const createCollection = () => {
    if (!newCollectionName.trim()) return;
    setCollections((prev) => [
      ...prev,
      { id: uid(), name: newCollectionName.trim(), testIds: [] },
    ]);
    setNewCollectionName("");
  };

  const runCollection = async (collectionId: string) => {
    const targetCollection = collections.find((c) => c.id === collectionId);
    if (!targetCollection) return;
    const tests = history.filter((h) =>
      targetCollection.testIds.includes(h.id),
    );
    for (const t of tests) {
      setMethod(t.method);
      setUrl(t.url);
      setHeaders(t.headers);
      setQueryParams(t.queryParams);
      setBody(t.body);
      setAuth(t.auth);
      await sendRequest(`${t.name} (rerun)`);
    }
  };

  const addLastToCollection = () => {
    if (!selectedCollectionId || !history[0]) return;
    setCollections((prev) =>
      prev.map((c) =>
        c.id === selectedCollectionId && !c.testIds.includes(history[0].id)
          ? { ...c, testIds: [...c.testIds, history[0].id] }
          : c,
      ),
    );
  };

  const exportHistoryJson = () => {
    const blob = new Blob([JSON.stringify(history, null, 2)], {
      type: "application/json",
    });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = "api-history.json";
    a.click();
    URL.revokeObjectURL(href);
  };

  const exportHistoryCsv = () => {
    const rows = [
      [
        "timestamp",
        "name",
        "method",
        "url",
        "status",
        "responseMs",
        "sizeBytes",
        "favorite",
        "thresholdBreached",
      ],
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
    const csv = rows
      .map((r) =>
        r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = "api-history.csv";
    a.click();
    URL.revokeObjectURL(href);
  };

  const exportCollections = () => {
    const blob = new Blob([JSON.stringify(collections, null, 2)], {
      type: "application/json",
    });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = "api-collections.json";
    a.click();
    URL.revokeObjectURL(href);
  };

  const importCollections = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setCollections(JSON.parse(String(reader.result)) as Collection[]);
      } catch {
        setNotification("Could not import collections JSON.");
      }
    };
    reader.readAsText(file);
  };

  const generateTypescript = () => {
    if (!latestResponse?.bodyRaw) return;
    try {
      const parsed = JSON.parse(latestResponse.bodyRaw);

      const getType = (obj: any, indent = ""): string => {
        if (obj === null) return "null";
        if (Array.isArray(obj)) {
          if (obj.length === 0) return "any[]";
          const type = getType(obj[0], indent);
          return type.includes("{") ? `Array<${type}>` : `${type}[]`;
        }
        if (typeof obj === "object") {
          const props = Object.entries(obj)
            .map(([k, v]) => {
              const keyName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k)
                ? k
                : `"${k}"`;
              return `${indent}  ${keyName}: ${getType(v, indent + "  ")};`;
            })
            .join("\n");
          return `{\n${props}\n${indent}}`;
        }
        return typeof obj;
      };

      const tsType = getType(parsed);
      const tsDef =
        Array.isArray(parsed) || typeof parsed !== "object"
          ? `export type APIResponse = ${tsType};`
          : `export interface APIResponse ${tsType}`;

      navigator.clipboard.writeText(tsDef);
      setNotification("Copied TypeScript interface to clipboard!");
    } catch {
      setNotification(
        "Could not parse response as JSON for TypeScript generation.",
      );
    }
  };

  const metricCard = (title: string, value: string) => (
    <div className="rounded-lg border border-[#262626] bg-[#0a0a0a] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#707070]">
        {title}
      </p>
      <p className="mt-2 text-xl font-semibold text-[#fafafa]">{value}</p>
    </div>
  );

  const renderRequestTab = () => {
    if (requestTab === "params") {
      return (
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#888]">
              Path Params
            </p>
            {urlParams.map((item) => (
              <div
                key={item.id}
                className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2"
              >
                <input
                  className="input"
                  value={item.key}
                  placeholder="id"
                  onChange={(e) =>
                    updateList(setUrlParams, item.id, "key", e.target.value)
                  }
                />
                <input
                  className="input"
                  value={item.value}
                  placeholder="123"
                  onChange={(e) =>
                    updateList(setUrlParams, item.id, "value", e.target.value)
                  }
                />
                <button
                  className="icon-btn"
                  onClick={() =>
                    setUrlParams((prev) => prev.filter((p) => p.id !== item.id))
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              className="secondary-btn text-xs"
              onClick={() => setUrlParams((prev) => [...prev, makeKV()])}
            >
              Add Param
            </button>
          </div>
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#888]">
              Query Params
            </p>
            {queryParams.map((item) => (
              <div
                key={item.id}
                className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2"
              >
                <input
                  className="input"
                  value={item.key}
                  placeholder="limit"
                  onChange={(e) =>
                    updateList(setQueryParams, item.id, "key", e.target.value)
                  }
                />
                <input
                  className="input"
                  value={item.value}
                  placeholder="10"
                  onChange={(e) =>
                    updateList(setQueryParams, item.id, "value", e.target.value)
                  }
                />
                <button
                  className="icon-btn"
                  onClick={() =>
                    setQueryParams((prev) =>
                      prev.filter((p) => p.id !== item.id),
                    )
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              className="secondary-btn text-xs"
              onClick={() => setQueryParams((prev) => [...prev, makeKV()])}
            >
              Add Query
            </button>
          </div>
        </div>
      );
    }

    if (requestTab === "headers") {
      return (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#888]">
            Headers
          </p>
          {headers.map((item) => (
            <div
              key={item.id}
              className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2"
            >
              <input
                className="input"
                value={item.key}
                placeholder="Content-Type"
                onChange={(e) =>
                  updateList(setHeaders, item.id, "key", e.target.value)
                }
              />
              <input
                className="input"
                value={item.value}
                placeholder="application/json"
                onChange={(e) =>
                  updateList(setHeaders, item.id, "value", e.target.value)
                }
              />
              <button
                className="icon-btn"
                onClick={() =>
                  setHeaders((prev) => prev.filter((p) => p.id !== item.id))
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            className="secondary-btn text-xs"
            onClick={() => setHeaders((prev) => [...prev, makeKV()])}
          >
            Add Header
          </button>
        </div>
      );
    }

    if (requestTab === "auth") {
      return (
        <div className="max-w-xl space-y-2">
          <select
            className="input"
            value={auth.type}
            onChange={(e) =>
              setAuth((prev) => ({ ...prev, type: e.target.value as AuthType }))
            }
          >
            <option value="none">No Auth</option>
            <option value="bearer">Bearer Token</option>
            <option value="apikey">API Key</option>
            <option value="basic">Basic Auth</option>
          </select>
          {auth.type === "bearer" && (
            <input
              className="input"
              placeholder="Bearer token"
              value={auth.bearerToken}
              onChange={(e) =>
                setAuth((prev) => ({ ...prev, bearerToken: e.target.value }))
              }
            />
          )}
          {auth.type === "apikey" && (
            <>
              <input
                className="input"
                placeholder="API key name"
                value={auth.apiKeyName}
                onChange={(e) =>
                  setAuth((prev) => ({ ...prev, apiKeyName: e.target.value }))
                }
              />
              <input
                className="input"
                placeholder="API key value"
                value={auth.apiKeyValue}
                onChange={(e) =>
                  setAuth((prev) => ({ ...prev, apiKeyValue: e.target.value }))
                }
              />
              <select
                className="input"
                value={auth.apiKeyLocation}
                onChange={(e) =>
                  setAuth((prev) => ({
                    ...prev,
                    apiKeyLocation: e.target.value as "header" | "query",
                  }))
                }
              >
                <option value="header">Send in header</option>
                <option value="query">Send in query</option>
              </select>
            </>
          )}
          {auth.type === "basic" && (
            <>
              <input
                className="input"
                placeholder="Username"
                value={auth.basic.username}
                onChange={(e) =>
                  setAuth((prev) => ({
                    ...prev,
                    basic: { ...prev.basic, username: e.target.value },
                  }))
                }
              />
              <input
                className="input"
                type="password"
                placeholder="Password"
                value={auth.basic.password}
                onChange={(e) =>
                  setAuth((prev) => ({
                    ...prev,
                    basic: { ...prev.basic, password: e.target.value },
                  }))
                }
              />
            </>
          )}
        </div>
      );
    }

    if (requestTab === "snippets") {
      const curlCommand = `curl -X ${method} "${resolvedUrl}" \\
${headers
  .filter((h) => h.enabled && h.key)
  .map((h) => `  -H "${h.key}: ${h.value}"`)
  .join(" \\\n")}${
        body && method !== "GET"
          ? ` \\\n  -d '${body.replace(/'/g, "'\\''")}'`
          : ""
      }`;

      return (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#888]">
              cURL
            </p>
            <div className="relative">
              <textarea
                readOnly
                value={curlCommand}
                className="h-40 w-full rounded-md border border-[#1f1f1f] bg-[#0a0a0a] p-3 font-mono text-[13px] text-[#ccc] outline-none"
              />
              <button
                onClick={() => navigator.clipboard.writeText(curlCommand)}
                className="absolute right-2 top-2 rounded bg-[#262626] px-2 py-1 text-[11px] text-white hover:bg-[#333]"
              >
                Copy
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (requestTab === "body") {
      return (
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="h-60 w-full rounded-md border border-[#1f1f1f] bg-[#0a0a0a] p-3 font-mono text-[13px] outline-none focus:border-[#555]"
        />
      );
    }

    return null;
  };

  return (
    <div className="flex h-screen flex-col bg-[#0a0a0a] text-[#ededed] font-sans">
      <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-[#262626] bg-[#141414] px-4">
        <div className="flex items-center gap-6">
          <h1 className="text-sm font-semibold text-white">API Monitor</h1>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setActiveTab("request")}
              className={`text-[13px] font-medium transition-colors ${activeTab === "request" ? "text-white" : "text-[#888] hover:text-[#bbb]"}`}
            >
              Request
            </button>
            <button
              onClick={() => setActiveTab("dashboard")}
              className={`text-[13px] font-medium transition-colors ${activeTab === "dashboard" ? "text-white" : "text-[#888] hover:text-[#bbb]"}`}
            >
              Dashboard
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex w-64 items-center gap-2 rounded-md border border-[#262626] bg-[#1a1a1a] px-3 py-1.5 focus-within:border-[#444]">
            <Search size={14} className="text-[#666]" />
            <input
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Search history..."
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-[#666]"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={exportHistoryJson}
              className="rounded-md p-1.5 text-[#888] hover:bg-[#262626] hover:text-white transition-colors"
              title="Export History"
            >
              <Download size={16} />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="rounded-md p-1.5 text-[#888] hover:bg-[#262626] hover:text-white transition-colors"
              title="Settings"
            >
              <Settings size={16} />
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="flex w-[260px] flex-col border-r border-[#262626] bg-[#141414]">
          <div className="flex h-full flex-col overflow-y-auto">
            <div className="p-4 border-b border-[#262626]">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#888]">
                  Collections
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={exportCollections}
                    className="text-[#888] hover:text-white"
                    title="Export Collections"
                  >
                    <Download size={12} />
                  </button>
                  <label
                    className="cursor-pointer text-[#888] hover:text-white"
                    title="Import Collections"
                  >
                    <Plus size={12} />
                    <input
                      type="file"
                      accept="application/json"
                      className="hidden"
                      onChange={importCollections}
                    />
                  </label>
                </div>
              </div>
              <div className="flex gap-2 mb-2">
                <input
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  placeholder="New collection"
                  className="flex-1 rounded-md border border-[#262626] bg-[#0a0a0a] px-2 py-1 text-xs outline-none focus:border-[#444]"
                />
                <button
                  onClick={createCollection}
                  className="rounded-md bg-[#262626] p-1 text-[#bbb] hover:bg-[#333] hover:text-white"
                >
                  <Plus size={14} />
                </button>
              </div>
              <div className="space-y-0.5">
                {collections.map((c) => (
                  <div
                    key={c.id}
                    className="group flex items-center justify-between rounded-md p-1.5 hover:bg-[#262626]"
                  >
                    <button
                      className="flex min-w-0 items-center gap-2 text-[13px] text-[#ccc] group-hover:text-white"
                      onClick={() => setSelectedCollectionId(c.id)}
                    >
                      <Folder size={14} className="text-[#888]" />
                      <span className="truncate">{c.name}</span>
                    </button>
                    <button
                      className="text-[10px] text-[#888] opacity-0 group-hover:opacity-100 hover:text-white uppercase font-bold"
                      onClick={() => runCollection(c.id)}
                    >
                      Run
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex-1 p-4 overflow-y-auto">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#888]">
                  History
                </p>
                <button
                  onClick={clearHistory}
                  className="text-[10px] uppercase font-bold text-[#888] hover:text-red-400"
                >
                  Clear
                </button>
              </div>
              <div className="flex flex-col gap-0.5">
                {filteredHistory.map((h) => (
                  <div
                    key={h.id}
                    className="group relative flex items-center justify-between rounded-md p-1.5 hover:bg-[#262626]"
                  >
                    <button
                      onClick={() => duplicateTest(h)}
                      className="flex items-center gap-2 min-w-0 flex-1 text-left"
                    >
                      <span
                        className="text-[10px] font-bold w-10 shrink-0"
                        style={{ color: METHOD_COLORS[h.method] }}
                      >
                        {h.method}
                      </span>
                      <span className="truncate text-[12px] text-[#ccc] group-hover:text-white">
                        {h.name}
                      </span>
                    </button>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 bg-[#262626] pl-2">
                      <button
                        onClick={() => toggleFavorite(h.id)}
                        className="p-0.5 transition-colors hover:text-white"
                      >
                        <Star
                          size={12}
                          className={
                            h.favorite
                              ? "fill-[#fbbf24] text-[#fbbf24]"
                              : "text-[#888]"
                          }
                        />
                      </button>
                      <button
                        onClick={() => removeHistory(h.id)}
                        className="p-0.5 text-[#888] hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* Main Workspace */}
        <main className="flex flex-1 flex-col overflow-hidden bg-[#0a0a0a]">
          {activeTab === "request" ? (
            <div className="flex h-full flex-col">
              {/* URL/Method Bar */}
              <div className="flex items-center gap-2 border-b border-[#262626] p-4 bg-[#141414]">
                <div className="flex flex-1 items-center rounded-md border border-[#333] bg-[#1a1a1a] focus-within:border-[#555] focus-within:ring-1 focus-within:ring-[#555]">
                  <select
                    className="h-10 rounded-l-md border-r border-[#333] bg-transparent px-3 text-[13px] font-bold outline-none cursor-pointer hover:bg-[#262626]"
                    style={{ color: METHOD_COLORS[method] || "#fff" }}
                    value={method}
                    onChange={(e) => setMethod(e.target.value as HttpMethod)}
                  >
                    <option value="GET" className="text-black">
                      GET
                    </option>
                    <option value="POST" className="text-black">
                      POST
                    </option>
                    <option value="PUT" className="text-black">
                      PUT
                    </option>
                    <option value="DELETE" className="text-black">
                      DELETE
                    </option>
                    <option value="PATCH" className="text-black">
                      PATCH
                    </option>
                  </select>
                  <input
                    className="h-10 flex-1 bg-transparent px-3 text-[13px] text-white outline-none placeholder:text-[#666]"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="Enter request URL"
                  />
                </div>
                <button
                  onClick={() => sendRequest()}
                  disabled={loading}
                  className="flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-6 text-[13px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:bg-blue-800 disabled:opacity-50"
                >
                  {loading ? (
                    <Clock3 size={14} className="animate-spin" />
                  ) : (
                    <Send size={14} />
                  )}
                  <span>{loading ? "Sending..." : "Send"}</span>
                </button>
                <div className="flex h-10 items-center gap-2 rounded-md border border-[#333] bg-[#1a1a1a] px-2">
                  <input
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    placeholder="Request name"
                    className="w-32 bg-transparent text-[13px] outline-none px-2"
                  />
                  <div className="h-5 w-px bg-[#333]"></div>
                  <select
                    value={selectedCollectionId}
                    onChange={(e) => setSelectedCollectionId(e.target.value)}
                    className="w-32 bg-transparent text-[13px] outline-none text-[#ccc] cursor-pointer"
                  >
                    <option value="">No Collection</option>
                    {collections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={addLastToCollection}
                    className="rounded px-2 py-1 text-[11px] font-bold uppercase text-[#888] hover:bg-[#333] hover:text-white transition-colors"
                  >
                    Save
                  </button>
                </div>
              </div>

              {/* Request Configuration */}
              <div className="flex flex-1 flex-col overflow-hidden border-b border-[#262626]">
                <div className="flex items-center gap-6 px-4 pt-2 border-b border-[#262626] bg-[#141414]">
                  {(
                    ["params", "headers", "auth", "body", "snippets"] as const
                  ).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setRequestTab(tab as typeof requestTab)}
                      className={`pb-2 pt-1 border-b-2 text-[13px] capitalize transition-colors ${requestTab === tab ? "border-blue-500 text-white" : "border-transparent text-[#888] hover:text-[#ccc]"}`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
                <div className="flex-1 overflow-y-auto bg-[#0a0a0a] p-4">
                  {renderRequestTab()}
                </div>
              </div>

              {/* Response Section */}
              <div className="flex flex-1 flex-col overflow-hidden bg-[#141414]">
                <div className="flex items-center justify-between border-b border-[#262626] px-4 pt-2">
                  <div className="flex items-center gap-6">
                    {(["body", "headers", "raw"] as ResponseTab[]).map(
                      (tab) => (
                        <button
                          key={tab}
                          onClick={() => setResponseTab(tab)}
                          className={`pb-2 pt-1 border-b-2 text-[13px] capitalize transition-colors ${responseTab === tab ? "border-blue-500 text-white" : "border-transparent text-[#888] hover:text-[#ccc]"}`}
                        >
                          {tab}
                        </button>
                      ),
                    )}
                  </div>
                  {latestResponse && (
                    <div className="flex items-center gap-4 text-[12px] pb-1">
                      <span
                        className="flex items-center gap-1 font-mono"
                        style={{ color: statusColor(latestResponse.status) }}
                      >
                        Status:{" "}
                        <span className="font-bold">
                          {latestResponse.status}
                        </span>{" "}
                        {latestResponse.statusText}
                      </span>
                      <span className="flex items-center gap-1 text-[#888] font-mono">
                        Time:{" "}
                        <span className="text-[#ccc]">
                          {latestResponse.durationMs}ms
                        </span>
                      </span>
                      <span className="flex items-center gap-1 text-[#888] font-mono">
                        Size:{" "}
                        <span className="text-[#ccc]">
                          {formatBytes(latestResponse.sizeBytes)}
                        </span>
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex-1 overflow-auto bg-[#0a0a0a] relative group">
                  {!latestResponse ? (
                    <div className="flex h-full items-center justify-center text-[13px] text-[#666]">
                      Enter the URL and click send to get a response
                    </div>
                  ) : (
                    <>
                      {responseTab === "body" &&
                        (latestResponse.bodyRaw.trim().startsWith("{") ||
                          latestResponse.bodyRaw.trim().startsWith("[")) && (
                          <button
                            onClick={generateTypescript}
                            className="absolute right-4 top-4 z-10 rounded-md bg-[#262626] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-[#ccc] opacity-0 transition-all hover:bg-[#333] hover:text-white group-hover:opacity-100 shadow-lg"
                          >
                            Copy as TS
                          </button>
                        )}
                      <pre className="p-4 font-mono text-[13px] text-[#ddd]">
                        {responseTab === "body"
                          ? latestResponse.bodyPretty
                          : responseTab === "headers"
                            ? Object.entries(latestResponse.headers)
                                .map(([k, v]) => `${k}: ${v}`)
                                .join("\n")
                            : latestResponse.bodyRaw}
                      </pre>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-white">Dashboard</h2>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 rounded-md border border-[#333] bg-[#1a1a1a] p-1">
                    <select
                      className="bg-transparent text-[13px] text-white outline-none cursor-pointer px-2"
                      value={dashboardFilter.range}
                      onChange={(e) =>
                        setDashboardFilter((prev) => ({
                          ...prev,
                          range: e.target.value as DashboardFilter["range"],
                        }))
                      }
                    >
                      <option value="24h">Last 24h</option>
                      <option value="7d">Last 7d</option>
                      <option value="30d">Last 30d</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                  {dashboardFilter.range === "custom" && (
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        className="rounded-md border border-[#333] bg-[#1a1a1a] px-2 py-1 text-[13px] text-white outline-none"
                        value={dashboardFilter.from ?? ""}
                        onChange={(e) =>
                          setDashboardFilter((p) => ({
                            ...p,
                            from: e.target.value,
                          }))
                        }
                      />
                      <span className="text-[#888]">-</span>
                      <input
                        type="date"
                        className="rounded-md border border-[#333] bg-[#1a1a1a] px-2 py-1 text-[13px] text-white outline-none"
                        value={dashboardFilter.to ?? ""}
                        onChange={(e) =>
                          setDashboardFilter((p) => ({
                            ...p,
                            to: e.target.value,
                          }))
                        }
                      />
                    </div>
                  )}
                </div>
              </div>

              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                {metricCard("Average", `${dashboardData.average} ms`)}
                {metricCard("Fastest", `${dashboardData.fastest} ms`)}
                {metricCard("Slowest", `${dashboardData.slowest} ms`)}
                {metricCard("Total", String(dashboardData.total))}
                {metricCard("Success", `${dashboardData.successRate}%`)}
              </section>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-xl border border-[#262626] bg-[#141414] p-4">
                  <p className="mb-4 text-sm font-semibold text-white">
                    Response Trend
                  </p>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={dashboardData.trend}>
                        <CartesianGrid stroke="#262626" />
                        <XAxis dataKey="label" stroke="#888" fontSize={11} />
                        <YAxis stroke="#888" fontSize={11} />
                        <Tooltip
                          contentStyle={{
                            background: "#1a1a1a",
                            border: "1px solid #333",
                            borderRadius: 8,
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="responseTime"
                          stroke="#3b82f6"
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="rounded-xl border border-[#262626] bg-[#141414] p-4">
                  <p className="mb-4 text-sm font-semibold text-white">
                    Success vs Failure
                  </p>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={dashboardData.pie}
                          dataKey="value"
                          nameKey="name"
                          outerRadius={90}
                        >
                          {dashboardData.pie.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: "#1a1a1a",
                            border: "1px solid #333",
                            borderRadius: 8,
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[#262626] bg-[#141414] p-4">
                <p className="mb-4 text-sm font-semibold text-white">
                  Endpoint Comparison
                </p>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dashboardData.endpointAverage}>
                      <CartesianGrid stroke="#262626" />
                      <XAxis
                        dataKey="endpoint"
                        stroke="#888"
                        fontSize={10}
                        interval={0}
                        angle={-20}
                        textAnchor="end"
                        height={70}
                      />
                      <YAxis stroke="#888" fontSize={11} />
                      <Tooltip
                        formatter={(value) => [`${value} ms`, "Average"]}
                        labelFormatter={(_, payload) =>
                          (payload?.[0]?.payload as { fullEndpoint?: string })
                            ?.fullEndpoint ?? ""
                        }
                        contentStyle={{
                          background: "#1a1a1a",
                          border: "1px solid #333",
                          borderRadius: 8,
                        }}
                      />
                      <Bar
                        dataKey="average"
                        fill="#3b82f6"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-[#333] bg-[#141414] p-6 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                Threshold Settings
              </h2>
              <button
                className="text-[#888] hover:text-white transition-colors"
                onClick={() => setShowSettings(false)}
              >
                <Trash2 size={16} />
              </button>
            </div>
            <p className="mb-4 text-sm text-[#888]">
              Set performance alerts (ms) per endpoint.
            </p>
            <div className="space-y-3">
              {Object.entries(thresholds).map(([endpoint, ms]) => (
                <div
                  key={endpoint}
                  className="grid grid-cols-[1fr_100px_auto] gap-2"
                >
                  <input
                    className="rounded-md border border-[#333] bg-[#1a1a1a] px-3 py-1.5 text-sm text-white focus:border-[#555] outline-none"
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
                    className="rounded-md border border-[#333] bg-[#1a1a1a] px-3 py-1.5 text-sm text-white focus:border-[#555] outline-none"
                    value={ms}
                    onChange={(e) =>
                      setThresholds((prev) => ({
                        ...prev,
                        [endpoint]: Number(e.target.value || 0),
                      }))
                    }
                  />
                  <button
                    className="rounded-md p-2 text-[#888] hover:bg-[#262626] hover:text-red-400"
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
              className="mt-6 rounded-md bg-[#262626] px-4 py-2 text-sm font-semibold text-white hover:bg-[#333] transition-colors"
              onClick={() =>
                setThresholds((prev) => ({ ...prev, [url]: prev[url] ?? 2000 }))
              }
            >
              Add Current URL
            </button>
          </div>
        </div>
      )}

      {notification && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg border border-[#333] bg-[#1a1a1a] p-4 shadow-lg flex items-center gap-3">
          <AlertTriangle size={16} className="text-[#fbbf24]" />
          <p className="text-sm text-white">{notification}</p>
        </div>
      )}
    </div>
  );
}
