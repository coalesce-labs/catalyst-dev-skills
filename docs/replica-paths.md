# Temporary paths runtime

Generated from @catalyst-cloud/paths at catalyst-cloud commit c391358d06720985126c15b7fa9d9d6ad1878211, PR 6059. The package remains private. The Cloud skills repository's scripts/vendor-paths.mjs compiles the exact source Git object with its locked compiler and records source and output hashes.

To refresh the runtime from that build, run CATALYST_PATHS_BUNDLE=/path/to/catalyst-cloud-skills/vendor/paths node scripts/vendor-paths.mjs, then node scripts/vendor.mjs --write. The transfer refuses a different source commit or modified generated files. node scripts/vendor-paths.mjs --check validates the local runtime against its provenance. Replace this temporary copy with the published package when distribution permits it.

The compatibility adapter next to this directory reads a declared replica from the shared manifest. Before manifest adoption it retains the CLI's saved customer.json replicaDb or legacy default. It opens neither the database nor its lock and never starts sync. The shell freshness gate derives the live lock from that same selected path.
