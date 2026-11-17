import axios, {
    AxiosHeaders,
    AxiosInstance,
    AxiosResponse,
    InternalAxiosRequestConfig,
} from 'axios'
import { ZendeskBasicConfig, ZendeskConfig, resolveZendeskAuth } from '../zendesk.types'
import { createClientCredentialsTokenSource } from './client-credentials-token'

type RetriableRequestConfig = InternalAxiosRequestConfig & {
    zendeskAccessToken?: string
    zendeskAuthRetried?: boolean
}

function basicAuthorizationHeader(config: ZendeskBasicConfig): string {
    const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64')
    return `Basic ${credentials}`
}

/**
 * Zendesk documents expired-token 401s as `{"error":"invalid_token"}` in the body.
 * Also accept the RFC 6750 `WWW-Authenticate: Bearer error="invalid_token"` header.
 */
function isInvalidTokenResponse(response: AxiosResponse): boolean {
    const data = response.data as { error?: unknown } | undefined
    if (data && typeof data === 'object' && data.error === 'invalid_token') {
        return true
    }
    const header: unknown =
        response.headers instanceof AxiosHeaders
            ? response.headers.get('www-authenticate')
            : (response.headers as Record<string, unknown> | undefined)?.['www-authenticate']
    return typeof header === 'string' && /error\s*=\s*"?invalid_token"?/i.test(header)
}

export function createHttpAgent(config: ZendeskConfig): AxiosInstance {
    const auth = resolveZendeskAuth(config)

    const baseURL = `https://${config.subdomain}.zendesk.com/api/v2`
    const agent = axios.create({ baseURL })
    const tokenSource =
        auth.mode === 'bearer' ? createClientCredentialsTokenSource(auth.config) : undefined
    const basicHeader = auth.mode === 'basic' ? basicAuthorizationHeader(auth.config) : undefined

    agent.interceptors.request.use(async (req: RetriableRequestConfig) => {
        if (tokenSource) {
            const accessToken = await tokenSource.getAccessToken()
            req.zendeskAccessToken = accessToken
            req.headers['Authorization'] = `Bearer ${accessToken}`
        } else {
            req.headers['Authorization'] = basicHeader
        }
        req.headers['Content-Type'] = 'application/json'
        req.headers['Accept'] = 'application/json'
        return req
    })

    if (tokenSource) {
        agent.interceptors.response.use(
            (response) => response,
            async (error: unknown) => {
                if (!axios.isAxiosError(error) || error.response?.status !== 401) {
                    return Promise.reject(error)
                }
                // Only retry API requests that were sent with a token Zendesk reports as
                // invalid/expired. Token-endpoint failures carry no zendeskAccessToken.
                const original = error.config as RetriableRequestConfig | undefined
                if (
                    !original?.zendeskAccessToken ||
                    original.zendeskAuthRetried ||
                    !isInvalidTokenResponse(error.response)
                ) {
                    return Promise.reject(error)
                }
                original.zendeskAuthRetried = true
                tokenSource.invalidate(original.zendeskAccessToken)
                return agent.request(original)
            },
        )
    }

    return agent
}
