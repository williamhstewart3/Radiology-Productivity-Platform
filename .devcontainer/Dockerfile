FROM mcr.microsoft.com/vscode/devcontainers/javascript-node:18-bullseye

# Install tooling that helps working with bun/turbo monorepos
SHELL ["/bin/bash", "-lc"]

# Keep image lean: bun installer runs in postCreateCommand in the devcontainer, but provide common dev packages
RUN apt-get update \
  && apt-get install -y --no-install-recommends git curl lsof build-essential \
  && rm -rf /var/lib/apt/lists/*

# Set a working directory for container
WORKDIR /workspace
