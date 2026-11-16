# Commit configuration

The skill reads `.catalyst/catalyst.toml`:

```toml
[project]
linear_team = "PROJ"

[pull_requests]
commit_convention = "conventional"
```

`linear_team` is the ticket pattern to look for in the branch name. `commit_convention` is `conventional` unless the file says otherwise. A checkout with no `catalyst.toml` gets the defaults: Conventional Commits, no ticket prefix, scopes detected from the changed paths, no required body. Scopes and body rules have no settings key.
