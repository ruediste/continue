import Parser from "web-tree-sitter";
import { IDE, Position, Range } from "../..";
import {
  getLanguageForFile,
  rangeToString,
  treeToString,
} from "../../util/treeSitter";
import {
  AutocompleteCodeSnippet,
  AutocompleteSnippetType,
} from "../snippets/types";
import {
  AutocompleteContext,
  AutocompleteLoggingContext,
  LogWriter,
} from "../util/AutocompleteContext";

import { LRUCache } from "lru-cache";
import { getRangeInString } from "../../util/ranges";
import { getAst, getNodeAroundRange } from "../util/ast";
import { ImportDefinitionsService } from "./ImportDefinitionsService";
import { getSymbolsForSnippet } from "./ranking";
import { LRUAsyncCache } from "./root-path-context/LRUAsyncCache";
import { RootPathContextService } from "./root-path-context/RootPathContextService";

export class ContextRetrievalService {
  private importDefinitionsService: ImportDefinitionsService;
  private rootPathContextService: RootPathContextService;

  constructor(private readonly ide: IDE) {
    this.importDefinitionsService = new ImportDefinitionsService(this.ide);
    this.rootPathContextService = new RootPathContextService(
      this.importDefinitionsService,
      this.ide,
    );
  }

  public async getSnippetsFromImportDefinitions(
    ctx: AutocompleteContext,
  ): Promise<AutocompleteCodeSnippet[]> {
    if (ctx.options.useImports === false) {
      return [];
    }

    const writeLog: LogWriter | undefined = ctx.options.logImportSnippets
      ? (msg) => ctx.writeLog("ImportDefinitionSnippets: " + msg)
      : undefined;
    const importSnippets: AutocompleteCodeSnippet[] = [];
    const fileInfo = this.importDefinitionsService.get(ctx.filepath);
    if (fileInfo) {
      const { imports } = fileInfo;
      // Look for imports of any symbols around the current range
      const symbols = this.getSymbolsAroundCursor(ctx, writeLog);
      for (const symbol of symbols) {
        const fileRanges = imports[symbol];
        if (Array.isArray(fileRanges)) {
          const snippets: AutocompleteCodeSnippet[] = await Promise.all(
            fileRanges.map(async (rif) => {
              writeLog?.(
                `found definition ${rif.filepath} ${rif.range.start.line}:${rif.range.start.character} - ${rif.range.end.line}:${rif.range.end.character}`,
              );

              return await this.createOutline(
                rif.filepath,
                rif.contents,
                rif.range,
                ctx,
              );
            }),
          );

          importSnippets.push(...snippets);
        }
      }
    }

    return importSnippets;
  }

  public getSymbolsAroundCursor(
    ctx: AutocompleteContext,
    writeLog: LogWriter | undefined,
  ) {
    const textAroundCursor =
      ctx.fullPrefix.split("\n").slice(-5).join("\n") +
      ctx.fullSuffix.split("\n").slice(0, 3).join("\n");
    const symbols = Array.from(getSymbolsForSnippet(textAroundCursor)).filter(
      (symbol) => !ctx.languageInfo.topLevelKeywords.includes(symbol),
    );
    writeLog?.(
      `ImportDefinitionSnippets: Text around cursor:\n${textAroundCursor}\n extracted symbols: ${symbols}`,
    );
    return symbols;
  }

  public async getRootPathSnippets(
    ctx: AutocompleteContext,
  ): Promise<AutocompleteCodeSnippet[]> {
    if (!ctx.treePath) {
      return [];
    }

    return this.rootPathContextService.getContextForPath(
      ctx.filepath,
      ctx.treePath,
      ctx,
    );
  }

  // use a relatively short cache, to avoid stale data
  private definitionCache = new LRUAsyncCache({
    max: 300,
    ttl: 1000 * 10,
  });

  private symbolRegex = /[a-zA-Z_$]+/g;

  public async getSurroundingSymbolSnippets(
    ctx: AutocompleteContext,
  ): Promise<AutocompleteCodeSnippet[]> {
    const writeLog = ctx.options.logSurroundingSymbolsSnippets
      ? (msg: string) => ctx.writeLog("SurroundingSymbolSnippets: " + msg)
      : undefined;

    const firstLine = Math.max(0, ctx.pos.line - 3);
    const lastLine = Math.min(ctx.fileLines.length - 1, ctx.pos.line + 1);
    writeLog?.(
      `Processing snippet\n${ctx.fileLines.slice(firstLine, lastLine).join("\n")}\n---\n`,
    );

    const symbols: { text: string; pos: Position }[] = [];
    for (let lineNr = firstLine; lineNr < lastLine; lineNr++) {
      const line = ctx.fileLines[lineNr];
      const matches = line.matchAll(this.symbolRegex);
      for (const match of matches) {
        symbols.push({
          text: match[0],
          pos: { line: lineNr, character: match.index },
        });
      }
    }

    const snippets: Promise<AutocompleteCodeSnippet[]>[] = [];
    for (const symbol of symbols.slice(-10)) {
      const symbolIdentifier = `${symbol.text} at ${symbol.pos.line + 1}:${symbol.pos.character + 1}`;
      writeLog?.(`found symbol ${symbolIdentifier}`);

      snippets.push(
        (async () => {
          const typeDefs = await this.definitionCache.get(
            `type:${symbol.pos.line}:${symbol.text}:${ctx.filepath}`,
            () =>
              this.ide.gotoTypeDefinition({
                filepath: ctx.filepath,
                position: symbol.pos,
              }),
          );

          if (typeDefs.length === 0)
            writeLog?.(`no type definitions found for: ${symbolIdentifier}`);
          else
            writeLog?.(
              `received type definitions for: ${symbolIdentifier} ${typeDefs.map(
                (td) =>
                  `${td.filepath} ${td.range.start.line + 1}:${td.range.start.character + 1} - ${td.range.end.line + 1}:${td.range.end.character + 1}`,
              )}`,
            );
          const result = await this.rootPathContextService.getSnippetsForRanges(
            typeDefs,
            writeLog,
            ctx,
          );
          result.forEach((snippet) =>
            writeLog?.(
              `received type snippet for ${symbolIdentifier}:\n${snippet.content}\n---\n`,
            ),
          );
          return result;
        })(),
      );
      snippets.push(
        (async () => {
          const typeDefs = await this.definitionCache.get(
            `def:${symbol.pos.line}:${symbol.text}:${ctx.filepath}`,
            () =>
              this.ide.gotoDefinition({
                filepath: ctx.filepath,
                position: symbol.pos,
              }),
          );

          if (typeDefs.length === 0)
            writeLog?.(`no definitions found for: ${symbolIdentifier}`);
          else
            writeLog?.(
              `received definitions for:${symbolIdentifier} ${typeDefs.map(
                (td) =>
                  `${td.filepath} ${td.range.start.line + 1}:${td.range.start.character + 1} - ${td.range.end.line + 1}:${td.range.end.character + 1}`,
              )}`,
            );
          const result = await this.rootPathContextService.getSnippetsForRanges(
            typeDefs,
            writeLog,
            ctx,
          );
          result.forEach((snippet) =>
            writeLog?.(
              `received snippet for ${symbolIdentifier}:\n${snippet.content}\n---\n`,
            ),
          );
          return result;
        })(),
      );
    }

    return (await Promise.all(snippets)).flat();
  }

  private collectOutline(
    node: Parser.SyntaxNode,
    drop: (startIndex: number, endIndex: number, replacement: string) => void,
    ctx: AutocompleteLoggingContext,
    writeLog: LogWriter | undefined,
  ) {
    const replacement = ctx.langOptions.outlineNodeReplacements[node.type];

    if (replacement !== undefined) {
      writeLog?.(
        `replacing ${node.type} ${rangeToString(node)} by: ${replacement}`,
      );
      drop(node.startIndex, node.endIndex, replacement);
      return;
    }
    let children = node.children;
    for (let i = 0; i < children.length; i++) {
      this.collectOutline(children[i], drop, ctx, writeLog);
    }
  }

  private astCache = new LRUAsyncCache({
    max: 50,
    ttl: 1000 * 5,
  });
  private typeOutlineCache = new LRUCache<string, string>({
    max: 50,
    ttl: 1000 * 5,
  });

  async createOutline(
    filepath: string,
    fileContents: string,
    range: Range,
    ctx: AutocompleteLoggingContext,
  ): Promise<AutocompleteCodeSnippet> {
    const ast = await this.astCache.get(filepath, () =>
      getAst(filepath, fileContents),
    );
    const language = await getLanguageForFile(filepath);
    const writeLog: LogWriter | undefined = ctx.options.logOutlineCreation
      ? (msg) => ctx.writeLog(`createOutline: ${msg}`)
      : undefined;

    if (ast !== undefined && language !== undefined) {
      let node = getNodeAroundRange(ast, range);
      writeLog?.(`${filepath} ${rangeToString(node)}\n${treeToString(node)}`);
      let content = "";
      if (ctx.langOptions.outlineTypeRootNodes.includes(node.type)) {
        const key = `${filepath}:${node.startIndex}:${node.endIndex}`;
        if (this.typeOutlineCache.has(key))
          content = this.typeOutlineCache.get(key)!;
        else {
          writeLog?.(`creating type outline for ${node.type}`);
          let index = node.startIndex;
          this.collectOutline(
            node,
            (startIndex, endIndex, replacement) => {
              if (startIndex > index) {
                content += fileContents.substring(index, startIndex);
              }
              content += replacement;
              index = endIndex;
            },
            ctx,
            writeLog,
          );
          content += fileContents.substring(index, node.endIndex);
          this.typeOutlineCache.set(key, content);
        }
      } else {
        writeLog?.(`using text of node ${node.type}`);
        content = node.text;
      }

      return {
        type: AutocompleteSnippetType.Code,
        filepath,
        range: {
          start: {
            line: node.startPosition.row,
            character: node.startPosition.column,
          },
          end: {
            line: node.endPosition.row,
            character: node.endPosition.column,
          },
        },
        content: content,
      };
    } else {
      ctx.writeLog(
        `unable to parse ${filepath} ${range.start.line + 1}:${range.start.character + 1} - ${range.end.line + 1}:${range.end.character + 1}`,
      );
      return {
        type: AutocompleteSnippetType.Code,
        filepath,
        range,
        content: getRangeInString(fileContents, range),
      };
    }
  }
}
