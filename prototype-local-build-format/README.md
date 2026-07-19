# PROTOTYPE — local Build format

This throwaway logic prototype asks whether one small, versioned Build document can safely round-trip exact Part Definition references, transforms, instance properties, explicit Mechanical Connections, and future extension data while supporting browser-local autosave and resume.

Run the interactive state model:

```sh
npm run prototype
```

Run the fixed boundary scenarios:

```sh
npm run check
```

## Recommended V1 decision

- A Build is one `weblocks.build` JSON document at schema version `1`.
- Part instances have stable IDs, exact `{ id, version }` Part Definition references, position, quaternion rotation, and JSON instance properties. Scale is not stored in V1.
- Mechanical Connections have stable IDs and name both endpoint Part IDs and Connection Point IDs; loading checks each endpoint against the exact definition's declared finite capacity.
- Extensions are `{ id, version, required, data }` entries. Unknown optional entries load unchanged and produce a warning. An unknown required entry rejects editable loading; the loader never partially opens the Build.
- A missing exact Part Definition, missing Connection Point, malformed relation, or unsupported schema also rejects editable loading with a specific result.
- Production persistence uses IndexedDB asynchronously, with one active Build snapshot replaced atomically in one transaction. A committed valid edit schedules autosave after 500 ms; later commits restart the debounce. Selection, ghost, camera, transient drag state, and undo history are runtime state and are not serialized.
- Returning resumes the latest complete snapshot. Import and export use one JSON file and the same reader/writer and validation path. Assets are references, not embedded data.
- V1 ships only a schema-v1 reader/writer. Add a migration only when a future supported schema cannot be interpreted directly; do not add a migration framework now.

The prototype keeps persistence in memory and models the IndexedDB transaction boundary as a single atomic snapshot replacement. It does not implement production storage.
