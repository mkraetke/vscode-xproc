import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as vscode from 'vscode';
import { analyze, XProcModel } from './xproc/model';
import { XProcVersion } from './xproc/types';

const XPROC_NS_PATTERN = /=\s*["']http:\/\/www\.w3\.org\/ns\/xproc["']/;

export function substituteVariables(value: string, document?: vscode.TextDocument): string {
  const folder = document ? vscode.workspace.getWorkspaceFolder(document.uri) : vscode.workspace.workspaceFolders?.[0];
  return value
    .replace(/\$\{workspaceFolder\}/g, folder?.uri.fsPath ?? '')
    .replace(/\$\{fileDirname\}/g, document ? path.dirname(document.uri.fsPath) : '')
    .replace(/\$\{userHome\}/g, os.homedir())
    .replace(/^~(?=$|[\\/])/, os.homedir());
}

export function resolvePathSetting(value: string, document?: vscode.TextDocument): string {
  const v = substituteVariables(value.trim(), document);
  if (!v || path.isAbsolute(v)) {
    return v;
  }
  const folder = document ? vscode.workspace.getWorkspaceFolder(document.uri) : vscode.workspace.workspaceFolders?.[0];
  if (folder && /[\\/]/.test(v)) {
    return path.join(folder.uri.fsPath, v);
  }
  return v;
}

/** Converts a URI used in the model (file URL or VS Code URI string) to a VS Code URI. */
export function toVscodeUri(uri: string): vscode.Uri {
  return uri.startsWith('file:') ? vscode.Uri.file(fileURLToPath(uri)) : vscode.Uri.parse(uri);
}

/** Caches the analysis of open documents per document version. */
export class ModelCache {
  private readonly cache = new Map<string, { version: number; model: XProcModel }>();

  isXProcDocument(document: vscode.TextDocument): boolean {
    if (document.languageId === 'xproc') {
      return true;
    }
    if (document.languageId !== 'xml') {
      return false;
    }
    return XPROC_NS_PATTERN.test(document.getText(new vscode.Range(0, 0, 60, 0)));
  }

  get(document: vscode.TextDocument): XProcModel {
    const key = document.uri.toString();
    const cached = this.cache.get(key);
    if (cached && cached.version === document.version) {
      return cached.model;
    }
    const cfg = vscode.workspace.getConfiguration('xproc', document.uri);
    const baseUri = document.uri.scheme === 'file' ? pathToFileURL(document.uri.fsPath).href : key;
    const model = analyze(document.getText(), baseUri, {
      defaultVersion: cfg.get<XProcVersion>('defaultVersion', '3.1'),
      catalogs: this.catalogsFor(document),
    });
    this.cache.set(key, { version: document.version, model });
    return model;
  }

  delete(document: vscode.TextDocument) {
    this.cache.delete(document.uri.toString());
  }

  clear() {
    this.cache.clear();
  }

  catalogsFor(document: vscode.TextDocument): string[] {
    const result: string[] = [];
    const add = (p: string) => {
      if (p && !result.includes(p) && fs.existsSync(p)) {
        result.push(p);
      }
    };
    const cfg = vscode.workspace.getConfiguration('xproc', document.uri);
    for (const c of cfg.get<string[]>('catalogs', [])) {
      add(resolvePathSetting(c, document));
    }
    if (document.uri.scheme === 'file') {
      const folder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
      let dir = path.dirname(document.uri.fsPath);
      for (let i = 0; i < 8; i++) {
        add(path.join(dir, 'xmlcatalog', 'catalog.xml'));
        // transpect: the catalog of the calabash distribution maps the extension steps
        add(path.join(dir, 'calabash', 'xmlcatalog', 'catalog.xml'));
        if (dir === folder) {
          break;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
          break;
        }
        dir = parent;
      }
      if (folder) {
        add(path.join(folder, 'xmlcatalog', 'catalog.xml'));
      }
    }
    return result;
  }
}
