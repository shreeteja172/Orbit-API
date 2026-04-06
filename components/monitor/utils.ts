import { KVPair } from "@/components/monitor/types";

export const statusColor = (status?: number) => {
  if (!status) return "#707070";
  if (status >= 200 && status < 300) return "#00e676";
  if (status >= 300 && status < 400) return "#fbbf24";
  return "#ff4444";
};

export const uid = () => crypto.randomUUID();
export const makeKV = (): KVPair => ({ id: uid(), key: "", value: "", enabled: true });

export const safeParseBody = (body: unknown): { pretty: string; raw: string } => {
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

export const toBytes = (data: unknown, headers?: Record<string, string>) => {
  const lengthHeader = headers?.["content-length"];
  if (lengthHeader && !Number.isNaN(Number(lengthHeader))) return Number(lengthHeader);
  return new Blob([typeof data === "string" ? data : JSON.stringify(data ?? "")]).size;
};

export const formatBytes = (size: number) => {
  if (size < 1024) return `${size} B`;
  return `${(size / 1024).toFixed(2)} KB`;
};

export const mapToKVRecords = (items: KVPair[]) =>
  items.reduce<Record<string, string>>((acc, item) => {
    if (item.enabled && item.key.trim()) acc[item.key.trim()] = item.value;
    return acc;
  }, {});
