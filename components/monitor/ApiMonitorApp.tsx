"use client";

import axios, { AxiosError, AxiosRequestHeaders } from "axios";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  BarChart3,
  Clock3,
  Copy,
  Download,
  Folder,
  Group,
  History,
  Plus,
  Search,
  Send,
  Settings,
  Star,
  Trash2,
  X,
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
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  ActiveTab,
  ApiResponseData,
  ApiTestRecord,
  AssertionResult,
  AssertionType,
  AuthConfig,
  AuthType,
  Collection,
  DashboardFilter,
  HttpMethod,
  KVPair,
  TestAssertion,
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

type RequestTab = "params" | "headers" | "auth" | "body" | "snippets" | "tests";
type ResponseTab = "body" | "headers" | "raw" | "tests";

const UI = {
  page: "flex h-screen flex-col bg-[#0b0b0b] text-[#ededed] font-sans",
  topbar:
    "flex h-14 flex-shrink-0 items-center justify-between border-b border-[#262626] bg-[#121212] px-4",
  surface: "rounded-xl border border-[#262626] bg-[#121212]",
  surfaceSoft: "rounded-xl border border-[#262626] bg-[#0f0f0f]",
  surfaceHeader:
    "flex items-center justify-between border-b border-[#262626] px-4 py-2",
  subtleText: "text-[13px] text-[#a3a3a3]",
  label: "text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8a8a8a]",
  input:
    "h-10 w-full rounded-md border border-[#2a2a2a] bg-[#0b0b0b] px-3 text-[13px] text-[#f5f5f5] outline-none placeholder:text-[#6b6b6b] focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20",
  inputSm:
    "h-8 w-full rounded-md border border-[#2a2a2a] bg-[#0b0b0b] px-2 text-xs text-[#f5f5f5] outline-none placeholder:text-[#6b6b6b] focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20",
  iconBtn:
    "rounded-md p-1.5 text-[#a3a3a3] transition-colors hover:bg-[#1f1f1f] hover:text-white focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/30",
  secondaryBtn:
    "inline-flex items-center justify-center rounded-md border border-[#2a2a2a] bg-[#141414] px-3 py-2 text-[12px] font-semibold text-[#e5e5e5] transition-colors hover:bg-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/30",
  primaryBtn:
    "inline-flex items-center justify-center gap-2 rounded-md bg-[#2563eb] px-5 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[#1d4ed8] disabled:bg-[#1e3a8a] disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/30",
  tabBtn: (active: boolean) =>
    `pb-2 pt-1 border-b-2 text-[13px] capitalize transition-colors ${
      active
        ? "border-[#3b82f6] text-white"
        : "border-transparent text-[#a3a3a3] hover:text-[#e5e5e5]"
    }`,
  tabPill: (active: boolean) =>
    `inline-flex items-center justify-center rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/30 ${
      active
        ? "bg-[#1a1a1a] text-white"
        : "text-[#a3a3a3] hover:bg-[#151515] hover:text-[#e5e5e5]"
    }`,
  chip: "inline-flex items-center rounded-full border border-[#2a2a2a] bg-[#0b0b0b] px-2.5 py-1 text-[12px] font-mono text-[#d4d4d4]",
} as const;

export default function ApiMonitorApp() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("request");
  const [requestTab, setRequestTab] = useState<RequestTab>("params");
  const [responseTab, setResponseTab] = useState<ResponseTab>("body");
  const [wrapResponse, setWrapResponse] = useState(true);
  const [method, setMethod] = useState<HttpMethod>("GET");
  const [url, setUrl] = useState(
    "https://jsonplaceholder.typicode.com/posts/1",
  );
  const [headers, setHeaders] = useState<KVPair[]>([makeKV()]);
  const [queryParams, setQueryParams] = useState<KVPair[]>([makeKV()]);
  const [urlParams, setUrlParams] = useState<KVPair[]>([makeKV()]);
  const [body, setBody] = useState('{\n  "title": "foo"\n}');
  const [assertions, setAssertions] = useState<TestAssertion[]>([]);
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

  const copyToClipboard = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotification(successMessage);
    } catch {
      setNotification("Could not copy to clipboard.");
    }
  };

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
      const setHeader = (name: string, value: string) => {
        const target = name.trim();
        if (!target) return;
        for (const existing of Object.keys(outgoingHeaders)) {
          if (existing.toLowerCase() === target.toLowerCase()) {
            delete outgoingHeaders[existing];
          }
        }
        outgoingHeaders[target] = value;
      };
      const localAuth = { ...auth };
      if (localAuth.type === "bearer" && localAuth.bearerToken.trim()) {
        setHeader("Authorization", `Bearer ${localAuth.bearerToken.trim()}`);
      }
      if (localAuth.type === "basic" && localAuth.basic.username) {
        setHeader(
          "Authorization",
          `Basic ${btoa(`${localAuth.basic.username}:${localAuth.basic.password}`)}`,
        );
      }

      const params = mapToKVRecords(queryParams);
      if (
        localAuth.type === "apikey" &&
        localAuth.apiKeyName &&
        localAuth.apiKeyValue
      ) {
        if (localAuth.apiKeyLocation === "header")
          setHeader(localAuth.apiKeyName, localAuth.apiKeyValue);
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

      const assertionResults = assertions
        .filter((a) => a.enabled)
        .map((assertion): AssertionResult => {
          let passed = false;
          let actualValue = "";
          let message = "";

          if (assertion.type === "statusCode") {
            actualValue = String(response.status);
            passed = actualValue === assertion.expectedValue;
            message = `Status code is ${actualValue}`;
          } else if (assertion.type === "responseTime") {
            actualValue = `${durationMs}ms`;
            passed = durationMs <= Number(assertion.expectedValue);
            message = `Response time is ${durationMs}ms`;
          } else if (assertion.type === "bodyContains") {
            actualValue = "Check Body";
            passed = parsedResponse.raw.includes(assertion.expectedValue);
            message = passed ? "Body contains string" : "Body missing string";
          }

          return { assertionId: assertion.id, passed, actualValue, message };
        });

      const responseData: ApiResponseData = {
        status: response.status,
        statusText: response.statusText,
        durationMs,
        sizeBytes: toBytes(response.data, responseHeaders),
        headers: responseHeaders,
        bodyPretty: parsedResponse.pretty,
        bodyRaw: parsedResponse.raw,
        contentType: responseHeaders["content-type"] ?? "unknown",
        assertionResults,
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
        assertions,
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
    setAssertions(
      record.assertions?.map((item) => ({ ...item, id: uid() })) || [],
    );
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

  const deleteCollection = (id: string) => {
    setCollections((prev) => prev.filter((c) => c.id !== id));
    if (selectedCollectionId === id) setSelectedCollectionId("");
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

  const handleSaveRequest = () => {
    if (!saveName.trim()) {
      setNotification("Please enter a name to save this request.");
      return;
    }

    // Create a saved record without firing
    const item: ApiTestRecord = {
      id: uid(),
      name: saveName.trim(),
      favorite: false,
      collectionId: selectedCollectionId || undefined,
      createdAt: new Date().toISOString(),
      method,
      url,
      queryParams,
      headers,
      body,
      auth,
      assertions,
      thresholdBreached: false,
    };

    setHistory((prev) => [item, ...prev]);

    if (selectedCollectionId) {
      setCollections((prev) =>
        prev.map((c) =>
          c.id === selectedCollectionId
            ? { ...c, testIds: [...c.testIds, item.id] }
            : c,
        ),
      );
    }
    setNotification("Request saved!");
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

      const getType = (obj: unknown, indent = ""): string => {
        if (obj === null) return "null";
        if (Array.isArray(obj)) {
          if (obj.length === 0) return "any[]";
          const type = getType(obj[0], indent);
          return type.includes("{") ? `Array<${type}>` : `${type}[]`;
        }
        if (typeof obj === "object") {
          const props = Object.entries(obj as Record<string, unknown>)
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
    <div className="rounded-xl border border-[#262626] bg-[#0b0b0b] p-4">
      <p className={UI.label}>{title}</p>
      <p className="mt-2 text-xl font-semibold text-[#fafafa]">{value}</p>
    </div>
  );

  const renderRequestTab = () => {
    if (requestTab === "params") {
      return (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className={UI.surfaceSoft}>
            <div className="flex items-center justify-between border-b border-[#262626] px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-white">Path params</p>
                <p className="mt-0.5 text-[12px] text-[#8a8a8a]">
                  Replace <span className="font-mono text-[#cfcfcf]">:id</span>{" "}
                  style segments.
                </p>
              </div>
              <button
                className={`${UI.secondaryBtn} h-8 px-2 text-xs`}
                onClick={() => setUrlParams((prev) => [...prev, makeKV()])}
              >
                <Plus size={14} />
                Add
              </button>
            </div>
            <div className="p-4">
              {urlParams.map((item) => (
                <div
                  key={item.id}
                  className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2"
                >
                  <input
                    className={UI.inputSm}
                    value={item.key}
                    placeholder="id"
                    onChange={(e) =>
                      updateList(setUrlParams, item.id, "key", e.target.value)
                    }
                  />
                  <input
                    className={UI.inputSm}
                    value={item.value}
                    placeholder="123"
                    onChange={(e) =>
                      updateList(setUrlParams, item.id, "value", e.target.value)
                    }
                  />
                  <button
                    className={UI.iconBtn}
                    onClick={() =>
                      setUrlParams((prev) =>
                        prev.filter((p) => p.id !== item.id),
                      )
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className={UI.surfaceSoft}>
            <div className="flex items-center justify-between border-b border-[#262626] px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-white">Query params</p>
                <p className="mt-0.5 text-[12px] text-[#8a8a8a]">
                  Appended to the URL after{" "}
                  <span className="font-mono text-[#cfcfcf]">?</span>.
                </p>
              </div>
              <button
                className={`${UI.secondaryBtn} h-8 px-2 text-xs`}
                onClick={() => setQueryParams((prev) => [...prev, makeKV()])}
              >
                <Plus size={14} />
                Add
              </button>
            </div>
            <div className="p-4">
              {queryParams.map((item) => (
                <div
                  key={item.id}
                  className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2"
                >
                  <input
                    className={UI.inputSm}
                    value={item.key}
                    placeholder="limit"
                    onChange={(e) =>
                      updateList(setQueryParams, item.id, "key", e.target.value)
                    }
                  />
                  <input
                    className={UI.inputSm}
                    value={item.value}
                    placeholder="10"
                    onChange={(e) =>
                      updateList(
                        setQueryParams,
                        item.id,
                        "value",
                        e.target.value,
                      )
                    }
                  />
                  <button
                    className={UI.iconBtn}
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
            </div>
          </div>
        </div>
      );
    }

    if (requestTab === "headers") {
      return (
        <div className={UI.surfaceSoft}>
          <div className="flex items-center justify-between border-b border-[#262626] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-white">Headers</p>
              <p className="mt-0.5 text-[12px] text-[#8a8a8a]">
                Sent with your request. Common:{" "}
                <span className="font-mono text-[#cfcfcf]">Content-Type</span>
              </p>
            </div>
            <button
              className={`${UI.secondaryBtn} h-8 px-2 text-xs`}
              onClick={() => setHeaders((prev) => [...prev, makeKV()])}
            >
              <Plus size={14} />
              Add
            </button>
          </div>
          <div className="p-4">
            {headers.map((item) => (
              <div
                key={item.id}
                className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2"
              >
                <input
                  className={UI.inputSm}
                  value={item.key}
                  placeholder="Content-Type"
                  onChange={(e) =>
                    updateList(setHeaders, item.id, "key", e.target.value)
                  }
                />
                <input
                  className={UI.inputSm}
                  value={item.value}
                  placeholder="application/json"
                  onChange={(e) =>
                    updateList(setHeaders, item.id, "value", e.target.value)
                  }
                />
                <button
                  className={UI.iconBtn}
                  onClick={() =>
                    setHeaders((prev) => prev.filter((p) => p.id !== item.id))
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (requestTab === "auth") {
      return (
        <div className={`${UI.surfaceSoft} max-w-2xl`}>
          <div className="border-b border-[#262626] px-4 py-3">
            <p className="text-sm font-semibold text-white">Authorization</p>
            <p className="mt-0.5 text-[12px] text-[#8a8a8a]">
              Pick a strategy; we’ll attach the right header/query
              automatically.
            </p>
          </div>
          <div className="p-4 space-y-3">
            <select
              className={UI.input}
              value={auth.type}
              onChange={(e) =>
                setAuth((prev) => ({
                  ...prev,
                  type: e.target.value as AuthType,
                }))
              }
            >
              <option value="none">No Auth</option>
              <option value="bearer">Bearer Token</option>
              <option value="apikey">API Key</option>
              <option value="basic">Basic Auth</option>
            </select>
            {auth.type === "bearer" && (
              <input
                className={UI.input}
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
                  className={UI.input}
                  placeholder="API key name"
                  value={auth.apiKeyName}
                  onChange={(e) =>
                    setAuth((prev) => ({ ...prev, apiKeyName: e.target.value }))
                  }
                />
                <input
                  className={UI.input}
                  placeholder="API key value"
                  value={auth.apiKeyValue}
                  onChange={(e) =>
                    setAuth((prev) => ({
                      ...prev,
                      apiKeyValue: e.target.value,
                    }))
                  }
                />
                <select
                  className={UI.input}
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
                  className={UI.input}
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
                  className={UI.input}
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
        </div>
      );
    }

    if (requestTab === "tests") {
      return (
        <div className={UI.surfaceSoft}>
          <div className="flex items-center justify-between border-b border-[#262626] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-white">Assertions</p>
              <p className="mt-0.5 text-[12px] text-[#8a8a8a]">
                Validate responses automatically after sending.
              </p>
            </div>
            <button
              className={`${UI.secondaryBtn} h-8 px-2 text-xs`}
              onClick={() =>
                setAssertions((prev) => [
                  ...prev,
                  {
                    id: uid(),
                    type: "statusCode",
                    expectedValue: "200",
                    enabled: true,
                  },
                ])
              }
            >
              <Plus size={14} />
              Add
            </button>
          </div>
          <div className="p-4 space-y-4">
            {assertions.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2 mb-2"
              >
                <input
                  type="checkbox"
                  checked={item.enabled}
                  onChange={(e) =>
                    setAssertions((prev) =>
                      prev.map((a) =>
                        a.id === item.id
                          ? { ...a, enabled: e.target.checked }
                          : a,
                      ),
                    )
                  }
                  className="w-4 h-4"
                />
                <select
                  className={UI.inputSm}
                  value={item.type}
                  onChange={(e) =>
                    setAssertions((prev) =>
                      prev.map((a) =>
                        a.id === item.id
                          ? { ...a, type: e.target.value as AssertionType }
                          : a,
                      ),
                    )
                  }
                >
                  <option value="statusCode">Status Code Equals</option>
                  <option value="responseTime">
                    Response Time Less Than (ms)
                  </option>
                  <option value="bodyContains">Body Contains String</option>
                </select>
                <input
                  className={UI.inputSm}
                  value={item.expectedValue}
                  placeholder={
                    item.type === "statusCode"
                      ? "200"
                      : item.type === "responseTime"
                        ? "300"
                        : "error"
                  }
                  onChange={(e) =>
                    setAssertions((prev) =>
                      prev.map((a) =>
                        a.id === item.id
                          ? { ...a, expectedValue: e.target.value }
                          : a,
                      ),
                    )
                  }
                />
                <button
                  className={`${UI.iconBtn} text-[#f87171] hover:text-[#fecaca]`}
                  onClick={() =>
                    setAssertions((prev) =>
                      prev.filter((a) => a.id !== item.id),
                    )
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {assertions.length === 0 && (
              <div className="rounded-xl border border-[#262626] bg-[#0b0b0b] p-5">
                <p className="text-sm font-semibold text-white">
                  No assertions
                </p>
                <p className="mt-1 text-[13px] text-[#8a8a8a]">
                  Add one to check status codes, response time, or body content.
                </p>
              </div>
            )}
          </div>
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
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-white">cURL</p>
              <button
                onClick={() => copyToClipboard(curlCommand, "Copied cURL!")}
                className={`${UI.secondaryBtn} h-8 px-2 text-xs`}
              >
                <Copy size={14} />
                Copy
              </button>
            </div>
            <div className="relative rounded-xl border border-[#262626] bg-[#0b0b0b] p-3">
              <textarea
                readOnly
                value={curlCommand}
                className="h-44 w-full resize-none bg-transparent font-mono text-[13px] leading-6 text-[#e5e5e5] outline-none"
              />
            </div>
          </div>
        </div>
      );
    }

    if (requestTab === "body") {
      return (
        <div className={UI.surfaceSoft}>
          <div className="flex items-center justify-between border-b border-[#262626] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-white">Body</p>
              <p className="mt-0.5 text-[12px] text-[#8a8a8a]">
                JSON is auto-parsed when possible.
              </p>
            </div>
            <button
              className={`${UI.secondaryBtn} h-8 px-2 text-xs`}
              onClick={() => setBody('{\n  "title": "foo"\n}')}
            >
              Reset
            </button>
          </div>
          <div className="p-4">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="h-64 w-full resize-none rounded-xl border border-[#262626] bg-[#0b0b0b] p-3 font-mono text-[13px] leading-6 text-[#e5e5e5] outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20"
            />
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className={UI.page}>
      <header className={UI.topbar}>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#2a2a2a] bg-[#0b0b0b] text-white">
              <BarChart3 size={16} />
            </div>
            <div className="leading-tight">
              <h1 className="text-[13px] font-semibold text-white">
                API Monitor
              </h1>
              <p className="text-[11px] text-[#8a8a8a]">
                Requests • History • Dashboard
              </p>
            </div>
          </div>
          <div className="ml-2 inline-flex items-center gap-1 rounded-lg border border-[#262626] bg-[#0b0b0b] p-1">
            <button
              onClick={() => setActiveTab("request")}
              className={UI.tabPill(activeTab === "request")}
            >
              Request
            </button>
            <button
              onClick={() => setActiveTab("dashboard")}
              className={UI.tabPill(activeTab === "dashboard")}
            >
              Dashboard
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex w-72 items-center gap-2 rounded-md border border-[#2a2a2a] bg-[#0b0b0b] px-3 py-1.5 focus-within:border-[#3b82f6] focus-within:ring-2 focus-within:ring-[#3b82f6]/20">
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
              className={UI.iconBtn}
              title="Export History"
            >
              <Download size={16} />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className={UI.iconBtn}
              title="Settings"
            >
              <Settings size={16} />
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="flex w-[280px] flex-col border-r border-[#262626] bg-[#121212]">
          <div className="flex h-full flex-col overflow-y-auto">
            <div className="p-4 border-b border-[#262626]">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#888]">
                  Collections
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={exportCollections}
                    className="text-[#a3a3a3] hover:text-white transition-colors"
                    title="Export Collections"
                  >
                    <Download size={12} />
                  </button>
                  <label
                    className="cursor-pointer text-[#a3a3a3] hover:text-white transition-colors"
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
                  className={`flex-1 ${UI.inputSm}`}
                />
                <button
                  onClick={createCollection}
                  className="rounded-md border border-[#2a2a2a] bg-[#141414] p-1 text-[#d4d4d4] hover:bg-[#1a1a1a] hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/30"
                >
                  <Plus size={14} />
                </button>
              </div>
              <div className="space-y-0.5">
                {collections.length === 0 && (
                  <div className="rounded-md border border-[#262626] bg-[#0b0b0b] p-3">
                    <p className="text-[12px] text-[#bdbdbd]">
                      No collections yet.
                    </p>
                    <p className="mt-1 text-[12px] text-[#7a7a7a]">
                      Create one to group and run requests together.
                    </p>
                  </div>
                )}
                {collections.map((c) => {
                  const collectionTests = history.filter(
                    (h) => c.testIds.includes(h.id) || h.collectionId === c.id,
                  );
                  const isSelected = selectedCollectionId === c.id;

                  return (
                    <div key={c.id} className="flex flex-col gap-0.5">
                      <div
                        className={`group flex items-center justify-between rounded-md p-1.5 transition-colors cursor-pointer ${isSelected ? "bg-[#262626]" : "hover:bg-[#1a1a1a]"}`}
                        onClick={() =>
                          setSelectedCollectionId(isSelected ? "" : c.id)
                        }
                      >
                        <div className="flex min-w-0 items-center gap-2 text-[13px] text-[#ccc] group-hover:text-white">
                          <Folder
                            size={14}
                            className={
                              isSelected
                                ? "fill-[#888] text-[#888]"
                                : "text-[#888]"
                            }
                          />
                          <span className="truncate">
                            {c.name}{" "}
                            <span className="text-[10px] text-[#666]">
                              ({collectionTests.length})
                            </span>
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            className="text-[10px] text-[#a3a3a3] opacity-0 group-hover:opacity-100 hover:text-white uppercase font-bold rounded px-2 py-1 hover:bg-[#1f1f1f] transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              runCollection(c.id);
                            }}
                          >
                            Run
                          </button>
                          <button
                            className="text-[#a3a3a3] opacity-0 group-hover:opacity-100 hover:text-red-400 rounded p-1 hover:bg-[#1f1f1f] transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteCollection(c.id);
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>

                      {/* Show items inside collection if opened */}
                      {isSelected && collectionTests.length > 0 && (
                        <div className="flex flex-col gap-0.5 pl-4 py-1 border-l border-[#333] ml-2 mt-1">
                          {collectionTests.map((t) => (
                            <div
                              key={t.id}
                              className="group relative flex items-center justify-between rounded-md p-1.5 hover:bg-[#262626]"
                            >
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  duplicateTest(t);
                                }}
                                className="flex items-center gap-2 min-w-0 flex-1 text-left"
                              >
                                <span
                                  className="text-[9px] font-bold w-8 shrink-0 tracking-wider"
                                  style={{ color: METHOD_COLORS[t.method] }}
                                >
                                  {t.method}
                                </span>
                                <span className="truncate text-[12px] text-[#bbb] group-hover:text-white">
                                  {t.name}
                                </span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeHistory(t.id);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1 text-[#666] hover:text-red-400 transition-colors"
                                title="Delete from history"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
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
                {filteredHistory.length === 0 && (
                  <div className="rounded-md border border-[#262626] bg-[#0b0b0b] p-3">
                    <p className="text-[12px] text-[#bdbdbd]">
                      No history to show.
                    </p>
                    <p className="mt-1 text-[12px] text-[#7a7a7a]">
                      Send a request to start building history.
                    </p>
                  </div>
                )}
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
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 pl-2">
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
        <main className="flex flex-1 flex-col overflow-hidden bg-[#0b0b0b]">
          {activeTab === "request" ? (
            <div className="flex h-full flex-col">
              {/* URL/Method Bar */}
              <div className="border-b border-[#262626] bg-[#121212] p-4">
                <div className="flex items-center gap-3">
                  <div className="flex flex-1 items-center rounded-xl border border-[#2a2a2a] bg-[#0b0b0b] focus-within:border-[#3b82f6] focus-within:ring-2 focus-within:ring-[#3b82f6]/20">
                    <select
                      className="h-10 rounded-l-xl border-r border-[#2a2a2a] bg-transparent px-3 text-[13px] font-bold outline-none cursor-pointer hover:bg-[#121212] focus:bg-[#121212]"
                      style={{ color: METHOD_COLORS[method] || "#fff" }}
                      value={method}
                      onChange={(e) => setMethod(e.target.value as HttpMethod)}
                    >
                      <option
                        value="GET"
                        className="bg-[#1a1a1a]"
                        style={{ color: METHOD_COLORS.GET }}
                      >
                        GET
                      </option>
                      <option
                        value="POST"
                        className="bg-[#1a1a1a]"
                        style={{ color: METHOD_COLORS.POST }}
                      >
                        POST
                      </option>
                      <option
                        value="PUT"
                        className="bg-[#1a1a1a]"
                        style={{ color: METHOD_COLORS.PUT }}
                      >
                        PUT
                      </option>
                      <option
                        value="DELETE"
                        className="bg-[#1a1a1a]"
                        style={{ color: METHOD_COLORS.DELETE }}
                      >
                        DELETE
                      </option>
                      <option
                        value="PATCH"
                        className="bg-[#1a1a1a]"
                        style={{ color: METHOD_COLORS.PATCH }}
                      >
                        PATCH
                      </option>
                    </select>
                    <input
                      className="h-10 flex-1 bg-transparent px-3 text-[13px] text-white outline-none placeholder:text-[#6b6b6b]"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                          sendRequest();
                        }
                      }}
                      placeholder="Enter request URL"
                    />
                  </div>
                  <button
                    onClick={() => sendRequest()}
                    disabled={loading}
                    className={`${UI.primaryBtn} h-10 px-6 shadow-[0_8px_24px_rgba(37,99,235,0.18)] active:scale-[0.99]`}
                  >
                    {loading ? (
                      <Clock3 size={14} className="animate-spin" />
                    ) : (
                      <Send size={14} />
                    )}
                    <span>{loading ? "Sending..." : "Send"}</span>
                  </button>
                  <div className="flex h-10 items-center gap-2 rounded-xl border border-[#2a2a2a] bg-[#0b0b0b] px-2">
                    <input
                      value={saveName}
                      onChange={(e) => setSaveName(e.target.value)}
                      placeholder="Request name"
                      className="w-32 bg-transparent text-[13px] outline-none px-2"
                    />
                    <div className="h-5 w-px bg-[#2a2a2a]"></div>
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
                      onClick={handleSaveRequest}
                      className="rounded px-2 py-1 text-[11px] font-bold uppercase text-[#a3a3a3] hover:bg-[#121212] hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/30"
                    >
                      Save
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[12px] text-[#8a8a8a]">
                    <span className={UI.chip}>{method}</span>
                    <span className="truncate max-w-[55vw]">{resolvedUrl}</span>
                    <span className="hidden sm:inline text-[#5f5f5f]">
                      Ctrl+Enter to send
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {favorites.length > 0 && (
                      <span className="text-[12px] text-[#a3a3a3]">
                        Favorites:{" "}
                        <span className="text-white">{favorites.length}</span>
                      </span>
                    )}
                    {alertCount > 0 && (
                      <span className="text-[12px] text-[#a3a3a3]">
                        Alerts: <span className="text-white">{alertCount}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-1 flex-col overflow-hidden border-b border-[#262626]">
                <div className="border-b border-[#262626] bg-[#121212] px-4 py-2">
                  <div className="inline-flex items-center gap-1 rounded-lg border border-[#262626] bg-[#0b0b0b] p-1">
                    {(
                      [
                        "params",
                        "headers",
                        "auth",
                        "body",
                        "snippets",
                        "tests",
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setRequestTab(tab as typeof requestTab)}
                        className={UI.tabPill(requestTab === tab)}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto bg-[#0b0b0b] p-4">
                  {renderRequestTab()}
                </div>
              </div>

              {/* Response Section */}
              <div className="flex flex-1 flex-col overflow-hidden bg-[#121212]">
                <div className="flex shrink-0 items-center justify-between border-b border-[#262626] px-4 py-2">
                  <div className="inline-flex items-center gap-1 rounded-lg border border-[#262626] bg-[#0b0b0b] p-1">
                    {(["body", "headers", "raw", "tests"] as ResponseTab[]).map(
                      (tab) => (
                        <button
                          key={tab}
                          onClick={() => setResponseTab(tab)}
                          className={`${UI.tabPill(responseTab === tab)} flex items-center gap-1`}
                        >
                          {tab}
                          {tab === "tests" &&
                            latestResponse?.assertionResults &&
                            latestResponse.assertionResults.length > 0 && (
                              <span
                                className={`text-[10px] px-1.5 rounded-full ${latestResponse.assertionResults.every((a) => a.passed) ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}
                              >
                                {
                                  latestResponse.assertionResults.filter(
                                    (a) => a.passed,
                                  ).length
                                }
                                /{latestResponse.assertionResults.length}
                              </span>
                            )}
                        </button>
                      ),
                    )}
                  </div>
                  {latestResponse && (
                    <div className="flex items-center gap-2">
                      <span
                        className={UI.chip}
                        style={{
                          color: statusColor(latestResponse.status),
                        }}
                      >
                        {latestResponse.status} {latestResponse.statusText}
                      </span>
                      <span className={UI.chip}>
                        {latestResponse.durationMs}ms
                      </span>
                      <span className={UI.chip}>
                        {formatBytes(latestResponse.sizeBytes)}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex-1 overflow-auto bg-[#0b0b0b] relative group">
                  {!latestResponse ? (
                    <div className="flex h-full items-center justify-center p-8">
                      <div className="w-full max-w-md rounded-xl border border-[#262626] bg-[#0b0b0b] p-6 text-center">
                        <p className="text-sm font-semibold text-white">
                          No response yet
                        </p>
                        <p className="mt-2 text-[13px] text-[#8a8a8a]">
                          Enter a URL, choose a method, then hit{" "}
                          <span className="text-white">Send</span>.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#262626] bg-[#0b0b0b]/95 px-4 py-2 backdrop-blur">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setWrapResponse((v) => !v)}
                            className={`${UI.secondaryBtn} h-8 px-2 text-xs`}
                            title="Toggle line wrapping"
                          >
                            {wrapResponse ? "Wrap: On" : "Wrap: Off"}
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          {responseTab === "body" &&
                            (latestResponse.bodyRaw.trim().startsWith("{") ||
                              latestResponse.bodyRaw
                                .trim()
                                .startsWith("[")) && (
                              <button
                                onClick={generateTypescript}
                                className={`${UI.secondaryBtn} h-8 px-2 text-xs`}
                              >
                                <Copy size={14} />
                                Copy TS
                              </button>
                            )}
                          <button
                            onClick={() => {
                              const text =
                                responseTab === "body"
                                  ? latestResponse.bodyPretty
                                  : responseTab === "headers"
                                    ? Object.entries(latestResponse.headers)
                                        .map(([k, v]) => `${k}: ${v}`)
                                        .join("\n")
                                    : responseTab === "raw"
                                      ? latestResponse.bodyRaw
                                      : "";
                              if (!text) return;
                              copyToClipboard(
                                text,
                                "Copied response to clipboard!",
                              );
                            }}
                            className={`${UI.secondaryBtn} h-8 px-2 text-xs`}
                            title="Copy current tab"
                          >
                            <Copy size={14} />
                            Copy
                          </button>
                        </div>
                      </div>
                      {responseTab === "tests" ? (
                        <div className="p-4 space-y-4">
                          {!latestResponse.assertionResults ||
                          latestResponse.assertionResults.length === 0 ? (
                            <p className="text-[#888] text-[13px]">
                              No assertions configured for this request. Add
                              some from the Request &gt; Tests tab.
                            </p>
                          ) : (
                            latestResponse.assertionResults.map((result) => (
                              <div
                                key={result.assertionId}
                                className={`p-4 rounded-xl border ${result.passed ? "bg-[#0b0b0b] border-[#1f3d2e]" : "bg-[#0b0b0b] border-[#3a1f1f]"}`}
                              >
                                <div className="flex items-center gap-2 mb-2">
                                  {result.passed ? (
                                    <span className="text-[#34d399] font-semibold">
                                      ✓ Passed
                                    </span>
                                  ) : (
                                    <span className="text-[#f87171] font-semibold">
                                      ✗ Failed
                                    </span>
                                  )}
                                </div>
                                <p className="text-[#ccc] text-[13px]">
                                  {result.message}
                                </p>
                              </div>
                            ))
                          )}
                        </div>
                      ) : (
                        <div className="p-4">
                          <div className="rounded-2xl border border-[#262626] bg-[#0f0f0f] shadow-[0_10px_30px_rgba(0,0,0,0.35)] overflow-hidden">
                            {responseTab === "body" &&
                            latestResponse.bodyPretty ? (
                              <SyntaxHighlighter
                                language="json"
                                style={vscDarkPlus}
                                customStyle={{
                                  margin: 0,
                                  padding: "1rem",
                                  fontSize: "13px",
                                  background: "transparent",
                                }}
                                wrapLines={wrapResponse}
                                wrapLongLines={wrapResponse}
                              >
                                {latestResponse.bodyPretty}
                              </SyntaxHighlighter>
                            ) : (
                              <pre
                                className={`p-4 font-mono text-[13px] leading-6 text-[#e5e5e5] ${
                                  wrapResponse
                                    ? "whitespace-pre-wrap"
                                    : "whitespace-pre"
                                }`}
                              >
                                {responseTab === "headers"
                                  ? Object.entries(latestResponse.headers)
                                      .map(([k, v]) => `${k}: ${v}`)
                                      .join("\n")
                                  : latestResponse.bodyRaw}
                              </pre>
                            )}
                          </div>
                        </div>
                      )}
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
                  <div className="flex items-center gap-2 rounded-md border border-[#2a2a2a] bg-[#0b0b0b] p-1">
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
                        className="rounded-md border border-[#2a2a2a] bg-[#0b0b0b] px-2 py-1 text-[13px] text-white outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20"
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
                        className="rounded-md border border-[#2a2a2a] bg-[#0b0b0b] px-2 py-1 text-[13px] text-white outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20"
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
          <div className="w-full max-w-lg rounded-2xl border border-[#2a2a2a] bg-[#121212] p-6 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                Threshold Settings
              </h2>
              <button
                className={UI.iconBtn}
                onClick={() => setShowSettings(false)}
                aria-label="Close settings"
              >
                <X size={16} />
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
                    className="rounded-md border border-[#2a2a2a] bg-[#0b0b0b] px-3 py-1.5 text-sm text-white outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20"
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
                    className="rounded-md border border-[#2a2a2a] bg-[#0b0b0b] px-3 py-1.5 text-sm text-white outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20"
                    value={ms}
                    onChange={(e) =>
                      setThresholds((prev) => ({
                        ...prev,
                        [endpoint]: Number(e.target.value || 0),
                      }))
                    }
                  />
                  <button
                    className="rounded-md p-2 text-[#a3a3a3] transition-colors hover:bg-[#1f1f1f] hover:text-[#f87171] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/30"
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
              className="mt-6 inline-flex items-center justify-center rounded-md border border-[#2a2a2a] bg-[#141414] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a1a1a] transition-colors focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/30"
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
