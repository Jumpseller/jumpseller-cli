import { InvalidArgumentError } from "commander";
import fs from "fs";

import { parseStoreReference } from "./services/auth.js";

export function validationCollector(validator, initial = []) {
  return (arg, args) => ((args ??= initial), args.push(validator(arg)), args);
}

export function validateThemeReference(ref) {
  if (ref.match(/^[1-9]\d*$/)) return +ref;
  throw new InvalidArgumentError(`Invalid theme id: "${ref}"`);
}

export function validateZipFilename(filename) {
  if (fs.existsSync(filename)) throw new InvalidArgumentError("File already exists");
  return filename;
}

export function validateStoreDomain(value) {
  const [ok, domain] = parseStoreReference(value);
  if (ok) return domain;
  throw new InvalidArgumentError(`Invalid store reference: "${value}". Expected a store code or jumpseller domain.`);
}
