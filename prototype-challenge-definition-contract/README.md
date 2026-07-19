# PROTOTYPE — Challenge Definition contract

Run:

```sh
node prototype-challenge-definition-contract/cli.mjs
```

Check every representative definition:

```sh
node prototype-challenge-definition-contract/cli.mjs --check
```

This throwaway prototype asks whether one immutable, data-only Challenge Definition can describe V1 built-in Challenges and leave a safe boundary for future local authoring without adding an editor, publishing workflow, executable scripts, or player-progress state.

The candidate contract contains exact identity/version fields, presentation metadata, an initial scene, exact available Part Definition references, named 3D Zones, the four accepted declarative success conditions, and opaque namespaced extensions. A mutable authoring draft is deliberately outside the portable published definition.
