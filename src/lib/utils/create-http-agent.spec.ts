jest.unmock('axios')

import { createHttpAgent } from './create-http-agent'
import type { ZendeskConfig } from '../zendesk.types'

function readAuthorization(headers: unknown): string | undefined {
    if (!headers || typeof headers !== 'object') return undefined
    const record = headers as Record<string, unknown>
    if (typeof record.get === 'function') {
        return (record.get as (name: string) => string)('Authorization')
    }
    return typeof record.Authorization === 'string' ? record.Authorization : undefined
}

describe('createHttpAgent', () => {
    const captureHeaders = async (config: ZendeskConfig): Promise<unknown> => {
        const agent = createHttpAgent(config)
        let headers: unknown
        agent.defaults.adapter = async (reqConfig) => {
            headers = reqConfig.headers
            return {
                data: {},
                status: 200,
                statusText: 'OK',
                headers: {},
                config: reqConfig,
            }
        }
        await agent.get('/users/me.json')
        return headers
    }

    describe('Basic auth', () => {
        it('sets Authorization Basic from username and password', async () => {
            const headers = await captureHeaders({
                subdomain: 'example',
                username: 'agent@example.com/token',
                password: 'secret-token',
            })
            const expected = `Basic ${Buffer.from('agent@example.com/token:secret-token').toString('base64')}`
            expect(readAuthorization(headers)).toBe(expected)
        })
    })

    describe('Bearer auth', () => {
        it('sets Authorization Bearer from static accessToken', async () => {
            const headers = await captureHeaders({
                subdomain: 'example',
                accessToken: 'static-oauth-token',
            })
            expect(readAuthorization(headers)).toBe('Bearer static-oauth-token')
        })

        it('calls getAccessToken and sets Authorization Bearer', async () => {
            const getAccessToken = jest.fn().mockResolvedValue('dynamic-oauth-token')
            const headers = await captureHeaders({
                subdomain: 'example',
                getAccessToken,
            })
            expect(getAccessToken).toHaveBeenCalledTimes(1)
            expect(readAuthorization(headers)).toBe('Bearer dynamic-oauth-token')
        })

        it('prefers getAccessToken over static accessToken', async () => {
            const getAccessToken = jest.fn().mockResolvedValue('from-callback')
            const headers = await captureHeaders({
                subdomain: 'example',
                accessToken: 'ignored',
                getAccessToken,
            })
            expect(getAccessToken).toHaveBeenCalledTimes(1)
            expect(readAuthorization(headers)).toBe('Bearer from-callback')
        })
    })

    describe('invalid config', () => {
        it('throws when no auth fields are provided', () => {
            expect(() => createHttpAgent({ subdomain: 'example' } as ZendeskConfig)).toThrow(
                /username and password/,
            )
        })

        it('throws when getAccessToken returns an empty token', async () => {
            const agent = createHttpAgent({
                subdomain: 'example',
                getAccessToken: async () => '',
            })
            agent.defaults.adapter = async (reqConfig) => ({
                data: {},
                status: 200,
                statusText: 'OK',
                headers: {},
                config: reqConfig,
            })
            await expect(agent.get('/users/me.json')).rejects.toThrow(/empty token/)
        })
    })
})
