---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: TruSpec
  text: Local-first, spec-synced API client
  tagline: Your collection is plain-text YAML in your repo. Your coding agent and your CI both run it and keep it in sync with your OpenAPI spec — fully offline, no account, ever.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Core concepts
      link: /concepts
    - theme: alt
      text: View on GitHub
      link: https://github.com/code-with-rashid/truspec

features:
  - icon: 🎯
    title: The spec is the source of truth
    details: Drift, coverage, and response-contract validation fail your build the moment your collection — or your API — diverges from your OpenAPI spec — offline and in CI.
  - icon: 📦
    title: Local-first & offline
    details: Plain-text YAML that diffs cleanly in Git. No account, no cloud, ever. Everything works without a network.
  - icon: 🤖
    title: Agent-native by design
    details: Every capability is reachable from plain files, a --json CLI, and a first-party MCP server for Claude Code and other agents.
  - icon: 🔋
    title: Batteries included
    details: Run requests with declarative assertions, mock any spec offline, import from Postman & Bruno, and gate CI — one focused tool.
---
