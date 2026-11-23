import MarkdownIt from "markdown-it";

// Raw HTML is off (markdown-it's default), so a description can't inject
// markup; it's escaped instead. Single line breaks are kept, since that's how
// people type in a text box.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

// Links to other sites open in a new tab.
const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) =>
    self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx]?.attrGet("href") ?? "";
  if (/^https?:\/\//.test(href)) {
    tokens[idx]?.attrSet("target", "_blank");
    tokens[idx]?.attrSet("rel", "noopener");
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

/** Markdown → HTML, for use with `set:html`. */
export function renderMarkdown(text: string): string {
  return md.render(text);
}

/** Markdown → plain text, for short previews such as cards. */
export function markdownToText(text: string): string {
  return (
    md
      .render(text)
      // Block boundaries become spaces; inline tags (<strong>, <a>…) just vanish.
      .replace(/<\/(p|li|h[1-6]|blockquote)>|<br\s*\/?>/g, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) =>
        e === "amp"
          ? "&"
          : e === "lt"
            ? "<"
            : e === "gt"
              ? ">"
              : e === "quot"
                ? '"'
                : "'",
      )
      .replace(/\s+/g, " ")
      .trim()
  );
}
