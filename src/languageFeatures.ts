import * as path from 'path';
import * as vscode from 'vscode';
import { ModelCache, toVscodeUri } from './modelCache';
import { complete, ItemKind } from './xproc/completion';
import { definition, hover, SymbolData, SymbolKind, symbols } from './xproc/features';
import { Severity, validate } from './xproc/validator';
import { tagClosedAt } from './xml/autoClose';

const SELECTOR: vscode.DocumentSelector = [
  { language: 'xproc' },
  { language: 'xml' },
];

const ITEM_KINDS: Record<ItemKind, vscode.CompletionItemKind> = {
  element: vscode.CompletionItemKind.Keyword,
  step: vscode.CompletionItemKind.Function,
  attribute: vscode.CompletionItemKind.Property,
  value: vscode.CompletionItemKind.Value,
  closeTag: vscode.CompletionItemKind.Snippet,
  port: vscode.CompletionItemKind.Interface,
  stepName: vscode.CompletionItemKind.Reference,
  namespace: vscode.CompletionItemKind.Module,
  file: vscode.CompletionItemKind.File,
};

const SYMBOL_KINDS: Record<SymbolKind, vscode.SymbolKind> = {
  pipeline: vscode.SymbolKind.Class,
  library: vscode.SymbolKind.Package,
  compound: vscode.SymbolKind.Namespace,
  step: vscode.SymbolKind.Function,
  input: vscode.SymbolKind.Interface,
  output: vscode.SymbolKind.Event,
  option: vscode.SymbolKind.Variable,
  variable: vscode.SymbolKind.Variable,
  import: vscode.SymbolKind.Module,
};

const SEVERITIES: Record<Severity, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

export function registerLanguageFeatures(context: vscode.ExtensionContext, models: ModelCache) {
  const range = (doc: vscode.TextDocument, start: number, end: number) => new vscode.Range(doc.positionAt(start), doc.positionAt(end));

  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(SELECTOR, {
    async provideCompletionItems(document, position, _token, ctx) {
      if (!models.isXProcDocument(document)) {
        return undefined;
      }
      const model = models.get(document);
      const result = complete(model, document.offsetAt(position));
      if (!result || (result.inContent && ctx.triggerKind === vscode.CompletionTriggerKind.TriggerCharacter)) {
        return undefined;
      }
      const r = range(document, result.replaceStart, result.replaceEnd);
      const items = result.items.map(d => {
        const item = new vscode.CompletionItem(d.label, ITEM_KINDS[d.kind]);
        item.insertText = d.isSnippet ? new vscode.SnippetString(d.insertText) : d.insertText;
        item.range = r;
        item.detail = d.detail;
        item.sortText = d.sortText;
        item.filterText = d.filterText;
        if (d.documentation) {
          item.documentation = new vscode.MarkdownString(d.documentation);
        }
        if (d.retrigger) {
          item.command = { command: 'editor.action.triggerSuggest', title: 'Suggest' };
        }
        return item;
      });
      if (result.hrefCompletion && document.uri.scheme === 'file') {
        const dir = path.dirname(document.uri.fsPath);
        const files = await vscode.workspace.findFiles('**/*.{xpl,xproc}', '**/{node_modules,.git,.svn}/**', 2000);
        for (const f of files) {
          if (f.fsPath === document.uri.fsPath) {
            continue;
          }
          const rel = path.relative(dir, f.fsPath).split(path.sep).join('/');
          const item = new vscode.CompletionItem(rel, vscode.CompletionItemKind.File);
          item.range = r;
          item.sortText = String(rel.split('/').length).padStart(3, '0') + rel;
          items.push(item);
        }
      }
      return new vscode.CompletionList(items, false);
    },
  }, '<', ' ', '"', "'", ':', '/', '@', '='));

  context.subscriptions.push(vscode.languages.registerHoverProvider(SELECTOR, {
    provideHover(document, position) {
      if (!models.isXProcDocument(document)) {
        return undefined;
      }
      const h = hover(models.get(document), document.offsetAt(position));
      if (!h) {
        return undefined;
      }
      return new vscode.Hover(new vscode.MarkdownString(h.markdown), range(document, h.start, h.end));
    },
  }));

  context.subscriptions.push(vscode.languages.registerDefinitionProvider(SELECTOR, {
    async provideDefinition(document, position) {
      if (!models.isXProcDocument(document)) {
        return undefined;
      }
      const d = definition(models.get(document), document.offsetAt(position));
      if (!d) {
        return undefined;
      }
      const uri = toVscodeUri(d.uri);
      let targetRange: vscode.Range;
      if (uri.toString() === document.uri.toString()) {
        targetRange = range(document, d.start, d.end);
      } else {
        const target = await vscode.workspace.openTextDocument(uri);
        targetRange = range(target, d.start, d.end);
      }
      const link: vscode.LocationLink = {
        targetUri: uri,
        targetRange,
        targetSelectionRange: targetRange,
        originSelectionRange: d.originStart !== undefined ? range(document, d.originStart, d.originEnd!) : undefined,
      };
      return [link];
    },
  }));

  context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(SELECTOR, {
    provideDocumentSymbols(document) {
      if (!models.isXProcDocument(document)) {
        return [];
      }
      const convert = (s: SymbolData): vscode.DocumentSymbol => {
        const sym = new vscode.DocumentSymbol(s.name, s.detail, SYMBOL_KINDS[s.kind], range(document, s.start, s.end), range(document, s.selStart, s.selEnd));
        sym.children = s.children.map(convert);
        return sym;
      };
      return symbols(models.get(document)).map(convert);
    },
  }));

  // auto-close tags
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== e.document || e.contentChanges.length !== 1 || e.reason !== undefined) {
      return;
    }
    const change = e.contentChanges[0];
    if (change.text !== '>' || !models.isXProcDocument(e.document)
      || !vscode.workspace.getConfiguration('xproc', e.document.uri).get<boolean>('autoCloseTags', true)) {
      return;
    }
    const document = e.document;
    const offset = document.offsetAt(change.range.start) + 1;
    const tagName = tagClosedAt(document.getText(), offset);
    if (!tagName) {
      return;
    }
    const position = document.positionAt(offset);
    setTimeout(() => {
      if (vscode.window.activeTextEditor === editor && editor.selection.active.isEqual(position)) {
        editor.insertSnippet(new vscode.SnippetString(`$0</${tagName}>`), position, { undoStopBefore: false, undoStopAfter: false });
      }
    }, 0);
  }));

  // built-in validation
  const diagnostics = vscode.languages.createDiagnosticCollection('xproc');
  context.subscriptions.push(diagnostics);
  const timers = new Map<string, NodeJS.Timeout>();

  const refresh = (document: vscode.TextDocument) => {
    if (!models.isXProcDocument(document)) {
      diagnostics.delete(document.uri);
      return;
    }
    if (!vscode.workspace.getConfiguration('xproc', document.uri).get<boolean>('validation.enabled', true)) {
      diagnostics.delete(document.uri);
      return;
    }
    const model = models.get(document);
    diagnostics.set(document.uri, validate(model).map(d => {
      const diag = new vscode.Diagnostic(range(document, d.start, d.end), d.message, SEVERITIES[d.severity]);
      diag.source = 'xproc';
      if (d.code && d.code !== 'XML' && d.code !== 'import') {
        diag.code = `err:${d.code}`;
      }
      return diag;
    }));
  };
  const schedule = (document: vscode.TextDocument) => {
    const key = document.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      refresh(document);
    }, 300));
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument(e => schedule(e.document)),
    vscode.workspace.onDidCloseTextDocument(d => diagnostics.delete(d.uri)),
    vscode.workspace.onDidSaveTextDocument(saved => {
      // imported libraries may have changed
      if (models.isXProcDocument(saved)) {
        models.clear();
        vscode.workspace.textDocuments.filter(d => d !== saved).forEach(refresh);
      }
    }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('xproc')) {
        models.clear();
        vscode.workspace.textDocuments.forEach(refresh);
      }
    }),
  );
  vscode.workspace.textDocuments.forEach(refresh);
}
