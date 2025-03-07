import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";

export class GitObserver {
  constructor(folder = ".") {
    this.folder = folder;
  }

  #file(file) {
    return path.join(this.folder, file);
  }

  #exec(command) {
    return execSync(command, { cwd: this.folder });
  }

  isIndexLocked() {
    return fs.existsSync(this.#file(".git/index.lock"));
  }

  readBranch() {
    return this.#exec("git branch --show-current").toString().trim();
  }

  readStash() {
    const state = this.#exec("git stash list").toString().trim();
    return crypto.createHash("sha1").update(state, "utf8").digest("hex");
  }

  pin() {
    this.branch = this.readBranch();
    this.stash = this.readStash();
  }

  check() {
    return this.isIndexLocked() || this.branch !== this.readBranch() || this.stash !== this.readStash();
  }

  static findGitRoot(dir) {
    for (dir = path.resolve(dir); dir !== path.dirname(dir); dir = path.dirname(dir))
      if (fs.existsSync(path.join(dir, ".git"))) return dir;
  }
}
