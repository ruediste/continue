import { IDE } from "../..";
import {
  AutocompleteCodeSnippet,
  AutocompleteSnippetType,
} from "../snippets/types";
import { AutocompleteContext } from "../util/AutocompleteContext";

import { ImportDefinitionsService } from "./ImportDefinitionsService";
import { getSymbolsForSnippet } from "./ranking";
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

    const importSnippets: AutocompleteCodeSnippet[] = [];
    const fileInfo = this.importDefinitionsService.get(ctx.filepath);
    if (fileInfo) {
      const { imports } = fileInfo;
      // Look for imports of any symbols around the current range
      const textAroundCursor =
        ctx.fullPrefix.split("\n").slice(-5).join("\n") +
        ctx.fullSuffix.split("\n").slice(0, 3).join("\n");
      const symbols = Array.from(getSymbolsForSnippet(textAroundCursor)).filter(
        (symbol) => !ctx.lang.topLevelKeywords.includes(symbol),
      );
      for (const symbol of symbols) {
        const rifs = imports[symbol];
        if (Array.isArray(rifs)) {
          const snippets: AutocompleteCodeSnippet[] = rifs.map((rif) => {
            return {
              filepath: rif.filepath,
              content: rif.contents,
              type: AutocompleteSnippetType.Code,
            };
          });

          importSnippets.push(...snippets);
        }
      }
    }

    return importSnippets;
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
}
