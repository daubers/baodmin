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

# Secrets engine mounts: create, change (tune) and delete. Deleting a mount destroys everything in it
# and revokes its leases, so this is a powerful rule; leave it out if mounts are managed elsewhere.
path "sys/mounts/*"        { capabilities = ["create", "read", "update", "delete"] }
# KV v2 settings (max versions, check-and-set) of the KV mount
path "secret/config"       { capabilities = ["read", "update"] }
path "secret/metadata/*"   { capabilities = ["list"] }

# Dynamic secrets engines: roles, config, credentials and leases. The paths use the default mount
# names (database/, aws/, ssh/); repeat a block with your own mount path for each engine you manage.
# The creds/sign lines let this account issue live logins, keys and certificates; drop them to manage
# roles without being able to use them.

# database (postgres, ...)
path "database/roles"          { capabilities = ["list"] }
path "database/roles/*"        { capabilities = ["create", "read", "update", "delete"] }
path "database/static-roles"   { capabilities = ["list"] }
path "database/static-roles/*" { capabilities = ["create", "read", "update", "delete"] }
path "database/config"         { capabilities = ["list"] }
path "database/config/*"       { capabilities = ["create", "read", "update", "delete"] }
path "database/rotate-root/*"  { capabilities = ["update"] }
path "database/reset/*"        { capabilities = ["update"] }
path "database/creds/*"        { capabilities = ["read"] }
path "database/static-creds/*" { capabilities = ["read"] }

# aws
path "aws/roles"               { capabilities = ["list"] }
path "aws/roles/*"             { capabilities = ["create", "read", "update", "delete"] }
path "aws/config/root"         { capabilities = ["create", "read", "update"] }
path "aws/config/lease"        { capabilities = ["create", "read", "update"] }
path "aws/config/rotate-root"  { capabilities = ["update"] }
path "aws/creds/*"             { capabilities = ["read", "update"] }

# ssh
path "ssh/roles"               { capabilities = ["list"] }
path "ssh/roles/*"             { capabilities = ["create", "read", "update", "delete"] }
path "ssh/config/ca"           { capabilities = ["create", "read", "update", "delete"] }
path "ssh/sign/*"              { capabilities = ["update"] }
path "ssh/creds/*"             { capabilities = ["update"] }

# Leases: browse, inspect, renew and revoke what the engines have issued
# (OpenBao requires sudo to list leases and to revoke by prefix)
path "sys/leases/lookup"       { capabilities = ["update"] }
path "sys/leases/lookup/*"     { capabilities = ["list", "sudo"] }
path "sys/leases/renew"        { capabilities = ["update"] }
path "sys/leases/revoke"       { capabilities = ["update"] }
path "sys/leases/revoke-prefix/*" { capabilities = ["update", "sudo"] }
