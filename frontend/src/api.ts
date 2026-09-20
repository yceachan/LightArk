import { openDB } from "idb";
export type KB = { id: string; name: string; created: number };
export type Entry = {
  id: string;
  kb: string;
  path: string;
  kind: "file" | "folder";
  format: string;
  size: number;
  version: number;
  updated: number;
};
export type Comment = {
  id: string;
  page: number;
  x: number;
  y: number;
  text: string;
  created: number;
  version: number;
};
export type Draft = {
  id: string;
  kb: string;
  path: string;
  version: number;
  text: string;
  updated: number;
};
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function request<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch("/api" + url, {
    ...options,
    headers: {
      "x-folio-request": "1",
      ...(options.body && typeof options.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    let msg = "请求失败";
    try {
      msg = (await res.json()).error;
    } catch {}
    throw new ApiError(res.status, msg);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}
export const contentURL = (e: Entry) =>
  `/api/entries/${e.id}/content?v=${e.version}`;
export async function readBlob(e: Entry) {
  const r = await fetch(contentURL(e));
  if (!r.ok)
    throw new ApiError(
      r.status,
      r.status === 503
        ? "这份文件尚未缓存，请联网后打开"
        : "文件读取失败，请刷新目录",
    );
  return r.blob();
}
export async function upload(
  kb: string,
  path: string,
  body: Blob,
  version?: number,
  expectedId?: string,
) {
  return request<Entry>(`/kbs/${kb}/files?path=${encodeURIComponent(path)}`, {
    method: "PUT",
    body,
    headers: {
      "If-Match": version ? `"${version}"` : "*",
      ...(expectedId ? { "x-folio-entry": expectedId } : {}),
    },
  });
}
const db = openDB("folio-local", 1, {
  upgrade(d) {
    d.createObjectStore("drafts", { keyPath: "id" });
  },
});
export const drafts = {
  get: async (id: string): Promise<Draft | undefined> =>
    (await db).get("drafts", id),
  put: async (d: Draft) => (await db).put("drafts", d),
  remove: async (id: string) => (await db).delete("drafts", id),
  all: async (): Promise<Draft[]> => (await db).getAll("drafts"),
  clear: async () => (await db).clear("drafts"),
};
export async function clearPrivateData() {
  for (const key of await caches.keys()) {
    if (key.startsWith("folio-data")) await caches.delete(key);
  }
  await drafts.clear();
  localStorage.removeItem("folio-unlocked");
  localStorage.removeItem("folio-kb");
}
export async function download(url: string, name: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("导出失败，请检查网络连接");
  saveBlob(await r.blob(), name);
}
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export const leaf = (path: string) => path.split("/").pop() || path;
export const sizeLabel = (size: number) =>
  size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${(size / 1024).toFixed(1)} KB`
      : `${(size / 1024 / 1024).toFixed(1)} MB`;
