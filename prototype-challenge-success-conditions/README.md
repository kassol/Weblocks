# PROTOTYPE — Challenge success conditions

Run:

```sh
node prototype-challenge-success-conditions/cli.mjs
```

Check every fixture without opening the interactive view:

```sh
node prototype-challenge-success-conditions/cli.mjs --check
```

This throwaway prototype asks whether three declarative condition types are enough to judge representative V1 Challenges with multiple valid Builds, without arbitrary scripting:

- `assembly-spans-zones`
- `player-parts-clear-zone`
- `player-part-count`

The interactive view compares the proposed semantics with intentionally naive checks so false positives and false negatives are visible. It does not define the full Challenge Definition contract, geometry format, editor, or production evaluator.
