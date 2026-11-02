import * as fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { getAttr, parseXml, XElement } from '../xml/parser';
import { mtimeOf } from './fsCache';

const CATALOG_NS = 'urn:oasis:names:tc:entity:xmlns:xml:catalog';

interface CatalogFile {
  mtime: number;
  exact: Map<string, string>;
  rewrites: { prefix: string; target: string }[];
  next: string[];
}

const cache = new Map<string, CatalogFile>();

function loadCatalog(file: string): CatalogFile | undefined {
  const mtime = mtimeOf(file);
  if (mtime === undefined) {
    return undefined;
  }
  const cached = cache.get(file);
  if (cached && cached.mtime === mtime) {
    return cached;
  }
  const result: CatalogFile = { mtime, exact: new Map(), rewrites: [], next: [] };
  try {
    const doc = parseXml(fs.readFileSync(file, 'utf8'));
    const walk = (el: XElement, base: string) => {
      const xmlBase = getAttr(el, 'xml:base');
      if (xmlBase) {
        base = new URL(xmlBase, base).href;
      }
      if (el.ns === CATALOG_NS) {
        switch (el.local) {
          case 'uri':
          case 'system': {
            const name = getAttr(el, el.local === 'uri' ? 'name' : 'systemId');
            const uri = getAttr(el, 'uri');
            if (name && uri) {
              result.exact.set(name, new URL(uri, base).href);
            }
            break;
          }
          case 'rewriteURI':
          case 'rewriteSystem': {
            const prefix = getAttr(el, el.local === 'rewriteURI' ? 'uriStartString' : 'systemIdStartString');
            const target = getAttr(el, 'rewritePrefix');
            if (prefix && target !== undefined) {
              let t = new URL(target, base).href;
              if (prefix.endsWith('/') && !t.endsWith('/')) {
                t += '/';
              }
              result.rewrites.push({ prefix, target: t });
            }
            break;
          }
          case 'nextCatalog': {
            const c = getAttr(el, 'catalog');
            if (c) {
              result.next.push(new URL(c, base).href);
            }
            break;
          }
        }
      }
      for (const c of el.children) {
        walk(c, base);
      }
    };
    if (doc.root) {
      walk(doc.root, pathToFileURL(file).href);
    }
  } catch {
    // ignore broken catalogs
  }
  result.rewrites.sort((x, y) => y.prefix.length - x.prefix.length);
  cache.set(file, result);
  return result;
}

/** Resolves URIs with a list of OASIS XML catalogs (file paths). */
export class CatalogResolver {
  constructor(private readonly catalogs: string[]) {}

  resolve(uri: string): string | undefined {
    const visited = new Set<string>();
    for (const c of this.catalogs) {
      const r = this.resolveIn(c, uri, visited);
      if (r) {
        return r;
      }
    }
    return undefined;
  }

  private resolveIn(file: string, uri: string, visited: Set<string>): string | undefined {
    if (visited.has(file)) {
      return undefined;
    }
    visited.add(file);
    const cat = loadCatalog(file);
    if (!cat) {
      return undefined;
    }
    const exact = cat.exact.get(uri);
    if (exact) {
      return exact;
    }
    for (const r of cat.rewrites) {
      if (uri.startsWith(r.prefix)) {
        return r.target + uri.substring(r.prefix.length);
      }
    }
    for (const next of cat.next) {
      if (!next.startsWith('file:')) {
        continue;
      }
      const r = this.resolveIn(fileURLToPath(next), uri, visited);
      if (r) {
        return r;
      }
    }
    return undefined;
  }
}
