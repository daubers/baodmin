import { useState } from 'react'
import { RequireConnection } from '../shared/RequireConnection'
import { EntitiesTab } from './EntitiesTab'
import { GroupsTab } from './GroupsTab'
import { TokensTab } from './TokensTab'
import { UsersTab } from './UsersTab'

const tabs = ['Users', 'Entities', 'Groups', 'Tokens'] as const
type Tab = (typeof tabs)[number]

export function IdentitiesPage() {
  const [tab, setTab] = useState<Tab>('Users')
  return (
    <section>
      <h1>Identities</h1>
      <RequireConnection>
        {(client) => (
          <>
            <div role="tablist" className="tabs">
              {tabs.map((t) => (
                <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls="identities-panel" onClick={() => setTab(t)}>
                  {t}
                </button>
              ))}
            </div>
            <div role="tabpanel" id="identities-panel" aria-labelledby={`tab-${tab}`}>
            {tab === 'Users' && <UsersTab client={client} />}
            {tab === 'Entities' && <EntitiesTab client={client} />}
            {tab === 'Groups' && <GroupsTab client={client} />}
            {tab === 'Tokens' && <TokensTab client={client} />}
            </div>
          </>
        )}
      </RequireConnection>
    </section>
  )
}
