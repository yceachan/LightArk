/**
 * Shiki highlighter — github-light + github-dark dual themes, CSS-variable
 * driven (same class/structure the VitePress baseline emitted:
 * `<pre class="shiki shiki-themes github-light github-dark vp-code">`).
 *
 * marked's Parser does NOT await async renderers (verified v18), so we warm
 * the highlighter before parsing (renderMarkdown awaits getHighlighter())
 * and call the synchronous `codeToHtml` afterwards.
 */
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
let highlighter: HighlighterCore | null = null;
let highlighterPromise: Promise<HighlighterCore> | null = null;
export function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise)
    highlighterPromise = createHighlighterCore({
      themes: [
        import("shiki/themes/github-light.mjs"),
        import("shiki/themes/github-dark.mjs"),
      ],
      langs: [
        import("shiki/langs/c.mjs"),
        import("shiki/langs/cpp.mjs"),
        import("shiki/langs/bash.mjs"),
        import("shiki/langs/rust.mjs"),
        import("shiki/langs/json.mjs"),
        import("shiki/langs/typescript.mjs"),
        import("shiki/langs/javascript.mjs"),
        import("shiki/langs/python.mjs"),
        import("shiki/langs/css.mjs"),
        import("shiki/langs/html.mjs"),
        import("shiki/langs/yaml.mjs"),
        import("shiki/langs/toml.mjs"),
        import("shiki/langs/markdown.mjs"),
        import("shiki/langs/diff.mjs"),
      ],
      engine: createOnigurumaEngine(import("shiki/wasm")),
    }).then((hl) => {
      highlighter = hl;
      return hl;
    });
  return highlighterPromise;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function highlightSync(code: string, lang: string): string {
  const safeLang = (lang || "").trim().toLowerCase();
  if (highlighter) {
    try {
      const html = highlighter.codeToHtml(code, {
        lang: safeLang || "plaintext",
        themes: { light: "github-light", dark: "github-dark" },
        defaultColor: false,
      });
      // baseline pre carries the `vp-code` class too
      return html.replace(
        'class="shiki shiki-themes github-light github-dark"',
        'class="shiki shiki-themes github-light github-dark vp-code"',
      );
    } catch {
      // unknown language → plain block (baseline txt behavior)
    }
  }
  return `<pre class="shiki vp-code"><code>${escapeHtml(code)}</code></pre>`;
}
