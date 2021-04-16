// 定义Module类， 存储模块内的一些信息， state
import { forEachValue } from '../util'

// Base data struct for store's module, package with some attribute and method

export default class Module {
  // 在生成Module时，mutation,action,getter都没有进行定义。只定义了state.
  constructor (rawModule, runtime) {
    this.runtime = runtime
    // Store some children item
    this._children = Object.create(null) // 创建一个空对象，用于存放模块中的子模块
    // Store the origin module object which passed by programmer
    this._rawModule = rawModule // 把options赋值到_rawModule中
    const rawState = rawModule.state // 赋值options中的state对象

    // Store the origin module's state 存储当前的state模块
    this.state = (typeof rawState === 'function' ? rawState() : rawState) || {}
  }

  // 判断当前模块是否定义命名空间
  get namespaced () {
    return !!this._rawModule.namespaced
  }
  // 添加子模块
  addChild (key, module) {
    this._children[key] = module
  }

  // 删除子模块
  removeChild (key) {
    delete this._children[key]
  }

  // 获得子模块
  getChild (key) {
    return this._children[key]
  }

  // 判断是否包含子模块
  hasChild (key) {
    return key in this._children
  }

  //  更新namespaced, actions, mutaions，getters的调用来源
  update (rawModule) {
    this._rawModule.namespaced = rawModule.namespaced
    if (rawModule.actions) {
      this._rawModule.actions = rawModule.actions
    }
    if (rawModule.mutations) {
      this._rawModule.mutations = rawModule.mutations
    }
    if (rawModule.getters) {
      this._rawModule.getters = rawModule.getters
    }
  }
  // 遍历执行回调当前模块的子模块
  forEachChild (fn) {
    forEachValue(this._children, fn)
  }

  // 遍历回调当前模块的getter.
  forEachGetter (fn) {
    if (this._rawModule.getters) {
      forEachValue(this._rawModule.getters, fn)
    }
  }

  // 遍历回调当前模块的actions
  forEachAction (fn) {
    if (this._rawModule.actions) {
      forEachValue(this._rawModule.actions, fn)
    }
  }

  // 遍历回调当前模块的mutations.
  forEachMutation (fn) {
    if (this._rawModule.mutations) {
      forEachValue(this._rawModule.mutations, fn)
    }
  }
}
