jest.unmock('axios')

import { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { createHttpAgent } from './create-http-agent'
import { tokenHttpClient } from './client-credentials-token'
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

function tokenResponseWithoutExpiry(accessToken: string): AxiosResponse {
    const response = tokenResponse(accessToken, 0)
    response.data = { access_token: accessToken, token_type: 'bearer', scope: 'read' }
    return response
}

function ok(config: InternalAxiosRequestConfig): AxiosResponse {
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config }
}

function httpError(status: number, data: unknown): AxiosError {
    const config = { headers: {} } as InternalAxiosRequestConfig
    return new AxiosError(
        `Request failed with status code ${status}`,
        AxiosError.ERR_BAD_REQUEST,
        config,
        undefined,
        { data, status, statusText: '', headers: {}, config },
    )
}

function unauthorized(
    config: InternalAxiosRequestConfig,
    data: unknown = { error: 'invalid_token' },
): AxiosError {
    return new AxiosError(
        'Request failed with status code 401',
        AxiosError.ERR_BAD_REQUEST,
        config,
        undefined,
        {
            data,
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
                .spyOn(tokenHttpClient, 'post')
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
                .spyOn(tokenHttpClient, 'post')
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

        it('reuses a short-lived token for half its lifetime, then refreshes it', async () => {
            const start = 1_700_000_000_000
            const now = jest.spyOn(Date, 'now').mockReturnValue(start)
            const post = jest
                .spyOn(tokenHttpClient, 'post')
                .mockResolvedValueOnce(tokenResponse('first-token', 30))
                .mockResolvedValueOnce(tokenResponse('second-token', 3600))
            const agent = createHttpAgent(oauthConfig)
            const authorizations: string[] = []
            agent.defaults.adapter = async (reqConfig) => {
                authorizations.push(readAuthorization(reqConfig.headers) ?? '')
                return ok(reqConfig)
            }

            await agent.get('/users/me.json')
            now.mockReturnValue(start + 10_000)
            await agent.get('/users/me.json')
            now.mockReturnValue(start + 16_000)
            await agent.get('/users/me.json')

            expect(post).toHaveBeenCalledTimes(2)
            expect(authorizations).toEqual([
                'Bearer first-token',
                'Bearer first-token',
                'Bearer second-token',
            ])
        })

        it('keeps a token without expires_in until it is rejected', async () => {
            const post = jest
                .spyOn(tokenHttpClient, 'post')
                .mockResolvedValue(tokenResponseWithoutExpiry('forever-token'))
            const agent = createHttpAgent(oauthConfig)
            agent.defaults.adapter = async (reqConfig) => ok(reqConfig)

            await agent.get('/users/me.json')
            await agent.get('/users/me.json')
            await agent.get('/users/me.json')

            expect(post).toHaveBeenCalledTimes(1)
        })

        it('uses a token client with a request timeout', () => {
            expect(tokenHttpClient.defaults.timeout).toBe(10_000)
        })

        it('shares one token request across concurrent API calls', async () => {
            let resolvePost: (value: AxiosResponse) => void = () => undefined
            const post = jest.spyOn(tokenHttpClient, 'post').mockImplementation(
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
                .spyOn(tokenHttpClient, 'post')
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
            const post = jest
                .spyOn(tokenHttpClient, 'post')
                .mockResolvedValue(tokenResponse('token', 3600))
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
            jest.spyOn(tokenHttpClient, 'post').mockResolvedValue(tokenResponse('', 3600))
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
            jest.spyOn(tokenHttpClient, 'post').mockRejectedValue(tokenError)
            const agent = createHttpAgent(oauthConfig)

            await expect(agent.get('/users/me.json')).rejects.toThrow(
                'Failed to obtain Zendesk access token: invalid_client: Client authentication failed',
            )
        })
        it('does not refresh the token for a 401 that is not invalid_token', async () => {
            const post = jest
                .spyOn(tokenHttpClient, 'post')
                .mockResolvedValue(tokenResponse('token', 3600))
            const agent = createHttpAgent(oauthConfig)
            let attempts = 0
            agent.defaults.adapter = async (reqConfig) => {
                attempts += 1
                return Promise.reject(unauthorized(reqConfig, { error: 'Forbidden' }))
            }

            await expect(agent.get('/users/me.json')).rejects.toMatchObject({
                response: { status: 401 },
            })
            expect(attempts).toBe(1)
            expect(post).toHaveBeenCalledTimes(1)
        })

        it('refreshes the token when WWW-Authenticate reports invalid_token', async () => {
            const post = jest
                .spyOn(tokenHttpClient, 'post')
                .mockResolvedValueOnce(tokenResponse('first-token', 3600))
                .mockResolvedValueOnce(tokenResponse('second-token', 3600))
            const agent = createHttpAgent(oauthConfig)
            const authorizations: string[] = []
            agent.defaults.adapter = async (reqConfig) => {
                const authorization = readAuthorization(reqConfig.headers) ?? ''
                authorizations.push(authorization)
                if (authorization === 'Bearer first-token') {
                    const error = unauthorized(reqConfig, { error: "Couldn't authenticate you" })
                    if (error.response) {
                        error.response.headers = {
                            'www-authenticate': 'Bearer realm="Zendesk", error="invalid_token"',
                        }
                    }
                    return Promise.reject(error)
                }
                return ok(reqConfig)
            }

            await agent.get('/users/me.json')

            expect(post).toHaveBeenCalledTimes(2)
            expect(authorizations).toEqual(['Bearer first-token', 'Bearer second-token'])
        })

        it('reuses a newer cached token when a stale request gets a 401', async () => {
            const post = jest
                .spyOn(tokenHttpClient, 'post')
                .mockResolvedValueOnce(tokenResponse('first-token', 3600))
                .mockResolvedValueOnce(tokenResponse('second-token', 3600))
            const agent = createHttpAgent(oauthConfig)
            const authorizations: string[] = []
            let releaseStale: () => void = () => undefined
            const staleGate = new Promise<void>((resolve) => {
                releaseStale = resolve
            })
            agent.defaults.adapter = async (reqConfig) => {
                const authorization = readAuthorization(reqConfig.headers) ?? ''
                authorizations.push(authorization)
                if (authorization === 'Bearer first-token') {
                    if (reqConfig.url === '/stale.json') {
                        await staleGate
                    }
                    return Promise.reject(unauthorized(reqConfig))
                }
                return ok(reqConfig)
            }

            const stale = agent.get('/stale.json')
            await agent.get('/fresh.json')
            releaseStale()
            await stale

            expect(post).toHaveBeenCalledTimes(2)
            expect(authorizations.filter((a) => a === 'Bearer second-token')).toHaveLength(2)
        })

        it('keeps the AxiosError and status when the token request fails', async () => {
            const post = jest
                .spyOn(tokenHttpClient, 'post')
                .mockRejectedValue(httpError(429, { error: 'rate_limited' }))
            const agent = createHttpAgent(oauthConfig)
            agent.defaults.adapter = async (reqConfig) => ok(reqConfig)

            const error = await agent.get('/users/me.json').catch((e: unknown) => e)

            expect(error).toBeInstanceOf(AxiosError)
            expect(error).toMatchObject({
                message: 'Failed to obtain Zendesk access token: rate_limited',
                response: { status: 429 },
            })
            expect(post).toHaveBeenCalledTimes(1)
        })

        it('does not retry when the token endpoint returns 401', async () => {
            const post = jest
                .spyOn(tokenHttpClient, 'post')
                .mockRejectedValue(
                    httpError(401, { error: 'invalid_token', error_description: 'bad client' }),
                )
            const agent = createHttpAgent(oauthConfig)
            agent.defaults.adapter = async (reqConfig) => ok(reqConfig)

            await expect(agent.get('/users/me.json')).rejects.toMatchObject({
                response: { status: 401 },
            })
            expect(post).toHaveBeenCalledTimes(1)
        })
    })

    describe('invalid config', () => {
        it('throws when no auth fields are provided', () => {
            expect(() => createHttpAgent({ subdomain: 'example' } as ZendeskConfig)).toThrow(
                /clientId, clientSecret, and scope, or both username and password/,
            )
        })

        it('uses Basic auth when OAuth fields are undefined or empty', async () => {
            const agent = createHttpAgent({
                subdomain: 'example',
                username: 'agent@example.com/token',
                password: 'secret-token',
                clientId: undefined,
                clientSecret: '',
                scope: undefined,
            } as unknown as ZendeskConfig)
            let headers: unknown
            agent.defaults.adapter = async (reqConfig) => {
                headers = reqConfig.headers
                return ok(reqConfig)
            }

            await agent.get('/users/me.json')

            expect(readAuthorization(headers)).toMatch(/^Basic /)
        })

        it('throws when OAuth fields are partially set alongside Basic credentials', () => {
            expect(() =>
                createHttpAgent({
                    subdomain: 'example',
                    username: 'agent@example.com/token',
                    password: 'secret-token',
                    clientId: 'client-id',
                } as unknown as ZendeskConfig),
            ).toThrow(/client credentials require clientId, clientSecret, and scope/)
        })

        it('throws when client credentials are incomplete', () => {
            expect(() =>
                createHttpAgent({ subdomain: 'example', clientId: 'client-id' } as ZendeskConfig),
            ).toThrow(/clientId, clientSecret, and scope/)
        })
    })
})
