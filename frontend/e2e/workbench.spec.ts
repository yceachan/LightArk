import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
const testKbs = new Map<BrowserContext, string>();
test.afterEach(async ({ context }) => {
  await context.setOffline(false);
  const id = testKbs.get(context);
  if (id)
    await context.request.delete(`/api/kbs/${id}`, {
      headers: { "x-folio-request": "1" },
    });
});
const password = process.env.FOLIO_TEST_PASSWORD || "folio-local-dev";
const md =
  "# 我的阅读笔记\n\n写下来，让知识成为自己的。\n\n## 一个安静的工作台\n\n这是从文件出发的个人知识库。\n\n> [!TIP]\n> 文件始终保持原样。\n\n## 阅读与思考\n\n| 文件格式 | 用途 |\n| --- | --- |\n| Markdown | 源码编辑 |\n| PDF | 位置批注 |\n\n## 下一步\n\n- [x] 整理文档\n- [ ] 继续探索\n";
async function setup(context: BrowserContext, page: Page, files = ["note.md"]) {
  const login = await context.request.post("/api/login", {
    headers: { "x-folio-request": "1" },
    data: { password },
  });
  expect(login.ok()).toBeTruthy();
  const kb = await (
    await context.request.post("/api/kbs", {
      headers: { "x-folio-request": "1" },
      data: { name: "阅读与研究 " + Date.now() },
    })
  ).json();
  testKbs.set(context, kb.id);
  const entries: any[] = [];
  for (const path of files) {
    let data: Buffer | string = md;
    if (path.endsWith(".pdf"))
      data = await readFile("../tests/fixtures/research.pdf");
    if (path.endsWith(".docx"))
      data = await readFile("../tests/fixtures/field-notes.docx");
    if (path.endsWith(".html"))
      data =
        '<h1>Interactive note</h1><button onclick="this.textContent=\'Clicked\'">Click me</button><script>try{parent.document.body.dataset.pwned="yes"}catch{};fetch("/api/kbs").then(()=>document.body.dataset.leaked="yes").catch(()=>{})</script>';
    if (path === "rendering.md")
      data = await readFile("../tests/fixtures/rendering.md");
    const r = await context.request.put(
      `/api/kbs/${kb.id}/files?path=${path}`,
      { headers: { "x-folio-request": "1", "if-match": "*" }, data },
    );
    expect(r.ok()).toBeTruthy();
    entries.push(await r.json());
  }
  await page.addInitScript((id) => {
    if (window.top === window) localStorage.setItem("folio-kb", id);
  }, kb.id);
  await page.goto("/");
  await expect(page.locator(".folder-heading h1")).toContainText(kb.name);
  return { kb, entries };
}
async function openFile(page: Page, name: string) {
  await page.locator(".file-row-name").filter({ hasText: name }).click();
}

test("desktop: real Markdown source edit, save, export, docking and screenshots", async ({
  context,
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { entries } = await setup(context, page);
  await openFile(page, "note.md");
  await expect(page.locator(".vp-doc h1")).toHaveText("我的阅读笔记");
  await page.screenshot({ path: "../docs/screenshots/desktop.png" });
  await page.getByRole("button", { name: "分屏编辑", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Markdown 源码" })
    .fill(md + "\n## 新的想法\n\n持久保存的内容。");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  const content = await context.request.get(
    `/api/entries/${entries[0].id}/content`,
  );
  expect(await content.text()).toContain("持久保存的内容");
  await page.getByLabel("大纲与信息停靠位置").selectOption("bottom");
  await expect(page.locator(".dock-bottom .inspector")).toBeVisible();
  await page.getByLabel("大纲与信息停靠位置").selectOption("right");
  const header = page.locator(".inspector .panel-title");
  await header.dispatchEvent("dragstart", {
    dataTransfer: await page.evaluateHandle(() => new DataTransfer()),
  });
  await page.locator(".drop-left").dispatchEvent("dragover");
  await page.locator(".drop-left").dispatchEvent("drop");
  await expect(page.locator(".dock-left .inspector")).toBeVisible();
  await page.getByLabel("大纲与信息停靠位置").selectOption("right");
  await page.getByRole("button", { name: "更多文件操作" }).click();
  const d = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出原文件", exact: true }).click();
  expect((await d).suggestedFilename()).toBe("note.md");
  expect(errors).toEqual([]);
});
test("PDF and Word render, page pin persists, sandboxed HTML stays isolated", async ({
  context,
  page,
}) => {
  const { entries } = await setup(context, page, [
    "research.pdf",
    "field-notes.docx",
    "interactive.html",
  ]);
  await openFile(page, "research.pdf");
  await expect(page.locator("canvas")).toBeVisible();
  await expect
    .poll(() =>
      page.locator("canvas").evaluate((c) => (c as HTMLCanvasElement).width),
    )
    .toBeGreaterThan(100);
  await expect(page.locator(".loading")).toHaveCount(0);
  await page.getByRole("button", { name: "添加批注", exact: true }).click();
  await page.locator("canvas").click({ position: { x: 120, y: 170 } });
  await page
    .getByRole("textbox", { name: "批注内容" })
    .fill("跨设备可以读到这条批注");
  await page.getByRole("button", { name: "保存批注" }).click();
  await expect(page.locator(".comment")).toContainText("跨设备可以读到");
  await expect(page.locator(".pdf-pin")).toHaveCount(1);
  await page.screenshot({ path: "../docs/screenshots/pdf.png" });
  expect(
    (
      await (
        await context.request.get(`/api/entries/${entries[0].id}/comments`)
      ).json()
    ).length,
  ).toBe(1);
  await page.locator(".home-tab").click();
  await openFile(page, "field-notes.docx");
  await expect(
    page.frameLocator("iframe").getByText("Field notes", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "../docs/screenshots/docx.png" });
  await page.locator(".home-tab").click();
  await openFile(page, "interactive.html");
  await page
    .frameLocator("iframe")
    .getByRole("button", { name: "Click me" })
    .click();
  await expect(
    page.frameLocator("iframe").getByRole("button", { name: "Clicked" }),
  ).toBeVisible();
  expect(await page.locator("body").getAttribute("data-pwned")).toBeNull();
  expect(
    await page
      .frameLocator("iframe")
      .locator("body")
      .getAttribute("data-leaked"),
  ).toBeNull();
});
test("Markdown math, highlighting, Mermaid, alerts, and script sanitization", async ({
  context,
  page,
}) => {
  await setup(context, page, ["rendering.md"]);
  await openFile(page, "rendering.md");
  await expect(page.locator(".katex").first()).toBeVisible();
  await expect(page.locator("pre.shiki")).toBeVisible();
  await expect(page.locator(".mermaid svg")).toBeVisible();
  await expect(page.locator(".custom-block")).toBeVisible();
  expect(await page.evaluate(() => (window as any).pwned)).toBeUndefined();
});
test("two-device conflicts preserve draft and remote version", async ({
  context,
  page,
}) => {
  const { kb, entries } = await setup(context, page);
  await openFile(page, "note.md");
  await page.getByRole("button", { name: "源码编辑" }).click();
  await page
    .getByRole("textbox", { name: "Markdown 源码" })
    .fill("# My local draft");
  const e = entries[0];
  expect(
    (
      await context.request.put(`/api/kbs/${kb.id}/files?path=note.md`, {
        headers: {
          "x-folio-request": "1",
          "if-match": '"1"',
          "x-folio-entry": e.id,
        },
        data: "# Changed elsewhere",
      })
    ).ok(),
  ).toBeTruthy();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".conflict-banner")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Markdown 源码" }),
  ).toHaveValue("# My local draft");
  expect(
    await (await context.request.get(`/api/entries/${e.id}/content`)).text(),
  ).toBe("# Changed elsewhere");
});
test("offline reopen, locally persisted edits, reconnect and manual sync", async ({
  context,
  page,
}) => {
  const { entries } = await setup(context, page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((r) =>
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => r(),
          { once: true },
        ),
      );
  });
  await page.reload();
  await openFile(page, "note.md");
  await expect(page.locator(".vp-doc h1")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const c = await caches.open("folio-data-v1");
        return (await c.keys()).filter((k) => k.url.includes("/content?"))
          .length;
      }),
    )
    .toBeGreaterThan(0);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".folder-heading h1")).toBeVisible();
  await openFile(page, "note.md");
  await expect(page.locator(".vp-doc h1")).toHaveText("我的阅读笔记");
  await page.getByRole("button", { name: "源码编辑" }).click();
  await page
    .getByRole("textbox", { name: "Markdown 源码" })
    .fill("# Written offline");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("草稿已保存在本机");
  await page.reload();
  await openFile(page, "note.md");
  await expect(
    page.getByRole("textbox", { name: "Markdown 源码" }),
  ).toHaveValue("# Written offline");
  await context.setOffline(false);
  await page
    .locator(".statusbar")
    .getByRole("button", { name: /草稿 · 同步/ })
    .click();
  await expect(page.getByRole("status")).toContainText("已同步 1 份");
  expect(
    await (
      await context.request.get(`/api/entries/${entries[0].id}/content`)
    ).text(),
  ).toBe("# Written offline");
});
test("file and folder actions through the interface", async ({
  context,
  page,
}) => {
  await setup(context, page, []);
  await page
    .getByRole("button", { name: "新建文件夹", exact: true })
    .first()
    .click();
  await page.getByRole("textbox", { name: "新建文件夹" }).fill("Notes");
  await page.getByRole("button", { name: "创建 / 保存" }).click();
  await expect(page.locator(".folder-heading h1")).toHaveText("Notes.");
  await page.getByRole("button", { name: "新建文档", exact: true }).click();
  await page
    .getByRole("textbox", { name: "新建 Markdown" })
    .fill("Notes/fresh.md");
  await page.getByRole("button", { name: "创建 / 保存" }).click();
  await expect(
    page.getByRole("textbox", { name: "Markdown 源码" }),
  ).toContainText("");
  await page.getByRole("button", { name: "阅读模式" }).click();
  await expect(page.locator(".vp-doc h1")).toHaveText("fresh");
  await page.getByRole("button", { name: "更多文件操作" }).click();
  await page
    .getByRole("button", { name: "重命名 / 移动", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "重命名 / 移动" })
    .fill("Notes/renamed.md");
  await page.getByRole("button", { name: "创建 / 保存" }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("renamed.md");
  await page.getByRole("button", { name: "更多文件操作" }).click();
  await page.getByRole("button", { name: "删除文件", exact: true }).click();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.locator(".folder-empty")).toBeVisible();
});
for (const [device, width, height] of [
  ["tablet", 834, 1112],
  ["mobile", 390, 844],
] as const) {
  test(`${device}: responsive reading, menus and source editor`, async ({
    context,
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await setup(context, page);
    await openFile(page, "note.md");
    await expect(page.locator(".vp-doc h1")).toHaveText("我的阅读笔记");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    await page.screenshot({ path: `../docs/screenshots/${device}.png` });
    if (device === "mobile") {
      await page
        .locator(".mobile-nav")
        .getByRole("button", { name: "文件", exact: true })
        .click();
      await expect(page.locator(".drawer-explorer")).toBeVisible();
      await page
        .locator(".drawer")
        .getByRole("button", { name: "隐藏资源管理器" })
        .click();
    } else {
      await page.getByRole("button", { name: "显示大纲与信息" }).click();
      await expect(page.locator(".drawer-inspector")).toBeVisible();
      await page
        .locator(".drawer")
        .getByRole("button", { name: "隐藏大纲与信息" })
        .click();
    }
    await page.getByRole("button", { name: "源码编辑" }).click();
    await expect(
      page.getByRole("textbox", { name: "Markdown 源码" }),
    ).toBeVisible();
  });
}

test("complete KB caching makes all four formats available offline", async ({
  context,
  page,
}) => {
  test.setTimeout(120000);
  await setup(context, page, [
    "note.md",
    "research.pdf",
    "field-notes.docx",
    "interactive.html",
  ]);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((r) =>
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => r(),
          { once: true },
        ),
      );
  });
  await page.getByRole("button", { name: "工作台设置", exact: true }).click();
  await page
    .getByRole("button", { name: "缓存当前知识库", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已读取 4 个文件", {
    timeout: 90000,
  });
  await page.getByRole("button", { name: "关闭设置" }).click();
  await context.setOffline(true);
  await page.reload();
  await openFile(page, "research.pdf");
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator(".loading")).toHaveCount(0);
  await page.locator(".home-tab").click();
  await openFile(page, "field-notes.docx");
  await expect(
    page.frameLocator("iframe").getByText("Field notes", { exact: true }),
  ).toBeVisible();
  await page.locator(".home-tab").click();
  await openFile(page, "interactive.html");
  await page
    .frameLocator("iframe")
    .getByRole("button", { name: "Click me" })
    .click();
  await expect(
    page.frameLocator("iframe").getByRole("button", { name: "Clicked" }),
  ).toBeVisible();
  await page.locator(".home-tab").click();
  await openFile(page, "note.md");
  await expect(page.locator(".vp-doc h1")).toHaveText("我的阅读笔记");
});

test("real import, import update, path search, and dark theme", async ({
  context,
  page,
}) => {
  await setup(context, page, []);
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "imported.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Imported document"),
    });
  await openFile(page, "imported.md");
  await expect(page.locator(".vp-doc h1")).toHaveText("Imported document");
  await page
    .locator("input[type=file]")
    .nth(1)
    .setInputFiles({
      name: "imported.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Updated document"),
    });
  await expect(page.locator(".vp-doc h1")).toHaveText("Updated document");
  await page.getByRole("button", { name: "搜索文件", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索关键词" }).fill("imported");
  await page.locator(".search-results button").click();
  await page.getByRole("button", { name: "切换主题" }).click();
  await expect(page.locator("html")).toHaveClass("dark");
  await page.screenshot({ path: "../docs/screenshots/dark.png" });
});
