import Auth from "./auth.js";

function resolveApiDomain(store) {
  return store.endsWith(".localhost") ? "http://api.localhost" : "https://api.jumpseller.com";
}

export default class Api {
  constructor(store, credentials) {
    this.store = store;
    this.apiDomain = resolveApiDomain(store);
    this.auth = credentials; // might not be given
  }

  get(path, params = {}) {
    return this.#request("GET", path, params);
  }

  put(path, params, body) {
    return this.#request("PUT", path, params, JSON.stringify(body));
  }

  post(path, params, body) {
    return this.#request("POST", path, params, JSON.stringify(body));
  }

  delete(path, params = {}) {
    return this.#request("DELETE", path, params);
  }

  #request(method, path, params, body) {
    const url = new URL(path, this.apiDomain);
    Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
    return fetch(url, { method, headers: this.#headers(), body });
  }

  #headers() {
    this.auth ??= Auth.getCredentials(this.store).credentials;
    return {
      Authorization: `Basic ${btoa(this.auth)}`,
      "Content-Type": "application/json",
    };
  }
}
