"use client";

import type { ReactElement } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "@/components/ui/copy-button";

const EXTERNAL = /^https?:\/\//i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Flattens a hast subtree back to its source text so it can be copied. */
function collectText(node: unknown): string {
  if (!isRecord(node)) return "";
  if (node.type === "text" && typeof node.value === "string") return node.value;
  const children = node.children;
  if (!Array.isArray(children)) return "";
  return children.map(collectText).join("");
}

/**
 * remark puts the fence's info string on the inner `<code>` as
 * `language-ts`. Reading it off the hast node is the only reliable way to
 * distinguish a fenced block from inline code in react-markdown v10 — the
 * `inline` prop was removed.
 */
function readLanguage(node: unknown): string {
  if (!isRecord(node)) return "";
  const children = node.children;
  if (!Array.isArray(children)) return "";
  for (const child of children) {
    if (!isRecord(child) || child.tagName !== "code") continue;
    const properties = child.properties;
    if (!isRecord(properties)) continue;
    const raw = properties.className;
    const classes = Array.isArray(raw)
      ? raw
      : typeof raw === "string"
        ? raw.split(/\s+/)
        : [];
    for (const entry of classes) {
      if (typeof entry === "string" && entry.startsWith("language-")) {
        return entry.slice("language-".length);
      }
    }
  }
  return "";
}

const components: Components = {
  a(props) {
    const { href, children } = props;
    const external = typeof href === "string" && EXTERNAL.test(href);
    return (
      <a
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
      >
        {children}
      </a>
    );
  },

  pre(props) {
    const { node, children } = props;
    const language = readLanguage(node);
    const source = collectText(node);

    return (
      <div className="overflow-hidden rounded-card border border-hairline">
        <div className="flex items-center justify-between gap-3 border-b border-hairline bg-elevated/70 py-1 pr-1.5 pl-3.5">
          <span className="font-mono text-[10.5px] tracking-[0.14em] text-ink-faint uppercase">
            {language || "code"}
          </span>
          {source ? <CopyButton value={source} label="Copy" /> : null}
        </div>
        {/* The .markdown pre rule owns the padding and colours; only the
            corners and border need to yield to the wrapper. */}
        <pre style={{ borderRadius: 0, border: "none" }}>{children}</pre>
      </div>
    );
  },
};

/**
 * Renders untrusted issue markdown. Raw HTML is never enabled (no
 * rehype-raw), and `img` is dropped outright — the app makes no external
 * network requests for assets.
 */
export function MarkdownBody({ markdown }: { markdown: string }): ReactElement {
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={components}
        disallowedElements={["img"]}
        unwrapDisallowed
      >
        {markdown}
      </Markdown>
    </div>
  );
}
