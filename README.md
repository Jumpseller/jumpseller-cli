# Jumpseller CLI

Interact with the Jumpseller API from a command line interface.

This tool is still in early development. Currently only two families of commands are available:

- `access` for managing store credentials
- `theme` a suite of tools for local theme development

Run commands and subcommands with `--help` for more information.

## Installation

Install the Jumpseller CLI globally with npm:

```bash
npm i -g @jumpseller/cli
```

```bash
# Information about commands available.
jumpseller --help
jumpseller theme --help

# Setups the initial credentials.
jumpseller access
```

## Development setup

Basic development setup is to clone the repository and link it globally so the main binary is available everywhere.

```bash
git clone ssh://github.com/Jumpseller/jumpseller-cli
cd jumpseller-cli
yarn install
npm link
```
