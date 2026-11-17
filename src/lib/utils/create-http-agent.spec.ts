jest.unmock('axios')

import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { createHttpAgent } from './create-http-agent'
import type { ZendeskConfig, ZendeskOAuthConfig } from '../zendesk.types'

const oauthConfig: ZendeskOAuthConfig = {
    subdomain: 'example',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    scope: 'read',
}

function readAuthorization(headers: unknown): string | undefined {
    if (!headers || typeof headers !== 'object') return undefined
    const record = headers as Record<string, unknown>
    if (typeof record.get === 'function') {
        return (record.get as (name: string) => string)('Authorization')
    }
    return typeof record.Authorization === 'string' ? record.Authorization : undefined
}

function tokenResponse(accessToken: string, expiresIn: number): AxiosResponse {
    return {
        data: {
            access_token: accessToken,
            token_type: 'bearer',
            expires_in: expiresIn,
            scope: 'read',
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { headers: {} } as InternalAxiosRequestConfig,
    }
}

function unauthorized(config: InternalAxiosRequestConfig): AxiosError {
    return new AxiosError(
        'Request failed with status code 401',
        AxiosError.ERR_BAD_REQUEST,
        config,
        undefined,
        {
            data: { error: 'invalid_token' },
            status: 401,
            statusText: 'Unauthorized',
            headers: {},
            config,
        },
    )
}

describe('createHttpAgent', () => {
    afterEach(() => {
        jest.restoreAllMocks()
    })

    describe('Basic auth', () => {
        it('sets Authorization Basic from username and password', async () => {
            const agent = createHttpAgent({
                subdomain: 'example',
                username: 'agent@example.com/token',
                password: 'secret-token',
            })
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

            const expected = `Basic ${Buffer.from('agent@example.com/token:secret-token').toString('base64')}`
            expect(readAuthorization(headers)).toBe(expected)
        })
    })

    describe('OAuth client credentials', () => {
        it('requests an access token and sets Authorization Bearer', async () => {
            const post = jest
                .spyOn(axios, 'post')
                .mockResolvedValue(tokenResponse('oauth-token', 3600))
            const agent = createHttpAgent(oauthConfig)
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

            expect(post).toHaveBeenCalledTimes(1)
            expect(post).toHaveBeenCalledWith(
                'https://example.zendesk.com/oauth/tokens',
                {
                    grant_type: 'client_credentials',
                    client_id: 'client-id',
                    client_secret: 'client-secret',
                    scope: 'read',
                },
                expect.objectContaining({
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json',
                    },
                }),
            )
            expect(readAuthorization(headers)).toBe('Bearer oauth-token')
        })

        it('reuses the access token until it expires', async () => {
            const post = jest
                .spyOn(axios, 'post')
                .mockResolvedValue(tokenResponse('cached-token', 3600))
            const agent = createHttpAgent(oauthConfig)
            const authorizations: string[] = []
            agent.defaults.adapter = async (reqConfig) => {
                authorizations.push(readAuthorization(reqConfig.headers) ?? '')
                return {
                    data: {},
                    status: 200,
                    statusText: 'OK',
                    headers: {},
                    config: reqConfig,
                }
            }

            await agent.get('/users/me.json')
            await agent.get('/users/me.json')

            expect(post).toHaveBeenCalledTimes(1)
            expect(authorizations).toEqual(['Bearer cached-token', 'Bearer cached-token'])
        })

        it('requests a new access token when the cached token is within the expiry skew', async () => {
            const post = jest
                .spyOn(axios, 'post')
                .mockResolvedValueOnce(tokenResponse('first-token', 30))
                .mockResolvedValueOnce(tokenResponse('second-token', 3600))
            const agent = createHttpAgent(oauthConfig)
            const authorizations: string[] = []
            agent.defaults.adapter = async (reqConfig) => {
                authorizations.push(readAuthorization(reqConfig.headers) ?? '')
                return {
                    data: {},
                    status: 200,
                    statusText: 'OK',
                    headers: {},
                    config: reqConfig,
                }
            }

            await agent.get('/users/me.json')
            await agent.get('/users/me.json')

            expect(post).toHaveBeenCalledTimes(2)
            expect(authorizations).toEqual(['Bearer first-token', 'Bearer second-token'])
        })

        it('shares one token request across concurrent API calls', async () => {
            let resolvePost: (value: AxiosResponse) => void = () => undefined
            const post = jest.spyOn(axios, 'post').mockImplementation(
                () =>
                    new Promise((resolve) => {
                        resolvePost = resolve
                    }),
            )
            const agent = createHttpAgent(oauthConfig)
            const authorizations: string[] = []
            agent.defaults.adapter = async (reqConfig) => {
                authorizations.push(readAuthorization(reqConfig.headers) ?? '')
                return {
                    data: {},
                    status: 200,
                    statusText: 'OK',
                    headers: {},
                    config: reqConfig,
                }
            }

            const first = agent.get('/users/me.json')
            const second = agent.get('/users/me.json')
            for (let i = 0; i < 10 && post.mock.calls.length < 1; i += 1) {
                await Promise.resolve()
            }

            expect(post).toHaveBeenCalledTimes(1)
            resolvePost(tokenResponse('shared-token', 3600))
            await Promise.all([first, second])
            expect(authorizations).toEqual(['Bearer shared-token', 'Bearer shared-token'])
        })

        it('refreshes the access token and retries once after a 401', async () => {
            const post = jest
                .spyOn(axios, 'post')
                .mockResolvedValueOnce(tokenResponse('first-token', 3600))
                .mockResolvedValueOnce(tokenResponse('second-token', 3600))
            const agent = createHttpAgent(oauthConfig)
            const authorizations: string[] = []
            let attempts = 0
            agent.defaults.adapter = async (reqConfig) => {
                attempts += 1
                authorizations.push(readAuthorization(reqConfig.headers) ?? '')
                if (attempts === 1) {
                    return Promise.reject(unauthorized(reqConfig))
                }
                return {
                    data: { ok: true },
                    status: 200,
                    statusText: 'OK',
                    headers: {},
                    config: reqConfig,
                }
            }

            const response = await agent.get('/users/me.json')

            expect(response.status).toBe(200)
            expect(response.data).toEqual({ ok: true })
            expect(authorizations).toEqual(['Bearer first-token', 'Bearer second-token'])
            expect(post).toHaveBeenCalledTimes(2)
        })

        it('does not retry a 401 more than once', async () => {
            const post = jest.spyOn(axios, 'post').mockResolvedValue(tokenResponse('token', 3600))
            const agent = createHttpAgent(oauthConfig)
            let attempts = 0
            agent.defaults.adapter = async (reqConfig) => {
                attempts += 1
                return Promise.reject(unauthorized(reqConfig))
            }

            await expect(agent.get('/users/me.json')).rejects.toMatchObject({
                response: { status: 401 },
            })
            expect(attempts).toBe(2)
            expect(post).toHaveBeenCalledTimes(2)
        })

        it('throws when the token response does not include an access token', async () => {
            jest.spyOn(axios, 'post').mockResolvedValue(tokenResponse('', 3600))
            const agent = createHttpAgent(oauthConfig)
            agent.defaults.adapter = async (reqConfig) => ({
                data: {},
                status: 200,
                statusText: 'OK',
                headers: {},
                config: reqConfig,
            })

            await expect(agent.get('/users/me.json')).rejects.toThrow(/access_token/)
        })

        it('includes the Zendesk error when the token request fails', async () => {
            const tokenError = new AxiosError(
                'Request failed with status code 401',
                AxiosError.ERR_BAD_REQUEST,
                { headers: {} } as InternalAxiosRequestConfig,
                undefined,
                {
                    data: {
                        error: 'invalid_client',
                        error_description: 'Client authentication failed',
                    },
                    status: 401,
                    statusText: 'Unauthorized',
                    headers: {},
                    config: { headers: {} } as InternalAxiosRequestConfig,
                },
            )
            jest.spyOn(axios, 'post').mockRejectedValue(tokenError)
            const agent = createHttpAgent(oauthConfig)

            await expect(agent.get('/users/me.json')).rejects.toThrow(
                'Failed to obtain Zendesk access token: invalid_client: Client authentication failed',
            )
        })
    })

    describe('invalid config', () => {
        it('throws when no auth fields are provided', () => {
            expect(() => createHttpAgent({ subdomain: 'example' } as ZendeskConfig)).toThrow(
                /clientId, clientSecret, and scope, or both username and password/,
            )
        })

        it('throws when client credentials are incomplete', () => {
            expect(() =>
                createHttpAgent({ subdomain: 'example', clientId: 'client-id' } as ZendeskConfig),
            ).toThrow(/clientId, clientSecret, and scope/)
        })
    })
})
