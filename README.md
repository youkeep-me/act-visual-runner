# Act Visual Runner - VS Code Extension to visually run GH Actions locally

[![Visual Studio Marketplace Version](https://vsmarketplacebadges.dev/version/fean-developer.act-visual-runner.svg)](https://img.shields.io/visual-studio-marketplace/v/fean-developer.act-visual-runner?style=flat-square&label=Visual%20Studio%20Marketplace)
[![Release](https://img.shields.io/github/v/release/fean-developer/vscode-act-runner-local?style=flat-square&label=release)](https://flat.badgen.net/github/release/fean-developer/act-visual-runner)
[![License](https://img.shields.io/github/license/fean-developer/vscode-act-runner-local?style=flat-square)](LICENSE)

[English](README.md) | [Português (Brasil)](README-pt-br.md)

VS Code extension that runs GitHub Actions workflows locally using [nektos/act](https://github.com/nektos/act) and visualizes execution in real time through an interactive n8n-style graph.

![Extension preview](images/vscode-act-ext.gif)

### New Layout

- Integrated sidebar UI.
- Repository selection opens in the main editor column for a more spacious experience.

<img src="images/image-new-1.png" alt="Act Runner workflow view" width="1024">

### Summary

- View the same workflow summary produced by GitHub Actions.

<img src="images/image-summary.png" alt="Workflow summary" width="1024">

### Analytics

- Review analytics based on local execution history.

<img src="images/image-analytic.png" alt="Execution analytics" width="1024">

This extension makes testing GitHub Actions locally more productive by providing an intuitive visual interface with real-time execution feedback.

> [!IMPORTANT]
> This extension requires [nektos/act](https://github.com/nektos/act) to be installed.

## Requirements

- [nektos/act](https://github.com/nektos/act) installed and available on `PATH`, or configured through `actRunner.actPath`.
- Docker or a compatible alternative such as Podman, Rancher Desktop, or OrbStack.
- VS Code 1.85 or newer.

## Installation

1. Open the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/).
2. Search for **Act/Run - GitHub Actions Visual locally**.
3. Select the extension and click **Install**.

### Install from GitHub Releases

Download the `.vsix` asset from the [latest GitHub Release](https://github.com/fean-developer/vscode-act-runner-local/releases), then open the Extensions view, select `...` -> **Install from VSIX...**, and choose the downloaded file. From a terminal, use `code --install-extension act-visual-runner-<version>.vsix`.

See [the release process](docs/RELEASE_PROCESS.md) for maintainer instructions.

## Quick Start

1. Open a repository containing workflows in `.github/workflows/`.
2. Click the **ACT Runner** icon in the Activity Bar.
3. Select a workflow in the explorer and click **Run**.
4. The graph opens automatically and displays each job and step status in real time.

## Available Commands

| Command | Description |
|---|---|
| `Act: Run Workflow` | Run a complete workflow |
| `Act: Quick Run` | Run the default workflow without prompts |
| `Act: Run Job` | Run a specific job |
| `Act: Stop Execution` | Cancel the current execution |
| `Act: Validate Workflow` | Validate workflow YAML |
| `Act: View History` | View previous executions |
| `Act: Docker Alternatives Guide` | View free alternatives to Docker Desktop |

## Configuration

| Setting | Description | Default |
|---|---|---|
| `actRunner.actPath` | Path to the `act` executable | `act` (`PATH`) |
| `actRunner.defaultImage` | Default Docker image | `catthehacker/ubuntu:act-latest` |

Configure the extension through **Preferences -> Settings -> Act Visual Runner**.

## Configuration Files

Optionally, act can be configured using these configuration files:

- **`.actrc`** - default act flags, for example `--platform ubuntu-latest=catthehacker/ubuntu:act-latest`.
- **`.secrets`** - secrets in `KEY=value` format.
- **`.env`** - environment variables.

### Example `.actrc`

```bash
# ─────────────────────────────────────────────────────────────────────────────
# nektos/act default flags — must live at fean-projects/ root (where act is run).
#
# Invocation:
#   cd /path/to/local-repository
#   act push -W [name of repository]/.github/workflows/pipeline-local.yaml \
#            --secret-file [name of repository]/.secrets
#
# IMPORTANT: act parses this file by splitting on whitespace. Shell quoting is
#   NOT supported. Use --flag=value (no space) when the value contains special
#   characters. Never write: --flag="value with space"
# ─────────────────────────────────────────────────────────────────────────────

# Runner image — catthehacker has Docker CLI, curl, jq, Python, etc.  pre-installed.
# This overrides ~/.config/act/actrc which maps ubuntu-latest=node:16-buster-slim.

--pull=false
-P ubuntu-latest=catthehacker/ubuntu:act-latest

# Attach all job containers to the platform_net network (created by docker compose).
# Allows containers to reach: sonarqube:9000  localhost:5000  portainer:9443
--network platform_net

# Reuse containers between runs to avoid re-downloading SDKs (217MB .NET SDK etc.)
# Disabled: --reuse causes "No such container" errors when containers are cleaned between runs.
# Clean up manually when needed: docker rm -f $(docker ps -aq --filter "name=act-")
# --reuse

```

## User Guide

See the [English user guide](USER_GUIDE.md) or the [Portuguese user guide](USER_GUIDE-pt-br.md) for detailed usage instructions.

## License

MIT
