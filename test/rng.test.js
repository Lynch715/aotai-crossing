import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeRng, rollInt } from '../src/engine/rng.js'

test('同一种子产出同一序列', () => {
  const a = makeRng(12345)
  const b = makeRng(12345)
  const seqA = [a(), a(), a(), a(), a()]
  const seqB = [b(), b(), b(), b(), b()]
  assert.deepEqual(seqA, seqB)
})

test('不同种子产出不同序列', () => {
  const a = makeRng(1)
  const b = makeRng(2)
  assert.notDeepEqual([a(), a(), a()], [b(), b(), b()])
})

test('种子 0 产出有效且可复现', () => {
  const a = makeRng(0)
  const b = makeRng(0)
  const seqA = [a(), a(), a(), a(), a()]
  const seqB = [b(), b(), b(), b(), b()]
  assert.deepEqual(seqA, seqB)
  assert.ok(seqA.every((v) => v >= 0 && v < 1))
  assert.ok(new Set(seqA).size > 1, '序列退化：所有值相同')
})

test('产出值落在 [0, 1)', () => {
  const rng = makeRng(999)
  for (let i = 0; i < 1000; i++) {
    const v = rng()
    assert.ok(v >= 0 && v < 1, `越界: ${v}`)
  }
})

test('rollInt 落在闭区间内且可复现', () => {
  const rng = makeRng(7)
  const vals = []
  for (let i = 0; i < 200; i++) vals.push(rollInt(rng, 1, 6))
  assert.ok(vals.every((v) => v >= 1 && v <= 6))
  assert.ok(vals.includes(1) && vals.includes(6))

  const rngB = makeRng(7)
  const valsB = []
  for (let i = 0; i < 200; i++) valsB.push(rollInt(rngB, 1, 6))
  assert.deepEqual(vals, valsB)
})
