// 将vuex实例 挂载到Vue上
export default function (Vue) {
  const version = Number(Vue.version.split('.')[0])
  // 2.0版本通过全局混入Vue.minix的方式挂载store
  if (version >= 2) {
    /**
     * 通过Vue.mixin方法做了一个全局混入，在每个组件beforeCreate生命周期会调用vuexInit方法，首先获取当前组件$options，判断
     * 单签组件是否有store，若有，就将store赋值给当前组件，如果没有就代表不是根组件，就从父组件上获取，并赋值当前组件，所有
     * 就可以通过this.$store访问到了store了。
     */
    Vue.mixin({ beforeCreate: vuexInit })
  } else {
    // override init and inject vuex init procedure
    // for 1.x backwards compatibility. 兼容1.0版本
    const _init = Vue.prototype._init
    Vue.prototype._init = function (options = {}) {
      options.init = options.init
        ? [vuexInit].concat(options.init)
        : vuexInit
      _init.call(this, options)
    }
  }

  /**
   * Vuex init hook, injected into each instances init hooks list.
   */
  // 将vuex混入到$options中
  function vuexInit () {
    const options = this.$options // 获取当前组件的options
    // store injection 如果当前组件的options上有store，那么将options.store赋值给this.$store（用于根组件）
    if (options.store) {
      this.$store = typeof options.store === 'function'
        ? options.store()
        : options.store
    } else if (options.parent && options.parent.$store) { // 如果没有，则获取父组件的$store，键它赋值给this.$store
      this.$store = options.parent.$store
    }
  }
}
