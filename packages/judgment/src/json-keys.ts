// Repeated keys in a JSON text, which JSON.parse hides by keeping the last value (T-616 red team). The coded filter
// abstains on a repeated decision key in a judge's output; a JSON delivery whose judged text repeats a key carries no
// references, since a pointer cannot say which of the two nodes the judge read.
//
// Call it only on text JSON.parse accepted: it tracks strings, brackets and commas and trusts the grammar. One pass,
// an explicit stack, so the time grows with the text's length and deep nesting cannot overflow.

/** The path of an object: the key or index of each ancestor, from the root. */
export type JsonPath = ReadonlyArray<string | number>;

/**
 * Calls `onRepeat` with the path of each object that holds a key twice, and the key (once per repeat). Stops early when
 * it returns true.
 */
export function repeatedKeys(text: string, onRepeat: (path: JsonPath, key: string) => boolean | void): void {
  type Frame = { kind: 'obj'; keys: Set<string>; awaitKey: boolean; key: string } | { kind: 'arr'; index: number };
  const stack: Frame[] = [];
  const pathOf = (): Array<string | number> => stack.slice(0, -1).map((f) => (f.kind === 'obj' ? f.key : f.index));
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x22) {
      let j = i + 1;
      while (j < text.length && text.charCodeAt(j) !== 0x22) j += text.charCodeAt(j) === 0x5c ? 2 : 1;
      const top = stack[stack.length - 1];
      if (top?.kind === 'obj' && top.awaitKey) {
        const key = JSON.parse(text.slice(i, j + 1)) as string;
        if (top.keys.has(key) && onRepeat(pathOf(), key) === true) return;
        top.keys.add(key);
        top.key = key;
        top.awaitKey = false;
      }
      i = j;
    } else if (c === 0x7b) stack.push({ kind: 'obj', keys: new Set(), awaitKey: true, key: '' });
    else if (c === 0x5b) stack.push({ kind: 'arr', index: 0 });
    else if (c === 0x7d || c === 0x5d) stack.pop();
    else if (c === 0x2c) {
      const top = stack[stack.length - 1];
      if (top?.kind === 'obj') top.awaitKey = true;
      else if (top) top.index++;
    }
  }
}

/** True when any object in the text holds a key twice. */
export function hasRepeatedKey(text: string): boolean {
  let found = false;
  repeatedKeys(text, () => (found = true));
  return found;
}
