# Offline reader dependencies

These files are copied without modification from the official npm packages below. They are served locally; the learning reader does not request a CDN or install packages at startup. Retrieved 2026-11-11.

| Local file | Package and source path | SHA-256 |
|---|---|---|
| `markdown-it.min.js` | `markdown-it@14.1.0`, `dist/markdown-it.min.js` | `38c70a1e7ca91ab40e2d9e6e60129851a717ed1c7d4acbbdd41bf9503791cf68` |
| `highlight.min.js` | `@highlightjs/cdn-assets@11.11.1`, `highlight.min.js` | `c4a399dd6f488bc97a3546e3476747b3e714c99c57b9473154c6fb8d259b9381` |
| `powershell.min.js` | `@highlightjs/cdn-assets@11.11.1`, `languages/powershell.min.js` | `8357484cd585fb36f36d0b3eab33518e7fdfdc2e54f1066a4ce73e505567e166` |
| `protobuf.min.js` | `@highlightjs/cdn-assets@11.11.1`, `languages/protobuf.min.js` | `cd2c97c8f6620b9c6c85afa013c614c1d5ad6aac115fc47717401c832a0ba76d` |

Source archives:

- <https://registry.npmjs.org/markdown-it/-/markdown-it-14.1.0.tgz>
- <https://registry.npmjs.org/@highlightjs/cdn-assets/-/cdn-assets-11.11.1.tgz>

`markdown-it.LICENSE` contains the MIT license; `highlight.LICENSE` contains the BSD 3-Clause license. Preserve these license files when distributing the reader. To update, deliberately choose a version, retrieve the corresponding official archive, verify the file hashes, and rerun the Markdown/security tests and browser checks.
