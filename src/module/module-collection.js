import Module from './module'
import { assert, forEachValue } from '../util'
// 收集并注册跟模块以及嵌套模块
export default class ModuleCollection {
  constructor (rawRootModule) {
    // register root module (Vuex.Store options) 注册模块
    this.register([], rawRootModule, false)
  }
  /**
   * 根据传入的path路径，获取我们想要的Module类
   * @param {*} path
   * @returns
   */
  get (path) {
    return path.reduce((module, key) => {
      return module.getChild(key)
    }, this.root)
  }

  /**
   * 根据模块是否有命名空间来设定一个路径名称
   * EG:
   * A:parent model B:son model C:child
   * B 的命名空间为 second ,C未定义；C继承B 为 sceond/
   * B 的命名空间为空，A为third ,那么B模块继承的是A的空间,c的空间为third/
   * @param {} path
   * @returns 未指定的命名空间的模块空间会继承父模块的命名空间
   */
  getNamespace (path) {
    let module = this.root
    return path.reduce((namespace, key) => {
      module = module.getChild(key)
      return namespace + (module.namespaced ? key + '/' : '')
    }, '')
  }

  update (rawRootModule) {
    update([], this.root, rawRootModule)
  }

  /**
   * 注册新的模块，根据模块的嵌套关系，将新的模块添加作为对应模块的子模块
   * @param {*} path 模块的嵌套关系，跟模块是，没有嵌套关系 path=[];
   * 不是根摸块时，存在嵌套关系 eg: path=[moduleA,moduleA1]
   * @param {*} rawModule 表示模块对象 ，vuex options
   * @param {*} runtime 表示程序运行时
   */
  register (path, rawModule, runtime = true) {
    if (__DEV__) {
      assertRawModule(path, rawModule)
    }

    const newModule = new Module(rawModule, runtime) // 初始化一个新模块
    if (path.length === 0) { // 没有其他模块
      this.root = newModule // 新模块为根模块
    } else {
      const parent = this.get(path.slice(0, -1)) // 获取父模块
      parent.addChild(path[path.length - 1], newModule) // 在父模块添加 新的子模块
    }

    // register nested modules 如果有嵌套的模块
    if (rawModule.modules) {
      // 遍历所有的子模块，并进行注册
      forEachValue(rawModule.modules, (rawChildModule, key) => {
        // 在path中存储所有子模块的名称
        this.register(path.concat(key), rawChildModule, runtime)
      })
    }
  }

  unregister (path) {
    const parent = this.get(path.slice(0, -1))
    const key = path[path.length - 1]
    const child = parent.getChild(key)

    if (!child) {
      if (__DEV__) {
        console.warn(
          `[vuex] trying to unregister module '${key}', which is ` +
          `not registered`
        )
      }
      return
    }

    if (!child.runtime) {
      return
    }

    parent.removeChild(key)
  }

  isRegistered (path) {
    const parent = this.get(path.slice(0, -1))
    const key = path[path.length - 1]

    if (parent) {
      return parent.hasChild(key)
    }

    return false
  }
}

function update (path, targetModule, newModule) {
  if (__DEV__) {
    assertRawModule(path, newModule)
  }

  // update target module
  targetModule.update(newModule)

  // update nested modules
  if (newModule.modules) {
    for (const key in newModule.modules) {
      if (!targetModule.getChild(key)) {
        if (__DEV__) {
          console.warn(
            `[vuex] trying to add a new module '${key}' on hot reloading, ` +
            'manual reload is needed'
          )
        }
        return
      }
      update(
        path.concat(key),
        targetModule.getChild(key),
        newModule.modules[key]
      )
    }
  }
}

const functionAssert = {
  assert: value => typeof value === 'function',
  expected: 'function'
}

const objectAssert = {
  assert: value => typeof value === 'function' ||
    (typeof value === 'object' && typeof value.handler === 'function'),
  expected: 'function or object with "handler" function'
}

const assertTypes = {
  getters: functionAssert,
  mutations: functionAssert,
  actions: objectAssert
}

function assertRawModule (path, rawModule) {
  Object.keys(assertTypes).forEach(key => {
    if (!rawModule[key]) return

    const assertOptions = assertTypes[key]

    forEachValue(rawModule[key], (value, type) => {
      assert(
        assertOptions.assert(value),
        makeAssertionMessage(path, key, type, value, assertOptions.expected)
      )
    })
  })
}

function makeAssertionMessage (path, key, type, value, expected) {
  let buf = `${key} should be ${expected} but "${key}.${type}"`
  if (path.length > 0) {
    buf += ` in module "${path.join('.')}"`
  }
  buf += ` is ${JSON.stringify(value)}.`
  return buf
}
