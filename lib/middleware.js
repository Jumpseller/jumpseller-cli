import { CommanderError } from "commander";

import Auth from "./services/auth.js";

class NoStoreError extends CommanderError {
  constructor(message) {
    super(1, 'jumpseller.noStore', message);
    Error.captureStackTrace(this, this.constructor);
    this.name = this.constructor.name;
  }
}

class NoCredentialsError extends CommanderError {
  constructor(message) {
    super(1, 'jumpseller.noCredentials', message);
    Error.captureStackTrace(this, this.constructor);
    this.name = this.constructor.name;
  }
}

const NO_STORE_ERROR = `
No store selected through command line, and no local or global default configured.
Use \`jumpseller access\` to setup acces credentials and a default store.
`.trim();

const NO_CREDENTIALS_ERROR = `
No credentials are set for store %s.
Use \`jumpseller access\` to setup acces credentials and a default store.
`.trim();

export function withCurrentStore(action) {
  return (...args) => {
    const store = Auth.currentStore();
    const credentials = Auth.getCredentials(store);
    if (!store) throw new NoStoreError(NO_STORE_ERROR);
    if (!credentials) throw new NoCredentialsError(NO_CREDENTIALS_ERROR.replace('%s', store));
    return action(...args);
  };
}
