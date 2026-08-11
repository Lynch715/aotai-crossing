// 可复现伪随机数发生器（mulberry32）。
// 判定必须可复现：同一存档重放要得到同样的结果，否则存档回放和 bug 复现都做不了。
export function makeRng(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 闭区间 [min, max] 内的整数
export function rollInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1))
}
