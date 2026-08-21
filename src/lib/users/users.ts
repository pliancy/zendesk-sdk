import { AxiosInstance } from 'axios'
import { User } from './users.types'

export class Users {
    private readonly baseUrl = '/users'

    constructor(private readonly http: AxiosInstance) {}

    async createOrUpdate(user: User): Promise<User> {
        const { skip_verify_email, ...userFields } = user
        const { data } = await this.http.post<{ user: User }>(
            `${this.baseUrl}/create_or_update.json`,
            {
                user: userFields,
                ...(skip_verify_email !== undefined ? { skip_verify_email } : {}),
            },
        )
        return data.user
    }

    async update(userId: number, user: Partial<User>): Promise<User> {
        const { data } = await this.http.put<{ user: User }>(`${this.baseUrl}/${userId}.json`, {
            user,
        })
        return data.user
    }

    async search(query: string): Promise<User[]> {
        type Page = { users: User[]; next_page: string | null }
        const results: User[] = []
        let nextPage: string | null = `${this.baseUrl}/search.json`
        let firstRequest = true

        while (nextPage) {
            const page: Page = firstRequest
                ? (await this.http.get<Page>(nextPage, { params: { query } })).data
                : (await this.http.get<Page>(nextPage)).data
            results.push(...page.users)
            nextPage = page.next_page
            firstRequest = false
        }

        return results
    }

    async suspend(userId: number): Promise<User> {
        return this.update(userId, { suspended: true })
    }

    async unsuspend(userId: number): Promise<User> {
        return this.update(userId, { suspended: false })
    }

    async delete(userId: number): Promise<void> {
        await this.http.delete(`${this.baseUrl}/${userId}.json`)
    }

    async permanentlyDelete(userId: number): Promise<void> {
        await this.http.delete(`/deleted_users/${userId}.json`)
    }
}
