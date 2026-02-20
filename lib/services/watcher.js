import fs from "fs";
import path from "path";
import micromatch from "micromatch";
import process from "process";
import { watch } from "chokidar";

import Api from "./api.js";
import { GitObserver } from "./git.js";

// Lots to be improved here:
// - Batch and debounce writes together
// - And for previous write/unlink to complete before sending next one
export class ThemeWatcher {
  constructor(store, theme, config) {
    this.store = store;
    this.id = theme;
    this.api = new Api(store);
    this.allowlist = config.allow || [];
    this.blocklist = config.block || [];
    this.requests = [];
  }

  async writeBulk(paths, contents) {
    const update = { paths, contents };
    const response = await this.api.put("/v1/themes/schema", { theme: this.id }, update);
    const body = await response.json();
    if (body.error) console.error(body.message);
    return body;
  }

  async write(path, content) {
    return await this.writeBulk([path], [content]);
  }

  async unlink(path) {
    const params = { theme: this.id, paths: [path] };
    const response = await this.api.delete("/v1/themes/schema", params);
    const body = await response.json();
    if (body.error) console.error(body.message);
    return body;
  }

  isKnownPath(path) {
    if (micromatch.isMatch(path, this.allowlist)) return true;
    if (micromatch.isMatch(path, this.blocklist)) return false;
    if (path.startsWith("partials/")) return true;
    if (path.startsWith("components/")) return true;
    if (path.startsWith("templates/")) return true;
    if (path.startsWith("assets/library/")) return false;
    if (path.startsWith("assets/")) return true;
    if (path.startsWith("config/")) return true;
    return false;
  }

  #pinGitRepository(folder) {
    const gitRoot = GitObserver.findGitRoot(folder);
    if (gitRoot) {
      this.gitObserver = new GitObserver(gitRoot);
      this.gitObserver.pin();
      console.info("Detected git repository at %s", gitRoot);
    }
  }

  #checkGitRepository() {
    return !!this.gitObserver && this.gitObserver.check();
  }

  #asyncStopHook() {
    let resolve;
    const promise = new Promise((res) => (resolve = res));
    return [promise, resolve];
  }

  async watch(folder) {
    if (this.watcher) throw new Error("Already watching");

    this.#pinGitRepository(folder);

    this.watcher = watch(folder, {
      ignoreInitial: true,
      alwaysStat: true,
      disableGlobbing: true,
    });

    const [promise, stop] = this.#asyncStopHook();

    this.watcher.on("all", (event, fullpath) => {
      const relativePath = path.relative(folder, fullpath);
      const action = this.isKnownPath(relativePath) ? event : "SKIP";

      if (this.#checkGitRepository()) {
        console.error("Git operation detected on %s, exiting...", this.gitObserver.folder);
        stop();
      }

      switch (action) {
        case "change":
        case "add": {
          const content = fs.readFileSync(fullpath, "utf-8");
          this.requests.push(this.write(relativePath, content));
          console.info("== %s %s", "WRITE", relativePath);
          break;
        }
        case "unlink": {
          this.requests.push(this.unlink(relativePath));
          console.info("== %s %s", "DELETE", relativePath);
          break;
        }
        default: {
          console.info("== %s %s", action, relativePath);
        }
      }
    });

    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);

    try {
      console.info("=== Listening for file events on %s", path.resolve(folder));
      await promise;
      console.info("Stopped listening for file events");
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }

    await this.watcher.close();
    await Promise.all(this.requests);
  }
}
