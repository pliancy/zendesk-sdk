import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
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

function isInvalidTokenError(data: unknown): boolean {
    return (
        !!data &&
        typeof data === 'object' &&
        (data as { error?: unknown }).error === 'invalid_token'
    )
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
                    !isInvalidTokenError(error.response.data)
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
