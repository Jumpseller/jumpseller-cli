import { program } from "commander";

import Auth from "./services/auth.js";
import { validateStoreDomain } from "./input.js";
import AccessCommand from "./access.js";
import ThemeCommand from "./theme.js";

function setAuthStoreFromOption(command) {
  const options = command.opts();
  if (options.store) Auth.setCommandStore(options.store);
}

program
  .version("0.1.0", "-v, --version")
  .description("CLI for the Jumpseller API")
  .option("-s, --store <store>", "Set the store for this command", validateStoreDomain)
  .hook("preSubcommand", setAuthStoreFromOption);

program.addCommand(AccessCommand);
program.addCommand(ThemeCommand);

program.parse(process.argv);
