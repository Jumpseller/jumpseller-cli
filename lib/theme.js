import { Command, InvalidArgumentError } from "commander";
import { pipeline } from "stream";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import archiver from "archiver";
import unzipper from "unzipper";
import FormData from "form-data";

import Auth from "./services/auth.js";
import Api from "./services/api.js";
import { ThemeWatcher } from "./services/watcher.js";

import { withCurrentStore } from "./middleware.js";
import { validateThemeReference, validationCollector } from "./input.js";
import { widetable, assembleTable, timeAgo } from "./output.js";

const streamPipeline = promisify(pipeline);

function assembleThemesTable(themes) {
  const header = ["id", "name", "status", "parent", "version", "last updated", "installed", "author", "lang"];
  const rows = themes.map((theme) => ({
    id: theme.id,
    name: theme.name,
    status: theme.in_use ? "active" : "",
    parent: theme.parent,
    version: theme.version,
    "last updated": theme.updated_at && timeAgo(theme.updated_at * 1000),
    installed: theme.created_at && new Date(theme.created_at * 1000).toLocaleString(),
    author: theme.author,
    lang: theme.language,
  }));
  return assembleTable(header, rows);
}

function temporaryFilename(extension) {
  return path.join(os.tmpdir(), `jumpseller-${Date.now()}${extension}`);
}

async function fetchPresigned(api) {
  const response = await api.get("v1/themes/presigned_for_import");
  return response.json();
}

function submitFormData(formData, url) {
  return new Promise((resolve, reject) => {
    formData.submit(url, (err, res) => {
      if (err) return reject(err);
      resolve(res);
    });
  });
}

function recurseFolder(prefixPath, currentPath, callback) {
  for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
    const zipPath = path.join(prefixPath, entry.name);
    const fsPath = entry.isSymbolicLink()
      ? fs.realpathSync(path.join(currentPath, entry.name))
      : path.join(currentPath, entry.name);

    if (fs.statSync(fsPath).isDirectory()) {
      recurseFolder(zipPath, fsPath, callback);
    } else {
      callback(zipPath, fsPath);
    }
  }
}

/**
 * Zip the entire folder at the given path, including hidden files,
 * and return the path to the resulting zip file in a temporary directory.
 */
function zipFolder(folderPath) {
  const outputPath = temporaryFilename(".zip");

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 9 } }); // Maximum compression

    output.on("close", () => resolve(outputPath));
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);

    recurseFolder(".", folderPath, (zipPath, fsPath) => {
      archive.file(fsPath, { name: zipPath });
    });

    archive.finalize();
  });
}

function unzipFolder(zipPath, outputPath) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: outputPath }))
      .on("close", () => {
        console.log("Extraction complete.");
        resolve();
      })
      .on("error", (err) => {
        console.error("Error during extraction:", err);
        reject(err);
      });
  });
}

const list = withCurrentStore(async function list() {
  const store = Auth.currentStore();
  const api = new Api(store);
  const response = await api.get("/v1/themes/list", {});
  const themes = await response.json();

  console.info(widetable(assembleThemesTable(themes)));
});

const apply = withCurrentStore(async function apply(id) {
  const store = Auth.currentStore();
  const api = new Api(store);

  const response = await api.put("/v1/themes/apply", { theme: id });
  if (response.ok) {
    console.info("Theme %s successfully applied", id);
  } else if (response.status === 404) {
    console.info("Theme %s not found in %s", id, store);
  } else {
    console.error("Theme %s: Unexpected error", id, response);
  }
});

const remove = withCurrentStore(async function remove(ids) {
  const store = Auth.currentStore();
  const api = new Api(store);

  const responses = [...new Set(ids)].map(async (id) => {
    const response = await api.delete("/v1/themes", { theme: id });
    if (response.ok) {
      console.info("Theme %s successfully deleted", id);
    } else if (response.status === 404) {
      console.info("Theme %s not found in %s", id, store);
    } else {
      console.error("Theme %s: Unexpected error", id, response);
    }
  });
  await Promise.all(responses);
});

const rename = withCurrentStore(async function rename(id, name) {
  const store = Auth.currentStore();
  const api = new Api(store);

  name = name.join(" ");
  if (!name) throw new InvalidArgumentError("New name is required");
  if (name.length > 65) throw new InvalidArgumentError("Name is too long (max 65 characters)");

  const response = await api.put("/v1/themes/update_fields", { theme: id, name });
  if (response.ok) {
    console.info("Theme %s successfully renamed", id);
  } else if (response.status === 404) {
    console.info("Theme %s not found in %s", id, store);
  } else {
    console.error("Theme %s: Unexpected error", id, response);
  }
});

const watch = withCurrentStore(async function watch(id, folder, options) {
  if (options.unsafe) options.allow.push(...WATCH_UNSAFE_FILES);
  folder ||= ".";

  const store = Auth.currentStore();
  const api = new Api(store);
  const response = await api.get("/v1/themes/list", {});
  const themes = await response.json();
  const theme = themes.find((theme) => theme.id === id);

  if (!theme) {
    console.info(widetable(assembleThemesTable(themes)));
    console.error("Theme %s not found in %s", id, store);
    return;
  }

  const watcher = new ThemeWatcher(store, theme.id, options);
  await watcher.watch(folder);
});

const exportTheme = withCurrentStore(async function exportTheme(id, filename) {
  const store = Auth.currentStore();
  const api = new Api(store);
  const response = await api.get("/v1/themes/list", {});
  const themes = await response.json();
  const theme = themes.find((theme) => theme.id === id);

  if (!theme) {
    console.info(widetable(assembleThemesTable(themes)));
    console.error("Theme %s not found in %s", id, store);
    return;
  }

  const zipFile = temporaryFilename(".zip");
  filename ||= `theme-${id}.zip`;

  try {
    const response = await api.post("/v1/themes/export", { theme: id });
    if (!response.ok) {
      throw new Error(`Unexpected response ${response.statusText}`);
    }
    await streamPipeline(response.body, fs.createWriteStream(zipFile));
  } catch (error) {
    console.error("Error downloading or saving the file:", error);
  }

  if (filename.endsWith(".zip")) {
    fs.renameSync(zipFile, filename);
    console.info("Theme folder downloaded to %s", filename);
  } else {
    await unzipFolder(zipFile, filename);
    console.info("Theme folder downloaded and extracted to %s", filename);
  }
});

const importTheme = withCurrentStore(async function importTheme(folder) {
  const store = Auth.currentStore();
  const api = new Api(store);

  const zip = await zipFolder(folder);
  const presigned = await fetchPresigned(api);

  const filename = path.basename(zip).toString();
  console.log("FOLDER %s | %s", folder, filename);

  const formData = new FormData();
  Object.entries(presigned.fields).forEach(([key, value]) => {
    formData.append(key, value);
  });
  formData.append("file", fs.createReadStream(zip), filename);

  console.log("UPLOAD 1");
  const upload = await submitFormData(formData, presigned.url);
  console.log("UPLOAD 2", upload);
  if (upload.statusCode !== 200) {
    console.error("[Upload error]", upload);
    process.exit(1);
  }

  try {
    const params = {};
    const response = await api.post("v1/themes/presigned_import", params, {
      filename,
      source: null,
    });
    console.log("UPLOAD 3", response);
    if (!response.ok) {
      throw new Error(`Unexpected response ${response.statusText}`);
    }
    console.info("Theme successfully imported from %s", folder);
  } catch (error) {
    console.error("Error importing theme:", error);
  }
});

const SUMMARY = "Manage themes in a store";
const HELP = `${SUMMARY}.

Themes are referenced by their integer id.
This id can be found in the URL of the editors, for example: /admin/themes/editor/654321
`.trim();

const program = new Command("theme");

program.helpCommand(false).usage("command <arguments...>").summary(SUMMARY).description(HELP);

program
  .command("list")
  .description("List all themes in the store")
  .action(list);

program
  .command("delete")
  .description("Delete one or more theme")
  .argument("<theme-id...>", "Theme id", validationCollector(validateThemeReference))
  .action(remove);

program
  .command("apply")
  .description("Set a theme as active")
  .argument("<theme-id>", "Theme id", validateThemeReference)
  .action(apply);

program
  .command("rename")
  .description("Rename a theme")
  .argument("<theme-id>", "Theme id", validateThemeReference)
  .argument("[name...]", "New name")
  .action(rename);

program
  .command("export")
  .description("Export an installed theme to a local zip")
  .argument("<theme-id>", "Theme id", validateThemeReference)
  .argument("[folder]", "Folder or zip filename to save exported theme")
  .action(exportTheme);

program
  .command("import")
  .description("Import a local theme folder into a store")
  .argument("<folder>", "Folder to import")
  .action(importTheme);

const WATCH_SUMMARY = "Mirror local edits to an installed theme";
const WATCH_HELP = `${WATCH_SUMMARY}.

Listen for fs write events to schema files in the local theme folder and
issue corresponding schema edit events to a designated installed theme.

This command is git-aware. If an fs write operation detected appears to
have been the result of a git operation (such as git stash, git switch,
git pull and so on) it will exit with an error to avoid triggering an
unintentional bulk write to the installed theme. This is not very robust
yet, so please exercise caution.

Options --allow, --block and --unsafe can be used to control which files
should be processed or ignored. By default writes to components/*.json
are blocked as they can be quite destructive.
`.trim();
const WATCH_UNSAFE_FILES = ["components/*.json"];

program
  .command("watch")
  .summary(WATCH_SUMMARY)
  .description(WATCH_HELP)
  .option("--block <pattern>", "Blocklist pattern (put globs inside quotes)", validationCollector((arg) => arg), WATCH_UNSAFE_FILES)
  .option("--allow <pattern>", "Allowlist pattern (put globs inside quotes)", validationCollector((arg) => arg), [])
  .option("--unsafe", "Shorthand for allowing all known unsafe file patterns")
  .argument("<theme-id>", "Theme id", validateThemeReference)
  .argument("[folder]", "Folder to watch (default .)")
  .action(watch);

export default program;
