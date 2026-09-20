/**
 * Markdown pipeline — parity contract with the VitePress baseline
 * (docs/.vitepress/config.mts `markdown.config` + theme behavior).
 *
 * All rules reproduce baseline behavior; deviations are intentional and
 * recorded in docs/design/design-freeze.md §4.
 */
import {
  Marked,
  type Renderer,
  type TokenizerExtension,
  type Tokens,
} from "marked";
import markedKatex from "marked-katex-extension";
import DOMPurify from "dompurify";
import { slugify } from "./slugify";
import { getHighlighter, highlightSync } from "./shiki";

// ---------------------------------------------------------------------------
// Baseline constants (docs/.vitepress/config.mts)
// ---------------------------------------------------------------------------

// Fence languages Shiki doesn't bundle → downgrade to plain block.
const UNSUPPORTED_LANGS = new Set([
  "kconfig",
  "dts",
  "devicetree",
  "cfg",
  "ld",
  "assembly",
  "pwsh",
  "pfofile",
]);

// Real inline HTML tags that stay untouched when encountered bare.
const SAFE_INLINE_HTML = new Set([
  "a",
  "abbr",
  "audio",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "details",
  "div",
  "em",
  "figcaption",
  "figure",
  "hr",
  "i",
  "iframe",
  "img",
  "ins",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "q",
  "s",
  "small",
  "source",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
  "video",
]);

const PLACEHOLDER_RE = /^<\/?([a-zA-Z_][\w.-]*)\s*\/?>$/;

// Typora leftovers / absolute local paths that must not be loaded as images.
const BROKEN_SRC_RE =
  /^(?:[a-zA-Z]:(?:[\\/]|%5[Cc]|%2[Ff])|file:|\\\\|\/(?:home|Users|mnt|root|tmp)\/)/;
const HTML_IMG_SRC_RE = /<img\b([^>]*?)\bsrc\s*=\s*(["'])([^"']*)\2/gi;

const ALERT_RE = /^\[!(note|tip|important|warning|caution)\]([^\n]*)/i;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Plain text of inline tokens (heading ids / TOC). */
export function inlineText(tokens: Tokens.Generic[] | undefined): string {
  if (!tokens) return "";
  let out = "";
  for (const t of tokens) {
    if (t.type === "text" || t.type === "codespan" || t.type === "escape") {
      out += (t as Tokens.Text).text ?? "";
    } else if ("tokens" in t && Array.isArray(t.tokens)) {
      out += inlineText(t.tokens as Tokens.Generic[]);
    }
  }
  return out;
}

/** Scrub broken image srcs out of raw HTML (baseline `scrubHtml`). */
function scrubHtmlImages(html: string): string {
  return html.replace(HTML_IMG_SRC_RE, (full, pre, q, src) =>
    BROKEN_SRC_RE.test(src) ? `<img${pre}src=${q}data:,${q}` : full,
  );
}

// ---------------------------------------------------------------------------
// The Marked instance — configured once at module scope
// ---------------------------------------------------------------------------

const md = new Marked({
  gfm: true,
  breaks: false,
});

// nonStandard: the baseline MathJax pipeline parses `$L$（…）` (closing `$`
// followed by a fullwidth paren). marked-katex-extension's default lookahead
// only allows [\s?!\.,:？！。，：]|$ after the closing `$`, so we relax it.
// Corpus has no currency-style `$<digit>` outside code fences, so this is safe.
md.use(markedKatex({ throwOnError: false, nonStandard: true }));

md.use({
  extensions: [
    // :::callout 💡 ... ::: — baseline `markdown-it-container` port
    {
      name: "callout",
      level: "block",
      start(src: string) {
        return src.startsWith(":::") ? 0 : -1;
      },
      tokenizer(this: { lexer: import("marked").Lexer }, src: string) {
        const m =
          /^:::\s*callout(?:\s+(.*?))?\s*(?:\n|$)([\s\S]*?)\n?:::\s*(?:\n|$)/.exec(
            src,
          );
        if (!m) return undefined;
        const token = {
          type: "callout",
          raw: m[0],
          icon: (m[1] || "💡").trim(),
          inner: m[2],
          tokens: [] as Tokens.Generic[],
        };
        this.lexer.blockTokens(token.inner, token.tokens);
        return token;
      },
      renderer(
        this: { parser: import("marked").Parser },
        token: Tokens.Generic,
      ) {
        const t = token as unknown as {
          icon: string;
          tokens: Tokens.Generic[];
        };
        return `<div class="callout custom-block"><span class="callout-icon">${t.icon}</span><div class="callout-content">${this.parser.parse(t.tokens)}</div></div>`;
      },
    } as TokenizerExtension,
  ],
});

const rendererOverrides: Partial<Renderer> = {
  // Heading ids follow the baseline slugify exactly.
  heading(this: Renderer, { tokens, depth }: Tokens.Heading) {
    const text = inlineText(tokens);
    return `<h${depth} id="${slugify(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
  },

  // Mermaid fences → placeholder div (hydrated by mermaid.run after mount);
  // unsupported fence langs → plain block; else shiki dual-theme highlight.
  code(this: Renderer, { lang, text }: Tokens.Code) {
    const langId = (lang || "").trim().split(/\s+/)[0].toLowerCase();
    if (langId === "mermaid") {
      return `<div class="mermaid">${escapeHtml(text)}</div>\n`;
    }
    if (UNSUPPORTED_LANGS.has(langId)) {
      return `<pre class="shiki vp-code"><code>${escapeHtml(text)}</code></pre>\n`;
    }
    return highlightSync(text, langId);
  },

  // Internal `#hash` links get the same slugify rewrite as the baseline
  // `link_open` renderer (path untouched, hash rewritten).
  link(this: Renderer, { href, title, tokens }: Tokens.Link) {
    const text = this.parser.parseInline(tokens);
    if (href.includes("#") && !href.startsWith("http")) {
      const [path, ...rest] = href.split("#");
      const hash = rest.join("#");
      if (hash) {
        let decoded = hash;
        try {
          decoded = decodeURIComponent(hash);
        } catch {
          /* malformed URI — keep as-is */
        }
        let newHash = decoded
          .trim()
          .toLowerCase()
          .replace(/[\s.:：()（）]+/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-+|-+$/g, "");
        if (/^\d/.test(newHash)) newHash = "_" + newHash;
        href = `${path}#${newHash}`;
      }
    }
    let out = `<a href="${href}"`;
    if (title) out += ` title="${escapeHtml(title)}"`;
    return out + `>${text}</a>`;
  },

  // Broken images → literal `[broken image: alt]` (baseline text token).
  image(this: Renderer, { href, title, text }: Tokens.Image) {
    if (BROKEN_SRC_RE.test(href)) {
      return `<span class="broken-image">[broken image: ${text || ""}]</span>`;
    }
    let out = `<img src="${href}" alt="${text || ""}"`;
    if (title) out += ` title="${escapeHtml(title)}"`;
    return out + ">";
  },

  // Bare `<placeholder>` inline tags → escaped text unless allowlisted.
  html(this: Renderer, { text, block }: Tokens.HTML) {
    if (block) return scrubHtmlImages(text);
    const trimmed = text.trim();
    const m = trimmed.match(PLACEHOLDER_RE);
    if (m && !SAFE_INLINE_HTML.has(m[1].toLowerCase())) {
      return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }
    return scrubHtmlImages(text);
  },

  // GitHub alerts — baseline VitePress native output:
  // `<div class="note custom-block github-alert"><p class="custom-block-title">NOTE</p>…`
  blockquote(this: Renderer, { tokens }: Tokens.Blockquote) {
    const first = tokens.find((t) => t.type === "paragraph");
    const head =
      first && "tokens" in first && Array.isArray(first.tokens)
        ? (first.tokens[0] as Tokens.Text | undefined)
        : undefined;
    if (first && head && head.type === "text") {
      const m = head.text.match(ALERT_RE);
      if (m) {
        const type = m[1].toLowerCase();
        head.text = head.text.slice(m[0].length).trimStart();
        const typeName = m[2].trim() || type.toUpperCase();
        const rest = tokens.filter((t) => t !== first || head.text !== "");
        const inner = this.parser.parse(rest);
        return `<div class="${type} custom-block github-alert"><p class="custom-block-title">${typeName}</p>${inner}</div>\n`;
      }
    }
    return `<blockquote>\n${this.parser.parse(tokens)}</blockquote>\n`;
  },

  // Task lists — baseline markdown-it-task-lists DOM:
  // `<ul class="contains-task-list"><li class="task-list-item"><input class="task-list-item-checkbox" disabled="" type="checkbox"> …`
  list(this: Renderer, token: Tokens.List) {
    const hasTask = token.items.some((i) => i.task);
    const tag = token.ordered ? "ol" : "ul";
    const cls = hasTask ? ' class="contains-task-list"' : "";
    const start =
      token.ordered && token.start !== 1 ? ` start="${token.start}"` : "";
    let body = "";
    for (const item of token.items) {
      body += this.listitem(item);
    }
    return `<${tag}${start}${cls}>\n${body}</${tag}>\n`;
  },

  listitem(this: Renderer, token: Tokens.ListItem) {
    if (token.task) {
      const checkbox = token.tokens.find((t) => t.type === "checkbox") as
        Tokens.Checkbox | undefined;
      const rest = token.tokens.filter((t) => t.type !== "checkbox");
      const box = checkbox
        ? this.checkbox(checkbox)
        : '<input class="task-list-item-checkbox" disabled="" type="checkbox"> ';
      return `<li class="task-list-item">${box}${this.parser.parse(rest)}</li>\n`;
    }
    return `<li>${this.parser.parse(token.tokens)}</li>\n`;
  },

  checkbox(this: Renderer, { checked }: Tokens.Checkbox) {
    return `<input class="task-list-item-checkbox" ${checked ? 'checked="" ' : ""}disabled="" type="checkbox"> `;
  },
};

md.use({ renderer: rendererOverrides });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RenderResult {
  html: string;
  title: string;
  headings: { id: string; text: string; depth: number }[];
}

/** Extract YAML frontmatter (`---\n...\n---`) if present. */
export function splitFrontmatter(src: string): {
  frontmatter: string | null;
  body: string;
} {
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(src);
  if (!m) return { frontmatter: null, body: src };
  return { frontmatter: m[1], body: src.slice(m[0].length) };
}

/**
 * Render a markdown document to sanitized HTML. Shiki is warmed before
 * parsing so highlighting is synchronous within the marked pipeline.
 */
export async function renderMarkdown(src: string): Promise<RenderResult> {
  await getHighlighter();
  const { body } = splitFrontmatter(src);

  const headings: RenderResult["headings"] = [];
  const tokens = md.lexer(body);
  for (const tok of tokens) {
    if (tok.type === "heading") {
      const t = tok as Tokens.Heading;
      headings.push({
        id: slugify(inlineText(t.tokens)),
        text: inlineText(t.tokens),
        depth: t.depth,
      });
    }
  }

  const raw = md.parse(body) as string;
  const html = DOMPurify.sanitize(raw, { ADD_TAGS: ["mermaid"] });

  const titleMatch = /^#\s+(.+)$/m.exec(body);
  return { html, title: titleMatch ? titleMatch[1].trim() : "", headings };
}
