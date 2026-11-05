# Changelog

## Unreleased

- Code completion and hover documentation for inline ISO Schematron, RELAX NG and XML Schema documents in the `schema` port of `p:validate-with-schematron`, `p:validate-with-relax-ng` and `p:validate-with-xml-schema`.
- File completion of `.sch`, `.rng`/`.rnc` and `.xsd` files for the `href` of the schema port.
- The content of implicitly inlined schemas is no longer validated as XProc and no longer appears in the outline.

- Code completion and hover documentation for inline XSLT 1.0, 2.0 and 3.0 stylesheets (e.g. in the `stylesheet` port of `p:xslt`).
- File completion of `.xsl` files for the `href` of stylesheet ports.
- The content of inline stylesheets is no longer validated as XProc and no longer appears in the outline.

## 0.1.1

- Add repository link to package metadata.
- Publish to the VS Code Marketplace via GitHub Actions.

## 0.1.0

- Initial version: XProc 1.0 (XML Calabash 1) and XProc 3.x (XML Calabash 3) support with completion, built-in validation, validation and execution with XML Calabash, hover, go to definition, outline and snippets.
