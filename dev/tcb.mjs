/**
 * 调用 CloudBase CLI 的薄封装。
 *
 *   node dev/tcb.mjs <参数数组.json>
 *
 * 为什么要绕这一下：PowerShell 5.1 向原生程序传参时会把引号吃掉，
 * 而 `tcb` 有些参数本身就是一整段 JSON（比如 `routes add --data '{...}'`）。
 * 直接写 `tcb routes add --data '[{"path":"/api"}]'` 到达 CLI 时引号已经没了，
 * 报一个和真实原因无关的 "JSON parse failed"。
 *
 * 所以把参数数组放进 JSON 文件（用编辑器写，不经过 shell），
 * 再用 Node 的 spawnSync 以数组形式传参 —— 不经过 shell，引号原样送达。
 *
 * 例：参数文件内容为
 *   ["routes", "add", "-e", "sm-xxx", "--data", "{\"domain\":\"*\"}"]
 * 然后
 *   node dev/tcb.mjs args.json
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const argsFile = process.argv[2]
if (!argsFile) {
  console.error('用法: node dev/tcb.mjs <参数数组.json>')
  process.exit(1)
}

let args
try {
  args = JSON.parse(readFileSync(argsFile, 'utf8'))
} catch (error) {
  console.error(`读不出参数文件 ${argsFile}: ${error.message}`)
  process.exit(1)
}
if (!Array.isArray(args)) {
  console.error('参数文件必须是一个 JSON 数组')
  process.exit(1)
}

// 支持 @路径 语法：把该参数替换成文件内容。
// JSON 里再嵌一段 JSON 字符串要三重转义，极容易写错；写成独立文件就干净了。
// 例：["db","nosql","execute","--command","@payload.json"]
const argsDir = path.dirname(path.resolve(argsFile))
args = args.map((arg) => {
  if (typeof arg !== 'string' || !arg.startsWith('@')) return arg
  return readFileSync(path.resolve(argsDir, arg.slice(1)), 'utf8').trim()
})

// 直接用 node 跑 CLI 的入口，不走 .cmd shim —— shim 会再经过一次 shell。
const npmRoot = execSync('npm root -g', { encoding: 'utf8' }).trim()
const cliEntry = path.join(npmRoot, '@cloudbase', 'cli', 'bin', 'tcb')

const result = spawnSync(process.execPath, [cliEntry, ...args], {
  stdio: 'inherit',
  cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
})

process.exit(result.status ?? 1)
