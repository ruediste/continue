import { createHash } from "crypto";

import { LRUCache } from "lru-cache";
import Parser from "web-tree-sitter";

import { IDE } from "../../..";
import { languageForFilepath, LanguageId } from "../../../util/languageId";
import {
  getQueryForFile,
  IGNORE_PATH_PATTERNS,
} from "../../../util/treeSitter";
import {
  AutocompleteCodeSnippet,
  AutocompleteSnippetType,
} from "../../snippets/types";
import { TabAutocompleteOptions } from "../../TabAutocompleteOptions";
import { AstPath } from "../../util/ast";
import { ImportDefinitionsService } from "../ImportDefinitionsService";
import { createOutline } from "../outline/createOutline";

function getSyntaxTreeString(
  node: Parser.SyntaxNode,
  indent: string = "",
): string {
  let result = "";
  const nodeInfo = `${node.type} [${node.startPosition.row}:${node.startPosition.column} - ${node.endPosition.row}:${node.endPosition.column}]`;
  result += `${indent}${nodeInfo}\n`;

  for (const child of node.children) {
    result += getSyntaxTreeString(child, indent + "  ");
  }

  return result;
}

/**
 * A cache that stores promises. If a promise is requested and it's already in
 * the cache, the promise is returned. If it's not in the cache, the promise is
 * created, stored in the cache, and then returned.
 *
 * Set the max size to the number of cache entries you would like to store, based on memory consumption.
 * Set the ttl value to the number of milliseconds you would like to keep the cache entry, based on how long you expect the data to be valid.
 */
export class LRUAsyncCache {
  private cache: LRUCache<string, Promise<any>>;

  constructor(options: LRUCache.Options<string, any, unknown>) {
    this.cache = new LRUCache<string, Promise<any>>(options);
  }

  async get<T>(
    key: string,
    create: () => Promise<T>,
    onCached: undefined | (() => void) = undefined,
  ): Promise<T> {
    let value = this.cache.get(key);
    if (!value) {
      value = create();
      this.cache.set(key, value);
    } else {
      onCached?.();
    }
    return value;
  }
}

export class RootPathContextService {
  private cache = new LRUAsyncCache({
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

  private static TYPES_TO_USE = new Set([
    "arrow_function",
    "generator_function_declaration",
    "program",
    "function_declaration",
    "function_definition",
    "method_definition",
    "method_declaration",
    "class_declaration",
    "class_definition",
  ]);

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
  ): Promise<AutocompleteCodeSnippet[]> {
    const snippets: AutocompleteCodeSnippet[] = [];
    const language = languageForFilepath(filepath);

    let query: Parser.Query | undefined;
    switch (node.type) {
      case "program":
        this.importDefinitionsService.get(filepath);
        break;
      default:
        // const type = node.type;
        // console.log(getSyntaxTreeString(node));
        // debugger;

        query = await getQueryForFile(
          filepath,
          `root-path-context-queries/${language}/${node.type}.scm`,
        );
        break;
    }

    if (!query) {
      return snippets;
    }

    const queries = query.matches(node).map(async (match) => {
      for (const item of match.captures) {
        try {
          const endPosition = item.node.endPosition;
          const newSnippets = await this.getSnippets(
            filepath,
            endPosition,
            language,
          );
          snippets.push(...newSnippets);
        } catch (e) {
          throw e;
        }
      }
    });

    await Promise.all(queries);

    return snippets;
  }

  private async getSnippets(
    filepath: string,
    endPosition: Parser.Point,
    language: LanguageId,
  ): Promise<AutocompleteCodeSnippet[]> {
    const definitions = await this.ide.gotoDefinition({
      filepath,
      position: {
        line: endPosition.row,
        character: endPosition.column,
      },
    });
    const newSnippets: AutocompleteCodeSnippet[] = await Promise.all(
      definitions
        .filter((definition) => {
          const isIgnoredPath = IGNORE_PATH_PATTERNS[language]?.some(
            (pattern) => pattern.test(definition.filepath),
          );

          return !isIgnoredPath;
        })
        .map(async (def) => {
          const fileContents = await this.ide.readFile(def.filepath);
          const outline = await createOutline(
            def.filepath,
            fileContents,
            def.range,
          );
          if (outline !== undefined) {
            return {
              type: AutocompleteSnippetType.Code,
              filepath: def.filepath,
              content: outline,
            };
          }
          return {
            type: AutocompleteSnippetType.Code,
            filepath: def.filepath,
            content: await this.ide.readRangeInFile(def.filepath, def.range),
          };
        }),
    );

    return newSnippets;
  }

  async getContextForPath(
    filepath: string,
    astPath: AstPath,
    ctx: {
      options: TabAutocompleteOptions;
      writeLog: (message: string) => Promise<void>;
    },
  ): Promise<AutocompleteCodeSnippet[]> {
    const snippets: AutocompleteCodeSnippet[] = [];

    let parentKey = filepath;
    const filteredAstPath = astPath.filter((node) =>
      RootPathContextService.TYPES_TO_USE.has(node.type),
    );

    if (ctx.options.logRootPathSnippets)
      ctx.writeLog(
        `RootPathSnippets: filtering ${astPath.map((t) => t.type)} by types ${RootPathContextService.TYPES_TO_USE.values()}. Resulting nodes: ${filteredAstPath.map((t) => t.type)}`,
      );
    for (const astNode of filteredAstPath) {
      const key = RootPathContextService.keyFromNode(parentKey, astNode);

      const newSnippets = await this.cache.get(
        key,
        () => {
          if (ctx.options.logRootPathSnippets)
            ctx.writeLog(
              `RootPathSnippets: getting snippets for ${astNode.type}`,
            );
          return this.getSnippetsForNode(filepath, astNode);
        },
        () => {
          if (ctx.options.logRootPathSnippets)
            ctx.writeLog(`RootPathSnippets: cache hit for ${astNode.type}`);
        },
      );

      snippets.push(...newSnippets);

      parentKey = key;
    }

    return snippets;
  }
}
