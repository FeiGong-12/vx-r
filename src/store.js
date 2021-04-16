import applyMixin from './mixin'
import devtoolPlugin from './plugins/devtool'
import ModuleCollection from './module/module-collection'
import {
  forEachValue,
  isObject,
  isPromise,
  assert,
  partial
} from './util'

// 定义Store

let Vue // bind on install

export class Store {
  constructor (options = {}) {
    // Auto install if it is not done yet and `window` has `Vue`.
    // To allow users to avoid auto-installation in some cases,
    // this code should be placed here. See #731
    if (!Vue && typeof window !== 'undefined' && window.Vue) {
      install(window.Vue)
    }

    if (__DEV__) {
      assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
      assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
      assert(this instanceof Store, `store must be called with the new operator.`)
    }

    // 入口参数
    const {
      plugins = [],
      strict = false
    } = options

    // store internal state

    /**
     *  state 提交的状态，当通过mutation方法改变state时，该状态为true；修完完后改为false；
     * 在严格模式下，修改state状态时，会查询_committing的状态，如果为false,代表不是从mutation下更改state值
     * 弹出警告
     */
    this._committing = false
    /**
     * 初始化action名称
     */
    this._actions = Object.create(null)
    this._actionSubscribers = [] // 存放action的订阅函数
    this._mutations = Object.create(null) // 初始化mutation方法名称
    this._wrappedGetters = Object.create(null) // 初始化所有包装后的getter
    this._modules = new ModuleCollection(options) // 根据传入的options注册各个模块，注册，建立模块关系。
    this._modulesNamespaceMap = Object.create(null) // 初始化命名空间模块
    this._subscribers = [] // 存放mutation的回调
    this._watcherVM = new Vue() // 监听getter,state
    this._makeLocalGettersCache = Object.create(null) // 初始化getter本地缓存

    // bind commit and dispatch to self
    const store = this
    // 将dispatch 和 commit 方法绑定到Store的实例上
    const {
      dispatch,
      commit
    } = this
    // 避免改变this指向
    this.dispatch = function boundDispatch (type, payload) {
      return dispatch.call(store, type, payload)
    }
    this.commit = function boundCommit (type, payload, options) {
      return commit.call(store, type, payload, options)
    }

    // strict mode 是否严格模式， true ： 更改state时必须由mutation来更改
    this.strict = strict

    const state = this._modules.root.state // 将根模块的state赋值给state常量

    // init root module.
    // this also recursively registers all sub-modules
    // and collects all module getters inside this._wrappedGetters
    // 从根模块开始，逐步完善各个模块信息
    installModule(this, state, [], this._modules.root)

    // initialize the store vm, which is responsible for the reactivity
    // (also registers _wrappedGetters as computed properties)
    // 注册vm
    resetStoreVM(this, state)

    // apply plugins 插件的调用
    plugins.forEach(plugin => plugin(this))

    const useDevtools = options.devtools !== undefined ? options.devtools : Vue.config.devtools
    if (useDevtools) { // 使用vue的开发插件
      devtoolPlugin(this)
    }
  }
  // 当访问state时，其实访问的是store._vm.data.$$state
  get state () {
    return this._vm._data.$$state
  }

  set state (v) {
    if (__DEV__) {
      assert(false, `use store.replaceState() to explicit replace store state.`)
    }
  }

  commit (_type, _payload, _options) {
    // check object-style commit，对传入的参数进行处理
    const {
      type,
      payload,
      options
    } = unifyObjectStyle(_type, _payload, _options)

    const mutation = {
      type,
      payload
    }
    const entry = this._mutations[type] // 参照mutation上是否有对应的方法
    if (!entry) {
      if (__DEV__) {
        console.error(`[vuex] unknown mutation type: ${type}`)
      }
      return
    }
    // 如果有相应的方法，就执行
    this._withCommit(() => {
      entry.forEach(function commitIterator (handler) {
        handler(payload)
      })
    })

    this._subscribers
      .slice() // shallow copy to prevent iterator invalidation if subscriber synchronously calls unsubscribe
      .forEach(sub => sub(mutation, this.state))

    if (
      __DEV__ &&
      options && options.silent
    ) {
      console.warn(
        `[vuex] mutation type: ${type}. Silent option has been removed. ` +
        'Use the filter functionality in the vue-devtools'
      )
    }
  }

  dispatch (_type, _payload) {
    // check object-style dispatch
    const {
      type,
      payload
    } = unifyObjectStyle(_type, _payload)

    const action = {
      type,
      payload
    }
    const entry = this._actions[type] // 查找actions 上的方法
    if (!entry) {
      if (__DEV__) {
        console.error(`[vuex] unknown action type: ${type}`)
      }
      return
    }

    try {
      this._actionSubscribers
        .slice() // shallow copy to prevent iterator invalidation if subscriber synchronously calls unsubscribe
        .filter(sub => sub.before)
        .forEach(sub => sub.before(action, this.state))
    } catch (e) {
      if (__DEV__) {
        console.warn(`[vuex] error in before action subscribers: `)
        console.error(e)
      }
    }
    // result 如果大于1，表示有多个异步方法，用promise。all进行包裹
    const result = entry.length > 1
      ? Promise.all(entry.map(handler => handler(payload)))
      : entry[0](payload)

    // 返回执行一个新的promise，内部判断返回的状态，resolve和reject
    return new Promise((resolve, reject) => {
      result.then(res => {
        try {
          this._actionSubscribers
            .filter(sub => sub.after)
            .forEach(sub => sub.after(action, this.state))
        } catch (e) {
          if (__DEV__) {
            console.warn(`[vuex] error in after action subscribers: `)
            console.error(e)
          }
        }
        resolve(res)
      }, error => {
        try {
          this._actionSubscribers
            .filter(sub => sub.error)
            .forEach(sub => sub.error(action, this.state, error))
        } catch (e) {
          if (__DEV__) {
            console.warn(`[vuex] error in error action subscribers: `)
            console.error(e)
          }
        }
        reject(error)
      })
    })
  }

  subscribe (fn, options) {
    return genericSubscribe(fn, this._subscribers, options)
  }

  subscribeAction (fn, options) {
    const subs = typeof fn === 'function' ? {
      before: fn
    } : fn
    return genericSubscribe(subs, this._actionSubscribers, options)
  }

  watch (getter, cb, options) {
    if (__DEV__) {
      assert(typeof getter === 'function', `store.watch only accepts a function.`)
    }
    return this._watcherVM.$watch(() => getter(this.state, this.getters), cb, options)
  }
  // 没被用到 在store._commit =true的状态下更新state，这是一种直接修改state的方法，而且不打印警告信息
  replaceState (state) {
    this._withCommit(() => {
      this._vm._data.$$state = state
    })
  }
  // 没被用到 注册模块
  registerModule (path, rawModule, options = {}) {
    if (typeof path === 'string') path = [path]

    if (__DEV__) {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
      assert(path.length > 0, 'cannot register the root module by using registerModule.')
    }

    this._modules.register(path, rawModule)
    installModule(this, this.state, path, this._modules.get(path), options.preserveState)
    // reset store to update getters...
    resetStoreVM(this, this.state)
  }

  // 卸载模块
  unregisterModule (path) {
    if (typeof path === 'string') path = [path]

    if (__DEV__) {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    this._modules.unregister(path)
    this._withCommit(() => {
      const parentState = getNestedState(this.state, path.slice(0, -1))
      Vue.delete(parentState, path[path.length - 1])
    })
    resetStore(this)
  }

  hasModule (path) {
    if (typeof path === 'string') path = [path]

    if (__DEV__) {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    return this._modules.isRegistered(path)
  }

  hotUpdate (newOptions) {
    this._modules.update(newOptions)
    resetStore(this, true)
  }

  _withCommit (fn) {
    const committing = this._committing
    this._committing = true
    fn()
    this._committing = committing
  }
}

function genericSubscribe (fn, subs, options) {
  if (subs.indexOf(fn) < 0) {
    options && options.prepend
      ? subs.unshift(fn)
      : subs.push(fn)
  }
  return () => {
    const i = subs.indexOf(fn)
    if (i > -1) {
      subs.splice(i, 1)
    }
  }
}
// 重置store
function resetStore (store, hot) {
  store._actions = Object.create(null)
  store._mutations = Object.create(null)
  store._wrappedGetters = Object.create(null)
  store._modulesNamespaceMap = Object.create(null)
  const state = store.state
  // init all modules
  installModule(store, state, [], store._modules.root, true)
  // reset vm
  resetStoreVM(store, state, hot)
}
/**
 * 初始化vm
 * 生成一个新的vm,然后将store._makeLocalGettersCache中的getters以及store.state交给vm托管
 * 即将store.state 赋值给_vm.data.$$state,将store._makeLocalGettersCache通过转化后赋值给vm.computed
 * 这样state就实现了响应式，getter就有了类似computed的功能
 * @param {*} store
 * @param {*} state
 * @param {*} hot
 */
function resetStoreVM (store, state, hot) {
  const oldVm = store._vm

  // bind store public getters 在实例上设置getter对象
  store.getters = {}
  // reset local getters cache 重置本地缓存
  store._makeLocalGettersCache = Object.create(null)
  const wrappedGetters = store._wrappedGetters
  const computed = {}
  // 遍历getters,将每一个getter注册到store。getters，访问对应的getter时会去vm上访问对应的computed
  forEachValue(wrappedGetters, (fn, key) => {
    // use computed to leverage its lazy-caching mechanism
    // direct inline function use will lead to closure preserving oldVm.
    // using partial to return function with only arguments preserved in closure environment.
    computed[key] = partial(fn, store)
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true // for local getters
    })
  })

  // use a Vue instance to store the state tree
  // suppress warnings just in case the user has added
  // some funky global mixins
  const silent = Vue.config.silent
  Vue.config.silent = true
  // 使用vue实例来存储vuex的state状态树，并利用computed去缓存getters返回的值
  store._vm = new Vue({
    data: {
      $$state: state
    },
    computed
  })
  Vue.config.silent = silent

  // enable strict mode for new vm 启用严格模式的监听警告
  if (store.strict) {
    enableStrictMode(store)
  }
  // 如果存在旧的vm，销毁旧的vm
  if (oldVm) {
    if (hot) {
      // dispatch changes in all subscribed watchers
      // to force getter re-evaluation for hot reloading.
      //  解除对旧的vm对data的应用
      store._withCommit(() => {
        oldVm._data.$$state = null
      })
    }
    Vue.nextTick(() => oldVm.$destroy())
  }
}
/**
 * 将实例对象store，state属性，路径，根模块对象一次作为参数传递
 * @param {*} store
 * @param {*} rootState
 * @param {*} path
 * @param {*} module
 * @param {*} hot
 */
function installModule (store, rootState, path, module, hot) {
  const isRoot = !path.length  // 是否为根模块
  // 调用module-collection 中getNamespace
  const namespace = store._modules.getNamespace(path) // 获取当前模块的命名空间

  // register in namespace map
  // 如果当前模块存在命名空间，那么在modulesNamespaceMap存储模块
  // （将所有的存在命名空间的模块记录，为之后的辅助函数可以调用）
  if (module.namespaced) {
    if (store._modulesNamespaceMap[namespace] && __DEV__) {
      console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
    }
    store._modulesNamespaceMap[namespace] = module
  }

  // set state  如果不是根模块，将当前的state存储到父级的state上。
  if (!isRoot && !hot) {
    // 获取父级state（根据当前的模块路径，从根模块的state开始找，最终找到当前模块父模块state，）
    const parentState = getNestedState(rootState, path.slice(0, -1))
    const moduleName = path[path.length - 1] // 当前模块名称
    store._withCommit(() => {
      if (__DEV__) {
        if (moduleName in parentState) {
          console.warn(
            `[vuex] state field "${moduleName}" was overridden by a module with the same name at "${path.join('.')}"`
          )
        }
      }
      Vue.set(parentState, moduleName, module.state) // 将当前模块的state注册到父级的state上
      // 使用vue的set方法，将当前模块state响应式式地添加到父模块的state上，是因为state放到一个Vue的data实例上
      // this.$store.state?.module.name -》使用的结果
    })
  }

  /**
   * 根据命名空间为每个模块创建一个属于该模块调用的上下文，并将该上下文赋值给了该模块的context属性
   */
  const local = module.context = makeLocalContext(store, namespace, path)

  // 注册模块所有的Mutation
  module.forEachMutation((mutation, key) => {
    const namespacedType = namespace + key
    registerMutation(store, namespacedType, mutation, local)
  })
  // 注册所有模块的actions
  module.forEachAction((action, key) => {
    /**
     * action:{
     *  asyncAdd({commit},cb){}
     *  asyncDelete:{
     *   root: true,
     *  handler:({commit},cb){}
     *  }
     * }
     */
    const type = action.root ? key : namespace + key // 判断是否在命名空间里注册一个全局的action
    const handler = action.handler || action // cb
    registerAction(store, type, handler, local)
  })

  // 注册所有的getter
  module.forEachGetter((getter, key) => {
    const namespacedType = namespace + key
    registerGetter(store, namespacedType, getter, local)
  })

  // 递归注册所有子模块
  module.forEachChild((child, key) => {
    installModule(store, rootState, path.concat(key), child, hot)
  })
}

/**
 * make localized dispatch, commit, getters and state
 * if there is no namespace, just use root ones
 * 如果设置了命名空间，则创建一个本地的dispatch,commit,getter,state,
 * 否则使用全局的store
 */
function makeLocalContext (store, namespace, path) {
  const noNamespace = namespace === ''

  const local = {
    // 当模块没有命名空间时，调用该上下文的dispatch方法会直接调用根模块的dispatch，而存在命名空间时，会先判断相应
    // 的命名空间
    dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const {
        payload,
        options
      } = args
      let {
        type
      } = args

      // 若传入了第三个参数设置了root:true,则派发的是全局上对应的action方法。
      if (!options || !options.root) {
        type = namespace + type
        if (__DEV__ && !store._actions[type]) {
          console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
          return
        }
      }

      return store.dispatch(type, payload)
    },

    commit: noNamespace ? store.commit : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const {
        payload,
        options
      } = args
      let {
        type
      } = args

      if (!options || !options.root) {
        type = namespace + type
        if (__DEV__ && !store._mutations[type]) {
          console.error(`[vuex] unknown local mutation type: ${args.type}, global type: ${type}`)
          return
        }
      }

      store.commit(type, payload, options)
    }
  }

  // getters and state object must be gotten lazily
  // because they will be changed by vm update
  // 如果没有命名空间，getter直接读取store.getter，否则在_makeLocalGettersCache 缓存中寻找
  // 通过object.defineProperties给local的gettershe 和state做了一个代理
  Object.defineProperties(local, {
    getters: {
      get: noNamespace
        ? () => store.getters
        : () => makeLocalGetters(store, namespace)
    },
    state: {
      get: () => getNestedState(store.state, path)
    }
  })

  return local
}

// 创建本地getter缓存
function makeLocalGetters (store, namespace) {
  if (!store._makeLocalGettersCache[namespace]) {
    const gettersProxy = {}
    const splitPos = namespace.length
    Object.keys(store.getters).forEach(type => {
      // skip if the target getter is not match this namespace
      // 如果store.getters 中没有与那么space匹配的getters,那么不进行任何操作
      if (type.slice(0, splitPos) !== namespace) return

      // extract local getter type，获取本地getter名称
      const localType = type.slice(splitPos)

      // Add a port to the getters proxy. 对getter添加一层代理
      // Define as getter property because
      // we do not want to evaluate the getters in this time.
      Object.defineProperty(gettersProxy, localType, {
        get: () => store.getters[type],
        enumerable: true
      })
    })
    // 把代理过的getter缓存到本地
    store._makeLocalGettersCache[namespace] = gettersProxy
  }

  return store._makeLocalGettersCache[namespace]
}
/**
 * 注册mutation、
  根据type(namespacedType)在store_mutations中寻找是否有entry
  将当前的mutations方法添加到entry末尾进行存储，其中mutation接受的参数有2个
  1个是上下文的localstate，还有一个是参数payload
  由此 store.mutation 都是由口岸至对方是进行存放的
  store._mutations = {
    'mutations1': [function handler() {...}],
    'ModuleA/mutations2': [function handler() {...}, function handler() {...}],
    'ModuleA/ModuleB/mutations2': [function handler() {...}]
  }
  键值由命名空间和mutations方法名组成，值是一个数组，存放着该键对应的mutation方法
 * 如果子模块没有设置命名空间，那么它会继承父模块的。如果方法重名，为了保证方法不被替换，就选择添加到数组末尾，
  此时，如果后续调用到该mutation方方，会先获取到相应的数组，然后遍历依次执行
 * @param {*} store
 * @param {*} type
 * @param {*} handler
 * @param {*} local
 */
function registerMutation (store, type, handler, local) {
  const entry = store._mutations[type] || (store._mutations[type] = [])
  entry.push(function wrappedMutationHandler (payload) {
    handler.call(store, local.state, payload)
  })
}
/**
 * 注册actions方法，接受两个参数，context（包含上下文中的state，dispatch，commit方法，getter方法），传入的参数payload
 * 先获取entry入口，然后将当前的actions进行包装添加到entry的末尾，最后对返回结果进行一个异步处理。
 * @param {*} store
 * @param {*} type
 * @param {*} handler
 * @param {*} local
 */
function registerAction (store, type, handler, local) {
  const entry = store._actions[type] || (store._actions[type] = [])
  entry.push(function wrappedActionHandler (payload) {
    let res = handler.call(store, {
      dispatch: local.dispatch,
      commit: local.commit,
      getters: local.getters,
      state: local.state,
      rootGetters: store.getters,
      rootState: store.state
    }, payload)
    // 确保返回一个promise函数
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }
    if (store._devtoolHook) {
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      return res
    }
  })
}

/**
 * getter和action，mutationion不同，没有获取入口，而是通过键值对直接查看是否有重复的getter，若干有那么不记录
 * 否则就包装在store._wrappedGetterS中，接受4个参数，2个上下文的state，getter,2个根模块的state,getter
 * 由此看出getter不能重名
 * @param {*} store
 * @param {*} type
 * @param {*} rawGetter
 * @param {*} local
 * @returns
 */
function registerGetter (store, type, rawGetter, local) {
  if (store._wrappedGetters[type]) { // 如果记录过getters 那么就不在重复记录
    if (__DEV__) {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }
  // 在_wrappedGetters中记录getters
  store._wrappedGetters[type] = function wrappedGetter (store) {
    return rawGetter(
      local.state, // local state
      local.getters, // local getters
      store.state, // root state
      store.getters // root getters
    )
  }
}

function enableStrictMode (store) {
  store._vm.$watch(function () {
    return this._data.$$state
  }, () => {
    if (__DEV__) {
      assert(store._committing, `do not mutate vuex store state outside mutation handlers.`)
    }
  }, {
    deep: true,
    sync: true
  })
}
// 获取到嵌套模式的state
function getNestedState (state, path) {
  return path.reduce((state, key) => state[key], state)
}
/**
 * commit提交转换
 * 第一种提交方式
  this.$store.commit('func', 1)

  第二种提交方式
  this.$store.commit({
    type: 'func',
    num: 1
  })

 * @param {}} type
 * @param {*} payload
 * @param {*} options
 * @returns
 */
function unifyObjectStyle (type, payload, options) {
  if (isObject(type) && type.type) {
    options = payload
    payload = type
    type = type.type
  }

  if (__DEV__) {
    assert(typeof type === 'string', `expects string as the type, but found ${typeof type}.`)
  }

  return {
    type,
    payload,
    options
  }
}
/**
 * 当调用vue.use(vuex)时，调用这个方法，判断vuex是否已经被注册，弱已经注册，则不执行任何操作，若没有被注册，那么
 * 调用applyMixin方法。
 * @param {*} _Vue
 * @returns
 */
export function install (_Vue) {
  if (Vue && _Vue === Vue) {
    if (__DEV__) {
      console.error(
        '[vuex] already installed. Vue.use(Vuex) should be called only once.'
      )
    }
    return
  }
  Vue = _Vue
  applyMixin(Vue)
}
