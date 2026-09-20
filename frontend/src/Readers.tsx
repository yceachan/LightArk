import type {
  PDFDocumentProxy,
  PDFDocumentLoadingTask,
  RenderTask,
} from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  MessageSquarePlus,
} from "lucide-react";
import type { Entry, Comment } from "./api";
import { readBlob, contentURL } from "./api";
import { renderMarkdown, type RenderResult } from "./markdown";

export function Markdown({
  text,
  onHeadings,
  onLink,
}: {
  text: string;
  onHeadings?: (h: RenderResult["headings"]) => void;
  onLink?: (path: string) => void;
}) {
  const [html, setHtml] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      renderMarkdown(text)
        .then((result) => {
          if (alive) {
            setHtml(result.html);
            onHeadings?.(result.headings);
          }
        })
        .catch(() => {
          if (alive) setHtml("<p>Markdown 渲染失败，请检查内容。</p>");
        });
    }, 100);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [text]);
  useEffect(() => {
    if (!html || !ref.current?.querySelector(".mermaid")) return;
    let alive = true;
    import("mermaid").then(async ({ default: m }) => {
      m.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "neutral",
        fontFamily: "Avenir Next, sans-serif",
        suppressErrorRendering: true,
      });
      const els = ref.current?.querySelectorAll<HTMLElement>(".mermaid");
      if (alive && els) await m.run({ nodes: els }).catch(() => {});
    });
    return () => {
      alive = false;
    };
  }, [html]);
  return (
    <div
      ref={ref}
      className="vp-doc"
      onClick={(e) => {
        const link = (e.target as HTMLElement).closest("a");
        if (!link) return;
        const href = link.getAttribute("href") || "";
        if (href.startsWith("#")) {
          e.preventDefault();
          document
            .getElementById(decodeURIComponent(href.slice(1)))
            ?.scrollIntoView({ behavior: "smooth" });
        } else if (!/^(https?:|mailto:)/.test(href)) {
          e.preventDefault();
          onLink?.(href);
        } else {
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
export function PdfReader({
  entry,
  comments,
  onPin,
  page,
  setPage,
}: {
  entry: Entry;
  comments: Comment[];
  onPin: (x: number, y: number) => void;
  page: number;
  setPage: (v: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    area = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null),
    [error, setError] = useState(""),
    [zoom, setZoom] = useState(1),
    [width, setWidth] = useState(700),
    [pin, setPin] = useState(false),
    [rendering, setRendering] = useState(false);
  useEffect(() => {
    let alive = true;
    let loading: PDFDocumentLoadingTask | undefined;
    setError("");
    setDoc(null);
    (async () => {
      const pdf = await import("pdfjs-dist");
      pdf.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      const cached =
        "caches" in window ? await caches.match(contentURL(entry)) : undefined;
      loading = pdf.getDocument({
        ...(cached
          ? { data: await cached.arrayBuffer() }
          : {
              url: contentURL(entry),
              withCredentials: true,
              disableAutoFetch: true,
              disableStream: true,
              rangeChunkSize: 128 * 1024,
            }),
        cMapUrl: "/pdf/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/pdf/standard_fonts/",
        wasmUrl: "/pdf/wasm/",
      });
      const document = await loading.promise;
      if (alive) {
        setDoc(document);
        // First page uses HTTP ranges. Fill the full-file cache in the background.
        if (!cached) void readBlob(entry).catch(() => {});
      } else await loading.destroy();
    })().catch((e) => {
      if (alive) setError(e.message);
    });
    return () => {
      alive = false;
      void loading?.destroy().catch(() => {});
    };
  }, [entry.id, entry.version]);
  useEffect(() => {
    if (!area.current) return;
    const observer = new ResizeObserver(([e]) =>
      setWidth(e.contentRect.width - 48),
    );
    observer.observe(area.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!doc || !canvas.current) return;
    let alive = true,
      task: RenderTask | undefined;
    setRendering(true);
    doc
      .getPage(page)
      .then((p) => {
        if (!alive) return;
        const base = p.getViewport({ scale: 1 });
        const scale = Math.min(width / base.width, 1.5) * zoom,
          viewport = p.getViewport({ scale });
        const c = canvas.current!;
        c.width = viewport.width * devicePixelRatio;
        c.height = viewport.height * devicePixelRatio;
        c.style.width = viewport.width + "px";
        c.style.height = viewport.height + "px";
        task = p.render({
          canvas: c,
          canvasContext: c.getContext("2d")!,
          viewport,
          transform: [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0],
        });
        return task.promise;
      })
      .catch((e: Error) => {
        if (alive && e.name !== "RenderingCancelledException")
          setError(e.message);
      })
      .finally(() => {
        if (alive) setRendering(false);
      });
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [doc, page, zoom, width]);
  return (
    <div className="pdf-reader">
      <div className="reader-tools">
        <button
          aria-label="上一页"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <span>
          第 {page} / {doc?.numPages || "…"} 页
        </span>
        <button
          aria-label="下一页"
          disabled={!doc || page >= doc.numPages}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight size={16} />
        </button>
        <i />
        <button
          aria-label="缩小"
          onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
        >
          <ZoomOut size={16} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          aria-label="放大"
          onClick={() => setZoom(Math.min(2, zoom + 0.1))}
        >
          <ZoomIn size={16} />
        </button>
        <button className={pin ? "active" : ""} onClick={() => setPin(!pin)}>
          <MessageSquarePlus size={16} />{" "}
          {pin ? "点击页面放置批注" : "添加批注"}
        </button>
      </div>
      <div className="pdf-scroll" ref={area}>
        {error ? (
          <div className="reader-error">{error}</div>
        ) : (
          <>
            <div
              className={"pdf-sheet " + (pin ? "pinning" : "")}
              onClick={(e) => {
                if (!pin || rendering) return;
                const r = e.currentTarget.getBoundingClientRect();
                onPin(
                  (e.clientX - r.left) / r.width,
                  (e.clientY - r.top) / r.height,
                );
                setPin(false);
              }}
            >
              <canvas ref={canvas} />
              {comments
                .filter((c) => c.page === page && c.version === entry.version)
                .map((c, i) => (
                  <button
                    className="pdf-pin"
                    key={c.id}
                    style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
                    title={c.text}
                    onClick={(e) => {
                      e.stopPropagation();
                      document
                        .getElementById("comment-" + c.id)
                        ?.scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    {i + 1}
                  </button>
                ))}
            </div>
            {(!doc || rendering) && (
              <div className="loading">正在渲染页面…</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none';">`;
export function HtmlReader({ entry }: { entry: Entry }) {
  const [html, setHtml] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    readBlob(entry)
      .then((b) => b.text())
      .then((t) => {
        if (alive) setHtml(policy + t);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [entry.id, entry.version]);
  return error ? (
    <div className="reader-error">{error}</div>
  ) : !html ? (
    <div className="loading">正在打开 HTML 文档…</div>
  ) : (
    <iframe
      key={entry.id + entry.version}
      className="document-frame"
      title="HTML 文档预览"
      sandbox="allow-scripts"
      srcDoc={html}
    />
  );
}
export function DocxReader({ entry }: { entry: Entry }) {
  const [html, setHtml] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    (async () => {
      const [{ renderAsync }, blob, { default: purify }] = await Promise.all([
        import("docx-preview"),
        readBlob(entry),
        import("dompurify"),
      ]);
      const div = document.createElement("div");
      await renderAsync(await blob.arrayBuffer(), div, undefined, {
        inWrapper: true,
        ignoreWidth: false,
        useBase64URL: true,
        renderHeaders: true,
        renderFooters: true,
      });
      const clean = purify.sanitize(div.innerHTML, {
        FORCE_BODY: true,
        ADD_TAGS: ["style"],
        ADD_ATTR: ["style"],
      });
      if (alive)
        setHtml(
          policy +
            `<style>body{margin:0;background:#eeeae2}.docx-wrapper{padding:28px!important}section.docx{max-width:100%;box-sizing:border-box}img{max-width:100%}</style>` +
            clean,
        );
    })().catch((e) => {
      if (alive) setError(e.message);
    });
    return () => {
      alive = false;
    };
  }, [entry.id, entry.version]);
  return error ? (
    <div className="reader-error">{error}</div>
  ) : html ? (
    <iframe
      className="document-frame"
      title="Word 文档预览"
      sandbox=""
      srcDoc={html}
    />
  ) : (
    <div className="loading">正在排版 Word 文档…</div>
  );
}
