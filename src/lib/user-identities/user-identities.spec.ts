import mockAxios from 'jest-mock-axios'
import { AxiosInstance } from 'axios'
import { UserIdentities } from './user-identities'
import { UserIdentity } from './user-identities.types'

describe('UserIdentities', () => {
    let userIdentities: UserIdentities

    const mockIdentity: UserIdentity = {
        id: 1,
        user_id: 10,
        type: 'email',
        value: 'jane@example.com',
        primary: true,
        verified: true,
    }

    beforeEach(() => {
        mockAxios.reset()
        userIdentities = new UserIdentities(mockAxios as never as AxiosInstance)
    })

    it('creates the instance', () => expect(userIdentities).toBeTruthy())

    describe('list', () => {
        it('lists identities for a user', async () => {
            jest.spyOn(mockAxios, 'get').mockResolvedValue({
                data: { identities: [mockIdentity], next_page: null },
            })

            await expect(userIdentities.list(10)).resolves.toEqual([mockIdentity])
            expect(mockAxios.get).toHaveBeenCalledWith('/users/10/identities.json')
        })

        it('follows pagination until there are no more pages', async () => {
            const second: UserIdentity = { ...mockIdentity, id: 2, primary: false }
            jest.spyOn(mockAxios, 'get')
                .mockResolvedValueOnce({
                    data: {
                        identities: [mockIdentity],
                        next_page: '/users/10/identities.json?page=2',
                    },
                })
                .mockResolvedValueOnce({ data: { identities: [second], next_page: null } })

            await expect(userIdentities.list(10)).resolves.toEqual([mockIdentity, second])
            expect(mockAxios.get).toHaveBeenNthCalledWith(1, '/users/10/identities.json')
            expect(mockAxios.get).toHaveBeenNthCalledWith(2, '/users/10/identities.json?page=2')
        })
    })

    describe('create', () => {
        it('creates a user identity', async () => {
            const identity: UserIdentity = {
                type: 'email',
                value: 'jane.alias@example.com',
                verified: true,
            }
            jest.spyOn(mockAxios, 'post').mockResolvedValue({
                data: { identity: { ...identity, id: 2, user_id: 10 } },
            })

            await expect(userIdentities.create(10, identity)).resolves.toEqual({
                ...identity,
                id: 2,
                user_id: 10,
            })
            expect(mockAxios.post).toHaveBeenCalledWith('/users/10/identities.json', { identity })
        })

        it('sends skip_verify_email as a top-level body field', async () => {
            const identity: UserIdentity = {
                type: 'email',
                value: 'jane.alias@example.com',
                verified: true,
                skip_verify_email: true,
            }
            jest.spyOn(mockAxios, 'post').mockResolvedValue({
                data: {
                    identity: {
                        type: identity.type,
                        value: identity.value,
                        verified: identity.verified,
                        id: 2,
                        user_id: 10,
                    },
                },
            })

            await expect(userIdentities.create(10, identity)).resolves.toEqual({
                type: 'email',
                value: 'jane.alias@example.com',
                verified: true,
                id: 2,
                user_id: 10,
            })
            expect(mockAxios.post).toHaveBeenCalledWith('/users/10/identities.json', {
                identity: {
                    type: 'email',
                    value: 'jane.alias@example.com',
                    verified: true,
                },
                skip_verify_email: true,
            })
        })
    })

    describe('update', () => {
        it('updates a user identity', async () => {
            const updated: UserIdentity = { ...mockIdentity, value: 'jane.new@example.com' }
            jest.spyOn(mockAxios, 'put').mockResolvedValue({ data: { identity: updated } })

            await expect(
                userIdentities.update(10, 1, { value: 'jane.new@example.com' }),
            ).resolves.toEqual(updated)
            expect(mockAxios.put).toHaveBeenCalledWith('/users/10/identities/1.json', {
                identity: { value: 'jane.new@example.com' },
            })
        })
    })

    describe('makePrimary', () => {
        it('promotes an identity to primary and returns all identities', async () => {
            const identities: UserIdentity[] = [
                { ...mockIdentity, id: 2, value: 'jane.new@example.com', primary: true },
                { ...mockIdentity, primary: false },
            ]
            jest.spyOn(mockAxios, 'put').mockResolvedValue({ data: { identities } })

            await expect(userIdentities.makePrimary(10, 2)).resolves.toEqual(identities)
            expect(mockAxios.put).toHaveBeenCalledWith(
                '/users/10/identities/2/make_primary.json',
                {},
            )
        })
    })

    describe('verify', () => {
        it('marks an identity verified', async () => {
            jest.spyOn(mockAxios, 'put').mockResolvedValue({ data: { identity: mockIdentity } })

            await expect(userIdentities.verify(10, 1)).resolves.toEqual(mockIdentity)
            expect(mockAxios.put).toHaveBeenCalledWith('/users/10/identities/1/verify.json', {})
        })
    })

    describe('delete', () => {
        it('deletes a user identity', async () => {
            jest.spyOn(mockAxios, 'delete').mockResolvedValue({ data: {} })

            await expect(userIdentities.delete(10, 1)).resolves.toBeUndefined()
            expect(mockAxios.delete).toHaveBeenCalledWith('/users/10/identities/1.json')
        })
    })
})
