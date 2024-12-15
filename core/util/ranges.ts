import { Position, Range } from "../index.js";

export function getRangeInString(content: string, range: Range): string {
  const lines = content.split("\n");

  if (range.start.line > range.end.line) {
    return "";
  }
  if (range.start.line === range.end.line) {
    if (range.start.character > range.end.character) return "";
    return (
      lines[range.start.line]?.substring(
        range.start.character,
        range.end.character,
      ) ?? ""
    );
  }

  const firstLine =
    lines[range.start.line]?.substring(
      range.start.character,
      lines[range.start.line].length,
    ) ?? "";
  const middleLines = lines.slice(range.start.line + 1, range.end.line);
  const lastLine =
    lines[range.end.line]?.substring(0, range.end.character) ?? "";

  return [firstLine, ...middleLines, lastLine].join("\n");
}

export function positionToIndex(content: string, position: Position): number {
  let currentPosition: Position = { line: 0, character: 0 };
  let index = 0;
  while (index < content.length) {
    if (currentPosition.line > position.line) {
      break;
    }
    if (
      currentPosition.line === position.line &&
      currentPosition.character >= position.character
    ) {
      break;
    }
    if (content[index] === "\n") {
      currentPosition.line++;
      currentPosition.character = 0;
    } else {
      currentPosition.character++;
    }
    index++;
  }
  return index;
}

export function intersection(a: Range, b: Range): Range | null {
  const startLine = Math.max(a.start.line, b.start.line);
  const endLine = Math.min(a.end.line, b.end.line);

  if (startLine > endLine) {
    return null;
  }

  if (startLine === endLine) {
    const startCharacter = Math.max(a.start.character, b.start.character);
    const endCharacter = Math.min(a.end.character, b.end.character);

    if (startCharacter > endCharacter) {
      return null;
    }

    return {
      start: { line: startLine, character: startCharacter },
      end: { line: endLine, character: endCharacter },
    };
  }

  const startCharacter =
    startLine === a.start.line ? a.start.character : b.start.character;
  const endCharacter =
    endLine === a.end.line ? a.end.character : b.end.character;

  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  };
}

export function union(a: Range, b: Range): Range {
  let start: Position;
  if (a.start.line === b.start.line) {
    start = {
      line: a.start.line,
      character: Math.min(a.start.character, b.start.character),
    };
  } else if (a.start.line < b.start.line) start = a.start;
  else start = b.start;

  let end: Position;
  if (a.end.line === b.end.line) {
    end = {
      line: a.end.line,
      character: Math.max(a.end.character, b.end.character),
    };
  } else if (a.end.line > b.end.line) end = a.end;
  else end = b.end;

  return {
    start,
    end,
  };
}

export function maxPosition(a: Position, b: Position): Position {
  if (a.line > b.line) {
    return a;
  } else if (a.line < b.line) {
    return b;
  } else {
    return a.character > b.character ? a : b;
  }
}

export function minPosition(a: Position, b: Position): Position {
  if (a.line < b.line) {
    return a;
  } else if (a.line > b.line) {
    return b;
  } else {
    return a.character < b.character ? a : b;
  }
}
