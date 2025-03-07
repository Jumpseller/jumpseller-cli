import fs from "fs";
import os from "os";
import path from "path";

const CONFIG_DIR = path.join(os.homedir(), ".config", "jumpseller");
const CREDENTIALS_FILE = path.join(CONFIG_DIR, "credentials");
const GLOBAL_CURRENT_FILE = path.join(CONFIG_DIR, "store");
const LOCAL_CURRENT_FILE = ".jumpseller-store";

function splitLines(text) {
  return text.length > 0 ? text.split("\n") : [];
}

function joinLines(lines) {
  lines.splice(0, lines.findIndex((line) => line));
  return lines.length > 0 ? lines.join("\n") + "\n" : "";
}

function canonicalLine(line) {
  const index = line.indexOf("#");
  return line.slice(0, index === -1 ? undefined : index).trim();
}

export function parseStoreReference(store) {
  if (store.endsWith("/")) store = store.slice(0, -1);
  if (store.startsWith("https://")) store = store.slice(8);
  if (store.startsWith("http://")) store = store.slice(7);
  if (store.startsWith("//")) store = store.slice(2);

  if (store === "test") {
    return [true, "test.localhost"];
  } else if (/^([a-z0-9_-]+)\.jumpseller\.com$/.test(store)) {
    return [true, store];
  } else if (/^([a-z0-9_-]+)\.localhost$/.test(store)) {
    return [true, store];
  } else if (/^[a-z0-9_-]+$/.test(store)) {
    return [true, `${store}.jumpseller.com`];
  } else {
    return [false, store];
  }
}

export function validCredentials(credentials) {
  return /^[0-9a-f]{32,50}:[0-9a-f]{32,50}$/.test(credentials);
}

function readFileIfExists(file, fallback = "") {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

export function jumpsellerDomain(store) {
  if (store.endsWith(".localhost")) return `http://${store}`;
  return `https://${store}`;
}

class Auth {
  #loadCredentialsFile() {
    return (this.credentialsText ??= readFileIfExists(CREDENTIALS_FILE).trim());
  }

  #loadGlobalDefault() {
    return (this.globalDefault ??= readFileIfExists(GLOBAL_CURRENT_FILE).trim() || false);
  }

  #writeCredentialsFile() {
    const tmp = `${CREDENTIALS_FILE}.tmp.${Math.random().toString(36).slice(2)}`;
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(tmp, this.credentialsText.trimStart());
    fs.renameSync(tmp, CREDENTIALS_FILE);
  }

  #writeGlobalDefault() {
    const tmp = `${GLOBAL_CURRENT_FILE}.tmp.${Math.random().toString(36).slice(2)}`;
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(tmp, this.globalDefault.trimStart());
    fs.renameSync(tmp, GLOBAL_CURRENT_FILE);
  }

  #writeLocalDefault() {
    const tmp = path.join(this.scopeFolder, `${LOCAL_CURRENT_FILE}.tmp.${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(this.scopeFolder, { recursive: true });
    fs.writeFileSync(tmp, this.scopeDefault.trimStart());
    fs.renameSync(tmp, path.join(this.scopeFolder, LOCAL_CURRENT_FILE));
  }

  #findScopeFolder() {
    const currentDir = process.cwd();
    const home = os.homedir();
    let fingerDir = currentDir;

    while (fingerDir.startsWith(home) || fingerDir !== "/") {
      try {
        const localFilePath = path.join(fingerDir, LOCAL_CURRENT_FILE);
        const content = fs.readFileSync(localFilePath, "utf-8");
        this.scopeDefault = content;
        return (this.scopeFolder = fingerDir);
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
      const parentDir = path.dirname(fingerDir);
      if (parentDir === fingerDir) break;
      fingerDir = parentDir;
    }
    this.scopeDefault = false;
    return (this.scopeFolder = currentDir);
  }

  getGlobalDefault() {
    this.#loadGlobalDefault();
    return this.globalDefault;
  }

  getLocalDefault() {
    this.#findScopeFolder();
    return this.scopeDefault;
  }

  currentStore() {
    return this.commandStore || this.getLocalDefault() || this.getGlobalDefault();
  }

  /**
   * Set and flush a new global default store
   */
  setGlobalDefault(domain) {
    this.globalDefault = domain;
    this.#writeGlobalDefault();
  }

  /**
   * Set and flush a new store on the closest scope
   */
  setLocalDefault(domain) {
    this.#findScopeFolder();
    this.scopeDefault = domain;
    this.#writeLocalDefault();
  }

  /**
   * Designate a store from the command line
   */
  setCommandStore(domain) {
    this.commandStore = domain;
  }

  /**
   * Flush modifications to credentials to disk
   */
  flush() {
    if (this.credentialsTextChanged) this.#writeCredentialsFile();
  }

  /**
   * Parse the credentials file and return a map with canonical domain keys.
   */
  listCredentials() {
    const content = this.#loadCredentialsFile();
    const lines = splitLines(content, "\n").filter((line) => canonicalLine(line));
    const domains = new Map();

    lines.forEach((line) => {
      const [domain, credentials] = canonicalLine(line).split(/\s+/);
      const [okDomain, correctedDomain] = parseStoreReference(domain);

      if (!okDomain || domain !== correctedDomain) {
        console.error("credentials file: Invalid domain %s", domain);
      } else if (!validCredentials(credentials)) {
        console.error("credentials file: Invalid credentials for %s", domain);
      } else if (domains.has(domain)) {
        console.error("credentials file: Duplicate domain %s", domain);
      } else {
        domains.set(domain, { credentials });
      }
    });
    return domains;
  }

  /**
   * Are there (valid) credentials for this domain?
   */
  getCredentials(domain) {
    const storage = this.listCredentials();
    return storage.get(domain);
  }

  /**
   * Add a domain to the internal credentials file
   */
  addCredentials(domain, credentials) {
    let missing = true;
    const content = this.#loadCredentialsFile();
    const lines = splitLines(content).map((line) => {
      const [lineDomain] = canonicalLine(line).split(/\s+/);
      if (domain !== lineDomain) {
        return line;
      } else {
        missing = false;
        return `${domain} ${credentials}`;
      }
    });
    if (missing) lines.push(`${domain} ${credentials}`);
    this.credentialsText = joinLines(lines);
    this.credentialsTextChanged = true;
  }

  /**
   * Remove a domain from the internal credentials file
   */
  removeCredentials(domain) {
    const content = this.#loadCredentialsFile();
    const lines = splitLines(content).filter((line) => {
      const [lineDomain] = canonicalLine(line).split(/\s+/);
      return domain !== lineDomain;
    });
    this.credentialsText = joinLines(lines);
    this.credentialsTextChanged = true;
  }
}

export default new Auth();
