# Code-scanning alert 38: a false positive in a bundled dependency

- **Date:** 2026-11-19
- **Task:** T-566 (roadmap row N182)
- **Verdict:** a false positive in `@noble/curves@1.9.1`, harmless in this use. The alert was dismissed as a false positive.

## The alert

CodeQL rule `js/biased-cryptographic-random`, rated high, at `site/try.mjs` line 5228, columns 17 to 38, found on commit `184b92cb`. Its message: "Using addition on a cryptographically secure random number produces biased results." `site/try.mjs` is the same at that commit and on `origin/main` (`git diff 184b92cb origin/main -- site/try.mjs` is empty) [measured].

## Where the line comes from

`site/try.mjs` is a bundle that `site/build.mjs` builds. The section that holds line 5228 starts at line 5178 with the marker `// node_modules/.pnpm/@noble+curves@1.9.1/node_modules/@noble/curves/esm/abstract/utils.js`. The flagged line is in that package's `hexToBytes`, at line 85 of `esm/abstract/utils.js` in `@noble/curves` 1.9.1 [measured]. viem 2.57.13 pulls in `@noble/curves` for secp256k1 signing.

```js
const n1 = asciiToBase16(hex.charCodeAt(hi));
const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
if (n1 === void 0 || n2 === void 0) {
	const char = hex[hi] + hex[hi + 1];          // line 5228: columns 17-38 are `hex[hi] + hex[hi + 1]`
	throw new Error("hex string expected, got non-hex character \"" + char + "\" at index " + hi);
}
array[ai] = n1 * 16 + n2;
```

## What the code does with the value

The flagged `+` joins two characters of the input string into one short string for an error message. It runs only when the input has a character that is not hex, and then the function throws. No number is added, and the result never becomes a byte, a key, a nonce, a signature or a salt [measured: read from the source].

CodeQL follows random bytes into this function. `try.mjs` makes fresh nonces with `crypto.getRandomValues`, turns them into hex (`freshNonce`, bundle line 9287), and viem turns hex back into bytes through `hexToBytes`. The rule then counts any `+` on a value derived from the random input as biased arithmetic [inferred from the rule's description and the data flow].

The bytes the function returns are not biased either. `n1 * 16 + n2` decodes two hex digits into one byte, a one-to-one map from 256 digit pairs onto 0 to 255. It is not a modulo or a range reduction, so random input stays uniformly random [measured: read from the source].

## Why only `try.mjs` is flagged

The same line is in `site/setup.mjs`, `site/try-judged.mjs`, `site/try-reclaim.mjs` and `site/try-sell.mjs` (`grep -n 'hex\[hi\] + hex\[hi + 1\]' site/*.mjs`), and in viem's dependency tree [measured]. CodeQL reported only one place, the one where its data flow from `crypto.getRandomValues` reaches the function [inferred].

## Action

No code change. The pinned bundles and their hashes are unchanged. Upgrading `@noble/curves` would not change this line's meaning and would need a re-pin, a separate decision. The alert was dismissed through `gh api` with the reason "false positive" and a comment pointing to this note.

## If the alert returns

A re-pin of `site/try.mjs` can move the line, and code scanning may then open a new alert under the same rule. Check that it points at `const char = hex[hi] + hex[hi + 1];` inside the `@noble/curves` `abstract/utils.js` section of the bundle. If it does, and the package is still `@noble/curves` 1.9.1 or the same `hexToBytes` code, the reasoning above holds: dismiss the new alert as a false positive with a comment pointing to this note. If the flagged code is different, this note does not cover it.
