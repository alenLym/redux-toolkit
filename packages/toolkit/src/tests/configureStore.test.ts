import { vi } from 'vitest'
import type { StoreEnhancer, StoreEnhancerStoreCreator } from '@reduxjs/toolkit'
import type * as Redux from 'redux'
import type * as DevTools from '@internal/devtoolsExtension'

vi.doMock('redux', async () => {
  const redux: any = await vi.importActual('redux')

  vi.spyOn(redux, 'applyMiddleware')
  vi.spyOn(redux, 'combineReducers')
  vi.spyOn(redux, 'compose')
  vi.spyOn(redux, 'createStore')

  return redux
})

vi.doMock('@internal/devtoolsExtension', async () => {
  const devtools: typeof DevTools = await vi.importActual(
    '@internal/devtoolsExtension'
  )
  vi.spyOn(devtools, 'composeWithDevTools') // @remap-prod-remove-line
  return devtools
})

function originalReduxCompose(...funcs: Function[]) {
  if (funcs.length === 0) {
    // infer the argument type so it is usable in inference down the line
    return <T>(arg: T) => arg
  }

  if (funcs.length === 1) {
    return funcs[0]
  }

  return funcs.reduce(
    (a, b) =>
      (...args: any) =>
        a(b(...args))
  )
}

function originalComposeWithDevtools() {
  if (arguments.length === 0) return undefined
  if (typeof arguments[0] === 'object') return originalReduxCompose
  return originalReduxCompose.apply(null, arguments as any as Function[])
}

describe('configureStore', async () => {
  // RTK's internal `composeWithDevtools` function isn't publicly exported,
  // so we can't mock it. However, it _does_ try to access the global extension method
  // attached to `window`. So, if we mock _that_, we'll know if the enhancer ran.
  const mockDevtoolsCompose = vi
    .fn()
    .mockImplementation(originalComposeWithDevtools)
  ;(window as any).__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ = mockDevtoolsCompose

  const redux = await import('redux')

  const { configureStore } = await import('@reduxjs/toolkit')

  const reducer: Redux.Reducer = (state = {}, _action) => state

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('given a function reducer', () => {
    it('calls createStore with the reducer', () => {
      configureStore({ reducer })
      expect(configureStore({ reducer })).toBeInstanceOf(Object)

      expect(redux.createStore).toHaveBeenCalledWith(
        reducer,
        undefined,
        expect.any(Function)
      )
      expect(redux.applyMiddleware).toHaveBeenCalled()
      expect(mockDevtoolsCompose).toHaveBeenCalled() // @remap-prod-remove-line
    })
  })

  describe('given an object of reducers', () => {
    it('calls createStore with the combined reducers', () => {
      const reducer = {
        reducer() {
          return true
        },
      }
      expect(configureStore({ reducer })).toBeInstanceOf(Object)
      expect(redux.combineReducers).toHaveBeenCalledWith(reducer)
      expect(redux.applyMiddleware).toHaveBeenCalled()
      expect(mockDevtoolsCompose).toHaveBeenCalled() // @remap-prod-remove-line-line
      expect(redux.createStore).toHaveBeenCalledWith(
        expect.any(Function),
        undefined,
        expect.any(Function)
      )
    })
  })

  describe('given no reducer', () => {
    it('throws', () => {
      expect(configureStore).toThrow(
        '"reducer" is a required argument, and must be a function or an object of functions that can be passed to combineReducers'
      )
    })
  })

  describe('given no middleware', () => {
    it('calls createStore without any middleware', () => {
      expect(configureStore({ middleware: [], reducer })).toBeInstanceOf(Object)
      expect(redux.applyMiddleware).toHaveBeenCalledWith()
      expect(mockDevtoolsCompose).toHaveBeenCalled() // @remap-prod-remove-line-line
      expect(redux.createStore).toHaveBeenCalledWith(
        reducer,
        undefined,
        expect.any(Function)
      )
    })
  })

  describe('given undefined middleware', () => {
    it('calls createStore with default middleware', () => {
      expect(configureStore({ middleware: undefined, reducer })).toBeInstanceOf(
        Object
      )
      expect(redux.applyMiddleware).toHaveBeenCalledWith(
        expect.any(Function), // thunk
        expect.any(Function), // immutableCheck
        expect.any(Function) // serializableCheck
      )
      expect(mockDevtoolsCompose).toHaveBeenCalled() // @remap-prod-remove-line-line
      expect(redux.createStore).toHaveBeenCalledWith(
        reducer,
        undefined,
        expect.any(Function)
      )
    })
  })

  describe('given a middleware creation function that returns undefined', () => {
    it('throws an error', () => {
      const invalidBuilder = vi.fn((getDefaultMiddleware) => undefined as any)
      expect(() =>
        configureStore({ middleware: invalidBuilder, reducer })
      ).toThrow(
        'when using a middleware builder function, an array of middleware must be returned'
      )
    })
  })

  describe('given a middleware creation function that returns an array with non-functions', () => {
    it('throws an error', () => {
      const invalidBuilder = vi.fn((getDefaultMiddleware) => [true] as any)
      expect(() =>
        configureStore({ middleware: invalidBuilder, reducer })
      ).toThrow('each middleware provided to configureStore must be a function')
    })
  })

  describe('given custom middleware that contains non-functions', () => {
    it('throws an error', () => {
      expect(() =>
        configureStore({ middleware: [true] as any, reducer })
      ).toThrow('each middleware provided to configureStore must be a function')
    })
  })

  describe('given custom middleware', () => {
    it('calls createStore with custom middleware and without default middleware', () => {
      const thank: Redux.Middleware = (_store) => (next) => (action) =>
        next(action)
      expect(configureStore({ middleware: [thank], reducer })).toBeInstanceOf(
        Object
      )
      expect(redux.applyMiddleware).toHaveBeenCalledWith(thank)
      expect(mockDevtoolsCompose).toHaveBeenCalled() // @remap-prod-remove-line-line
      expect(redux.createStore).toHaveBeenCalledWith(
        reducer,
        undefined,
        expect.any(Function)
      )
    })
  })

  describe('middleware builder notation', () => {
    it('calls builder, passes getDefaultMiddleware and uses returned middlewares', () => {
      const thank = vi.fn(
        ((_store) => (next) => (action) => 'foobar') as Redux.Middleware
      )

      const builder = vi.fn((getDefaultMiddleware) => {
        expect(getDefaultMiddleware).toEqual(expect.any(Function))
        expect(getDefaultMiddleware()).toEqual(expect.any(Array))

        return [thank]
      })

      const store = configureStore({ middleware: builder, reducer })

      expect(builder).toHaveBeenCalled()

      expect(store.dispatch({ type: 'test' })).toBe('foobar')
    })
  })

  describe('with devTools disabled', () => {
    it('calls createStore without devTools enhancer', () => {
      expect(configureStore({ devTools: false, reducer })).toBeInstanceOf(
        Object
      )
      expect(redux.applyMiddleware).toHaveBeenCalled()
      expect(redux.compose).toHaveBeenCalled()
      expect(redux.createStore).toHaveBeenCalledWith(
        reducer,
        undefined,
        expect.any(Function)
      )
    })
  })

  describe('with devTools options', () => {
    it('calls createStore with devTools enhancer and option', () => {
      const options = {
        name: 'myApp',
        trace: true,
      }
      expect(configureStore({ devTools: options, reducer })).toBeInstanceOf(
        Object
      )
      expect(redux.applyMiddleware).toHaveBeenCalled()
      expect(mockDevtoolsCompose).toHaveBeenCalledWith(options) // @remap-prod-remove-line
      expect(redux.createStore).toHaveBeenCalledWith(
        reducer,
        undefined,
        expect.any(Function)
      )
    })
  })

  describe('given preloadedState', () => {
    it('calls createStore with preloadedState', () => {
      expect(configureStore({ reducer })).toBeInstanceOf(Object)
      expect(redux.applyMiddleware).toHaveBeenCalled()
      expect(mockDevtoolsCompose).toHaveBeenCalled() // @remap-prod-remove-line
      expect(redux.createStore).toHaveBeenCalledWith(
        reducer,
        undefined,
        expect.any(Function)
      )
    })
  })

  describe('given enhancers', () => {
    it('calls createStore with enhancers', () => {
      const enhancer: Redux.StoreEnhancer = (next) => next
      expect(configureStore({ enhancers: [enhancer], reducer })).toBeInstanceOf(
        Object
      )
      expect(redux.applyMiddleware).not.toHaveBeenCalled()
      expect(mockDevtoolsCompose).toHaveBeenCalled() // @remap-prod-remove-line
      expect(redux.createStore).toHaveBeenCalledWith(
        reducer,
        undefined,
        expect.any(Function)
      )
    })

    it('accepts a callback for customizing enhancers', () => {
      let dummyEnhancerCalled = false

      const dummyEnhancer: StoreEnhancer =
        (createStore) =>
        (reducer, ...args: any[]) => {
          dummyEnhancerCalled = true

          return createStore(reducer, ...args)
        }

      const reducer = () => ({})

      const store = configureStore({
        reducer,
        enhancers: (getDefaultEnhancers) =>
          getDefaultEnhancers().concat(dummyEnhancer),
      })

      expect(dummyEnhancerCalled).toBe(true)
    })
  })
})
