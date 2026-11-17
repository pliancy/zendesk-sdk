import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import {
    ZendeskBasicConfig,
    ZendeskConfig,
    ZendeskOAuthConfig,
    resolveZendeskAuthMode,
} from '../zendesk.types'
import { createClientCredentialsTokenSource } from './client-credentials-token'

const INVALID_CONFIG_MESSAGE =
    'ZendeskConfig must provide clientId, clientSecret, and scope, or both username and password for Basic auth'

const OAUTH_FIELDS_MESSAGE =
    'ZendeskConfig client credentials require clientId, clientSecret, and scope'

type RetriableRequestConfig = InternalAxiosRequestConfig & {
    zendeskAuthRetried?: boolean
}

function hasOAuthField(config: ZendeskConfig): boolean {
    return 'clientId' in config || 'clientSecret' in config || 'scope' in config
}

function assertZendeskConfig(config: ZendeskConfig): void {
    if (hasOAuthField(config)) {
        if (resolveZendeskAuthMode(config) !== 'bearer') {
            throw new Error(OAUTH_FIELDS_MESSAGE)
        }
        return
    }
    const { username, password } = config as ZendeskBasicConfig
    if (username && password) {
        return
    }
    throw new Error(INVALID_CONFIG_MESSAGE)
}

function basicAuthorizationHeader(config: ZendeskBasicConfig): string {
    const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64')
    return `Basic ${credentials}`
}

export function createHttpAgent(config: ZendeskConfig): AxiosInstance {
    assertZendeskConfig(config)

    const baseURL = `https://${config.subdomain}.zendesk.com/api/v2`
    const agent = axios.create({ baseURL })
    const tokenSource =
        resolveZendeskAuthMode(config) === 'bearer'
            ? createClientCredentialsTokenSource(config as ZendeskOAuthConfig)
            : undefined

    agent.interceptors.request.use(async (req) => {
        if (tokenSource) {
            req.headers['Authorization'] = `Bearer ${await tokenSource.getAccessToken()}`
        } else {
            req.headers['Authorization'] = basicAuthorizationHeader(config as ZendeskBasicConfig)
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
                const original = error.config as RetriableRequestConfig | undefined
                if (!original || original.zendeskAuthRetried) {
                    return Promise.reject(error)
                }
                original.zendeskAuthRetried = true
                tokenSource.invalidate()
                return agent.request(original)
            },
        )
    }

    return agent
}
