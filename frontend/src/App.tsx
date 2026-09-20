import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  BookOpen,
  Folder,
  FolderOpen,
  FileText,
  FileCode2,
  File,
  Search,
  Plus,
  ChevronRight,
  ChevronDown,
  PanelLeft,
  PanelRight,
  Upload,
  Download,
  MoreHorizontal,
  X,
  Check,
  ArrowUpRight,
  ArrowLeft,
  Sun,
  Moon,
  Cloud,
  CloudOff,
  RefreshCw,
  Settings2,
  List,
  MessageSquare,
  GripVertical,
  FolderPlus,
  Code2,
  Columns2,
  Eye,
  Save,
  Trash2,
  Pencil,
  LogOut,
  HardDrive,
  Keyboard,
  Menu,
  ArrowDownToLine,
  CheckCircle2,
  Link2,
} from "lucide-react";
import {
  request,
  ApiError,
  upload,
  readBlob,
  contentURL,
  drafts,
  download,
  saveBlob,
  clearPrivateData,
  leaf,
  sizeLabel,
  type KB,
  type Entry,
  type Comment,
} from "./api";
import { Markdown, PdfReader, HtmlReader, DocxReader } from "./Readers";
import type { RenderResult } from "./markdown";

type Dock = "left" | "right" | "bottom";
type Panel = "explorer" | "inspector";
type Layout = {
  explorer: Dock;
  inspector: Dock;
  left: number;
  right: number;
  bottom: number;
  showExplorer: boolean;
  showInspector: boolean;
};
const initialLayout: Layout = {
  explorer: "left",
  inspector: "right",
  left: 260,
  right: 250,
  bottom: 220,
  showExplorer: true,
  showInspector: true,
};
const welcome = `# 给知识一个安静的地方\n\n文档是思考留下的痕迹。Folio 把它们收在一起，让你随时回到自己的知识现场。\n\n> [!TIP]\n> 从左侧选择文件，或把你的第一份文档拖进来。你的文件，始终保持原来的样子。\n\n## 从文件出发\n\n这里的一切都从路径开始。项目、研究、阅读笔记，可以按你习惯的方式放进文件夹。\n\n| 格式 | 在这里，你可以 |\n| :--- | :--- |\n| Markdown | 阅读、编辑源码、实时预览 |\n| PDF | 按页阅读、添加位置批注 |\n| Word | 预览 DOCX 的分页内容 |\n| HTML | 运行自包含的交互文档 |\n\n## 少一点打断，多一点专注\n\n阅读区保留充足的留白。侧栏可以收起，面板可以拖动。按下 **⌘ / Ctrl + K** 找到文件，**⌘ / Ctrl + S** 保存修改。\n\n### 一个简单的工作流\n\n1. 为一个主题创建知识库\n2. 导入文件，用文件夹整理\n3. 打开需要的内容，边读边记\n4. 缓存整个知识库，带着它离线出发\n\n## 在不同设备间接着读\n\n所有文件保存在你自己的服务器上。电脑上展开工作台，平板上专注阅读，手机上随时查阅。\n\n已经访问的文件会逐步缓存。编辑草稿先存到本机；恢复网络后，点击「同步草稿」提交。远端有新版本时，会保留两边的内容供你处理。\n\n---\n\n*Keep what matters. Make room for thought.*\n`;
const sampleHtml = `<!doctype html><html lang="zh"><meta charset="utf-8"><style>body{background:#f4f0e8;color:#36302a;font-family:Georgia,serif;margin:0;padding:60px 8%}small{letter-spacing:3px;color:#a45d47}h1{font-size:48px;font-weight:400}button{background:#a45d47;color:white;border:0;border-radius:8px;padding:12px 20px;cursor:pointer}#number{font-size:80px;margin:30px 0}p{line-height:1.8}</style><small>AN INTERACTIVE NOTE</small><h1>让想法动起来。</h1><p>这是一个自包含的 HTML 文档。样式、脚本和内容一起保存。<br>试试点击下面的按钮。</p><div id="number">0</div><button onclick="document.getElementById('number').textContent=++window.count">记录一个想法 +</button><script>window.count=0</script></html>`;
function FileIcon({ format, size = 17 }: { format?: string; size?: number }) {
  return (
    <span className={"file-icon " + (format || "folder")}>
      {format === "md" ? (
        <FileText size={size} />
      ) : format === "html" ? (
        <FileCode2 size={size} />
      ) : format === "pdf" ? (
        <File size={size} />
      ) : format === "docx" ? (
        <FileText size={size} />
      ) : (
        <Folder size={size} />
      )}
    </span>
  );
}
function IconButton({
  label,
  children,
  onClick,
  active = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      className={"icon-button " + (active ? "active" : "")}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function useWindow() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const fn = () => setWidth(window.innerWidth);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return width;
}
function getLayout() {
  try {
    return {
      ...initialLayout,
      ...JSON.parse(localStorage.getItem("folio-layout") || "{}"),
    };
  } catch {
    return initialLayout;
  }
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(false),
    [checking, setChecking] = useState(true),
    [password, setPassword] = useState(""),
    [loginError, setLoginError] = useState("");
  const [kbs, setKbs] = useState<KB[]>([]),
    [kbId, setKbId] = useState(localStorage.getItem("folio-kb") || ""),
    [entries, setEntries] = useState<Entry[]>([]),
    [activeId, setActiveId] = useState(""),
    [folderPath, setFolderPath] = useState(""),
    [tabs, setTabs] = useState<string[]>([]);
  const [text, setText] = useState(""),
    [baseText, setBaseText] = useState(""),
    [baseVersion, setBaseVersion] = useState(0),
    [loading, setLoading] = useState(false),
    [readerError, setReaderError] = useState(""),
    [mode, setMode] = useState<"read" | "split" | "source">("read"),
    [saving, setSaving] = useState(false),
    [hasDraft, setHasDraft] = useState(false),
    [draftCount, setDraftCount] = useState(0),
    [conflict, setConflict] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]),
    [page, setPage] = useState(1),
    [pin, setPin] = useState<{ x: number; y: number } | null>(null),
    [commentText, setCommentText] = useState(""),
    [headings, setHeadings] = useState<RenderResult["headings"]>([]);
  const [online, setOnline] = useState(navigator.onLine),
    [toast, setToast] = useState(""),
    [layout, setLayout] = useState<Layout>(getLayout),
    [dragPanel, setDragPanel] = useState<Panel | null>(null),
    [drawer, setDrawer] = useState<Panel | null>(null),
    [more, setMore] = useState(false),
    [kbMenu, setKbMenu] = useState(false),
    [settings, setSettings] = useState(false),
    [search, setSearch] = useState<string | null>(null),
    [expanded, setExpanded] = useState<Set<string>>(new Set()),
    [dark, setDark] = useState(localStorage.getItem("folio-theme") === "dark"),
    [cacheProgress, setCacheProgress] = useState(""),
    [cacheStats, setCacheStats] = useState(""),
    [installEvent, setInstallEvent] = useState<any>(null),
    [updateWorker, setUpdateWorker] = useState<ServiceWorker | null>(null);
  const [dialog, setDialog] = useState<{
    title: string;
    description?: string;
    value: string;
    danger?: boolean;
    resolve: (v: string | null) => void;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null),
    replaceInput = useRef<HTMLInputElement>(null),
    searchInput = useRef<HTMLInputElement>(null),
    editor = useRef<HTMLTextAreaElement>(null),
    saveRef = useRef<() => void>(() => {}),
    toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined),
    fetchGeneration = useRef(0);
  const width = useWindow(),
    mobile = width < 700,
    compact = width < 1100;
  const selected = entries.find((e) => e.id === activeId),
    kb = kbs.find((k) => k.id === kbId),
    dirty = text !== baseText || hasDraft;
  function notify(s: string) {
    setToast(s);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 5500);
  }
  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function ask(
    title: string,
    value = "",
    description?: string,
    danger = false,
  ) {
    return new Promise<string | null>((resolve) =>
      setDialog({ title, value, description, danger, resolve }),
    );
  }
  function closeDialog(value: string | null) {
    dialog?.resolve(value);
    setDialog(null);
  }
  async function refreshKbs() {
    const list = await request<KB[]>("/kbs");
    setKbs(list);
    setKbId((id) => (list.some((k) => k.id === id) ? id : list[0]?.id || ""));
  }
  async function refreshEntries() {
    if (!kbId) return;
    const id = kbId,
      generation = ++fetchGeneration.current;
    const list = await request<Entry[]>(`/kbs/${id}/entries`);
    if (generation === fetchGeneration.current) setEntries(list);
  }
  async function refreshDrafts() {
    setDraftCount((await drafts.all()).length);
  }
  useEffect(() => {
    request("/session")
      .then(() => {
        setAuthenticated(true);
        localStorage.setItem("folio-unlocked", "1");
      })
      .catch((e) => {
        if (
          !(e instanceof ApiError) &&
          localStorage.getItem("folio-unlocked")
        ) {
          setAuthenticated(true);
          setOnline(false);
        }
      })
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    const on = () => {
        setOnline(true);
        notify("已恢复网络，本地草稿可手动同步");
      },
      off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const install = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e);
    };
    window.addEventListener("beforeinstallprompt", install);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("beforeinstallprompt", install);
    };
  }, []);
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    let canceled = false;
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      if (canceled) return;
      if (reg.waiting) setUpdateWorker(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        worker?.addEventListener("statechange", () => {
          if (
            worker.state === "installed" &&
            navigator.serviceWorker.controller
          )
            setUpdateWorker(worker);
        });
      });
    });
    return () => {
      canceled = true;
    };
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("folio-theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    localStorage.setItem("folio-layout", JSON.stringify(layout));
  }, [layout]);
  useEffect(() => {
    if (authenticated) {
      run(refreshKbs);
      run(refreshDrafts);
    }
  }, [authenticated]);
  useEffect(() => {
    if (!authenticated) return;
    localStorage.setItem("folio-kb", kbId);
    setEntries([]);
    setActiveId("");
    setFolderPath("");
    setTabs([]);
    setExpanded(new Set());
    if (!kbId) return;
    run(refreshEntries);
    const timer = setInterval(() => {
      if (navigator.onLine) refreshEntries().catch(() => {});
    }, 15000);
    const visibility = () => {
      if (document.visibilityState === "visible")
        refreshEntries().catch(() => {});
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      fetchGeneration.current++;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [kbId, authenticated]);
  useEffect(() => {
    let alive = true;
    setHeadings([]);
    setComments([]);
    setPin(null);
    setPage(1);
    setReaderError("");
    setConflict(false);
    setHasDraft(false);
    setText("");
    setBaseText("");
    if (!selected || selected.kind === "folder") return;
    if (selected.format === "md") {
      setLoading(true);
      (async () => {
        const d = await drafts.get(selected.id);
        let remote = "";
        try {
          remote = await (await readBlob(selected)).text();
        } catch (e) {
          if (!d) throw e;
          setReaderError("正在读取本地草稿；原文件暂时无法获取");
        }
        if (alive) {
          setText(d?.text ?? remote);
          setBaseText(remote);
          setBaseVersion(d?.version ?? selected.version);
          setHasDraft(!!d);
          setConflict(!!d && d.version !== selected.version);
          if (d) setMode("split");
        }
      })()
        .catch((e) => {
          if (alive) setReaderError(e.message);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    } else if (selected.format === "pdf") {
      request<Comment[]>(`/entries/${selected.id}/comments`)
        .then((c) => {
          if (alive) setComments(c);
        })
        .catch((e) => {
          if (alive) notify(e.message);
        });
    }
    return () => {
      alive = false;
    };
  }, [selected?.id, selected?.version]);
  useEffect(() => {
    if (!selected || selected.format !== "pdf") return;
    let alive = true;
    const refresh = () => {
      if (navigator.onLine)
        request<Comment[]>(`/entries/${selected.id}/comments`)
          .then((c) => {
            if (alive) setComments(c);
          })
          .catch(() => {});
    };
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [selected?.id, selected?.version]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch("");
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
      if (e.key === "Escape") {
        setSearch(null);
        setDrawer(null);
        setMore(false);
        setKbMenu(false);
        setSettings(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (search !== null) setTimeout(() => searchInput.current?.focus(), 30);
  }, [search !== null]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    setChecking(true);
    try {
      await request("/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setAuthenticated(true);
      localStorage.setItem("folio-unlocked", "1");
      setPassword("");
    } catch (e) {
      setLoginError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }
  function open(e: Entry) {
    setMode("read");
    if (e.kind === "folder") {
      setActiveId("");
      setFolderPath(e.path);
      setExpanded((old) => new Set([...old, e.path]));
    } else {
      setActiveId(e.id);
      setFolderPath(
        e.path.includes("/") ? e.path.slice(0, e.path.lastIndexOf("/")) : "",
      );
      setTabs((t) => (t.includes(e.id) ? t : [...t, e.id]));
    }
    setDrawer(null);
    setSearch(null);
    setMore(false);
  }
  function openPath(path: string) {
    const base = selected?.path.split("/").slice(0, -1) || [];
    const [file, hash] = path.split("#");
    for (const part of decodeURIComponent(file).split("/")) {
      if (part === "..") base.pop();
      else if (part && part !== ".") base.push(part);
    }
    const e = entries.find((e) => e.path === base.join("/"));
    if (e) open(e);
    else notify("知识库中没有找到这个文件");
    if (hash)
      setTimeout(() => document.getElementById(hash)?.scrollIntoView(), 500);
  }
  async function edit(value: string) {
    setText(value);
    setHasDraft(true);
    if (selected)
      try {
        await drafts.put({
          id: selected.id,
          kb: selected.kb,
          path: selected.path,
          version: baseVersion,
          text: value,
          updated: Date.now(),
        });
        await refreshDrafts();
      } catch {
        notify("本地空间不足，草稿未能保存，请立即下载副本");
      }
  }
  async function save() {
    if (!selected || selected.format !== "md" || saving || loading) return;
    setSaving(true);
    try {
      await drafts.put({
        id: selected.id,
        kb: selected.kb,
        path: selected.path,
        version: baseVersion,
        text,
        updated: Date.now(),
      });
      if (!navigator.onLine) {
        notify("草稿已保存在本机，联网后可同步");
        await refreshDrafts();
        return;
      }
      const current = await upload(
        selected.kb,
        selected.path,
        new Blob([text], { type: "text/markdown" }),
        baseVersion,
        selected.id,
      );
      await drafts.remove(selected.id);
      setHasDraft(false);
      setBaseText(text);
      setBaseVersion(current.version);
      setEntries((es) => es.map((e) => (e.id === current.id ? current : e)));
      setConflict(false);
      notify("已保存到知识库");
      await refreshDrafts();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setConflict(true);
        notify("检测到新版本，本地草稿已保留");
      } else notify((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  saveRef.current = () => run(save);
  async function syncDrafts() {
    let done = 0,
      conflicts = 0;
    for (const d of await drafts.all()) {
      try {
        await upload(
          d.kb,
          d.path,
          new Blob([d.text], { type: "text/markdown" }),
          d.version,
          d.id,
        );
        await drafts.remove(d.id);
        done++;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) conflicts++;
        else throw e;
      }
    }
    await refreshEntries();
    await refreshDrafts();
    notify(
      `已同步 ${done} 份草稿${conflicts ? `，${conflicts} 份存在冲突，已保留在本机` : ""}`,
    );
  }
  async function newKb() {
    setKbMenu(false);
    const name = await ask(
      "新建知识库",
      "",
      "按主题收纳你的文件，例如「阅读与研究」。",
    );
    if (!name?.trim()) return;
    const k = await request<KB>("/kbs", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    setKbs((v) => [...v, k]);
    setKbId(k.id);
  }
  async function newItem(folder: boolean) {
    setMore(false);
    const path = await ask(
      folder ? "新建文件夹" : "新建 Markdown",
      folderPath +
        (folderPath ? "/" : "") +
        (folder ? "未命名文件夹" : "未命名.md"),
      "使用 / 分隔路径，父文件夹需要先创建。",
    );
    if (!path) return;
    const e = folder
      ? await request<Entry>(`/kbs/${kbId}/folders`, {
          method: "POST",
          body: JSON.stringify({ path }),
        })
      : await upload(
          kbId,
          path,
          new Blob([`# ${leaf(path).replace(/\.md$/, "")}\n\n`]),
        );
    await refreshEntries();
    open(e);
    if (!folder) setMode("source");
  }
  async function importFiles(files: FileList | File[] | null, replace = false) {
    if (!files?.length || !kbId) return;
    for (const file of Array.from(files)) {
      let path =
        replace && selected
          ? selected.path
          : (folderPath ? folderPath + "/" : "") + file.name;
      const old = entries.find((e) => e.path === path);
      if (old && !replace) {
        const yes = await ask(
          "更新已有文件",
          path,
          "将通过导入更新这个文件，旧版本上的 PDF 批注仍会保留。",
          true,
        );
        if (yes === null) continue;
      }
      if (
        replace &&
        selected &&
        file.name.split(".").pop() !== selected.path.split(".").pop()
      )
        throw new Error("请选择相同格式的文件");
      await upload(kbId, path, file, old?.version, old?.id);
    }
    await refreshEntries();
    notify("文件已导入");
    if (fileInput.current) fileInput.current.value = "";
    if (replaceInput.current) replaceInput.current.value = "";
  }
  async function rename(e: Entry) {
    setMore(false);
    const path = await ask(
      "重命名 / 移动",
      e.path,
      "输入完整相对路径。移动文件夹会同时更新其中的文件。",
    );
    if (!path || path === e.path) return;
    await request(`/entries/${e.id}`, {
      method: "PUT",
      headers: { "If-Match": `"${e.version}"` },
      body: JSON.stringify({ path }),
    });
    if (folderPath === e.path) setFolderPath(path);
    await refreshEntries();
  }
  async function remove(e: Entry) {
    setMore(false);
    if (
      (await ask(
        "删除" + (e.kind === "folder" ? "文件夹" : "文件"),
        e.path,
        e.kind === "folder"
          ? "此文件夹及其中所有文件都会被删除。"
          : "文件及其批注会从知识库中删除。",
        true,
      )) === null
    )
      return;
    await request(`/entries/${e.id}`, {
      method: "DELETE",
      headers: { "If-Match": `"${e.version}"` },
    });
    if (e.id === activeId) setActiveId("");
    if (folderPath === e.path) setFolderPath("");
    await drafts.remove(e.id);
    await refreshEntries();
    await refreshDrafts();
    notify("已删除");
  }
  async function seed() {
    const k = await request<KB>("/kbs", {
      method: "POST",
      body: JSON.stringify({ name: "我的知识花园" }),
    });
    await request(`/kbs/${k.id}/folders`, {
      method: "POST",
      body: JSON.stringify({ path: "开始使用" }),
    });
    await request(`/kbs/${k.id}/folders`, {
      method: "POST",
      body: JSON.stringify({ path: "阅读与研究" }),
    });
    await request(`/kbs/${k.id}/folders`, {
      method: "POST",
      body: JSON.stringify({ path: "灵感收集" }),
    });
    await upload(k.id, "开始使用/欢迎使用 Folio.md", new Blob([welcome]));
    await upload(k.id, "灵感收集/交互笔记.html", new Blob([sampleHtml]));
    setKbs((v) => [...v, k]);
    setKbId(k.id);
    notify("示例知识库已就绪，打开「开始使用」即可阅读");
  }
  async function cacheKb() {
    if (!navigator.serviceWorker?.controller) {
      notify("离线缓存需要生产构建，或等待首次安装后刷新页面");
      return;
    }
    await Promise.all([request("/kbs"), request(`/kbs/${kbId}/entries`)]);
    setCacheProgress("准备离线阅读器…");
    const assets: string[] = await (await fetch("/offline-assets.json")).json();
    for (let i = 0; i < assets.length; i += 4)
      await Promise.all(
        assets.slice(i, i + 4).map((url) =>
          fetch(url).then((r) => {
            if (!r.ok) throw new Error("离线阅读器缓存失败");
          }),
        ),
      );
    const files = entries.filter((e) => e.kind === "file");
    let count = 0;
    for (const e of files) {
      setCacheProgress(`${++count} / ${files.length}`);
      await readBlob(e);
      if (e.format === "pdf") await request(`/entries/${e.id}/comments`);
    }
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      navigator.serviceWorker.controller?.postMessage("FLUSH", [channel.port2]);
    });
    setCacheProgress("");
    const persisted = await navigator.storage?.persist();
    notify(
      `已读取 ${count} 个文件，缓存按 200 MiB 上限渐进保留${persisted ? " · 已获得持久存储" : ""}`,
    );
    await storageStats();
  }
  async function storageStats() {
    const estimate = await navigator.storage?.estimate();
    setCacheStats(sizeLabel(estimate?.usage || 0));
  }
  async function addComment() {
    if (!selected || !pin || !commentText.trim()) return;
    await request(`/entries/${selected.id}/comments`, {
      method: "POST",
      body: JSON.stringify({
        ...pin,
        page,
        text: commentText,
        version: selected.version,
      }),
    });
    setComments(await request(`/entries/${selected.id}/comments`));
    setPin(null);
    setCommentText("");
    notify("批注已保存");
  }
  function dock(panel: Panel, side: Dock) {
    setLayout((v) => ({ ...v, [panel]: side }));
    setDragPanel(null);
  }
  function resize(side: Dock, e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const start = side === "bottom" ? e.clientY : e.clientX,
      original = layout[side];
    const element = e.currentTarget;
    const move = (event: PointerEvent) => {
      const delta = (side === "bottom" ? event.clientY : event.clientX) - start;
      setLayout((v) => ({
        ...v,
        [side]: Math.max(
          side === "bottom" ? 140 : 200,
          Math.min(
            side === "bottom" ? 450 : 400,
            original + delta * (side === "left" ? 1 : -1),
          ),
        ),
      }));
    };
    const end = () => {
      element.removeEventListener("pointermove", move as EventListener);
      element.removeEventListener("pointerup", end);
      element.removeEventListener("pointercancel", end);
    };
    element.addEventListener("pointermove", move as EventListener);
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", end);
  }
  const currentFolder = entries.find(
    (e) => e.kind === "folder" && e.path === folderPath,
  );
  const childEntries = entries
    .filter(
      (e) =>
        (e.path.includes("/")
          ? e.path.slice(0, e.path.lastIndexOf("/"))
          : "") === folderPath,
    )
    .sort((a, b) =>
      a.kind === b.kind
        ? a.path.localeCompare(b.path)
        : a.kind === "folder"
          ? -1
          : 1,
    );
  function tree(parent = "", depth = 0): ReactNode {
    return entries
      .filter(
        (e) =>
          (e.path.includes("/")
            ? e.path.slice(0, e.path.lastIndexOf("/"))
            : "") === parent,
      )
      .sort((a, b) =>
        a.kind === b.kind
          ? a.path.localeCompare(b.path)
          : a.kind === "folder"
            ? -1
            : 1,
      )
      .map((e) => (
        <div key={e.id}>
          <div
            className={
              "tree-row " +
              (activeId === e.id || (!activeId && folderPath === e.path)
                ? "selected"
                : "")
            }
            style={{ paddingLeft: 12 + depth * 16 }}
          >
            <button
              className="tree-open"
              onClick={() => {
                if (e.kind === "folder")
                  setExpanded((old) => {
                    const next = new Set(old);
                    next.has(e.path) ? next.delete(e.path) : next.add(e.path);
                    return next;
                  });
                else open(e);
              }}
              aria-label={
                e.kind === "folder"
                  ? `展开 ${leaf(e.path)}`
                  : `打开 ${leaf(e.path)}`
              }
            >
              {e.kind === "folder" ? (
                expanded.has(e.path) ? (
                  <ChevronDown size={13} />
                ) : (
                  <ChevronRight size={13} />
                )
              ) : (
                <span className="tree-indent" />
              )}
            </button>
            <button className="tree-name" onClick={() => open(e)}>
              <FileIcon format={e.format} />
              <span>{leaf(e.path)}</span>
            </button>
          </div>
          {e.kind === "folder" &&
            expanded.has(e.path) &&
            tree(e.path, depth + 1)}
        </div>
      ));
  }
  function panelHeader(panel: Panel, title: string) {
    return (
      <div
        className="panel-title"
        draggable={!compact}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/folio-panel", panel);
          setDragPanel(panel);
        }}
        onDragEnd={() => setDragPanel(null)}
      >
        <span>
          <GripVertical size={13} />
          {title}
        </span>
        <div className="panel-actions">
          <select
            aria-label={`${title}停靠位置`}
            title="停靠位置"
            value={layout[panel]}
            onChange={(e) => dock(panel, e.target.value as Dock)}
          >
            <option value="left">左</option>
            <option value="right">右</option>
            <option value="bottom">下</option>
          </select>
          <IconButton
            label={`隐藏${title}`}
            onClick={() => {
              setDrawer(null);
              setLayout((v) => ({
                ...v,
                [panel === "explorer" ? "showExplorer" : "showInspector"]:
                  false,
              }));
            }}
          >
            <X size={14} />
          </IconButton>
        </div>
      </div>
    );
  }
  function explorer() {
    return (
      <section className="panel explorer">
        {panelHeader("explorer", "资源管理器")}
        <div className="explorer-controls">
          <button
            onClick={() => {
              setActiveId("");
              setFolderPath("");
              setDrawer(null);
            }}
          >
            <BookOpen size={14} />
            <span>{kb?.name || "知识库"}</span>
          </button>
          <IconButton
            label="新建 Markdown"
            onClick={() => run(() => newItem(false))}
          >
            <Plus size={16} />
          </IconButton>
          <IconButton
            label="新建文件夹"
            onClick={() => run(() => newItem(true))}
          >
            <FolderPlus size={16} />
          </IconButton>
        </div>
        <div className="tree">
          {tree()}
          {entries.length === 0 && (
            <p className="muted empty-tree">
              导入一份文件，
              <br />
              开始构建你的知识库。
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div>
            <span className="status-dot" />
            {online ? "个人空间 · 已连接" : "本机离线空间"}
          </div>
          <button
            className="import-zone"
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={17} />
            <span>
              导入文件<small>PDF、MD、DOCX、HTML</small>
            </span>
            <Plus size={14} />
          </button>
        </div>
      </section>
    );
  }
  function inspector() {
    return (
      <section className="panel inspector">
        {panelHeader(
          "inspector",
          selected?.format === "pdf" ? "批注与信息" : "大纲与信息",
        )}
        <div className="inspector-scroll">
          {selected?.format === "md" && (
            <>
              <div className="eyebrow">ON THIS PAGE</div>
              <nav className="outline">
                {headings
                  .filter((h) => h.depth > 1)
                  .map((h, i) => (
                    <button
                      key={h.id + i}
                      style={{ paddingLeft: (h.depth - 2) * 12 }}
                      onClick={() => {
                        document
                          .getElementById(h.id)
                          ?.scrollIntoView({ behavior: "smooth" });
                        setDrawer(null);
                      }}
                    >
                      {h.text}
                    </button>
                  ))}
                {headings.length < 2 && (
                  <p className="muted">标题会显示在这里</p>
                )}
              </nav>
            </>
          )}
          {selected?.format === "pdf" && (
            <>
              <div className="eyebrow">
                DOCUMENT NOTES <span>{comments.length}</span>
              </div>
              {pin && (
                <div className="comment-form">
                  <b>第 {page} 页 · 新批注</b>
                  <textarea
                    autoFocus
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="记下你的想法…"
                    aria-label="批注内容"
                  />
                  <div>
                    <button onClick={() => setPin(null)}>取消</button>
                    <button className="primary" onClick={() => run(addComment)}>
                      保存批注
                    </button>
                  </div>
                </div>
              )}
              {comments.length === 0 && !pin && (
                <div className="annotation-empty">
                  <MessageSquare size={26} />
                  <p>在阅读中留下思考</p>
                  <small>
                    点击阅读器「添加批注」，
                    <br />
                    然后在页面上选择位置。
                  </small>
                </div>
              )}
              {comments.map((c) => (
                <article
                  className={
                    "comment " +
                    (c.version !== selected.version ? "old-comment" : "")
                  }
                  id={"comment-" + c.id}
                  key={c.id}
                >
                  <header>
                    <button
                      onClick={() => {
                        if (c.version === selected.version) setPage(c.page);
                        else notify("这条批注属于旧版本，位置仅供参考");
                      }}
                    >
                      第 {c.page} 页{" "}
                      {c.version !== selected.version ? "· 旧版本" : ""}
                    </button>
                    <IconButton
                      label="删除批注"
                      onClick={() =>
                        run(async () => {
                          await request(`/comments/${c.id}`, {
                            method: "DELETE",
                          });
                          setComments((v) => v.filter((n) => n.id !== c.id));
                        })
                      }
                    >
                      <X size={12} />
                    </IconButton>
                  </header>
                  <p>{c.text}</p>
                  <small>
                    {new Date(c.created * 1000).toLocaleString("zh-CN")}
                  </small>
                </article>
              ))}
            </>
          )}
          <div className="file-info">
            <div className="eyebrow">
              {selected ? "FILE DETAILS" : "KNOWLEDGE BASE"}
            </div>
            <dl>
              <dt>{selected ? "格式" : "文件"}</dt>
              <dd>
                {selected
                  ? selected.format.toUpperCase()
                  : entries.filter((e) => e.kind === "file").length + " 份"}
              </dd>
              <dt>{selected ? "大小" : "文件夹"}</dt>
              <dd>
                {selected
                  ? sizeLabel(selected.size)
                  : entries.filter((e) => e.kind === "folder").length + " 个"}
              </dd>
              {selected && (
                <>
                  <dt>版本</dt>
                  <dd>v{selected.version}</dd>
                  <dt>更新于</dt>
                  <dd>
                    {new Date(selected.updated * 1000).toLocaleDateString(
                      "zh-CN",
                    )}
                  </dd>
                </>
              )}
            </dl>
            {selected && <p className="path-label">{selected.path}</p>}
            <div className="private-note">
              <Cloud size={14} />
              <span>
                存储于你的服务器<small>你的文件，始终属于你。</small>
              </span>
            </div>
          </div>
          <div className="inspector-footer">
            <BookOpen size={18} />
            <p>Keep what matters.</p>
            <small>给思考，留一点空间。</small>
          </div>
        </div>
      </section>
    );
  }
  function panelContent(p: Panel) {
    return p === "explorer" ? explorer() : inspector();
  }
  function dockArea(side: Dock) {
    const panels = (["explorer", "inspector"] as Panel[]).filter(
      (p) =>
        layout[p] === side &&
        layout[p === "explorer" ? "showExplorer" : "showInspector"] &&
        !(compact && p === "inspector"),
    );
    if (!panels.length || mobile) return null;
    return (
      <aside className={"dock dock-" + side}>
        {panels.map((p) => (
          <div className="docked-panel" key={p}>
            {panelContent(p)}
          </div>
        ))}
        <div
          role="separator"
          aria-label={`调整${side}面板大小`}
          aria-orientation={side === "bottom" ? "horizontal" : "vertical"}
          tabIndex={0}
          className={"resize-handle resize-" + side}
          onPointerDown={(e) => resize(side, e)}
          onKeyDown={(e) => {
            if (
              ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                e.key,
              )
            ) {
              e.preventDefault();
              setLayout((v) => ({
                ...v,
                [side]: Math.max(
                  180,
                  Math.min(
                    400,
                    v[side] +
                      (["ArrowRight", "ArrowUp"].includes(e.key) ? 20 : -20),
                  ),
                ),
              }));
            }
          }}
        />
      </aside>
    );
  }
  const leftOn =
    !mobile &&
    ((layout.showExplorer && layout.explorer === "left") ||
      (!compact && layout.showInspector && layout.inspector === "left"));
  const rightOn =
    !mobile &&
    ((layout.showExplorer && layout.explorer === "right") ||
      (!compact && layout.showInspector && layout.inspector === "right"));
  const bottomOn =
    !mobile &&
    ((layout.showExplorer && layout.explorer === "bottom") ||
      (!compact && layout.showInspector && layout.inspector === "bottom"));
  if (!authenticated)
    return (
      <div className="login-page">
        <div className="login-art">
          <span className="brand">
            <span className="brand-mark">f.</span>folio
            <span className="brand-dot">●</span>
          </span>
          <div>
            <span className="eyebrow">A HOME FOR YOUR KNOWLEDGE</span>
            <h1>
              读过的，想过的。
              <br />
              <em>都在这里。</em>
            </h1>
            <p>
              一个安静的个人文档工作台。
              <br />
              从文件出发，回到思考本身。
            </p>
            <div className="format-line">
              <span>MD</span>
              <i />
              <span>PDF</span>
              <i />
              <span>DOCX</span>
              <i />
              <span>HTML</span>
            </div>
          </div>
          <small>YOUR FILES. YOUR SPACE.</small>
          <div className="art-pages">
            <div />
            <div />
            <div>
              <span>Field notes</span>
              <b>
                Ideas worth
                <br />
                keeping.
              </b>
              <i />
              <i />
              <i />
              <em>01 / A personal collection</em>
            </div>
          </div>
        </div>
        <div className="login-form">
          <div className="login-inner">
            <BookOpen size={30} strokeWidth={1.3} />
            <h2>回到你的知识库</h2>
            <p>用服务器的访问密码解锁个人空间。</p>
            <form onSubmit={login}>
              <label htmlFor="password">访问密码</label>
              <input
                id="password"
                autoFocus
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="输入访问密码"
              />
              <button className="primary" disabled={checking}>
                {checking ? "正在连接…" : "打开工作台"}
                <ArrowUpRight size={17} />
              </button>
              {loginError && <p className="error-text">{loginError}</p>}
            </form>
            <small>
              <HardDrive size={13} /> 自部署存储 · 文件路径管理 · 跨设备访问
            </small>
          </div>
        </div>
      </div>
    );
  return (
    <div
      className="app-shell"
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer?.files.length) {
          e.preventDefault();
          run(() => importFiles(e.dataTransfer.files));
        }
      }}
    >
      <input
        hidden
        ref={fileInput}
        type="file"
        accept=".md,.pdf,.docx,.html,.htm"
        multiple
        onChange={(e) => run(() => importFiles(e.target.files))}
      />
      <input
        hidden
        ref={replaceInput}
        type="file"
        accept={selected ? "." + selected.format : undefined}
        onChange={(e) => run(() => importFiles(e.target.files, true))}
      />
      <header className="titlebar">
        <button
          className="brand"
          onClick={() => {
            setActiveId("");
            setFolderPath("");
          }}
        >
          <span className="brand-mark">f.</span>
          <span>
            folio<span className="brand-dot">●</span>
          </span>
        </button>
        <span className="title-divider" />
        <div className="kb-selector">
          <button onClick={() => setKbMenu(!kbMenu)}>
            <span>{kb?.name || "个人知识库"}</span>
            <ChevronDown size={13} />
          </button>
          {kbMenu && (
            <div className="popover kb-popover">
              <div className="menu-heading">我的知识库</div>
              {kbs.map((k) => (
                <button
                  key={k.id}
                  onClick={() => {
                    setKbId(k.id);
                    setKbMenu(false);
                  }}
                >
                  <BookOpen size={15} />
                  {k.name}
                  {k.id === kbId && <Check size={14} />}
                </button>
              ))}
              <hr />
              <button onClick={() => run(newKb)}>
                <Plus size={15} />
                新建知识库
              </button>
            </div>
          )}
        </div>
        <button className="global-search" onClick={() => setSearch("")}>
          <Search size={15} />
          <span>搜索你的知识库…</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="title-actions">
          <span className={"connection " + (!online ? "offline" : "")}>
            <span className="status-dot" />
            {online ? "已连接" : "离线"}
          </span>
          <IconButton label="切换主题" onClick={() => setDark(!dark)}>
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </IconButton>
          <button
            className="avatar"
            title="工作台设置"
            onClick={() => {
              setSettings(true);
              run(storageStats);
            }}
          >
            ME
          </button>
        </div>
      </header>
      <div
        className="workbench"
        style={
          {
            "--left": leftOn ? layout.left + "px" : "0px",
            "--right": rightOn ? layout.right + "px" : "0px",
            "--bottom": bottomOn ? layout.bottom + "px" : "0px",
          } as CSSProperties
        }
      >
        <nav className="activity-bar">
          <div>
            <IconButton
              label="文件资源管理器"
              active={layout.showExplorer}
              onClick={() =>
                mobile
                  ? setDrawer("explorer")
                  : setLayout((v) => ({ ...v, showExplorer: !v.showExplorer }))
              }
            >
              <PanelLeft size={21} />
            </IconButton>
            <IconButton label="搜索文件" onClick={() => setSearch("")}>
              <Search size={21} />
            </IconButton>
            <IconButton
              label="离线缓存与设置"
              onClick={() => {
                setSettings(true);
                run(storageStats);
              }}
            >
              <Cloud size={21} />
            </IconButton>
          </div>
          <div>
            <IconButton
              label="工作台设置"
              onClick={() => {
                setSettings(true);
                run(storageStats);
              }}
            >
              <Settings2 size={21} />
            </IconButton>
          </div>
        </nav>
        {dockArea("left")}
        <main className="main-workspace">
          <div className="tabbar">
            <button
              className={"tab home-tab " + (!activeId ? "active" : "")}
              onClick={() => setActiveId("")}
            >
              <FolderOpen size={15} />
              {folderPath ? leaf(folderPath) : "知识库"}
            </button>
            {tabs.map((id) => {
              const e = entries.find((e) => e.id === id);
              return (
                e && (
                  <div
                    key={id}
                    className={"tab " + (id === activeId ? "active" : "")}
                  >
                    <button onClick={() => open(e)}>
                      <FileIcon format={e.format} size={14} />
                      {leaf(e.path)}
                      {id === activeId && dirty && e.format === "md" && (
                        <span className="dirty-dot" />
                      )}
                    </button>
                    <button
                      aria-label={`关闭 ${leaf(e.path)}`}
                      className="close-tab"
                      onClick={() => {
                        setTabs((t) => t.filter((n) => n !== id));
                        if (activeId === id) setActiveId("");
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                )
              );
            })}
            <div className="tabbar-end">
              <IconButton
                label="显示大纲与信息"
                active={layout.showInspector}
                onClick={() =>
                  compact
                    ? setDrawer("inspector")
                    : setLayout((v) => ({
                        ...v,
                        showInspector: !v.showInspector,
                      }))
                }
              >
                <PanelRight size={16} />
              </IconButton>
            </div>
          </div>
          <div className="document-toolbar">
            <div className="breadcrumbs">
              <button
                className="mobile-tree"
                aria-label="打开文件菜单"
                onClick={() => setDrawer("explorer")}
              >
                <Menu size={18} />
              </button>
              <button
                onClick={() => {
                  setActiveId("");
                  setFolderPath("");
                }}
              >
                <BookOpen size={14} />
                <span>{kb?.name || "知识库"}</span>
              </button>
              {(selected?.path || folderPath)
                .split("/")
                .filter(Boolean)
                .map((part, i, parts) => (
                  <span key={i}>
                    <ChevronRight size={12} />
                    <button
                      onClick={() => {
                        if (i < parts.length - 1 || !selected) {
                          setActiveId("");
                          setFolderPath(parts.slice(0, i + 1).join("/"));
                        }
                      }}
                    >
                      {part}
                    </button>
                  </span>
                ))}
            </div>
            <div className="document-actions">
              {selected?.format === "md" && (
                <>
                  <div className="mode-switch">
                    <button
                      aria-label="阅读模式"
                      className={mode === "read" ? "active" : ""}
                      onClick={() => setMode("read")}
                    >
                      <Eye size={14} />
                      <span>阅读</span>
                    </button>
                    <button
                      aria-label="分屏编辑"
                      className={mode === "split" ? "active" : ""}
                      onClick={() => setMode("split")}
                    >
                      <Columns2 size={14} />
                      <span>分屏</span>
                    </button>
                    <button
                      aria-label="源码编辑"
                      className={mode === "source" ? "active" : ""}
                      onClick={() => setMode("source")}
                    >
                      <Code2 size={14} />
                      <span>源码</span>
                    </button>
                  </div>
                  {mode !== "read" && (
                    <button
                      className="save-button"
                      disabled={saving || loading}
                      onClick={() => run(save)}
                    >
                      <Save size={14} />
                      <span>{saving ? "保存中" : "保存"}</span>
                    </button>
                  )}
                </>
              )}
              {!selected && kb && (
                <button
                  className="subtle-button"
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload size={14} />
                  <span>导入</span>
                </button>
              )}
              <div className="more-wrap">
                <IconButton label="更多文件操作" onClick={() => setMore(!more)}>
                  <MoreHorizontal size={19} />
                </IconButton>
                {more && (
                  <div className="popover more-popover">
                    {selected ? (
                      <>
                        <button
                          onClick={() =>
                            run(() =>
                              download(
                                contentURL(selected),
                                leaf(selected.path),
                              ),
                            )
                          }
                        >
                          <Download size={15} />
                          导出原文件
                        </button>
                        <button
                          onClick={() => {
                            setMore(false);
                            replaceInput.current?.click();
                          }}
                        >
                          <RefreshCw size={15} />
                          通过导入更新
                        </button>
                        <button onClick={() => run(() => rename(selected))}>
                          <Pencil size={15} />
                          重命名 / 移动
                        </button>
                        <button
                          className="danger"
                          onClick={() => run(() => remove(selected))}
                        >
                          <Trash2 size={15} />
                          删除文件
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => run(() => newItem(false))}>
                          <FileText size={15} />
                          新建 Markdown
                        </button>
                        <button onClick={() => run(() => newItem(true))}>
                          <FolderPlus size={15} />
                          新建文件夹
                        </button>
                        {currentFolder && (
                          <>
                            <button
                              onClick={() => run(() => rename(currentFolder))}
                            >
                              <Pencil size={15} />
                              重命名 / 移动文件夹
                            </button>
                            <button
                              className="danger"
                              onClick={() => run(() => remove(currentFolder))}
                            >
                              <Trash2 size={15} />
                              删除文件夹
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          {conflict && selected && (
            <div className="conflict-banner">
              <span>远端已有新版本，本地草稿已保留。</span>
              <button
                onClick={() =>
                  saveBlob(new Blob([text]), leaf(selected.path) + ".draft.md")
                }
              >
                下载本地副本
              </button>
              <button
                onClick={() =>
                  run(async () => {
                    if (
                      (await ask(
                        "载入远端版本",
                        "确认",
                        "本地草稿将被替换，请先下载本地副本。",
                        true,
                      )) === null
                    )
                      return;
                    await drafts.remove(selected.id);
                    setHasDraft(false);
                    await refreshDrafts();
                    await refreshEntries();
                    const updated = (
                      await request<Entry[]>(`/kbs/${kbId}/entries`)
                    ).find((e) => e.id === selected.id);
                    if (updated) {
                      const value = await (await readBlob(updated)).text();
                      setText(value);
                      setBaseText(value);
                      setBaseVersion(updated.version);
                      setConflict(false);
                    }
                  })
                }
              >
                载入远端
              </button>
            </div>
          )}
          <div className="document-body">
            {!selected ? (
              <div className="folder-page">
                {!kb ? (
                  <div className="empty-library">
                    <span className="eyebrow">YOUR PERSONAL LIBRARY</span>
                    <h1>知识，从这里生长。</h1>
                    <p>把散落的文档收拢成属于你的知识空间。</p>
                    <div>
                      <button className="primary" onClick={() => run(newKb)}>
                        <Plus size={16} />
                        创建知识库
                      </button>
                      <button
                        className="subtle-button"
                        onClick={() => run(seed)}
                      >
                        探索示例
                        <ArrowUpRight size={15} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="folder-heading">
                      <div>
                        <div className="eyebrow">
                          {folderPath
                            ? "COLLECTION"
                            : "PERSONAL KNOWLEDGE BASE"}
                        </div>
                        <h1>
                          {folderPath ? leaf(folderPath) : kb.name}
                          <span>.</span>
                        </h1>
                        <p>
                          {folderPath
                            ? "沿着熟悉的路径，找到值得留下的内容。"
                            : "收纳文档，也收纳每一次思考。"}
                        </p>
                      </div>
                      <button
                        className="primary"
                        onClick={() => run(() => newItem(false))}
                      >
                        <Plus size={16} />
                        新建文档
                      </button>
                    </div>
                    <div className="folder-summary">
                      <span>
                        <Folder size={14} />
                        {
                          childEntries.filter((e) => e.kind === "folder").length
                        }{" "}
                        个文件夹
                      </span>
                      <span>
                        <FileText size={14} />
                        {
                          childEntries.filter((e) => e.kind === "file").length
                        }{" "}
                        份文档
                      </span>
                      <span className="summary-end">按文件路径组织</span>
                    </div>
                    <div className="file-table">
                      <div className="file-table-header">
                        <span>名称</span>
                        <span>类型</span>
                        <span>更新日期</span>
                        <span />
                      </div>
                      {folderPath && (
                        <button
                          className="file-row parent-row"
                          onClick={() =>
                            setFolderPath(
                              folderPath.split("/").slice(0, -1).join("/"),
                            )
                          }
                        >
                          <span>
                            <ArrowLeft size={16} />
                            返回上级
                          </span>
                        </button>
                      )}
                      {childEntries.map((e) => (
                        <div className="file-row" key={e.id}>
                          <button
                            className="file-row-name"
                            onClick={() => open(e)}
                          >
                            <FileIcon format={e.format} size={21} />
                            <span>
                              {leaf(e.path)}
                              <small>
                                {e.kind === "folder"
                                  ? entries.filter((n) =>
                                      n.path.startsWith(e.path + "/"),
                                    ).length + " 个项目"
                                  : sizeLabel(e.size)}
                              </small>
                            </span>
                          </button>
                          <span className="format-badge">
                            {e.kind === "folder"
                              ? "文件夹"
                              : e.format.toUpperCase()}
                          </span>
                          <span className="date-cell">
                            {new Date(e.updated * 1000).toLocaleDateString(
                              "zh-CN",
                            )}
                          </span>
                          <div className="row-actions">
                            <IconButton
                              label={`重命名 ${leaf(e.path)}`}
                              onClick={() => run(() => rename(e))}
                            >
                              <Pencil size={14} />
                            </IconButton>
                            <IconButton
                              label={`删除 ${leaf(e.path)}`}
                              onClick={() => run(() => remove(e))}
                            >
                              <Trash2 size={14} />
                            </IconButton>
                          </div>
                        </div>
                      ))}
                    </div>
                    {childEntries.length === 0 && (
                      <div className="folder-empty">
                        <FolderOpen size={36} strokeWidth={1} />
                        <h3>留一个位置，给下一个想法。</h3>
                        <p>将文件拖放到这里，或点击导入。</p>
                        <button onClick={() => fileInput.current?.click()}>
                          <Upload size={15} />
                          导入文件
                        </button>
                      </div>
                    )}
                    <div className="folder-footnote">
                      <span>PDF · MARKDOWN · WORD · HTML</span>
                      <span>
                        原始文件，自由流动。
                        <ArrowUpRight size={14} />
                      </span>
                    </div>
                  </>
                )}
              </div>
            ) : selected.format === "md" ? (
              <div className={"markdown-workspace mode-" + mode}>
                {mode !== "read" && (
                  <div className="source-pane">
                    <div className="source-heading">
                      <span>MARKDOWN SOURCE</span>
                      <span>{dirty ? "本地草稿" : "已保存"} · UTF-8</span>
                    </div>
                    <textarea
                      ref={editor}
                      aria-label="Markdown 源码"
                      spellCheck={false}
                      value={text}
                      disabled={saving || loading}
                      onChange={(e) => void edit(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Tab") {
                          e.preventDefault();
                          const t = e.currentTarget,
                            start = t.selectionStart,
                            end = t.selectionEnd;
                          void edit(
                            text.slice(0, start) + "  " + text.slice(end),
                          );
                          requestAnimationFrame(() => {
                            t.selectionStart = t.selectionEnd = start + 2;
                          });
                        }
                      }}
                    />
                    <div className="source-footer">
                      {text.split("\n").length} 行<span>⌘ / Ctrl + S 保存</span>
                    </div>
                  </div>
                )}
                {mode !== "source" && (
                  <div className="reading-scroll">
                    {loading ? (
                      <div className="loading">正在打开文档…</div>
                    ) : (
                      <article className="reading-page">
                        <div className="reading-meta">
                          <span className="format-badge">MARKDOWN</span>
                          <span>
                            {Math.max(1, Math.ceil(text.length / 600))} 分钟阅读
                          </span>
                          <span className="meta-line" />
                        </div>
                        {readerError && (
                          <p className="reader-error">{readerError}</p>
                        )}
                        <Markdown
                          text={text}
                          onHeadings={setHeadings}
                          onLink={openPath}
                        />
                        <footer className="reading-footer">
                          <span>— &nbsp; 思考，未完待续。</span>
                          <CheckCircle2 size={14} />
                        </footer>
                      </article>
                    )}
                  </div>
                )}
              </div>
            ) : selected.format === "pdf" ? (
              <PdfReader
                entry={selected}
                comments={comments}
                onPin={(x, y) => {
                  setPin({ x, y });
                  if (compact) setDrawer("inspector");
                  else setLayout((v) => ({ ...v, showInspector: true }));
                }}
                page={page}
                setPage={setPage}
              />
            ) : selected.format === "docx" ? (
              <DocxReader entry={selected} />
            ) : (
              <HtmlReader entry={selected} />
            )}
          </div>
        </main>
        {dockArea("right")}
        {dockArea("bottom")}
        {dragPanel && (
          <div className="drop-targets">
            {(["left", "right", "bottom"] as Dock[]).map((side) => (
              <div
                key={side}
                className={"drop-target drop-" + side}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  dock(dragPanel, side);
                }}
              >
                {side === "left"
                  ? "停靠左侧"
                  : side === "right"
                    ? "停靠右侧"
                    : "停靠底部"}
              </div>
            ))}
          </div>
        )}
      </div>
      <footer className="statusbar">
        <div>
          <span className="status-dot" />
          {online ? "工作台已就绪" : "离线 · 已缓存内容可读"}
          <span className="status-separator" />
          {kb && `${entries.filter((e) => e.kind === "file").length} 份文档`}
        </div>
        <div>
          {draftCount > 0 && (
            <button onClick={() => run(syncDrafts)}>
              <RefreshCw size={12} />
              {draftCount} 份草稿 · 同步
            </button>
          )}
          <span className="desktop-hint">
            {selected?.format === "md" ? "Markdown · UTF-8" : "文件即知识"}
          </span>
          <button onClick={() => setLayout(initialLayout)}>
            <Columns2 size={12} />
            自适应布局
          </button>
        </div>
      </footer>
      <nav className="mobile-nav">
        <button onClick={() => setDrawer("explorer")}>
          <FolderOpen size={20} />
          文件
        </button>
        <button onClick={() => setSearch("")}>
          <Search size={20} />
          搜索
        </button>
        <button
          className="mobile-add"
          onClick={() => fileInput.current?.click()}
        >
          <Plus size={23} />
        </button>
        <button onClick={() => setDrawer("inspector")}>
          <List size={20} />
          {selected?.format === "pdf" ? "批注" : "大纲"}
        </button>
        <button
          onClick={() => {
            setSettings(true);
            run(storageStats);
          }}
        >
          <Settings2 size={20} />
          设置
        </button>
      </nav>
      {drawer && (
        <div className="overlay drawer-overlay" onClick={() => setDrawer(null)}>
          <div
            className={"drawer drawer-" + drawer}
            onClick={(e) => e.stopPropagation()}
          >
            {panelContent(drawer)}
          </div>
        </div>
      )}
      {search !== null && (
        <div className="overlay" onClick={() => setSearch(null)}>
          <section
            className="search-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="搜索知识库"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="search-field">
              <Search size={20} />
              <input
                ref={searchInput}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="按文件名或路径搜索…"
                aria-label="搜索关键词"
              />
              <button onClick={() => setSearch(null)}>
                <kbd>ESC</kbd>
              </button>
            </div>
            <div className="search-caption">当前知识库 · {kb?.name}</div>
            <div className="search-results">
              {entries
                .filter((e) =>
                  e.path.toLowerCase().includes(search.toLowerCase()),
                )
                .slice(0, 50)
                .map((e) => (
                  <button key={e.id} onClick={() => open(e)}>
                    <FileIcon format={e.format} />
                    <span>
                      {leaf(e.path)}
                      <small>{e.path}</small>
                    </span>
                    <ArrowUpRight size={15} />
                  </button>
                ))}
              {!entries.some((e) =>
                e.path.toLowerCase().includes(search.toLowerCase()),
              ) && <p className="empty-search">没有找到匹配的路径</p>}
            </div>
            <footer>
              文件名与路径搜索 <span>Enter 选择 · Esc 关闭</span>
            </footer>
          </section>
        </div>
      )}
      {settings && (
        <div className="overlay" onClick={() => setSettings(false)}>
          <section
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="工作台设置"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <span className="eyebrow">MAKE YOURSELF AT HOME</span>
                <h2>你的工作台</h2>
              </div>
              <IconButton label="关闭设置" onClick={() => setSettings(false)}>
                <X size={20} />
              </IconButton>
            </header>
            <div className="settings-section">
              <h3>
                <Cloud size={17} />
                离线与同步
              </h3>
              <p>
                先加载目录，按需缓存原文件。草稿保存在此设备，手动同步时检查版本。
              </p>
              <div className="settings-row">
                <span>
                  本机存储用量
                  <small>
                    {cacheStats || "正在计算…"} · 文件缓存上限 200 MiB
                  </small>
                </span>
                <button
                  disabled={!!cacheProgress || !kb}
                  onClick={() =>
                    run(async () => {
                      try {
                        await cacheKb();
                      } finally {
                        setCacheProgress("");
                      }
                    })
                  }
                >
                  {cacheProgress || "缓存当前知识库"}
                </button>
              </div>
              <div className="settings-row">
                <span>
                  Markdown 本地草稿<small>{draftCount} 份待保存</small>
                </span>
                <button
                  disabled={!draftCount || !online}
                  onClick={() => run(syncDrafts)}
                >
                  同步草稿
                </button>
              </div>
              {draftCount > 0 && (
                <div className="settings-row">
                  <span>
                    保留草稿副本<small>包括远端已删除或移动的文件</small>
                  </span>
                  <button
                    onClick={() =>
                      run(async () =>
                        saveBlob(
                          new Blob(
                            [JSON.stringify(await drafts.all(), null, 2)],
                            { type: "application/json" },
                          ),
                          "folio-local-drafts.json",
                        ),
                      )
                    }
                  >
                    导出全部草稿
                  </button>
                </div>
              )}
              <button
                className="text-button"
                onClick={() =>
                  run(async () => {
                    for (const key of await caches.keys())
                      if (key.startsWith("folio-data"))
                        await caches.delete(key);
                    await storageStats();
                    notify("文件缓存已清除，本地草稿保留");
                  })
                }
              >
                清除文件缓存
              </button>
            </div>
            <div className="settings-section">
              <h3>
                <Columns2 size={17} />
                布局与外观
              </h3>
              <div className="settings-row">
                <span>
                  面板布局<small>拖动面板标题，停靠到左、右或底部</small>
                </span>
                <button onClick={() => setLayout(initialLayout)}>
                  恢复默认
                </button>
              </div>
              <div className="settings-row">
                <span>阅读主题</span>
                <button onClick={() => setDark(!dark)}>
                  {dark ? "切换浅色" : "切换深色"}
                </button>
              </div>
              {installEvent && (
                <button
                  onClick={() =>
                    run(async () => {
                      await installEvent.prompt();
                      setInstallEvent(null);
                    })
                  }
                >
                  <ArrowDownToLine size={16} />
                  安装到设备
                </button>
              )}
              {updateWorker && (
                <button
                  onClick={() => {
                    updateWorker.postMessage("SKIP_WAITING");
                    navigator.serviceWorker.addEventListener(
                      "controllerchange",
                      () => location.reload(),
                      { once: true },
                    );
                  }}
                >
                  应用更新（草稿保留）
                </button>
              )}
            </div>
            {kb && (
              <div className="settings-section">
                <h3>
                  <BookOpen size={17} />
                  当前知识库
                </h3>
                <div className="settings-row">
                  <span>{kb.name}</span>
                  <button
                    onClick={() =>
                      run(async () => {
                        const name = await ask("重命名知识库", kb.name);
                        if (name) {
                          await request(`/kbs/${kb.id}`, {
                            method: "PUT",
                            body: JSON.stringify({ name }),
                          });
                          await refreshKbs();
                        }
                      })
                    }
                  >
                    重命名
                  </button>
                </div>
                <div className="settings-row">
                  <button
                    onClick={() =>
                      run(() =>
                        download(`/api/kbs/${kb.id}/export`, kb.name + ".zip"),
                      )
                    }
                  >
                    <Download size={14} />
                    导出全部文件与批注
                  </button>
                  <button
                    className="danger"
                    onClick={() =>
                      run(async () => {
                        const value = await ask(
                          "删除知识库",
                          "",
                          `请输入「${kb.name}」确认删除全部文件与批注。`,
                          true,
                        );
                        if (value !== kb.name) {
                          if (value !== null) notify("名称不匹配，未删除");
                          return;
                        }
                        await request(`/kbs/${kb.id}`, { method: "DELETE" });
                        for (const d of await drafts.all())
                          if (d.kb === kb.id) await drafts.remove(d.id);
                        await refreshKbs();
                        await refreshDrafts();
                        setSettings(false);
                      })
                    }
                  >
                    删除知识库
                  </button>
                </div>
              </div>
            )}
            <footer>
              <span>FOLIO / PERSONAL KNOWLEDGE WORKBENCH</span>
              <button
                onClick={() =>
                  run(async () => {
                    if (
                      draftCount &&
                      (await ask(
                        "退出登录",
                        "退出",
                        "本机缓存和草稿将被清除，请先同步或下载草稿。",
                        true,
                      )) === null
                    )
                      return;
                    await request("/logout", { method: "POST" });
                    await clearPrivateData();
                    setAuthenticated(false);
                    setSettings(false);
                    setEntries([]);
                    setKbs([]);
                  })
                }
              >
                <LogOut size={14} />
                退出
              </button>
            </footer>
          </section>
        </div>
      )}
      {dialog && (
        <div className="overlay dialog-overlay">
          <form
            className="input-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={dialog.title}
            onSubmit={(e) => {
              e.preventDefault();
              closeDialog(dialog.value);
            }}
          >
            <h2>{dialog.title}</h2>
            {dialog.description && <p>{dialog.description}</p>}
            <input
              autoFocus
              value={dialog.value}
              aria-label={dialog.title}
              onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
              onFocus={(e) => e.target.select()}
            />
            <div>
              <button type="button" onClick={() => closeDialog(null)}>
                取消
              </button>
              <button className={dialog.danger ? "danger-primary" : "primary"}>
                {dialog.danger ? "确认" : "创建 / 保存"}
              </button>
            </div>
          </form>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          <span>{toast}</span>
          <button onClick={() => setToast("")} aria-label="关闭提示">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
