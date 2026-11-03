import { test, expect, type Page } from "@playwright/test";
import { mkdtemp, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type ViteDevServer } from "vite";

const initial = {
  scriptVersion: 1,
  id: "watch-preview-test",
  title: "自动更新测试",
  revision: 1,
  phone: { owner: "测试机主", date: "2026-04-03", time: "21:10" },
  installedApps: ["notes", "settings"],
  content: { notes: [{ id: "test-note", title: "行程", body: "原始安排" }] },
};
let server: ViteDevServer;
let directory: string;
let file: string;
let url: string;

async function start(source: string, extension = "json") {
  directory = await mkdtemp(path.join(tmpdir(), "foundphone-watch-"));
  file = path.join(directory, "story." + extension);
  await writeFile(file, source);
  const previous = process.env.STORY_FILE;
  process.env.STORY_FILE = file;
  try {
    server = await createServer({
      configFile: path.resolve("vite.runtime.config.ts"),
      server: { port: 0, host: "127.0.0.1" },
      logLevel: "silent",
    });
  } finally {
    if (previous === undefined) delete process.env.STORY_FILE;
    else process.env.STORY_FILE = previous;
  }
  await server.listen();
  const address = server.httpServer!.address();
  if (!address || typeof address === "string")
    throw Error("Missing test server port");
  url = `http://127.0.0.1:${address.port}`;
}
async function noteBody(page: Page) {
  await page.getByRole("button", { name: "轻触解锁", exact: true }).click();
  await page.getByRole("button", { name: "打开备忘录", exact: true }).click();
  await page.locator(".notes-list button").filter({ hasText: "行程" }).click();
  return page.locator(".native-note-paper");
}
test.afterEach(async () => {
  await server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("保存自动更新；错误保留旧版；修复、连续保存及原子替换恢复", async ({
  page,
  request,
}) => {
  await start(JSON.stringify(initial));
  await page.goto(url);
  await expect(page).toHaveTitle("自动更新测试 · 捡手机");
  await expect(await noteBody(page)).toContainText("原始安排");
  const changed = structuredClone(initial);
  changed.title = "已修改行程";
  changed.content.notes[0].body = "新的出差安排";
  await writeFile(file, JSON.stringify(changed));
  await expect(page).toHaveTitle("已修改行程 · 捡手机");
  await expect(await noteBody(page)).toContainText("新的出差安排");
  const good = await request.get(url + "/work.json").then((r) => r.text());
  // Invalid JSON must not replace a working preview.
  await writeFile(file, '{"title":');
  await expect(page.locator("vite-error-overlay")).toContainText(
    "已保留上一次可用预览",
  );
  expect(await request.get(url + "/work.json").then((r) => r.text())).toBe(
    good,
  );
  // Recovering to identical valid data must also dismiss the error via reload.
  await writeFile(file, JSON.stringify(changed));
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "轻触解锁", exact: true }),
  ).toBeVisible();
  // Schema errors have useful field paths.
  await writeFile(
    file,
    JSON.stringify({ ...changed, installedApps: ["no-such-app"] }),
  );
  await expect(page.locator("vite-error-overlay")).toContainText(
    "installedApps.0",
  );
  expect(await request.get(url + "/work.json").then((r) => r.text())).toBe(
    good,
  );
  // Structurally valid stories still have to pass their actual ending paths.
  await writeFile(
    file,
    JSON.stringify({
      ...changed,
      events: [
        { id: "finish", type: "ending", event: "start", label: "正确结局" },
      ],
      tests: [{ name: "不通过的路径", steps: [], ending: "不存在的结局" }],
    }),
  );
  await expect(page.locator("vite-error-overlay")).toContainText("未到达结局");
  expect(await request.get(url + "/work.json").then((r) => r.text())).toBe(
    good,
  );
  // Typical editor save: write a replacement then atomically rename it.
  changed.title = "最后一次保存";
  changed.revision++;
  await writeFile(file, JSON.stringify({ ...changed, title: "中间保存" }));
  await writeFile(file + ".tmp", JSON.stringify(changed));
  await rename(file + ".tmp", file);
  await expect(page).toHaveTitle("最后一次保存 · 捡手机");
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  const response = await request.get(url + "/work.json");
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect((await response.json()).updatedAt).toBe(2);
  expect((await request.get(url + "/blank-work.json")).ok()).toBe(true);
  expect((await request.get(url + "/test-work.json")).ok()).toBe(true);
  // Source remains authored data, without compiler output or revision mutations.
  const { readFile } = await import("node:fs/promises");
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual(changed);
});

test("STORY_FILE 指向外部 Markdown；启动时错误也能保存修复", async ({
  page,
  request,
}) => {
  await start("# 尚未填写数据\n", "md");
  await page.goto(url);
  expect((await request.get(url + "/work.json")).status()).toBe(503);
  await writeFile(
    file,
    "# 故事\n```json\n" + JSON.stringify(initial) + "\n```\n",
  );
  await expect(page).toHaveTitle("自动更新测试 · 捡手机");
  await expect(await noteBody(page)).toContainText("原始安排");
});
