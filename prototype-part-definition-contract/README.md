# PROTOTYPE — Part Definition contract

Run:

```sh
node prototype-part-definition-contract/cli.mjs
```

Check every representative definition:

```sh
node prototype-part-definition-contract/cli.mjs --check
```

This throwaway prototype asks whether one small, data-only Part Definition contract can describe V1 structural Parts and preserve enough identity and local connection geometry for future lamps, fans, and two-way switches without changing the editor core.

The candidate contract contains only immutable identity/version fields, a visual asset reference, local axis-aligned Occupied Space boxes, typed Connection Points with full local frames, declarative instance properties, and opaque namespaced extensions. It deliberately excludes scaling, geometry-changing properties, physics/electrical values, behavior scripts, and simulation state.
