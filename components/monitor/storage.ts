import { STORAGE_KEY } from "@/components/monitor/constants";
import { StorageShape } from "@/components/monitor/types";

export const readStorage = (): StorageShape => {
  if (typeof window === "undefined") {
    return { history: [], collections: [], thresholds: {} };
  }
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

export const writeStorage = (value: StorageShape) => {
  if (typeof window === "undefined") return;
  const storage = window.storage ?? window.localStorage;
  storage.setItem(STORAGE_KEY, JSON.stringify(value));
};
