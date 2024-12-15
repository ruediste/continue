import Parser, { Point } from "web-tree-sitter";

import { Position, Range, RangeInFileWithContents } from "../../";
import { getParserForFile } from "../../util/treeSitter";

export type AstPath = Parser.SyntaxNode[];

export async function getAst(
  filepath: string,
  fileContents: string,
): Promise<Parser.Tree | undefined> {
  const parser = await getParserForFile(filepath);

  if (!parser) {
    return undefined;
  }

  try {
    const ast = parser.parse(fileContents);
    return ast;
  } catch (e) {
    return undefined;
  }
}

export async function getTreePathAtCursor(
  ast: Parser.Tree,
  cursorIndex: number,
): Promise<AstPath> {
  const path = [ast.rootNode];
  while (path[path.length - 1].childCount > 0) {
    let foundChild = false;
    for (const child of path[path.length - 1].children) {
      if (child.startIndex <= cursorIndex && child.endIndex >= cursorIndex) {
        path.push(child);
        foundChild = true;
        break;
      }
    }

    if (!foundChild) {
      break;
    }
  }

  return path;
}
export function getNodeBefore(
  node: Parser.SyntaxNode,
  cursorIndex: number,
): Parser.SyntaxNode {
  let candidate = node;
  for (const child of node.children) {
    if (child.endIndex < cursorIndex) candidate = child;
    else if (child.startIndex <= cursorIndex && child.endIndex >= cursorIndex) {
      return getNodeBefore(child, cursorIndex);
    } else break;
  }

  return candidate;
}

function compare(a: Point, b: Position) {
  if (a.row < b.line) return -1;
  else if (a.row > b.line) return 1;
  else if (a.column < b.character) return -1;
  else if (a.column > b.character) return 1;
  else return 0;
}

export function getNodeAroundRange(ast: Parser.Tree, range: Range) {
  let node = ast.rootNode;
  outer: do {
    for (const child of node.children) {
      if (
        compare(child.startPosition, range.start) <= 0 &&
        compare(child.endPosition, range.end) >= 0
      ) {
        node = child;
        continue outer;
      }
    }
  } while (false);
  return node;
}

export async function getScopeAroundRange(
  range: RangeInFileWithContents,
): Promise<RangeInFileWithContents | undefined> {
  const ast = await getAst(range.filepath, range.contents);
  if (!ast) {
    return undefined;
  }

  const { start: s, end: e } = range.range;
  const lines = range.contents.split("\n");
  const startIndex =
    lines.slice(0, s.line).join("\n").length +
    (lines[s.line]?.slice(s.character).length ?? 0);
  const endIndex =
    lines.slice(0, e.line).join("\n").length +
    (lines[e.line]?.slice(0, e.character).length ?? 0);

  let node = ast.rootNode;
  while (node.childCount > 0) {
    let foundChild = false;
    for (const child of node.children) {
      if (child.startIndex < startIndex && child.endIndex > endIndex) {
        node = child;
        foundChild = true;
        break;
      }
    }

    if (!foundChild) {
      break;
    }
  }

  return {
    contents: node.text,
    filepath: range.filepath,
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
  };
}
