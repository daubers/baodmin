import { useState } from 'react'
import { RequireConnection } from '../shared/RequireConnection'
import { EntitiesTab } from './EntitiesTab'
import { GroupsTab } from './GroupsTab'
import { UsersTab } from './UsersTab'

const tabs = ['Users', 'Entities', 'Groups'] as const
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
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                  {t}
                </button>
              ))}
            </div>
            {tab === 'Users' && <UsersTab client={client} />}
            {tab === 'Entities' && <EntitiesTab client={client} />}
            {tab === 'Groups' && <GroupsTab client={client} />}
          </>
        )}
      </RequireConnection>
    </section>
  )
}
