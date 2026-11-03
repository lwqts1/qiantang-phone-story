import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import type { compileStory as CompileStory } from "../src/story-engine/compiler";
import type { testStory as TestStory } from "../src/story-engine/testStory";

// Development only: publish a complete, validated snapshot in memory. Never
// overwrite the author's source or the last working snapshot on a failed save.
export function storyPreviewPlugin(): Plugin {
  const storyFile = process.env.STORY_FILE || "stories/template/story.json";
  let files = new Set<string>();
  return {
    name: "foundphone-story-preview",
    apply: "serve",
    configureServer(server) {
      const entries = [
        ["/work.json", storyFile],
        ["/blank-work.json", "stories/blank/story.json"],
        ["/test-work.json", "stories/test-preview/story.json"],
      ].map(([url, file]) => [url, path.resolve(server.config.root, file)]);
      files = new Set(entries.map(([, file]) => file));
      let snapshot = new Map<string, string>();
      let generation = 0;
      let closed = false;
      let failed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let failureMessage = "正在编译故事，请稍后刷新。";

      async function build(version: number) {
        if (closed || version !== generation) return;
        let currentFile = storyFile;
        try {
          const { compileStory } = (await server.ssrLoadModule(
            "/src/story-engine/compiler.ts",
          )) as { compileStory: typeof CompileStory };
          const { testStory } = (await server.ssrLoadModule(
            "/src/story-engine/testStory.ts",
          )) as { testStory: typeof TestStory };
          const next = new Map<string, string>();
          for (const [url, file] of entries) {
            currentFile = file;
            const source = await readFile(file, "utf8");
            if (Buffer.byteLength(source) > 100 * 1024 * 1024)
              throw Error("脚本不能超过100MB");
            let json = source;
            if (/\.md$/i.test(file)) {
              const match = /```json\s*\n([\s\S]*?)```/.exec(source);
              if (!match) throw Error("Markdown 需要一个 ```json 剧情数据块");
              json = match[1];
            }
            const { story, work } = compileStory(JSON.parse(json));
            const errors = testStory(story, work);
            if (errors.length) throw Error(errors.join("\n"));
            next.set(url, JSON.stringify(work));
          }
          if (closed || version !== generation) return;
          const changed = [...next].some(
            ([url, data]) => snapshot.get(url) !== data,
          );
          const reload = failed || (snapshot.size > 0 && changed);
          snapshot = next;
          failed = false;
          server.config.logger.info("[story] 校验和通关测试通过，预览已更新。");
          if (reload) server.ws.send({ type: "full-reload", path: "*" });
        } catch (cause) {
          if (closed || version !== generation) return;
          const error = cause as Error & {
            field?: string;
            issues?: { path: (string | number)[]; message: string }[];
          };
          const detail = error.issues
            ? error.issues
                .map((i) => `${i.path.join(".") || "$"}: ${i.message}`)
                .join("\n")
            : `${error.field ? error.field + ": " : ""}${error.message}`;
          failureMessage = `故事未更新，请修正后保存。${snapshot.size ? "已保留上一次可用预览。" : "尚无可用预览。"}\n${currentFile}\n${detail}`;
          failed = true;
          server.config.logger.error("[story] " + failureMessage);
          server.ws.send({
            type: "error",
            err: {
              message: failureMessage,
              stack: "",
              plugin: "foundphone-story-preview",
              id: currentFile,
            },
          });
        }
      }

      // Serialize builds and discard stale results from rapid consecutive saves.
      let queue = build(generation);
      const onFile = (event: string, file: string) => {
        if (
          !files.has(path.resolve(file)) ||
          !["add", "change", "unlink"].includes(event)
        )
          return;
        generation++;
        clearTimeout(timer);
        timer = setTimeout(() => {
          const version = generation;
          queue = queue.then(() => build(version));
        }, 120);
      };
      server.watcher.add([...files]);
      server.watcher.on("all", onFile);
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || "/", "http://localhost").pathname;
        if (!entries.some(([entry]) => url === entry)) return next();
        await queue;
        res.setHeader("Cache-Control", "no-store");
        const data = snapshot.get(url);
        res.setHeader(
          "Content-Type",
          data
            ? "application/json; charset=utf-8"
            : "text/plain; charset=utf-8",
        );
        res.statusCode = data ? 200 : 503;
        res.end(data || failureMessage);
      });
      server.httpServer?.once("close", () => {
        closed = true;
        clearTimeout(timer);
        server.watcher.off("all", onFile);
      });
    },
    handleHotUpdate(ctx) {
      // Only our validated snapshot may trigger the story reload.
      if (files.has(path.resolve(ctx.file))) return [];
    },
  };
}
