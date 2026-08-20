import { AxiosInstance } from 'axios'
import { UserIdentity } from './user-identities.types'

export class UserIdentities {
    constructor(private readonly http: AxiosInstance) {}

    async list(userId: number): Promise<UserIdentity[]> {
        type Page = { identities: UserIdentity[]; next_page: string | null }
        const results: UserIdentity[] = []
        let nextPage: string | null = `/users/${userId}/identities.json`

        while (nextPage) {
            const page: Page = (await this.http.get<Page>(nextPage)).data
            results.push(...page.identities)
            nextPage = page.next_page
        }

        return results
    }

    async create(userId: number, identity: UserIdentity): Promise<UserIdentity> {
        const { skip_verify_email, ...identityFields } = identity
        const { data } = await this.http.post<{ identity: UserIdentity }>(
            `/users/${userId}/identities.json`,
            {
                identity: identityFields,
                ...(skip_verify_email !== undefined ? { skip_verify_email } : {}),
            },
        )
        return data.identity
    }

    async update(
        userId: number,
        identityId: number,
        identity: Partial<UserIdentity>,
    ): Promise<UserIdentity> {
        const { data } = await this.http.put<{ identity: UserIdentity }>(
            `/users/${userId}/identities/${identityId}.json`,
            { identity },
        )
        return data.identity
    }

    /** Promotes the identity to primary. Zendesk demotes the previous primary to a secondary. */
    async makePrimary(userId: number, identityId: number): Promise<UserIdentity[]> {
        const { data } = await this.http.put<{ identities: UserIdentity[] }>(
            `/users/${userId}/identities/${identityId}/make_primary.json`,
            {},
        )
        return data.identities
    }

    async verify(userId: number, identityId: number): Promise<UserIdentity> {
        const { data } = await this.http.put<{ identity: UserIdentity }>(
            `/users/${userId}/identities/${identityId}/verify.json`,
            {},
        )
        return data.identity
    }

    async delete(userId: number, identityId: number): Promise<void> {
        await this.http.delete(`/users/${userId}/identities/${identityId}.json`)
    }
}
