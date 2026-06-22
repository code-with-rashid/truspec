import { defineConfig } from "vitepress";

const REPO = "https://github.com/code-with-rashid/truspec";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "TruSpec",
  description: "Local-first, spec-synced, agent-native API client.",
  lang: "en-US",

  // GitHub Pages serves a *project* site at /<repo>/, so the site must be built
  // with that base path. If you later attach a custom domain at the root, change
  // this to "/".
  base: "/truspec/",

  cleanUrls: true,
  lastUpdated: true,

  // docs/README.md stays as the GitHub folder index; the site home is index.md.
  srcExclude: ["README.md"],

  // VitePress renders Markdown through Vue, which treats `{{ ... }}` as a template
  // expression. TruSpec's own syntax IS `{{var}}`, so protect inline code with `v-pre`
  // to render it literally. (Fenced code blocks are already protected automatically.)
  markdown: {
    config(md) {
      md.renderer.rules.code_inline = (tokens, idx) =>
        `<code v-pre>${md.utils.escapeHtml(tokens[idx].content)}</code>`;
    },
  },

  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: "Guide", link: "/getting-started" },
      {
        text: "Reference",
        items: [
          { text: "File format", link: "/file-format" },
          { text: "CLI", link: "/cli" },
          { text: "Programmatic API", link: "/api" },
        ],
      },
      {
        text: "Guides",
        items: [
          { text: "Spec sync", link: "/spec-sync" },
          { text: "Mock server", link: "/mocking" },
          { text: "Importing", link: "/importing" },
          { text: "Scripting", link: "/scripting" },
          { text: "CI/CD", link: "/ci" },
          { text: "AI agents (MCP)", link: "/mcp" },
          { text: "Editors", link: "/editors" },
        ],
      },
      { text: "npm", link: "https://www.npmjs.com/package/truspec" },
    ],

    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "Overview", link: "/" },
          { text: "Getting started", link: "/getting-started" },
          { text: "Core concepts", link: "/concepts" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "File format", link: "/file-format" },
          { text: "CLI", link: "/cli" },
          { text: "Programmatic API", link: "/api" },
        ],
      },
      {
        text: "Guides",
        items: [
          { text: "Spec sync: drift, coverage & contract", link: "/spec-sync" },
          { text: "Mock server", link: "/mocking" },
          { text: "Importing", link: "/importing" },
          { text: "Scripting", link: "/scripting" },
          { text: "CI/CD integration", link: "/ci" },
          { text: "AI agents (MCP)", link: "/mcp" },
          { text: "Editors: Web UI & VS Code", link: "/editors" },
        ],
      },
      {
        text: "Help",
        items: [{ text: "FAQ & troubleshooting", link: "/faq" }],
      },
    ],

    socialLinks: [{ icon: "github", link: REPO }],

    editLink: {
      pattern: `${REPO}/edit/main/docs/:path`,
      text: "Edit this page on GitHub",
    },

    search: { provider: "local" },

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © Rashid Mahmood",
    },
  },
});
