import axios, { AxiosInstance } from 'axios'
import { ZendeskConfig } from '../zendesk.types'

const INVALID_CONFIG_MESSAGE =
    'ZendeskConfig must provide either getAccessToken, accessToken, or both username and password for Basic auth'

function assertZendeskConfig(config: ZendeskConfig): void {
    if ('getAccessToken' in config && config.getAccessToken != null) {
        if (typeof config.getAccessToken !== 'function') {
            throw new Error('ZendeskConfig getAccessToken must be a function')
        }
        return
    }
    if ('accessToken' in config && config.accessToken != null && config.accessToken !== '') {
        if (typeof config.accessToken !== 'string') {
            throw new Error('ZendeskConfig accessToken must be a string')
        }
        return
    }
    const { username, password } = config as { username?: string; password?: string }
    if (username != null && password != null && username !== '' && password !== '') {
        return
    }
    throw new Error(INVALID_CONFIG_MESSAGE)
}

async function resolveAuthorizationHeader(config: ZendeskConfig): Promise<string> {
    if ('getAccessToken' in config && config.getAccessToken != null) {
        const token = await config.getAccessToken()
        if (!token) {
            throw new Error('ZendeskConfig getAccessToken returned an empty token')
        }
        return `Bearer ${token}`
    }
    if ('accessToken' in config && config.accessToken != null && config.accessToken !== '') {
        return `Bearer ${config.accessToken}`
    }
    const { username, password } = config as { username: string; password: string }
    const credentials = Buffer.from(`${username}:${password}`).toString('base64')
    return `Basic ${credentials}`
}

export function createHttpAgent(config: ZendeskConfig): AxiosInstance {
    assertZendeskConfig(config)

    const baseURL = `https://${config.subdomain}.zendesk.com/api/v2`
    const agent = axios.create({ baseURL })

    agent.interceptors.request.use(async (req) => {
        req.headers['Authorization'] = await resolveAuthorizationHeader(config)
        req.headers['Content-Type'] = 'application/json'
        req.headers['Accept'] = 'application/json'
        return req
    })

    return agent
}
