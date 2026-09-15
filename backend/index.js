/**
 * CloudBase 云函数的入口（**必须是 CommonJS**）。
 *
 * 为什么这里不能写成 ESM：CloudBase 的运行时是用 `require()` 加载入口的。
 * 这一点是实测出来的 —— 部署一个什么都不做的 `export function main` 也会崩，
 * 平台只回一句 "0 code exit unexpected"，看不出所以然。
 * 换运行时到 Node 24（理论上支持 require(esm)）也一样，说明是它的加载器不认 ESM。
 * 而同样的代码写成 `exports.main = ...` 立刻就跑通了。
 *
 * 所以这里的策略是：入口做成 CommonJS 壳，真正的逻辑放在 app.mjs 里动态载入。
 * 于是 `_lib/**` 和 `api/**` 全都能保持 ESM（扩展名 .mjs），99 个测试不用动、
 * 也不涉及任何 CJS 互操作的坑。
 *
 * 这层壳很薄，不值得为它把整个后端改写成 CommonJS。
 */

/** 载入一次就缓存住，后续请求复用；失败了下次请求还能重试 */
let appPromise = null;

function loadApp() {
  if (!appPromise) {
    appPromise = import('./app.mjs').catch((error) => {
      // 把失败的 promise 丢掉，否则一次加载失败会让这个实例永久瘫痪
      appPromise = null;
      throw error;
    });
  }
  return appPromise;
}

exports.main = async function main(event, context) {
  const app = await loadApp();
  return app.main(event, context);
};
