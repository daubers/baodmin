# Least-privilege policy for the account that uses EnvBao Admin.
# Adjust "secret" if your KV v2 mount has a different path.

# Policies: list, read, create/update and delete (managed `envbao-*` and read-only viewing of the rest)
path "sys/policies/acl"   { capabilities = ["list"] }
path "sys/policies/acl/*" { capabilities = ["create", "read", "update", "delete"] }

# Userpass users
path "auth/userpass/users"   { capabilities = ["list"] }
path "auth/userpass/users/*" { capabilities = ["create", "read", "update", "delete"] }

# Identity entities, aliases and groups
path "identity/entity/name"        { capabilities = ["list"] }
path "identity/entity/name/*"      { capabilities = ["create", "read", "update", "delete"] }
path "identity/entity-alias"       { capabilities = ["create", "update"] }
path "identity/entity-alias/id/*"  { capabilities = ["read", "delete"] }
path "identity/group/name"         { capabilities = ["list"] }
path "identity/group/name/*"       { capabilities = ["create", "read", "update", "delete"] }

# Tokens: create, list (needs sudo in OpenBao), inspect and revoke by accessor
path "auth/token/create"          { capabilities = ["create", "update"] }
path "auth/token/accessors"       { capabilities = ["list", "sudo"] }
path "auth/token/lookup-accessor" { capabilities = ["update"] }
path "auth/token/revoke-accessor" { capabilities = ["update"] }

# Discovery: mounted auth methods and secrets engines, and KV v2 metadata for the secret browser
path "sys/auth"            { capabilities = ["read"] }
path "sys/mounts"          { capabilities = ["read"] }
path "secret/metadata/*"   { capabilities = ["list"] }
