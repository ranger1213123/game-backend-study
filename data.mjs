// Both deployments read the same course contract. No notebook data leaves the browser.
export function createCourseSource({ baseURL, mode = "api", fetch: request = globalThis.fetch }) {
  if (!["api", "static"].includes(mode)) throw Error("未知的课程发布方式。");
  const base = new URL("./", baseURL);
  const address = (relative) => new URL(relative, base).pathname + new URL(relative, base).search;
  const read = async (relative) => {
    const response = await request(address(relative), {cache: "no-cache"});
    if (!response.ok) throw Error("学习内容暂时无法读取，请刷新页面。");
    return response.json();
  };
  return {
    mode,
    bookURL: address(mode === "static" ? "book/" : "book"),
    downloadURL: address(mode === "static" ? "backend-systems-textbook.html" : "book?download=1"),
    loadCourse: () => read(mode === "static" ? "data/course.json" : "api/course"),
    loadDocument: (path) => {
      if (typeof path !== "string" || !/^learning\/[\w./-]+\.md$/.test(path) ||
          path.split("/").some(part => part === "." || part === ".."))
        throw Error("这份资料不在课程目录中。");
      return read(mode === "static"
        ? "data/documents/" + path.split("/").map(encodeURIComponent).join("/") + ".json"
        : "api/document?path=" + encodeURIComponent(path));
    },
  };
}
