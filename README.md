# pi-config

Personal configuration for [Pi](https://pi.dev), with independently versioned plugins.

## Plugins

Each plugin is a Git submodule. This repository records its remote URL and pins a specific commit; the plugin's source, tests, and documentation live in its own public repository.

| Submodule | Repository | Purpose |
| --- | --- | --- |
| `plugins/pi-btw` | [pi-btw](https://github.com/ThbltLmr/pi-btw) | Ephemeral `/btw` side questions |
| `plugins/pi-modal-editor` | [pi-modal-editor](https://github.com/ThbltLmr/pi-modal-editor) | Vim-style prompt editing |
| `plugins/pi-starship-footer` | [pi-starship-footer](https://github.com/ThbltLmr/pi-starship-footer) | Context, model, git, quota, and cost footer |

`settings.json` loads these as relative local packages. Do not also install the same plugins through `pi install`, or leave copies in `extensions/`, since that can register them twice. Run `/reload` after changing the configuration or plugin source.

The parent also tracks themes, skills, agent instructions, and other selected settings. It does not track authentication, sessions, trust state, or installed-package caches.

## Clone or restore

On a machine without an existing Pi configuration:

```sh
git clone --recurse-submodules https://github.com/ThbltLmr/pi-config.git ~/.pi/agent
```

For an existing checkout:

```sh
git submodule update --init --recursive
```

Back up an existing `~/.pi/agent` before replacing it. A Git checkout is not a backup of ignored credentials or sessions.

## Change a plugin

Commit and push inside the plugin first, then record its new commit in the parent:

```sh
cd plugins/pi-btw
git switch main
# Edit and test. Stage only the intended files.
git add extensions/btw.ts
git commit -m "fix: describe the change"
git push origin main
cd ../..
git add plugins/pi-btw
git commit -m "chore: update pi-btw"
git push --recurse-submodules=check
```

Submodules restored with `git submodule update` may have a detached HEAD. Switch to a branch before making commits. If the pinned commit is ahead of an existing local branch, reconcile that branch before editing rather than silently moving the parent pin backwards.

## Pull the pinned versions

With clean parent and plugin worktrees:

```sh
git pull --ff-only
git submodule update --init --recursive
git submodule status
git status
```

This restores the versions recorded by the parent; it does not advance every plugin to the latest remote commit. To adopt a newer plugin version, update its branch deliberately, test it, then commit the changed submodule reference here.

## Tests

```sh
npm --prefix plugins/pi-modal-editor test
npm --prefix plugins/pi-starship-footer test

# The btw development tests need their local dev dependencies.
(cd plugins/pi-btw && npm ci --ignore-scripts && npm test && npm run typecheck)
```

The modal-editor suite uses the installed Pi package. Its README documents the `PI_ROOT` override. See each plugin's README for compatibility and runtime behavior, including provider requests and cache use.

## Publication boundary

The plugin repositories start with fresh history and a GitHub noreply commit identity. They contain selected source and tests, package metadata, documentation, and applicable third-party notices, not this repository's configuration or history.

The split does not remove anything from this parent repository's existing history. `.gitignore` prevents accidental additions; it cannot erase previously committed data. Review staged files and commit metadata before every public push.

No project license has been selected for the plugins yet. They remain `UNLICENSED`; `private: true` in their package manifests prevents accidental npm publication, not public GitHub hosting.
