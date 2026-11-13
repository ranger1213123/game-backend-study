const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );

/** Resolve course-relative Markdown links without ever leaving learning/. */
export function resolveDocumentLink(href, sourceFile = "learning/README.md") {
  try {
    if (typeof href !== "string" || typeof sourceFile !== "string") return null;
    const hash = href.indexOf("#");
    const beforeHash = hash < 0 ? href : href.slice(0, hash);
    const pathname = decodeURIComponent(beforeHash.split("?")[0]);
    const anchor = hash < 0 ? "" : decodeURIComponent(href.slice(hash + 1));
    if (
      !pathname ||
      /[\\\u0000-\u001f:%]/.test(pathname) ||
      !pathname.toLowerCase().endsWith(".md")
    )
      return null;
    const absolute = pathname.startsWith("/");
    const candidate = absolute ? pathname.slice(1) : pathname;
    const rootRelative = absolute || candidate.startsWith("learning/");
    const parts = rootRelative ? [] : sourceFile.split("/").slice(0, -1);
    for (const segment of candidate.split("/")) {
      if (!segment || segment === ".") continue;
      if (segment === "..") {
        if (parts.length <= 1) return null;
        parts.pop();
      } else parts.push(segment);
    }
    if (parts[0] !== "learning" || parts.length < 2) return null;
    return { path: parts.join("/"), anchor };
  } catch {
    return null;
  }
}

function headingSlug(text) {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}_\-\s]/gu, "")
      .replace(/\s/g, "-") || "section"
  );
}

/** The injected libraries make the same renderer testable without a browser. */
export function createRenderer({
  markdownit = globalThis.markdownit,
  hljs = globalThis.hljs,
} = {}) {
  if (typeof markdownit !== "function")
    throw Error("本地 Markdown 组件未加载，请刷新页面。");
  const parser = markdownit({
    html: false,
    linkify: false,
    typographer: false,
    breaks: false,
  });
  const defaultHeading =
    parser.renderer.rules.heading_open ||
    ((tokens, index, options, env, self) =>
      self.renderToken(tokens, index, options));
  parser.renderer.rules.heading_open = (tokens, index, options, env, self) => {
    const content = tokens[index + 1];
    const plain =
      content?.children
        ?.map((token) => (token.type === "html_inline" ? "" : token.content))
        .join("") ||
      content?.content ||
      "";
    const base = (env.headingPrefix || "") + headingSlug(plain);
    const count = env.headingCounts.get(base) || 0;
    env.headingCounts.set(base, count + 1);
    tokens[index].attrSet("id", count ? `${base}-${count}` : base);
    return defaultHeading(tokens, index, options, env, self);
  };

  parser.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const href = token.attrGet("href") || "";
    if (/^https?:\/\//i.test(href)) {
      token.attrSet("target", "_blank");
      token.attrSet("rel", "noopener noreferrer");
      env.linkStack.push("a");
      return self.renderToken(tokens, index, options);
    }
    if (href.startsWith("#")) {
      if (env.headingPrefix) token.attrSet("href", `#${env.headingPrefix}${href.slice(1)}`);
      env.linkStack.push("a");
      return self.renderToken(tokens, index, options);
    }
    const document = resolveDocumentLink(href, env.sourceFile);
    if (document) {
      token.attrSet(
        "href",
        `#/doc/${encodeURIComponent(document.path)}${document.anchor ? `?anchor=${encodeURIComponent(document.anchor)}` : ""}`,
      );
      token.attrSet("data-doc-path", document.path);
      if (document.anchor) token.attrSet("data-doc-anchor", document.anchor);
      env.linkStack.push("a");
      return self.renderToken(tokens, index, options);
    }
    env.linkStack.push("span");
    return '<span class="unavailable-link" title="该文件不属于本地课程文档，请在源码仓查看">';
  };
  parser.renderer.rules.link_close = (tokens, index, options, env) =>
    `</${env.linkStack.pop() || "a"}>`;

  // Images never trigger network requests: this reader works entirely offline.
  parser.renderer.rules.image = (tokens, index) =>
    `<span class="markdown-image-alt">[图片：${escapeHTML(tokens[index].content || "课程插图")}]</span>`;
  const codeBlock = (code, info = "") => {
    const requested = info.trim().split(/\s+/)[0].toLowerCase();
    const language = /^[a-z0-9+#.-]{1,40}$/.test(requested)
      ? requested
      : "text";
    const aliases = {
      sh: "bash",
      shell: "bash",
      ps1: "powershell",
      pwsh: "powershell",
      proto: "protobuf",
      "c#": "csharp",
    };
    const highlightLanguage = aliases[language] || language;
    let body = escapeHTML(code);
    if (hljs?.getLanguage?.(highlightLanguage)) {
      try {
        body = hljs.highlight(code, {
          language: highlightLanguage,
          ignoreIllegals: true,
        }).value;
      } catch {
        /* Keep escaped plain text if a language cannot be highlighted. */
      }
    }
    const label = language === "mermaid" ? "Mermaid · 图示源码" : language;
    return `<div class="code-block" data-language="${escapeHTML(language)}"><div class="code-toolbar"><span class="code-language">${escapeHTML(label)}</span><button type="button" class="copy-code" data-copy-code aria-label="复制代码">复制</button></div><pre><code class="hljs language-${escapeHTML(language)}">${body}</code></pre></div>\n`;
  };
  parser.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index];
    if (token.info.trim() === "study-question") {
      try {
        const q = JSON.parse(token.content);
        if (!q || typeof q.prompt !== "string" || typeof q.code !== "string" ||
          (q.language !== undefined && typeof q.language !== "string") ||
          !Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > 6 ||
          !Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.choices.length ||
          typeof q.hint !== "string" || typeof q.solution !== "string" ||
          q.choices.some(c => !c || typeof c.text !== "string" || typeof c.why !== "string") ||
          token.content.length > 24_000) throw Error("invalid question");
        return `<section class="study-question"><div class="eyebrow">停下来，推演一步</div><h4>${escapeHTML(q.prompt)}</h4>${codeBlock(q.code, q.language || "python")}<div class="question-choices" role="group" aria-label="选择你预测的结果">${q.choices.map((c,i)=>`<button class="question-choice" data-action="answer-question" data-correct="${i===q.correct}" data-explanation="${escapeHTML(c.why)}" aria-pressed="false"><span>${String.fromCharCode(65+i)}</span>${escapeHTML(c.text)}</button>`).join("")}</div><p class="question-feedback" role="status" hidden></p><details class="question-hint"><summary>需要一点提示</summary><p>${escapeHTML(q.hint)}</p></details><details class="question-solution"><summary>查看完整解释</summary><p>${escapeHTML(q.solution)}</p></details><small>这是本地预测练习；代码未在网页中执行，作答不会自动完成课程。</small></section>`;
      } catch { return codeBlock(token.content, "text"); }
    }
    return codeBlock(token.content, token.info);
  };
  parser.renderer.rules.code_block = (tokens, index) =>
    codeBlock(tokens[index].content);
  parser.renderer.rules.table_open = () =>
    '<div class="table-scroll" tabindex="0" role="region" aria-label="可横向滚动的课程表格"><table>\n';
  parser.renderer.rules.table_close = () => "</table></div>\n";

  return (text, sourceFile = "learning/README.md", headingPrefix = "") => {
    if (typeof text !== "string") throw Error("课程正文必须是文本。");
    return parser.render(text, {
      sourceFile,
      headingPrefix,
      headingCounts: new Map(),
      linkStack: [],
    });
  };
}

let defaultRenderer;
export function renderMarkdown(text, sourceFile = "learning/README.md") {
  defaultRenderer ??= createRenderer();
  return defaultRenderer(text, sourceFile);
}
