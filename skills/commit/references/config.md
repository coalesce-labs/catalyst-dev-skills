# Commit configuration

The skill reads `.catalyst/config.json`:

```json
{
  "catalyst": {
    "commit": {
      "useConventional": true,
      "scopes": ["agents", "commands", "scripts", "docs", "config"],
      "autoDetectType": true,
      "autoDetectScope": true,
      "requireBody": false
    },
    "project": {
      "ticketPrefix": "PROJ"
    }
  }
}
```

`scopes` lists the scopes to offer, `ticketPrefix` the ticket pattern to look for in the branch name, and `requireBody` whether every commit needs a body.
