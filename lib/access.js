import { Command } from "commander";
import plimit from "p-limit";
import readline from "readline-sync";
import { format } from "util";

import Auth, { parseStoreReference, validCredentials, jumpsellerDomain } from "./services/auth.js";
import Api from "./services/api.js";

import { validateStoreDomain } from "./input.js";
import { widetable, assembleTable } from "./output.js";

const STORE_NAME_ERROR_HELP = `
Invalid store format. Please use the store code or domain (such as simple, simple.jumpseller.com, ...)
`.trim();

const ADMIN_AUTH_HELP = `
Each store & account pair has its own set of credentials.
For a given store, you can find the credentials for your account in the admin panel
in the Account Information page located at Account > Preferences > {your account}.
`.trim();

const PROMPT_CREDENTIALS_HELP = `
Each store & account pair has its own set of credentials.
Find the credentials for your account at
    %s/admin/accounts
`.trim();

async function verifyCredentials(store, credentials) {
  console.info("… Verifying credentials are for %s", store);
  try {
    const api = new Api(store, credentials);
    const response = await api.get("/v1/whoami", {});
    if (response.status !== 200) {
      console.error("✖ Error verifying credentials: %s", response.statusText);
    } else {
      const token = await response.json();
      const actualStore = parseStoreReference(token.store)[1];
      if (store === actualStore) {
        console.info("✔ (account %s)", token.account);
        return true;
      } else {
        console.error("✖ credentials are for store %s", token.store);
      }
    }
  } catch (error) {
    console.error("✖ Error verifying credentials", error);
  }
}

function promptForStore() {
  const name = readline.question("Store code or domain: ").trim();
  const [ok, store] = parseStoreReference(name);
  if (ok) return store;
  console.error(STORE_NAME_ERROR_HELP);
  return promptForStore(false);
}

async function promptForCredentials(store, showHelp = false) {
  if (showHelp) console.info(format(PROMPT_CREDENTIALS_HELP, jumpsellerDomain(store)));
  const login = readline.question("Login key: ").trim().toLowerCase();
  const authToken = readline.question("Auth Token: ").trim().toLowerCase();
  const credentials = `${login}:${authToken}`;
  if (validCredentials(credentials) && await verifyCredentials(store, credentials)) return credentials;
  if (!validCredentials(credentials)) console.error("Invalid credentials format.");
  return promptForCredentials(store, false);
}

async function access() {
  const stores = [...Auth.listCredentials().keys()].sort();

  if (stores.length === 0) {
    console.info("No store credentials found, setting up default store.");
    const store = promptForStore();
    await add(store);
    Auth.setGlobalDefault(store);
    console.info("Set global default store to %s", store);
  } else {
    await list();
  }
}

async function add(store) {
  if (!store) store = promptForStore();
  const exists = Auth.getCredentials(store);
  const credentials = await promptForCredentials(store, true);
  Auth.addCredentials(store, credentials);
  Auth.flush();
  console.info("%s credentials for %s", exists ? "Updated" : "Added", store);
}

async function remove(store) {
  const exists = Auth.getCredentials(store);
  if (!exists) {
    console.info("No credentials found for %s", store);
  } else {
    Auth.removeCredentials(store);
    Auth.flush();
    console.info("Removed credentials for %s", store);
  }
}

async function list() {
  const stores = [...Auth.listCredentials().keys()].sort();
  const scopeStore = Auth.getLocalDefault();
  const defaultStore = Auth.getGlobalDefault();

  const tags = { [scopeStore]: "local default", [defaultStore]: "global default" };
  const resolution = {};

  let resolved = 0, n = stores.length;
  const refresh = () => process.stdout.write(format("\u001b[sChecking %d stores... (%d/%d)\u001b[u", n, resolved, n));
  refresh();

  const limiter = plimit(10);
  const promises = stores.map((store) => limiter(async () => {
    try {
      const api = new Api(store);
      const response = await api.get("/v1/whoami", {});
      if (response.status !== 200) {
        resolution[store] = { status: "✖", error: response.statusText };
      } else {
        const token = await response.json();
        const actualStore = parseStoreReference(token.store)[1];
        if (store === actualStore) {
          resolution[store] = { status: "✔", account: token.account };
        } else {
          resolution[store] = { status: "✖", actual: token.store, account: token.account };
        }
      }
    } catch (error) {
      resolution[store] = { status: "✖", error: error.message };
    }
    resolved++;
    refresh();
  }));
  await Promise.all(promises);

  const header = { status: "", store: "store", tag: "", actual: "actual store", account: "account", error: "error" };
  const rows = stores.map((store) => Object.assign({ store, tag: tags[store] || "" }, resolution[store]));

  process.stdout.write("\u001b[s" + widetable(assembleTable(header, rows)));
}

async function current() {
  const store = Auth.currentStore();
  if (store) console.info(store);
}

async function setDefault(store) {
  const exists = Auth.getCredentials(store);
  if (!exists) {
    console.info("No credentials found for %s", store);
    await add(store);
  }
  Auth.setGlobalDefault(store);
  console.info("Set global default store to %s", store);
}

async function setLocal(store) {
  const exists = Auth.getCredentials(store);
  if (!exists) {
    console.info("No credentials found for %s", store);
    await add(store);
  }
  Auth.setLocalDefault(store);
  console.info("Set local default store at %s to %s", Auth.scopeFolder, store);
}

const SUMMARY = "Manage access credentials to the Jumpseller API";
const HELP = `${SUMMARY}.

${ADMIN_AUTH_HELP}

A default store can be set globally, and individual theme folders
can also specify their own default store for commands.
`.trim();

const program = new Command("access");

program.helpCommand(false).usage("command <arguments...>").summary(SUMMARY).description(HELP).action(access);

program
  .command("list")
  .description("List all stored credentials and their accounts")
  .action(list);

program
  .command("current")
  .description("Print the current store")
  .action(current);

program
  .command("add")
  .description("Add or update credentials for a store")
  .argument("[store]", "Store code", validateStoreDomain)
  .action(add);

program
  .command("remove")
  .description("Remove credentials for a store")
  .argument("<store>", "Store code", validateStoreDomain)
  .action(remove);

program
  .command("default")
  .description("Set the global default store")
  .argument("<store>", "Store code", validateStoreDomain)
  .action(setDefault);

program
  .command("local")
  .description("Set a local default store in the current directory")
  .argument("<store>", "Store code", validateStoreDomain)
  .action(setLocal);

export default program;
