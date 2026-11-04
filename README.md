# XProc for VS Code (XProc 1.0 and 3.x)

Edit, validate and run [XProc](https://xproc.org) pipelines in VS Code:

- **XProc 1.0** pipelines are run and validated with **XML Calabash 1.x**
- **XProc 3.0 / 3.1** pipelines are run and validated with **XML Calabash 3.x**

The processor is selected automatically from the `version` attribute of the pipeline.

## Features

- **Code completion**, context aware and version specific:
  - elements and steps that are allowed at the cursor position (including steps declared in the document or in imported libraries, resolved via XML catalogs), with snippets for required options and inputs
  - attributes and step options (required ones first)
  - attribute values: ports of the parent step (`p:with-input/@port`, `p:input/@port`), option names (`p:with-option/@name`), step names and readable ports for `p:pipe` and the XProc 3 `pipe="port@step"` shortcut, enumerated option values, `version`, `as` types, content types, namespace URIs, `p:import/@href` files
  - closing tags, plus automatic end tag insertion
  - **inline XSLT 1.0/2.0/3.0 stylesheets** (in `p:inline` or, in XProc 3, directly in `p:with-input port="stylesheet"`): `xsl:stylesheet` snippets for the stylesheet port, XSLT elements allowed at the cursor position (for the version of the stylesheet), attributes (including `xsl:*` attributes on literal result elements), enumerated values, named templates, modes, template parameters, attribute sets, and `$variables` in scope; hover documentation for XSLT elements
  - `.xsl` files for the `href` of the stylesheet port
- **Validation as you type** (built-in, no processor needed): well-formedness, unknown or misplaced elements and steps, XProc 1.0 vs. 3.x vocabulary, unknown options, missing required options, unknown ports, `p:pipe` references to non-existing steps or ports, duplicate step names, unresolvable imports.
- **Validation with XML Calabash** (*XProc: Validate Pipeline with XML Calabash*, and on save): the pipeline is compiled but **not run**. Errors are shown in the editor.
  - XML Calabash 3: `--nogo`
  - XML Calabash 1: the pipeline is imported by a generated wrapper pipeline that never invokes it
- **Run pipelines** (*XProc: Run Pipeline*, `Ctrl+Alt+R`, ▷ button in the editor title). Messages go to the *XProc* output channel, errors are shown as diagnostics, and the primary output (stdout) is opened in an editor.
  *XProc: Run Pipeline with Arguments…* asks for inputs/options (pre-filled from the pipeline's ports and options). The arguments are remembered per pipeline.
- **Hover** documentation for steps (ports, options, defaults, link to the specification), options and attributes
- **Go to definition** for steps declared in imported libraries, `p:pipe` step references and `p:import` hrefs
- **Outline** of pipelines, steps, ports, options and variables
- Snippets for new XProc 1.0/3.1 pipelines and libraries

`.xpl` and `.xproc` files use the `xproc` language. XML documents (language `xml`) that use the XProc namespace get completion, validation and the commands, too.

## Installation

The extension is distributed as a `.vsix` file (e.g. `vscode-xproc-0.1.0.vsix`). To build it yourself, see [Development](#development).

**From the VS Code user interface**

1. Open the Extensions view (`Ctrl+Shift+X`, on macOS `Cmd+Shift+X`).
2. Click the `…` menu (*Views and More Actions*) at the top of the view.
3. Choose **Install from VSIX…** and select the `.vsix` file.
4. Reload the window if VS Code asks you to.

Alternatively, right-click the `.vsix` file in the VS Code Explorer and choose **Install Extension VSIX**.

**From the command line**

```sh
code --install-extension vscode-xproc-0.1.0.vsix
```

For Cursor use `cursor --install-extension …`, for VS Code Insiders `code-insiders --install-extension …`.

**Remote / WSL**

When VS Code is connected to WSL, a container or SSH, install the extension in the remote window (the *Install from VSIX…* command does that automatically there). Java and XML Calabash must be available on the remote side.

To update, install the newer `.vsix` the same way. To remove the extension, use **Uninstall** in the Extensions view or `code --uninstall-extension xporc.vscode-xproc`.

## Setup

### XML Calabash 3 (XProc 3.x)

Download a release from [github.com/xmlcalabash/xmlcalabash3](https://github.com/xmlcalabash/xmlcalabash3/releases) and point the extension to the application jar:

```json
"xproc.calabash3.jar": "/opt/xmlcalabash-3.0.0/xmlcalabash-app-3.0.0.jar"
```

Alternatively set `xproc.calabash3.command` to the `xmlcalabash.sh` / `xmlcalabash.ps1` launcher.

### XML Calabash 1 (XProc 1.0)

For **transpect** projects nothing has to be configured: the extension looks for `calabash/calabash.sh` (`calabash.bat` on Windows) in the folders above the pipeline and uses that launcher.

Otherwise either configure a launcher script

```json
"xproc.calabash1.command": "${workspaceFolder}/calabash/calabash.sh"
```

or the jar and its classpath (XML Calabash 1.1+ needs a Saxon jar):

```json
"xproc.calabash1.jar": "/opt/calabash/xmlcalabash-1.5.7-120.jar",
"xproc.calabash1.classpath": ["/opt/calabash/lib/*", "/opt/saxon/saxon-he-12.5.jar"]
```

### Settings

| Setting | Description |
| --- | --- |
| `xproc.defaultVersion` | Version assumed for pipelines without `version` attribute |
| `xproc.java.path`, `xproc.java.options` | Java executable and JVM options (when started from a jar) |
| `xproc.calabash1.*`, `xproc.calabash3.*` | `command`, `jar`, `classpath` (1 only), `arguments` (always passed to the processor) |
| `xproc.calabash1.detectTranspect` | Auto-detect transpect `calabash/calabash.sh` launchers |
| `xproc.catalogs` | XML catalogs used to resolve `p:import` URIs. `xmlcatalog/catalog.xml` (and transpect's `calabash/xmlcatalog/catalog.xml`) in the folders above the pipeline are used automatically |
| `xproc.validation.enabled` | Built-in validation as you type |
| `xproc.validation.processorOnSave` | Validate with XML Calabash on save |
| `xproc.run.saveBeforeRun`, `xproc.run.workingDirectory`, `xproc.run.showResultInEditor` | Run behaviour |
| `xproc.autoCloseTags` | Insert end tags automatically |

Settings may use `${workspaceFolder}`, `${fileDirname}`, `${userHome}` and `~`.

### Run arguments

Arguments entered in *Run Pipeline with Arguments…* are passed to the processor. `name=value` assignments are put after the pipeline (they set options), everything else before it:

- XML Calabash 3: `--input:source=doc.xml --output:result=out.xml param=value`
- XML Calabash 1: `-i source=doc.xml -o result=out.xml param=value`

## Notes

- Validating unsaved changes, and validating XProc 1.0 pipelines without a `type` attribute, requires a temporary copy of the pipeline next to the original. The copy is a hidden file (`.<name>.vscode-xproc-….xpl`) and is removed right afterwards. It is needed so that relative imports keep working.
- XML Calabash 1 does not report line numbers for most static errors. The extension then tries to locate the element mentioned in the message.

## Development

```sh
npm install
npm run compile   # or: npm run watch
npm test          # unit tests (node:test)
npm run package   # creates the .vsix
```

Press `F5` in VS Code to start an Extension Development Host.
