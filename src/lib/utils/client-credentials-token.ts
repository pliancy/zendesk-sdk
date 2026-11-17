import axios, { AxiosError } from 'axios'
import { ZendeskOAuthConfig } from '../zendesk.types'

const EXPIRY_SKEW_MS = 60 * 1000
const TOKEN_REQUEST_TIMEOUT_MS = 10 * 1000

/**
 * Dedicated client for the token endpoint so a hung request times out and
 * interceptors registered on the global axios instance are not applied.
 */
export const tokenHttpClient = axios.create({ timeout: TOKEN_REQUEST_TIMEOUT_MS })

type ZendeskTokenResponse = {
    access_token?: string
    expires_in?: number
}

type CachedAccessToken = {
    accessToken: string
    expiresAt: number
}

export type ClientCredentialsTokenSource = {
    getAccessToken: () => Promise<string>
    /** Clears the cached token, but only if it is still the token that failed. */
    invalidate: (accessToken: string) => void
}

export function createClientCredentialsTokenSource(
    config: ZendeskOAuthConfig,
): ClientCredentialsTokenSource {
    let cached: CachedAccessToken | undefined
    let inflight: Promise<string> | undefined

    const getAccessToken = (): Promise<string> => {
        const now = Date.now()
        if (cached && cached.expiresAt > now) {
            return Promise.resolve(cached.accessToken)
        }
        if (inflight) {
            return inflight
        }

        const request = fetchClientCredentialsToken(config, now)
            .then((token) => {
                cached = token
                return token.accessToken
            })
            .finally(() => {
                if (inflight === request) {
                    inflight = undefined
                }
            })
        inflight = request
        return request
    }

    return {
        getAccessToken,
        invalidate: (accessToken: string) => {
            if (cached?.accessToken === accessToken) {
                cached = undefined
            }
        },
    }
}

async function fetchClientCredentialsToken(
    config: ZendeskOAuthConfig,
    now: number,
): Promise<CachedAccessToken> {
    let data: ZendeskTokenResponse
    try {
        const response = await tokenHttpClient.post<ZendeskTokenResponse>(
            `https://${config.subdomain}.zendesk.com/oauth/tokens`,
            {
                grant_type: 'client_credentials',
                client_id: config.clientId,
                client_secret: config.clientSecret,
                scope: config.scope,
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
            },
        )
        data = response.data ?? {}
    } catch (error) {
        throw tokenFailureError(error)
    }

    if (typeof data.access_token !== 'string' || data.access_token === '') {
        throw new Error('Zendesk token response did not include an access_token')
    }

    return {
        accessToken: data.access_token,
        expiresAt: computeExpiresAt(data.expires_in, now),
    }
}

function computeExpiresAt(expiresIn: unknown, now: number): number {
    if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
        // No usable lifetime: keep the token until Zendesk rejects it as invalid_token.
        return Infinity
    }
    const ttlMs = expiresIn * 1000
    return now + ttlMs - Math.min(EXPIRY_SKEW_MS, ttlMs / 2)
}

function tokenFailureError(error: unknown): Error {
    const message = tokenFailureMessage(error)
    if (axios.isAxiosError(error)) {
        const wrapped = new AxiosError(
            message,
            error.code,
            error.config,
            error.request,
            error.response,
        )
        wrapped.cause = error
        return wrapped
    }
    const wrapped: Error & { cause?: unknown } = new Error(message)
    wrapped.cause = error
    return wrapped
}

function tokenFailureMessage(error: unknown): string {
    const prefix = 'Failed to obtain Zendesk access token'
    if (axios.isAxiosError(error)) {
        const detail = readZendeskOAuthError(error.response?.data)
        if (detail) {
            return `${prefix}: ${detail}`
        }
        if (error.response?.status) {
            return `${prefix}: HTTP ${error.response.status}`
        }
    }
    if (error instanceof Error && error.message) {
        return `${prefix}: ${error.message}`
    }
    return prefix
}

function readZendeskOAuthError(data: unknown): string | undefined {
    if (!data || typeof data !== 'object') {
        return undefined
    }
    const body = data as { error?: unknown; error_description?: unknown }
    const code = typeof body.error === 'string' ? body.error : undefined
    const description =
        typeof body.error_description === 'string' ? body.error_description : undefined
    if (code && description) {
        return `${code}: ${description}`
    }
    return description ?? code
}
