import { createHash } from "crypto";

import Parser from "web-tree-sitter";

import { LRUCache } from "lru-cache";
import { IDE, Range, RangeInFile } from "../../..";
import { rangeInFileToString } from "../../../util";
import { languageForFilepath } from "../../../util/languageId";
import { getRangeInString } from "../../../util/ranges";
import {
  getLanguageForFile,
  getQuery,
  IGNORE_PATH_PATTERNS,
  rangeToString,
  treeToString,
} from "../../../util/treeSitter";
import {
  AutocompleteCodeSnippet,
  AutocompleteSnippetType,
} from "../../snippets/types";
import { AstPath, getAst, getNodeAroundRange } from "../../util/ast";
import {
  AutocompleteLoggingContext,
  LogWriter,
} from "../../util/AutocompleteContext";
import { ImportDefinitionsService } from "../ImportDefinitionsService";
import { LRUAsyncCache } from "./LRUAsyncCache";

export class RootPathContextService {
  private snippetCache = new LRUAsyncCache({
    max: 100,
    ttl: 1000 * 30,
  });

  constructor(
    private readonly importDefinitionsService: ImportDefinitionsService,
    private readonly ide: IDE,
  ) {}

  private static getNodeId(node: Parser.SyntaxNode): string {
    return `${node.startIndex}`;
  }

  /**
   * Key comes from hash of parent key and node type and node id.
   */
  private static keyFromNode(
    parentKey: string,
    astNode: Parser.SyntaxNode,
  ): string {
    return createHash("sha256")
      .update(parentKey)
      .update(astNode.type)
      .update(RootPathContextService.getNodeId(astNode))
      .digest("hex");
  }

  private async getSnippetsForNode(
    filepath: string,
    node: Parser.SyntaxNode,
    ctx: AutocompleteLoggingContext,
    writeLog?: LogWriter,
  ): Promise<AutocompleteCodeSnippet[]> {
    const language = languageForFilepath(filepath);

    const query = await getQuery(
      language,
      `root-path-context-queries`,
      node.type,
    );

    if (!query) {
      writeLog?.(`No query for node type ${node.type} in language ${language}`);
      return [];
    }

    const snippets: AutocompleteCodeSnippet[] = [];
    const queries = query
      .matches(node, { maxStartDepth: 0 })
      .map(async (match) => {
        writeLog?.(
          `Match found: node type: ${node.type} language: ${language} patternIndex: ${match.pattern}, nodePosition: ${rangeToString(node)}`,
        );
        for (const item of match.captures) {
          writeLog?.(
            `Capture found: node type: ${item.node.type} nodePosition: ${rangeToString(item.node)} text: ${item.node.text}`,
          );

          try {
            const endPosition = item.node.endPosition;
            const definitions = await this.ide.gotoDefinition({
              filepath,
              position: {
                line: endPosition.row,
                character: endPosition.column,
              },
            });
            writeLog?.(
              "Found definitions: " +
                definitions.map((d) => rangeInFileToString(d)).join(", "),
            );
            snippets.push(
              ...(await this.getSnippetsForRanges(definitions, writeLog, ctx)),
            );
          } catch (e) {
            throw e;
          }
        }
      });

    await Promise.all(queries);

    return snippets;
  }

  private snippetForRangeCache = new LRUAsyncCache({
    max: 50,
    ttl: 1000 * 10,
  });

  public async getSnippetsForRanges(
    definitions: RangeInFile[],
    writeLog: LogWriter | undefined,
    ctx: AutocompleteLoggingContext,
  ) {
    const newSnippets: AutocompleteCodeSnippet[][] = await Promise.all(
      definitions.map((def) =>
        this.snippetForRangeCache.get<AutocompleteCodeSnippet[]>(
          `${def.filepath}:${def.range.start.line}`,
          async () => {
            const language = languageForFilepath(def.filepath);
            if (!language) return [];
            const isIgnoredPath = IGNORE_PATH_PATTERNS[language]?.some(
              (pattern) => pattern.test(def.filepath),
            );
            if (isIgnoredPath) {
              writeLog?.(`Ignoring path: ${def.filepath}`);
              return [];
            }

            const fileContents = await this.ide.readFile(def.filepath);
            return [
              await this.createOutline(
                def.filepath,
                fileContents,
                def.range,
                ctx,
              ),
            ];
          },
        ),
      ),
    );

    return newSnippets.flat();
  }

  async getContextForPath(
    filepath: string,
    astPath: AstPath,
    ctx: AutocompleteLoggingContext,
  ): Promise<AutocompleteCodeSnippet[]> {
    const snippets: AutocompleteCodeSnippet[] = [];
    const writeLog = ctx.options.logRootPathSnippets
      ? async (message: string) => ctx.writeLog(`RootPathSnippets: ${message}`)
      : undefined;

    let parentKey = filepath;
    const filteredAstPath = astPath.filter((node) => node.isNamed);

    writeLog?.(`processing path ${filteredAstPath.map((t) => t.type)}`);
    for (const astNode of filteredAstPath) {
      const key = RootPathContextService.keyFromNode(parentKey, astNode);

      const newSnippets = await this.snippetCache.get(
        key,
        () => {
          writeLog?.(`getting snippets for ${astNode.type}`);
          return this.getSnippetsForNode(filepath, astNode, ctx, writeLog);
        },
        () => {
          writeLog?.(`cache hit for ${astNode.type}`);
        },
      );

      snippets.push(...newSnippets);

      parentKey = key;
    }

    return snippets;
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
