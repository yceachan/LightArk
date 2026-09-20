/**
 * Slugify — byte-for-byte equivalent of the VitePress baseline
 * (docs/.vitepress/config.mts `anchor.slugify`).
 *
 * 核心正则：匹配 空格、点、英文冒号、中文冒号、英文括号、中文括号、百分号
 * 连续横线合并、去首尾横线、数字开头加 `_` 前缀。
 */
export const SLUGIFY_CHARS_RE = /[\s.:：()（）%]+/g;

export function slugify(str: string): string {
  const slug = str
    .trim()
    .toLowerCase()
    .replace(SLUGIFY_CHARS_RE, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  // 数字开头 → 加下划线前缀（HTML4 规范）
  return /^\d/.test(slug) ? "_" + slug : slug;
}
