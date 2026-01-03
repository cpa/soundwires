export const bandPower = (data: Float32Array, index: number): number => {
  const start = Math.max(0, index - 1)
  const end = Math.min(data.length - 1, index + 1)
  let total = 0
  let count = 0
  for (let i = start; i <= end; i += 1) {
    total += data[i]
    count += 1
  }
  return total / Math.max(count, 1)
}

export const frequencyToIndex = (frequency: number, sampleRate: number, fftSize: number): number => {
  const binSize = sampleRate / fftSize
  return Math.round(frequency / binSize)
}
